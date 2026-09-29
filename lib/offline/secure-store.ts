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

export async function getSecurePendingMutations(tenantId?: string): Promise<SyncMutation[]> {
  const rows = tenantId
    ? await localDb.mutations
        .where('tenantId')
        .equals(tenantId)
        .filter((item) => item.status === 'pending' || item.status === 'failed')
        .sortBy('timestamp')
    : await localDb.mutations
        .filter((item) => item.status === 'pending' || item.status === 'failed')
        .sortBy('timestamp');

  return Promise.all(rows.map(decryptMutation));
}

export async function getSecureMutation(id: string): Promise<SyncMutation | null> {
  const row = await localDb.mutations.get(id);
  return row ? decryptMutation(row) : null;
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
        (entity as any).patientId ||
        (entity as any).encounterId ||
        (entity as any).orderId ||
        (entity as any).tokenId ||
        (entity as any).evidenceId ||
        (entity as any).findingId ||
        (entity as any).balanceId ||
        (entity as any).itemId ||
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
          Number((entity as any).version || (entity as any).serverVersion || 0) || undefined,
        vectorClock: ((entity as any).vectorClock || undefined) as VectorClock | undefined,
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

export async function remapEdgeEntityIds(
  tenantId: string,
  mappings: Array<{ localId: string; canonicalId: string }>
): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  for (const mapping of mappings) {
    const rows = await localDb.edge_entities
      .where('tenantId')
      .equals(normalizedTenantId)
      .filter((row) => row.entityId === mapping.localId)
      .toArray();

    for (const row of rows) {
      await localDb.edge_entities.delete(row.key);
      await localDb.edge_entities.put({
        ...row,
        key: `${normalizedTenantId}:${row.collection}:${mapping.canonicalId}`,
        entityId: mapping.canonicalId,
        updatedAt: Date.now(),
      });
    }
  }
}
