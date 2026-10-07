import {
  updateMutationStatus,
  deleteMutation,
  OfflineMutation,
  MutationAction,
} from './db';
import {
  getSecurePendingMutations,
  getSecurePendingVectorClock,
  getSecureEdgeEntityMetadata,
  updateSecureEdgeEntityVersion,
  putSecureMutation,
  putEntityMappings,
  remapEdgeEntityIds,
  resolveMappedReferences,
  putSecureEdgeEntities,
  listSecureEdgeEntities,
  recordSecureConflict,
} from '@/lib/offline/secure-store';
import { withEdgeSyncLeadership } from '@/lib/offline/sync-leader';
import { ensurePersistentEdgeStorage } from '@/lib/offline/storage-manager';
import { auth } from '@/lib/firebase/client';
import { getCachedAuthSession, getCachedOfflineCapabilityLease } from '@/lib/offline/auth-storage';
import { probeApplicationConnectivity, ConnectivityProbeResult } from '@/lib/offline/connectivity';
import { incrementClock, mergeClocks } from '@/lib/offline/vector-clock';

export interface LastReplicationEvent {
  at: Date;
  tenantId: string | null;
  batchIds: string[];
  syncedCount: number;
  conflictCount: number;
  outcome: 'SYNCED' | 'NO_CHANGES' | 'PARTIAL' | 'FAILED';
  error: string | null;
}

export interface SyncEngineState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  lastSyncedAt: Date | null;
  activeProcessingId: string | null;
  lastError: string | null;
  replicaStatus: 'unknown' | 'ready' | 'offline' | 'unauthenticated' | 'unavailable';
  replicaReachable: boolean | null;
  replicaLatencyMs: number | null;
  replicaStoreLatencyMs: number | null;
  replicaCheckedAt: Date | null;
  replicaError: string | null;
  lastReplicationEvent: LastReplicationEvent | null;
  offlineSimulationActive: boolean;
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
  dependsOnMutationIds?: string[];
  optimisticCache?: boolean;
  optimisticPayload?: Record<string, any>;
  mutationId?: string;
}

class ClinicalSyncEngine {
  private isProcessing = false;
  private listeners = new Set<(state: SyncEngineState) => void>();
  private state: SyncEngineState = {
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    lastSyncedAt: null,
    activeProcessingId: null,
    lastError: null,
    replicaStatus: 'unknown',
    replicaReachable: null,
    replicaLatencyMs: null,
    replicaStoreLatencyMs: null,
    replicaCheckedAt: null,
    replicaError: null,
    lastReplicationEvent: null,
    offlineSimulationActive: false,
  };
  private autoSyncInterval: any = null;
  private forcedOffline = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.initNetworkListeners();
      void ensurePersistentEdgeStorage().catch(() => {});
      void this.refreshPendingCount();
      void this.refreshConnectivity(false).then((result) => {
        if (result.isOnline) void this.refreshReplicaStatus();
      });
      this.autoSyncInterval = setInterval(() => {
        if (this.state.isSyncing) return;
        void this.refreshConnectivity(true).then((result) => {
          if (result.isOnline) void this.refreshReplicaStatus();
        });
      }, 25000);
    }
  }

  private initNetworkListeners() {
    // Native browser connectivity events are transport hints only. Sandboxed
    // previews can report them incorrectly, so always confirm application-origin
    // reachability before changing the clinical connectivity state.
    window.addEventListener('online', () => {
      void this.refreshConnectivity(true);
    });
    window.addEventListener('offline', () => {
      void this.refreshConnectivity(false);
    });

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

  public async refreshConnectivity(
    processQueueWhenOnline = false
  ): Promise<ConnectivityProbeResult> {
    if (this.forcedOffline) {
      const forcedResult = { isOnline: false, latencyMs: null };
      this.updateState({
        isOnline: false,
        replicaStatus: 'offline',
        replicaReachable: false,
        replicaLatencyMs: null,
        replicaStoreLatencyMs: null,
        replicaCheckedAt: new Date(),
        replicaError: null,
      });
      return forcedResult;
    }

    const result = await probeApplicationConnectivity();
    const wasOnline = this.state.isOnline;

    this.updateState({ isOnline: result.isOnline });

    if (
      result.isOnline &&
      processQueueWhenOnline &&
      !this.isProcessing &&
      (!wasOnline || this.state.pendingCount > 0)
    ) {
      void this.processSyncQueue();
    }

    return result;
  }

  public async refreshReplicaStatus(tenantId?: string): Promise<void> {
    if (this.forcedOffline || !this.state.isOnline) {
      this.updateState({
        replicaStatus: 'offline',
        replicaReachable: false,
        replicaLatencyMs: null,
        replicaStoreLatencyMs: null,
        replicaCheckedAt: new Date(),
        replicaError: null,
      });
      return;
    }

    try {
      const currentUser = auth.currentUser;
      const cached = await getCachedAuthSession();

      if (!currentUser || !cached) {
        this.updateState({
          replicaStatus: 'unauthenticated',
          replicaReachable: null,
          replicaLatencyMs: null,
          replicaStoreLatencyMs: null,
          replicaCheckedAt: new Date(),
          replicaError: null,
        });
        return;
      }

      const activeTenantId = (tenantId || cached.user.tenantId).trim().toLowerCase();
      if (activeTenantId !== cached.user.tenantId.trim().toLowerCase()) {
        this.updateState({
          replicaStatus: 'unavailable',
          replicaReachable: false,
          replicaLatencyMs: null,
          replicaStoreLatencyMs: null,
          replicaCheckedAt: new Date(),
          replicaError: 'TENANT_MISMATCH',
        });
        return;
      }

      const idToken = await currentUser.getIdToken(false);
      const startedAt = performance.now();
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 5000);
      let response: Response;

      try {
        response = await fetch(
          `/api/sync/status?tenantId=${encodeURIComponent(activeTenantId)}&probe=${Date.now()}`,
          {
            method: 'GET',
            cache: 'no-store',
            credentials: 'same-origin',
            signal: controller.signal,
            headers: {
              Authorization: `Bearer ${idToken}`,
              'x-ghims-tenant-id': activeTenantId,
              'x-ghims-session-id': cached.session.sessionId,
              ...(cached.session.deviceId
                ? { 'x-ghims-device-id': cached.session.deviceId }
                : {}),
            },
          }
        );
      } finally {
        window.clearTimeout(timeoutId);
      }
      const roundTripLatencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      const payload = await response.json().catch(() => ({}));

      this.updateState({
        replicaStatus: response.ok && payload.status === 'ready' ? 'ready' : 'unavailable',
        replicaReachable: response.ok && payload.status === 'ready',
        replicaLatencyMs: response.ok ? roundTripLatencyMs : null,
        replicaStoreLatencyMs:
          response.ok && Number.isFinite(payload.storeLatencyMs)
            ? Number(payload.storeLatencyMs)
            : null,
        replicaCheckedAt: new Date(),
        replicaError: response.ok ? null : String(payload.error || `HTTP_${response.status}`),
      });
    } catch (error) {
      this.updateState({
        replicaStatus: 'unavailable',
        replicaReachable: false,
        replicaLatencyMs: null,
        replicaStoreLatencyMs: null,
        replicaCheckedAt: new Date(),
        replicaError: error instanceof Error ? error.message : 'REPLICA_STATUS_FAILED',
      });
    }
  }

  public async setOfflineSimulation(active: boolean): Promise<void> {
    const runtimeMode = String(process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE || '')
      .trim()
      .toUpperCase();

    if (active && runtimeMode === 'PRODUCTION') {
      throw new Error('OFFLINE_SIMULATION_DISABLED_IN_PRODUCTION');
    }

    this.forcedOffline = active;
    this.updateState({ offlineSimulationActive: active });

    if (active) {
      this.updateState({
        isOnline: false,
        replicaStatus: 'offline',
        replicaReachable: false,
        replicaLatencyMs: null,
        replicaStoreLatencyMs: null,
        replicaCheckedAt: new Date(),
        replicaError: null,
      });
      await this.registerBackgroundSync();
      return;
    }

    const connectivity = await this.refreshConnectivity(true);
    if (connectivity.isOnline) {
      await this.refreshReplicaStatus();
    }
  }

  public async refreshPendingCount(tenantId?: string): Promise<number> {
    try {
      const cached = await getCachedAuthSession();
      const activeTenantId = String(tenantId || cached?.user?.tenantId || '').trim().toLowerCase();
      const actorId = String(cached?.user?.uid || '').trim();
      if (!activeTenantId || !actorId) {
        this.updateState({ pendingCount: 0 });
        return 0;
      }

      const pending = await getSecurePendingMutations(activeTenantId, actorId);
      this.updateState({ pendingCount: pending.length });
      return pending.length;
    } catch {
      this.updateState({ pendingCount: 0 });
      return 0;
    }
  }

  /**
   * Offline storage captures a domain command, never a raw Firestore mutation.
   * The collection/action fields remain only for optimistic local-cache rendering.
   */
  public async queueMutation(params: QueueMutationParams): Promise<OfflineMutation> {
    const cached = await getCachedAuthSession();
    let actorId = String(cached?.user?.uid || '').trim();
    let deviceId = String(cached?.session?.deviceId || cached?.user?.deviceId || '').trim();
    let activeTenantId = String(cached?.user?.tenantId || '').trim().toLowerCase();

    if (!cached) {
      const connectivity = await probeApplicationConnectivity();
      this.updateState({ isOnline: connectivity.isOnline });
      if (connectivity.isOnline) {
        throw new Error(
          'SESSION_EXPIRED: online command capture requires renewed authoritative authentication.'
        );
      }

      const lease = await getCachedOfflineCapabilityLease();
      if (!lease) {
        throw new Error(
          'OFFLINE_CAPABILITY_REQUIRED: extended-outage capture requires a valid server-issued offline capability.'
        );
      }
      if (Date.now() >= Date.parse(lease.expiresAt)) {
        throw new Error('OFFLINE_CAPABILITY_EXPIRED');
      }
      if (!lease.allowedCommandTypes.includes(params.commandType)) {
        throw new Error(
          `OFFLINE_CAPABILITY_COMMAND_DENIED: ${params.commandType} is not permitted for extended-outage capture.`
        );
      }

      actorId = lease.actorId;
      deviceId = lease.deviceId;
      activeTenantId = lease.tenantId.trim().toLowerCase();
    }

    if (!actorId) {
      throw new Error('AUTHENTICATION_REQUIRED: offline commands require an authenticated originating user.');
    }
    if (activeTenantId !== params.tenantId.trim().toLowerCase()) {
      throw new Error('TENANT_MISMATCH: offline command tenant must match the active session or capture lease.');
    }
    if (cached && (
      cached.session.status !== 'ACTIVE' ||
      Date.now() >= new Date(cached.session.expiresAt).getTime()
    )) {
      throw new Error('SESSION_EXPIRED: offline command capture requires a still-valid cached session.');
    }

    const [pendingClock, entityMetadata] = await Promise.all([
      getSecurePendingVectorClock(params.tenantId, actorId),
      getSecureEdgeEntityMetadata(
        params.tenantId,
        actorId,
        params.collection,
        params.resourceId
      ),
    ]);
    const baseVectorClock = entityMetadata?.vectorClock || {};
    const currentClock = mergeClocks(baseVectorClock, pendingClock);
    const clockNodeId = deviceId || actorId;
    const vectorClock = incrementClock(currentClock, clockNodeId);

    const mutation = await putSecureMutation({
      id: params.mutationId || `mut_${crypto.randomUUID()}`,
      tenantId: params.tenantId,
      actorId,
      collection: params.collection,
      action: params.action,
      resourceId: params.resourceId,
      commandType: params.commandType,
      idempotencyKey: params.idempotencyKey || `offline_${crypto.randomUUID()}`,
      schemaVersion: params.schemaVersion || 1,
      baseEntityVersion: params.baseEntityVersion ?? entityMetadata?.serverVersion,
      dependsOnMutationIds: params.dependsOnMutationIds,
      baseVectorClock,
      payload: params.payload,
      vectorClock,
      clientTimestamp: Date.now(),
    });

    if (params.optimisticCache !== false && params.action !== 'DELETE') {
      const optimisticPatch = params.optimisticPayload || params.payload;
      let optimisticEntity: Record<string, unknown> = {
        id: params.resourceId,
        ...optimisticPatch,
      };

      if (params.action === 'UPDATE') {
        const existingRows = await listSecureEdgeEntities<Record<string, unknown>>(
          params.tenantId,
          actorId,
          params.collection
        );
        const existing = existingRows.find((row) => {
          const rowId = String(
            (row as any).id ||
              (row as any).orderId ||
              (row as any).encounterId ||
              (row as any).receiptId ||
              ''
          ).trim();
          return rowId === params.resourceId;
        });
        if (existing) {
          optimisticEntity = {
            ...existing,
            ...optimisticEntity,
          };
        }
      }

      await putSecureEdgeEntities(
        params.tenantId,
        actorId,
        params.collection,
        [optimisticEntity]
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
    return withEdgeSyncLeadership(
      () => this.processSyncQueueAsLeader(tenantId),
      { syncedCount: 0, conflictCount: 0 }
    );
  }

  private async processSyncQueueAsLeader(tenantId?: string): Promise<{ syncedCount: number; conflictCount: number }> {
    if (this.isProcessing) return { syncedCount: 0, conflictCount: 0 };

    if (this.forcedOffline) {
      this.updateState({ isOnline: false });
      return { syncedCount: 0, conflictCount: 0 };
    }

    const connectivity = await probeApplicationConnectivity();
    this.updateState({ isOnline: connectivity.isOnline });
    if (!connectivity.isOnline) {
      return { syncedCount: 0, conflictCount: 0 };
    }

    this.isProcessing = true;
    this.updateState({ isSyncing: true, lastError: null });

    let syncedCount = 0;
    let conflictCount = 0;
    const batchIds: string[] = [];
    const processingMutationIds = new Set<string>();
    let eventTenantId: string | null = tenantId || null;

    try {
      const currentUser = auth.currentUser;
      const cached = await getCachedAuthSession();
      if (!currentUser || !cached) {
        throw new Error('AUTHENTICATION_REQUIRED: offline replay requires an active authenticated session.');
      }

      const activeTenantId = String(tenantId || cached.user.tenantId).trim().toLowerCase();
      const pending = await getSecurePendingMutations(activeTenantId, cached.user.uid);
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

        const replayable = mutations.filter(
          (mutation) => mutation.commandType && mutation.idempotencyKey
        );
        const legacy = mutations.filter(
          (mutation) => !mutation.commandType || !mutation.idempotencyKey
        );

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
        batchIds.push(batchId);
        eventTenantId = mutationTenantId;

        for (const mutation of replayable) {
          this.updateState({ activeProcessingId: mutation.id });
          await updateMutationStatus(mutation.id, 'syncing');
          processingMutationIds.add(mutation.id);
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 15000);
        let response: Response;

        try {
          response = await fetch('/api/sync/batch', {
            method: 'POST',
            signal: controller.signal,
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
                mutations: await Promise.all(replayable.map(async (mutation) => ({
                  mutationId: mutation.id,
                  occurredAt: mutation.clientTimestamp || mutation.timestamp,
                  commandType: mutation.commandType,
                  collection: mutation.collection,
                  payload: await resolveMappedReferences(mutationTenantId, mutation.payload),
                  idempotencyKey: mutation.idempotencyKey,
                  entityId: await resolveMappedReferences(
                    mutationTenantId,
                    mutation.resourceId || mutation.docId
                  ),
                  schemaVersion: mutation.schemaVersion || 1,
                  baseEntityVersion: mutation.baseEntityVersion,
                  dependsOnMutationIds: mutation.dependsOnMutationIds,
                  vectorClock: mutation.vectorClock,
                  baseVectorClock: mutation.baseVectorClock,
                }))),
              },
            }),
          });
        } finally {
          window.clearTimeout(timeoutId);
        }

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error?.message || 'Offline replay request failed.');
        }

        const returnedMutationIds = new Set<string>();

        for (const result of payload.results || []) {
          const mutation = replayable.find((item) => item.id === result.mutationId);
          if (!mutation) continue;

          returnedMutationIds.add(mutation.id);

          if (result.status === 'accepted') {
            if (Array.isArray(result.entityMappings) && result.entityMappings.length > 0) {
              const mappings = result.entityMappings.map((mapping: any) => ({
                localId: String(mapping.localId),
                canonicalId: String(mapping.canonicalId),
                entityType: String(mapping.entityType || 'ENTITY'),
                sourceMutationId: mutation.id,
              }));
              await putEntityMappings(mutation.tenantId, mappings);
              await remapEdgeEntityIds(mutation.tenantId, mappings);
            }
            await deleteMutation(mutation.id);
            const authoritativeData =
              result.data && typeof result.data === 'object'
                ? result.data as Record<string, unknown>
                : mutation.payload;
            await putSecureEdgeEntities(
              mutation.tenantId,
              cached.user.uid,
              mutation.collection,
              [{
                id: mutation.resourceId || mutation.docId,
                ...authoritativeData,
              }]
            );
            syncedCount += 1;
          } else if (result.status === 'conflict' || result.status === 'requires_review') {
            conflictCount += 1;
            await updateMutationStatus(
              mutation.id,
              'conflict',
              result.reason || 'Server reconciliation required.'
            );
            await recordSecureConflict(
              mutation.tenantId,
              cached.user.uid,
              {
                id: mutation.id,
                mutationId: mutation.id,
                tenantId: mutation.tenantId,
                collection: mutation.collection,
                resourceId: mutation.resourceId || mutation.docId,
                clientData: mutation.payload,
                conflictType: result.conflictCategory || 'STATE_CONFLICT',
                reason: result.reason,
              }
            );
          } else {
            await updateMutationStatus(
              mutation.id,
              'failed',
              result.reason || 'Server rejected offline command.'
            );
          }

          processingMutationIds.delete(mutation.id);
        }

        for (const mutation of replayable) {
          if (returnedMutationIds.has(mutation.id)) continue;
          await updateMutationStatus(
            mutation.id,
            'failed',
            'SYNC_RESPONSE_INCOMPLETE: server returned no reconciliation result for this command.'
          );
          processingMutationIds.delete(mutation.id);
        }
      }

      await this.refreshPendingCount(tenantId);
      const completedAt = new Date();
      this.updateState({
        lastSyncedAt: completedAt,
        activeProcessingId: null,
        lastReplicationEvent: {
          at: completedAt,
          tenantId: eventTenantId,
          batchIds,
          syncedCount,
          conflictCount,
          outcome:
            conflictCount > 0
              ? 'PARTIAL'
              : syncedCount > 0
                ? 'SYNCED'
                : 'NO_CHANGES',
          error: null,
        },
      });
      void this.refreshReplicaStatus(eventTenantId || undefined);
      if (typeof window !== 'undefined' && eventTenantId && syncedCount > 0) {
        window.dispatchEvent(
          new CustomEvent('ghims:edge-sync-complete', {
            detail: {
              tenantId: eventTenantId,
              syncedCount,
              conflictCount,
              batchIds,
            },
          })
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync loop failed';

      for (const mutationId of processingMutationIds) {
        await updateMutationStatus(
          mutationId,
          'failed',
          `SYNC_TRANSPORT_FAILURE: ${message}`
        ).catch(() => {});
      }
      processingMutationIds.clear();
      await this.refreshPendingCount(tenantId).catch(() => 0);

      this.updateState({
        lastError: message,
        lastReplicationEvent: {
          at: new Date(),
          tenantId: eventTenantId,
          batchIds,
          syncedCount,
          conflictCount,
          outcome: 'FAILED',
          error: message,
        },
      });
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
