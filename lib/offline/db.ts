import Dexie, { Table } from 'dexie';
import {
  SyncMutation,
  MutationAction,
  MutationStatus,
  EdgeEntityRecord,
  EdgeEntityMapping,
  EdgeSyncMetadata,
} from '@/types/offline';
import { mergeClocks } from '@/lib/offline/vector-clock';

export class GHIMSDatabase extends Dexie {
  mutations!: Table<SyncMutation, string>;
  edge_entities!: Table<EdgeEntityRecord, string>;
  entity_map!: Table<EdgeEntityMapping, string>;
  sync_metadata!: Table<EdgeSyncMetadata, string>;

  constructor() {
    super('ghims_clinical_dexie_db');

    this.version(1).stores({
      mutations: 'id, tenantId, collection, docId, status, timestamp',
      offline_cache: 'key, tenantId, collection, updatedAt',
      clinical_patients: 'id, tenantId, mrn, name, bedId, acuityScore',
      bed_occupancy: 'id, tenantId, wardId, bedNumber, status',
      surgical_cases: 'id, tenantId, patientId, theaterId, status',
    });

    this.version(2).stores({
      mutations: 'id, tenantId, collection, docId, status, timestamp',
      offline_cache: 'key, tenantId, collection, updatedAt',
      clinical_patients: 'id, tenantId, mrn, name, bedId, acuityScore',
      bed_occupancy: 'id, tenantId, wardId, bedNumber, status',
      surgical_cases: 'id, tenantId, patientId, theaterId, status',
      edge_entities: 'key, [tenantId+collection], tenantId, collection, entityId, updatedAt',
      entity_map: 'key, tenantId, localId, canonicalId, entityType, status, updatedAt',
      sync_metadata: 'key, tenantId, scope, lastHydratedAt',
    });

    // v3 removes Generation-1 plaintext-capable clinical caches. All retained
    // PHI/read models live in actor-scoped AES-GCM encrypted edge_entities.
    this.version(3).stores({
      mutations: 'id, tenantId, collection, docId, status, timestamp',
      offline_cache: null,
      clinical_patients: null,
      bed_occupancy: null,
      surgical_cases: null,
      edge_entities: 'key, [tenantId+collection], tenantId, collection, entityId, updatedAt',
      entity_map: 'key, tenantId, localId, canonicalId, entityType, status, updatedAt',
      sync_metadata: 'key, tenantId, scope, lastHydratedAt',
    });
  }
}

// Singleton database instance
export const localDb = new GHIMSDatabase();

// ----------------------------------------------------------------------
// Convenience Helpers for Clinical Entities & Mutations
// ----------------------------------------------------------------------

export async function getLocalMutations(tenantId?: string): Promise<SyncMutation[]> {
  try {
    if (tenantId) {
      return await localDb.mutations
        .where('tenantId')
        .equals(tenantId)
        .sortBy('timestamp');
    }
    return await localDb.mutations.orderBy('timestamp').toArray();
  } catch (error) {
    console.warn('Failed to retrieve mutations from Dexie:', error);
    return [];
  }
}

export async function getPendingMutationsFromDb(tenantId?: string): Promise<SyncMutation[]> {
  try {
    if (tenantId) {
      return await localDb.mutations
        .where('tenantId')
        .equals(tenantId)
        .filter((m) => m.status === 'pending' || m.status === 'failed')
        .sortBy('timestamp');
    }
    return await localDb.mutations
      .filter((m) => m.status === 'pending' || m.status === 'failed')
      .sortBy('timestamp');
  } catch (error) {
    console.warn('Failed to retrieve pending mutations from Dexie:', error);
    return [];
  }
}

export async function getPendingVectorClock(
  tenantId?: string
): Promise<Record<string, number>> {
  try {
    const mutations = tenantId
      ? await localDb.mutations.where('tenantId').equals(tenantId).toArray()
      : await localDb.mutations.toArray();

    return mutations
      .filter((mutation) => mutation.status !== 'syncing' || Boolean(mutation.vectorClock))
      .reduce<Record<string, number>>(
        (clock, mutation) => mergeClocks(clock, mutation.vectorClock),
        {}
      );
  } catch (error) {
    console.warn('Failed to derive pending vector clock from Dexie:', error);
    return {};
  }
}

export async function measureLocalStoreLatency(
  tenantId?: string
): Promise<number | null> {
  const now = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const startedAt = now();
  try {
    if (tenantId) {
      await localDb.mutations.where('tenantId').equals(tenantId).count();
    } else {
      await localDb.mutations.count();
    }
    return Math.max(0, Number((now() - startedAt).toFixed(2)));
  } catch (error) {
    console.warn('Failed to measure local IndexedDB latency:', error);
    return null;
  }
}

// ----------------------------------------------------------------------
// Compatibility aliases & mutation helpers
// ----------------------------------------------------------------------

export type OfflineMutation = SyncMutation;
export type { MutationAction, MutationStatus } from '@/types/offline';

export interface SyncConflict {
  id: string;
  mutationId?: string;
  tenantId: string;
  collection: string;
  resourceId?: string;
  serverData?: Record<string, any>;
  clientData?: Record<string, any>;
  strategy?: 'LWW_SERVER' | 'OVERWRITE_CLIENT' | 'MANUAL_MERGE';
  resolved?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  timestamp?: number;
  [key: string]: any;
}

export async function getPendingMutations(tenantId?: string): Promise<SyncMutation[]> {
  return getPendingMutationsFromDb(tenantId);
}

export async function addMutation(
  _mutationOrParams:
    | SyncMutation
    | {
        tenantId: string;
        actorId?: string;
        collection: string;
        action: MutationAction;
        resourceId?: string;
        docId?: string;
        payload: Record<string, any>;
        commandType?: string;
        idempotencyKey?: string;
        schemaVersion?: number;
        baseEntityVersion?: number;
        id?: string;
        vectorClock?: Record<string, number>;
        clientTimestamp?: number;
      }
): Promise<SyncMutation> {
  throw new Error(
    'LEGACY_RAW_MUTATION_RETIRED: use putSecureMutation through the governed sync engine.'
  );
}

export async function updateMutationStatus(
  id: string,
  status: SyncMutation['status'],
  error?: string
): Promise<void> {
  const existing = await localDb.mutations.get(id);
  if (existing) {
    await localDb.mutations.update(id, {
      status,
      errorMessage: error || existing.errorMessage,
      retryCount: (existing.retryCount || 0) + (status === 'failed' ? 1 : 0),
    });
  }
}

export async function deleteMutation(id: string): Promise<void> {
  await localDb.mutations.delete(id);
}

export async function resolveSyncConflict(
  _conflictId: string,
  _strategy?: 'LWW_SERVER' | 'OVERWRITE_CLIENT' | 'MANUAL_MERGE',
  _resolvedBy?: string
): Promise<void> {
  throw new Error(
    'SERVER_RECONCILIATION_REQUIRED: clinical sync conflicts cannot be resolved or discarded by the browser.'
  );
}



/**
 * Clear PHI-bearing read caches for a tenant when a user leaves a shared workstation.
 * Pending governed mutations are deliberately preserved and remain bound to their
 * originating Firebase UID for later replay by that same user.
 */
export async function clearOfflineReadModelsForTenant(tenantId: string): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim();
  if (!normalizedTenantId) return;

  await localDb.transaction(
    'rw',
    [localDb.edge_entities, localDb.sync_metadata],
    async () => {
      await localDb.edge_entities.where('tenantId').equals(normalizedTenantId).delete();
      await localDb.sync_metadata.where('tenantId').equals(normalizedTenantId).delete();
      // Do not delete encrypted pending mutations or entity_map here. They are
      // actor-bound and are required to complete safe replay after the same user
      // re-authenticates on the device.
    }
  );
}


export async function replaceTenantEdgeSnapshot(
  _tenantId: string,
  _collections: Record<string, Array<Record<string, unknown>>>,
  _metadata: Omit<EdgeSyncMetadata, 'key' | 'tenantId' | 'scope'> & { scope?: string }
): Promise<void> {
  throw new Error(
    'LEGACY_PLAINTEXT_EDGE_API_RETIRED: use replaceSecureTenantEdgeSnapshot.'
  );
}

export async function listEdgeEntities<T extends Record<string, unknown> = Record<string, unknown>>(
  _tenantId: string,
  _collection: string
): Promise<T[]> {
  throw new Error(
    'LEGACY_PLAINTEXT_EDGE_API_RETIRED: use listSecureEdgeEntities.'
  );
}

export async function getEdgeEntity<T extends Record<string, unknown> = Record<string, unknown>>(
  _tenantId: string,
  _collection: string,
  _entityId: string
): Promise<T | null> {
  throw new Error(
    'LEGACY_PLAINTEXT_EDGE_API_RETIRED: use actor-scoped secure-store access.'
  );
}

export async function getEdgeSyncMetadata(
  tenantId: string,
  scope = 'clinical-core'
): Promise<EdgeSyncMetadata | null> {
  const key = `${String(tenantId || '').trim().toLowerCase()}:${scope}`;
  return (await localDb.sync_metadata.get(key)) || null;
}

export async function clearTenantEdgeEntities(tenantId: string): Promise<void> {
  const normalizedTenantId = String(tenantId || '').trim().toLowerCase();
  if (!normalizedTenantId) return;
  await localDb.transaction(
    'rw',
    localDb.edge_entities,
    localDb.sync_metadata,
    async () => {
      await localDb.edge_entities.where('tenantId').equals(normalizedTenantId).delete();
      await localDb.sync_metadata.where('tenantId').equals(normalizedTenantId).delete();
    }
  );
}
