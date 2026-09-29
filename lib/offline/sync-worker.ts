import { syncEngine, SyncEngineState } from './sync-engine';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
import { getSecureConflicts } from '@/lib/offline/secure-store';
import { MutationAction } from '@/types/offline';

export interface SyncWorkerState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  conflictCount: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

type SyncStateListener = (state: SyncWorkerState) => void;

type GovernedOfflinePayload = Record<string, unknown> & {
  __commandType?: string;
  __idempotencyKey?: string;
  __schemaVersion?: number;
  __baseEntityVersion?: number;
  __commandPayload?: Record<string, unknown>;
};

/**
 * Compatibility façade for legacy callers.
 *
 * The previous implementation performed direct browser Firestore transactions and
 * client-side vector-clock/LWW conflict resolution. That authority path is retired.
 * Every replay now goes through sync-engine -> /api/sync/batch -> CommandBus.
 */
class GovernedSyncCompatibilityCoordinator {
  public subscribe(listener: SyncStateListener): () => void {
    if (!syncEngine) return () => {};

    return syncEngine.subscribe((state: SyncEngineState) => {
      void this.toWorkerState(state).then(listener);
    });
  }

  private async toWorkerState(state: SyncEngineState): Promise<SyncWorkerState> {
    const cached = await getCachedAuthSession();
    const conflicts = cached
      ? await getSecureConflicts(cached.user.tenantId, cached.user.uid)
      : [];
    return {
      isOnline: state.isOnline,
      isSyncing: state.isSyncing,
      pendingCount: state.pendingCount,
      conflictCount: conflicts.length,
      lastSyncedAt: state.lastSyncedAt ? state.lastSyncedAt.getTime() : null,
      lastError: state.lastError,
    };
  }

  public async refreshMetrics(
    tenantId?: string
  ): Promise<{ pending: number; conflicts: number }> {
    if (!syncEngine) return { pending: 0, conflicts: 0 };
    const pending = await syncEngine.refreshPendingCount(tenantId);
    const cached = await getCachedAuthSession();
    const conflicts = cached
      ? (await getSecureConflicts(tenantId || cached.user.tenantId, cached.user.uid)).length
      : 0;
    return { pending, conflicts };
  }

  public async queueMutation(
    tenantId: string,
    collection: string,
    docId: string,
    action: MutationAction,
    payload: GovernedOfflinePayload
  ): Promise<string> {
    if (!syncEngine) {
      throw new Error('OFFLINE_ENGINE_UNAVAILABLE');
    }

    const commandType = String(payload.__commandType || '').trim();
    const idempotencyKey = String(payload.__idempotencyKey || '').trim();

    if (!commandType) {
      throw new Error(
        'LEGACY_RAW_MUTATION_REJECTED: offline writes must declare __commandType and replay through the server CommandBus.'
      );
    }

    const commandPayload =
      payload.__commandPayload && typeof payload.__commandPayload === 'object'
        ? payload.__commandPayload
        : Object.fromEntries(
            Object.entries(payload).filter(([key]) => !key.startsWith('__'))
          );

    const mutation = await syncEngine.queueMutation({
      tenantId,
      collection,
      action,
      resourceId: docId,
      commandType,
      payload: commandPayload,
      idempotencyKey: idempotencyKey || undefined,
      schemaVersion:
        typeof payload.__schemaVersion === 'number' ? payload.__schemaVersion : 1,
      baseEntityVersion:
        typeof payload.__baseEntityVersion === 'number'
          ? payload.__baseEntityVersion
          : undefined,
    });

    return mutation.id;
  }

  public async processSyncQueue(
    tenantId?: string
  ): Promise<{ syncedCount: number; conflictCount: number }> {
    if (!syncEngine) return { syncedCount: 0, conflictCount: 0 };
    return syncEngine.processSyncQueue(tenantId);
  }
}

export const syncCoordinator =
  typeof window !== 'undefined'
    ? new GovernedSyncCompatibilityCoordinator()
    : (null as unknown as GovernedSyncCompatibilityCoordinator);

export async function queueMutation(
  tenantId: string,
  collection: string,
  docId: string,
  action: MutationAction,
  payload: GovernedOfflinePayload
): Promise<string> {
  if (!syncCoordinator) {
    throw new Error('OFFLINE_ENGINE_UNAVAILABLE');
  }
  return syncCoordinator.queueMutation(tenantId, collection, docId, action, payload);
}

export async function processSyncQueue(
  tenantId?: string
): Promise<{ syncedCount: number; conflictCount: number }> {
  if (!syncCoordinator) return { syncedCount: 0, conflictCount: 0 };
  return syncCoordinator.processSyncQueue(tenantId);
}
