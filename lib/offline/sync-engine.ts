import {
  addMutation,
  getPendingMutations,
  updateMutationStatus,
  deleteMutation,
  saveToOfflineCache,
  recordSyncConflict,
  OfflineMutation,
  MutationAction,
} from './db';
import { auth } from '@/lib/firebase/client';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';

export interface SyncEngineState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncedAt: Date | null;
  activeProcessingId: string | null;
  lastError: string | null;
}

export interface QueueMutationParams {
  tenantId: string;
  collection: string;
  action: MutationAction;
  resourceId: string;
  commandType: string;
  payload: Record<string, any>;
  idempotencyKey?: string;
  schemaVersion?: number;
  baseEntityVersion?: number;
  optimisticCache?: boolean;
}

class ClinicalSyncEngine {
  private isProcessing = false;
  private listeners = new Set<(state: SyncEngineState) => void>();
  private state: SyncEngineState = {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncedAt: null,
    activeProcessingId: null,
    lastError: null,
  };
  private autoSyncInterval: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.initNetworkListeners();
      void this.refreshPendingCount();
      this.autoSyncInterval = setInterval(() => {
        if (this.state.isOnline && !this.state.isSyncing) void this.processSyncQueue();
      }, 25000);
    }
  }

  private initNetworkListeners() {
    window.addEventListener('online', () => {
      this.updateState({ isOnline: true });
      void this.processSyncQueue();
    });
    window.addEventListener('offline', () => this.updateState({ isOnline: false }));

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'TRIGGER_SYNC_QUEUE') void this.processSyncQueue();
      });
    }
  }

  public subscribe(listener: (state: SyncEngineState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  private updateState(partial: Partial<SyncEngineState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => {
      try { listener(this.state); } catch (error) { console.error('Sync listener failed:', error); }
    });
  }

  public getState(): SyncEngineState {
    return { ...this.state };
  }

  public async refreshPendingCount(tenantId?: string): Promise<number> {
    try {
      const pending = await getPendingMutations(tenantId);
      this.updateState({ pendingCount: pending.length });
      return pending.length;
    } catch {
      return 0;
    }
  }

  /**
   * Offline storage captures a domain command, never a raw Firestore mutation.
   * The collection/action fields remain only for optimistic local-cache rendering.
   */
  public async queueMutation(params: QueueMutationParams): Promise<OfflineMutation> {
    const mutation = await addMutation({
      tenantId: params.tenantId,
      collection: params.collection,
      action: params.action,
      resourceId: params.resourceId,
      commandType: params.commandType,
      idempotencyKey: params.idempotencyKey || `offline_${crypto.randomUUID()}`,
      schemaVersion: params.schemaVersion || 1,
      baseEntityVersion: params.baseEntityVersion,
      payload: params.payload,
    });

    if (params.optimisticCache !== false && params.action !== 'DELETE') {
      await saveToOfflineCache(
        params.tenantId,
        params.collection,
        params.resourceId,
        params.payload
      );
    }

    await this.refreshPendingCount(params.tenantId);

    if (this.state.isOnline) void this.processSyncQueue(params.tenantId);
    else void this.registerBackgroundSync();

    return mutation;
  }

  public async registerBackgroundSync() {
    try {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const registration = await navigator.serviceWorker.ready;
        // @ts-ignore browser support is runtime-detected.
        if (registration.sync) await registration.sync.register('sync-clinical-queue');
      }
    } catch (error) {
      console.warn('Background sync registration unavailable:', error);
    }
  }

  /**
   * Replays queued domain commands through the authenticated server sync endpoint.
   * No browser Firestore write or client-side LWW resolution is permitted.
   */
  public async processSyncQueue(tenantId?: string): Promise<{ syncedCount: number; conflictCount: number }> {
    if (this.isProcessing) return { syncedCount: 0, conflictCount: 0 };
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.updateState({ isOnline: false });
      return { syncedCount: 0, conflictCount: 0 };
    }

    this.isProcessing = true;
    this.updateState({ isSyncing: true, lastError: null });

    let syncedCount = 0;
    let conflictCount = 0;

    try {
      const currentUser = auth.currentUser;
      const cached = await getCachedAuthSession();
      if (!currentUser || !cached) {
        throw new Error('AUTHENTICATION_REQUIRED: offline replay requires an active authenticated session.');
      }

      const pending = await getPendingMutations(tenantId);
      const byTenant = new Map<string, OfflineMutation[]>();
      for (const mutation of pending) {
        const list = byTenant.get(mutation.tenantId) || [];
        list.push(mutation);
        byTenant.set(mutation.tenantId, list);
      }

      for (const [mutationTenantId, mutations] of byTenant) {
        if (cached.user.tenantId !== mutationTenantId) {
          for (const mutation of mutations) {
            await updateMutationStatus(mutation.id, 'failed', 'TENANT_MISMATCH: active session differs from queued mutation tenant.');
          }
          continue;
        }

        const replayable = mutations.filter((mutation) => mutation.commandType && mutation.idempotencyKey);
        const legacy = mutations.filter((mutation) => !mutation.commandType || !mutation.idempotencyKey);

        for (const mutation of legacy) {
          await updateMutationStatus(
            mutation.id,
            'failed',
            'LEGACY_RAW_MUTATION_REJECTED: mutation must be re-created as a governed domain command.'
          );
        }

        if (replayable.length === 0) continue;

        const idToken = await currentUser.getIdToken(false);
        const batchId = `sync_${crypto.randomUUID()}`;

        for (const mutation of replayable) {
          this.updateState({ activeProcessingId: mutation.id });
          await updateMutationStatus(mutation.id, 'syncing');
        }

        const response = await fetch('/api/sync/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
            'x-ghims-tenant-id': mutationTenantId,
            'x-ghims-session-id': cached.session.sessionId,
            ...(cached.session.deviceId ? { 'x-ghims-device-id': cached.session.deviceId } : {}),
          },
          body: JSON.stringify({
            batch: {
              deviceId: cached.session.deviceId || 'unknown-device',
              tenantId: mutationTenantId,
              actorId: cached.user.uid,
              batchId,
              submittedAt: Date.now(),
              mutations: replayable.map((mutation) => ({
                mutationId: mutation.id,
                occurredAt: mutation.clientTimestamp || mutation.timestamp,
                commandType: mutation.commandType,
                payload: mutation.payload,
                idempotencyKey: mutation.idempotencyKey,
                entityId: mutation.resourceId || mutation.docId,
                schemaVersion: mutation.schemaVersion || 1,
              })),
            },
          }),
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error?.message || 'Offline replay request failed.');
        }

        for (const result of payload.results || []) {
          const mutation = replayable.find((item) => item.id === result.mutationId);
          if (!mutation) continue;

          if (result.status === 'accepted') {
            await deleteMutation(mutation.id);
            await saveToOfflineCache(
              mutation.tenantId,
              mutation.collection,
              mutation.resourceId || mutation.docId,
              result.data || mutation.payload
            );
            syncedCount += 1;
          } else if (result.status === 'conflict' || result.status === 'requires_review') {
            conflictCount += 1;
            await updateMutationStatus(mutation.id, 'conflict', result.reason || 'Server reconciliation required.');
            await recordSyncConflict({
              id: mutation.id,
              mutationId: mutation.id,
              tenantId: mutation.tenantId,
              collection: mutation.collection,
              resourceId: mutation.resourceId || mutation.docId,
              clientData: mutation.payload,
              conflictType: result.conflictCategory || 'STATE_CONFLICT',
              reason: result.reason,
            });
          } else {
            await updateMutationStatus(mutation.id, 'failed', result.reason || 'Server rejected offline command.');
          }
        }
      }

      await this.refreshPendingCount(tenantId);
      this.updateState({ lastSyncedAt: new Date(), activeProcessingId: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync loop failed';
      this.updateState({ lastError: message });
    } finally {
      this.isProcessing = false;
      this.updateState({ isSyncing: false, activeProcessingId: null });
    }

    return { syncedCount, conflictCount };
  }
}

export const syncEngine =
  typeof window !== 'undefined'
    ? new ClinicalSyncEngine()
    : (null as unknown as ClinicalSyncEngine);
