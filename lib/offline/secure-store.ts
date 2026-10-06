'use client';

import type {
  EdgeEntityMapping,
  EdgeEntityRecord,
  EdgeSyncMetadata,
  MutationAction,
  SyncMutation,
  VectorClock,
} from '@/types/offline';
import { localDb } from '@/lib/offline/db';
import { decryptEdgeJson, encryptEdgeJson, isEncryptedEdgeEnvelope } from '@/lib/offline/crypto';

export interface SecureMutationInput {
  id: string;
  tenantId: string;
  actorId: string;
  collection: string;
  action: MutationAction;
  resourceId: string;
  commandType: string;
  idempotencyKey: string;
  schemaVersion: number;
  baseEntityVersion?: number;
  dependsOnMutationIds?: string[];
  baseVectorClock?: VectorClock;
  payload: Record<string, unknown>;
  vectorClock: VectorClock;
  clientTimestamp: number;
}

export async function putSecureMutation(input: SecureMutationInput): Promise<SyncMutation> {
  const encryptedPayload = await encryptEdgeJson(input.tenantId, input.actorId, input.payload);
  const mutation: SyncMutation = {
    id: input.id,
    tenantId: input.tenantId,
    actorId: input.actorId,
    collection: input.collection,
    docId: input.resourceId,
    resourceId: input.resourceId,
    action: input.action,
    commandType: input.commandType,
    idempotencyKey: input.idempotencyKey,
    schemaVersion: input.schemaVersion,
    baseEntityVersion: input.baseEntityVersion,
    dependsOnMutationIds: input.dependsOnMutationIds,
    baseVectorClock: input.baseVectorClock,
    // PHI is not persisted in plaintext. The public read path restores payload in memory.
    payload: {},
    encryptedPayload,
    vectorClock: input.vectorClock,
    timestamp: input.clientTimestamp,
    clientTimestamp: input.clientTimestamp,
    retryCount: 0,
    status: 'pending',
  };

  await localDb.mutations.put(mutation);
  return { ...mutation, payload: input.payload };
}

async function decryptMutation(mutation: SyncMutation): Promise<SyncMutation> {
  if (!mutation.encryptedPayload || !isEncryptedEdgeEnvelope(mutation.encryptedPayload)) {
    return mutation;
  }
  const payload = await decryptEdgeJson<Record<string, unknown>>(mutation.encryptedPayload);
  return { ...mutation, payload };
}

export async function getSecurePendingMutations(
  tenantId: string,
  actorId: string
): Promise<SyncMutation[]> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const normalizedActorId = String(actorId || '').trim();
  if (!normalizedTenantId || !normalizedActorId) return [];

  // Shared-workstation boundary: filter ownership before decrypting any PHI.
  const rows = await localDb.mutations
    .where('tenantId')
    .equals(normalizedTenantId)
    .filter(
      (item) =>
        item.actorId === normalizedActorId &&
        (item.status === 'pending' || item.status === 'failed')
    )
    .sortBy('timestamp');

  return Promise.all(rows.map(decryptMutation));
}

export async function getSecurePendingVectorClock(
  tenantId: string,
  actorId: string
): Promise<VectorClock> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const normalizedActorId = String(actorId || '').trim();
  if (!normalizedTenantId || !normalizedActorId) return {};

  const rows = await localDb.mutations
    .where('tenantId')
    .equals(normalizedTenantId)
    .filter(
      (item) =>
        item.actorId === normalizedActorId &&
        item.status !== 'conflict'
    )
    .toArray();

  return rows.reduce<VectorClock>((clock, mutation) => {
    const next = mutation.vectorClock || {};
    const nodes = new Set([...Object.keys(clock), ...Object.keys(next)]);
    const merged: VectorClock = { ...clock };
    for (const node of nodes) {
      merged[node] = Math.max(clock[node] || 0, next[node] || 0);
    }
    return merged;
  }, {});
}

export async function getSecureMutation(
  id: string,
  actorId: string
): Promise<SyncMutation | null> {
  const row = await localDb.mutations.get(id);
  if (!row || row.actorId !== actorId) return null;
  return decryptMutation(row);
}

export async function replaceSecureTenantEdgeSnapshot(
  tenantId: string,
  actorId: string,
  collections: Record<string, Array<Record<string, unknown>>>,
  metadata: Omit<EdgeSyncMetadata, 'key' | 'tenantId' | 'scope'> & { scope?: string }
): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  if (!normalizedTenantId || !actorId) throw new Error('EDGE_CRYPTO_CONTEXT_REQUIRED');

  const records: EdgeEntityRecord[] = [];
  for (const [collection, entities] of Object.entries(collections || {})) {
    for (const entity of entities || []) {
      const entityId = String(
        (entity as any).id ||
        (entity as any).openItemId ||
        (entity as any).escalationId ||
        (entity as any).consultationId ||
        (entity as any).handoffId ||
        (entity as any).orderId ||
        (entity as any).tokenId ||
        (entity as any).evidenceId ||
        (entity as any).findingId ||
        (entity as any).balanceId ||
        (entity as any).itemId ||
        (entity as any).encounterId ||
        (entity as any).patientId ||
        ''
      ).trim();
      if (!entityId) continue;

      records.push({
        key: `${normalizedTenantId}:${collection}:${entityId}`,
        tenantId: normalizedTenantId,
        collection,
        entityId,
        data: {},
        encryptedData: await encryptEdgeJson(normalizedTenantId, actorId, entity),
        actorId,
        updatedAt: Date.now(),
        serverVersion:
          Number(
            (entity as any)._serverVersion ||
            (entity as any).serverVersion ||
            (entity as any).version ||
            0
          ) || undefined,
        vectorClock: (
          (entity as any)._vectorClock ||
          (entity as any).vectorClock ||
          undefined
        ) as VectorClock | undefined,
      });
    }
  }

  const collectionNames = Object.keys(collections || {});
  await localDb.transaction(
    'rw',
    localDb.edge_entities,
    localDb.sync_metadata,
    async () => {
      for (const collection of collectionNames) {
        await localDb.edge_entities
          .where('[tenantId+collection]')
          .equals([normalizedTenantId, collection])
          .delete();
      }
      if (records.length) await localDb.edge_entities.bulkPut(records);
      const scope = metadata.scope || 'clinical-core';
      await localDb.sync_metadata.put({
        key: `${normalizedTenantId}:${scope}`,
        tenantId: normalizedTenantId,
        scope,
        snapshotVersion: metadata.snapshotVersion,
        lastHydratedAt: metadata.lastHydratedAt,
        serverGeneratedAt: metadata.serverGeneratedAt,
      });
    }
  );
}

export async function listSecureEdgeEntities<T extends Record<string, unknown> = Record<string, unknown>>(
  tenantId: string,
  actorId: string,
  collection: string
): Promise<T[]> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const rows = await localDb.edge_entities
    .where('[tenantId+collection]')
    .equals([normalizedTenantId, collection])
    .toArray();

  const visible = rows.filter((row) => !row.deleted);
  const decoded = await Promise.all(
    visible.map(async (row) => {
      if (row.encryptedData && isEncryptedEdgeEnvelope(row.encryptedData)) {
        if (row.actorId && row.actorId !== actorId) {
          throw new Error('EDGE_CACHE_ACTOR_MISMATCH');
        }
        return decryptEdgeJson<T>(row.encryptedData);
      }
      return row.data as T;
    })
  );

  return decoded;
}

export async function putSecureEdgeEntities(
  tenantId: string,
  actorId: string,
  collection: string,
  entities: Array<Record<string, unknown>>
): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  if (!normalizedTenantId || !actorId) throw new Error('EDGE_CRYPTO_CONTEXT_REQUIRED');

  const rows: EdgeEntityRecord[] = [];
  for (const entity of entities) {
    const entityId = String(
      (entity as any).id ||
      (entity as any).openItemId ||
      (entity as any).escalationId ||
      (entity as any).consultationId ||
      (entity as any).handoffId ||
      (entity as any).orderId ||
      (entity as any).tokenId ||
      (entity as any).evidenceId ||
      (entity as any).encounterId ||
      (entity as any).patientId ||
      ''
    ).trim();
    if (!entityId) continue;
    rows.push({
      key: `${normalizedTenantId}:${collection}:${entityId}`,
      tenantId: normalizedTenantId,
      collection,
      entityId,
      data: {},
      encryptedData: await encryptEdgeJson(normalizedTenantId, actorId, entity),
      actorId,
      updatedAt: Date.now(),
      serverVersion:
        Number(
          (entity as any)._serverVersion ||
          (entity as any).serverVersion ||
          (entity as any).version ||
          0
        ) || undefined,
      vectorClock: (
        (entity as any)._vectorClock ||
        (entity as any).vectorClock ||
        undefined
      ) as VectorClock | undefined,
    });
  }
  if (rows.length) await localDb.edge_entities.bulkPut(rows);
}

export async function getSecureEdgeEntityMetadata(
  tenantId: string,
  actorId: string,
  collection: string,
  entityId: string
): Promise<{ serverVersion?: number; vectorClock?: VectorClock } | null> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const normalizedActorId = String(actorId || '').trim();
  const normalizedCollection = String(collection || '').trim();
  const normalizedEntityId = String(entityId || '').trim();
  if (!normalizedTenantId || !normalizedActorId || !normalizedCollection || !normalizedEntityId) {
    return null;
  }

  const row = await localDb.edge_entities.get(
    `${normalizedTenantId}:${normalizedCollection}:${normalizedEntityId}`
  );
  if (!row || row.actorId !== normalizedActorId) return null;

  return {
    serverVersion: row.serverVersion,
    vectorClock: row.vectorClock,
  };
}

export async function updateSecureEdgeEntityVersion(
  tenantId: string,
  actorId: string,
  collection: string,
  entityId: string,
  serverVersion?: number,
  vectorClock?: VectorClock
): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const normalizedActorId = String(actorId || '').trim();
  const key = `${normalizedTenantId}:${collection}:${entityId}`;
  const row = await localDb.edge_entities.get(key);
  if (!row || row.actorId !== normalizedActorId) return;

  await localDb.edge_entities.update(key, {
    ...(typeof serverVersion === 'number' ? { serverVersion } : {}),
    ...(vectorClock ? { vectorClock } : {}),
    updatedAt: Date.now(),
  });
}

export async function putLocalEntityMappings(
  tenantId: string,
  mappings: Array<{
    localId: string;
    entityType: string;
    sourceMutationId?: string;
  }>
): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const now = Date.now();
  const rows: EdgeEntityMapping[] = mappings.map((mapping) => ({
    key: `${normalizedTenantId}:${mapping.entityType}:${mapping.localId}`,
    tenantId: normalizedTenantId,
    localId: mapping.localId,
    entityType: mapping.entityType,
    status: 'LOCAL_ONLY',
    sourceMutationId: mapping.sourceMutationId,
    createdAt: now,
    updatedAt: now,
  }));
  if (rows.length) await localDb.entity_map.bulkPut(rows);
}

export async function putEntityMappings(
  tenantId: string,
  mappings: Array<{
    localId: string;
    canonicalId: string;
    entityType: string;
    sourceMutationId?: string;
  }>
): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const now = Date.now();
  const rows: EdgeEntityMapping[] = mappings.map((mapping) => ({
    key: `${normalizedTenantId}:${mapping.entityType}:${mapping.localId}`,
    tenantId: normalizedTenantId,
    localId: mapping.localId,
    canonicalId: mapping.canonicalId,
    entityType: mapping.entityType,
    status: 'MAPPED',
    sourceMutationId: mapping.sourceMutationId,
    createdAt: now,
    updatedAt: now,
  }));
  if (rows.length) await localDb.entity_map.bulkPut(rows);
}

export async function resolveCanonicalId(
  tenantId: string,
  localId: string
): Promise<string> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const mappings = await localDb.entity_map
    .where('tenantId')
    .equals(normalizedTenantId)
    .filter((row) => row.localId === localId && row.status === 'MAPPED' && Boolean(row.canonicalId))
    .toArray();
  return mappings[0]?.canonicalId || localId;
}

export async function resolveMappedReferences<T>(
  tenantId: string,
  value: T
): Promise<T> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const mappings = await localDb.entity_map
    .where('tenantId')
    .equals(normalizedTenantId)
    .filter((row) => row.status === 'MAPPED' && Boolean(row.canonicalId))
    .toArray();

  const lookup = new Map(
    mappings
      .filter((row) => row.canonicalId)
      .map((row) => [row.localId, row.canonicalId as string])
  );

  const rewrite = (input: unknown): unknown => {
    if (typeof input === 'string') return lookup.get(input) || input;
    if (Array.isArray(input)) return input.map(rewrite);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, item]) => [key, rewrite(item)])
      );
    }
    return input;
  };

  return rewrite(value) as T;
}

export interface SecureSyncConflict {
  id: string;
  mutationId: string;
  tenantId: string;
  collection: string;
  resourceId?: string;
  clientData: Record<string, unknown>;
  conflictType: string;
  reason?: string;
  timestamp: number;
}

export async function recordSecureConflict(
  tenantId: string,
  actorId: string,
  conflict: Omit<SecureSyncConflict, 'timestamp'>
): Promise<void> {
  const row = {
    ...conflict,
    timestamp: Date.now(),
  };
  await putSecureEdgeEntities(tenantId, actorId, 'conflicts', [row]);
}

export async function getSecureConflicts(
  tenantId: string,
  actorId: string
): Promise<SecureSyncConflict[]> {
  return listSecureEdgeEntities<SecureSyncConflict & Record<string, unknown>>(
    tenantId,
    actorId,
    'conflicts'
  ) as Promise<SecureSyncConflict[]>;
}

export async function remapEdgeEntityIds(
  tenantId: string,
  mappings: Array<{ localId: string; canonicalId: string }>
): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  const lookup = new Map(mappings.map((mapping) => [mapping.localId, mapping.canonicalId]));

  const rewrite = (input: unknown): unknown => {
    if (typeof input === 'string') return lookup.get(input) || input;
    if (Array.isArray(input)) return input.map(rewrite);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, item]) => [key, rewrite(item)])
      );
    }
    return input;
  };

  const rows = await localDb.edge_entities
    .where('tenantId')
    .equals(normalizedTenantId)
    .toArray();

  for (const row of rows) {
    let data = row.data as Record<string, unknown>;
    if (row.encryptedData && isEncryptedEdgeEnvelope(row.encryptedData)) {
      data = await decryptEdgeJson<Record<string, unknown>>(row.encryptedData);
    }
    const rewritten = rewrite(data) as Record<string, unknown>;
    const nextEntityId = lookup.get(row.entityId) || row.entityId;
    const nextKey = `${normalizedTenantId}:${row.collection}:${nextEntityId}`;

    if (!row.actorId) {
      throw new Error('EDGE_CACHE_ACTOR_REQUIRED_FOR_REMAP');
    }

    const encryptedData = await encryptEdgeJson(normalizedTenantId, row.actorId, rewritten);
    if (nextKey !== row.key) await localDb.edge_entities.delete(row.key);
    await localDb.edge_entities.put({
      ...row,
      key: nextKey,
      entityId: nextEntityId,
      data: {},
      encryptedData,
      updatedAt: Date.now(),
    });
  }
}
