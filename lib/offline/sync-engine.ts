import {
  addMutation,
  getPendingMutations,
  getPendingVectorClock,
  updateMutationStatus,
  deleteMutation,
  saveToOfflineCache,
  recordSyncConflict,
  applyCanonicalEntityMappings,
  putEdgeEntity,
  OfflineMutation,
  MutationAction,
} from './db';
import { auth } from '@/lib/firebase/client';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
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
  baseVectorClock?: Record<string, number>;
  optimisticCache?: boolean;
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
    const cached = await getCachedAuthSession();
    if (!cached?.user?.uid) {
      throw new Error('AUTHENTICATION_REQUIRED: offline commands require an authenticated originating user.');
    }
    if (cached.user.tenantId !== params.tenantId) {
      throw new Error('TENANT_MISMATCH: offline command tenant must match the active session.');
    }
    if (
      cached.session.status !== 'ACTIVE' ||
      Date.now() >= new Date(cached.session.expiresAt).getTime()
    ) {
      throw new Error('SESSION_EXPIRED: offline command capture requires a still-valid cached session.');
    }

    const currentClock = await getPendingVectorClock(params.tenantId);
    const causalBaseClock = mergeClocks(params.baseVectorClock, currentClock);
    const clockNodeId = cached.session.deviceId || cached.user.uid;
    const vectorClock = incrementClock(causalBaseClock, clockNodeId);

    const mutation = await addMutation({
      id: params.mutationId,
      tenantId: params.tenantId,
      actorId: cached.user.uid,
      collection: params.collection,
      action: params.action,
      resourceId: params.resourceId,
      commandType: params.commandType,
      idempotencyKey: params.idempotencyKey || `offline_${crypto.randomUUID()}`,
      schemaVersion: params.schemaVersion || 1,
      baseEntityVersion: params.baseEntityVersion,
      payload: params.payload,
      vectorClock,
      clientTimestamp: Date.now(),
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
    let needsFollowupReplay = false;
    let eventTenantId: string | null = tenantId || null;

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

        const wrongActor = mutations.filter(
          (mutation) => !mutation.actorId || mutation.actorId !== cached.user.uid
        );
        for (const mutation of wrongActor) {
          await updateMutationStatus(
            mutation.id,
            'failed',
            mutation.actorId
              ? 'OFFLINE_ACTOR_MISMATCH: queued command belongs to a different authenticated user.'
              : 'OFFLINE_ACTOR_MISSING: legacy queued command has no authoritative originating user.'
          );
        }

        const actorOwned = mutations.filter(
          (mutation) => mutation.actorId === cached.user.uid
        );
        const allReplayable = actorOwned.filter(
          (mutation) => mutation.commandType && mutation.idempotencyKey
        );
        const registrationMutation = allReplayable.find(
          (mutation) => mutation.commandType === 'RegisterPatientAndEncounterCommand'
        );
        const replayable = registrationMutation ? [registrationMutation] : allReplayable;
        if (registrationMutation && allReplayable.length > 1) {
          // Canonical patient/encounter IDs must be known before dependent commands
          // are replayed. A follow-up pass runs after the registration mapping commits.
          needsFollowupReplay = true;
        }
        const legacy = actorOwned.filter(
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
                mutations: replayable.map((mutation) => ({
                  mutationId: mutation.id,
                  occurredAt: mutation.clientTimestamp || mutation.timestamp,
                  commandType: mutation.commandType,
                  payload: mutation.payload,
                  idempotencyKey: mutation.idempotencyKey,
                  entityId: mutation.resourceId || mutation.docId,
                  schemaVersion: mutation.schemaVersion || 1,
                  baseEntityVersion: mutation.baseEntityVersion,
                  vectorClock: mutation.vectorClock,
                })),
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
            const idMappings = Array.isArray(result.data?.idMappings)
              ? result.data.idMappings.filter(
                  (mapping: any) => mapping?.localId && mapping?.canonicalId && mapping?.entityType
                )
              : [];

            if (idMappings.length > 0) {
              await applyCanonicalEntityMappings(mutation.tenantId, idMappings);

              if (result.data?.patient?.id) {
                await putEdgeEntity(
                  mutation.tenantId,
                  'patients',
                  result.data.patient.id,
                  result.data.patient,
                  Number(result.serverVersion || result.data.patient.version || 1)
                );
              }
              if (result.data?.encounter?.id) {
                await putEdgeEntity(
                  mutation.tenantId,
                  'encounters',
                  result.data.encounter.id,
                  result.data.encounter,
                  Number(result.serverVersion || 1)
                );
              }
              if (result.data?.queueToken?.id) {
                await putEdgeEntity(
                  mutation.tenantId,
                  'opd_queue',
                  result.data.queueToken.id,
                  result.data.queueToken,
                  Number(result.serverVersion || 1)
                );
              }

              needsFollowupReplay = true;
            }

            const authoritativeData =
              mutation.collection === 'beds' && result.data?.bed
                ? result.data.bed
                : mutation.collection === 'billingMismatches' && result.data?.finding
                  ? result.data.finding
                  : result.data;

            if (
              mutation.commandType === 'RecordStockTransactionCommand' &&
              result.data?.balance &&
              mutation.resourceId &&
              result.serverVersion
            ) {
              await putEdgeEntity(
                mutation.tenantId,
                'inventoryBalances',
                mutation.resourceId,
                {
                  ...(result.data.balance as Record<string, unknown>),
                  _serverVersion: result.serverVersion,
                  ...(result.serverVectorClock
                    ? { _vectorClock: result.serverVectorClock }
                    : {}),
                },
                result.serverVersion
              );
            } else if (
              authoritativeData &&
              typeof authoritativeData === 'object' &&
              mutation.resourceId &&
              result.serverVersion
            ) {
              await putEdgeEntity(
                mutation.tenantId,
                mutation.collection,
                String(
                  (authoritativeData as any).id ||
                  (authoritativeData as any).findingId ||
                  mutation.resourceId
                ),
                {
                  ...(authoritativeData as Record<string, unknown>),
                  _serverVersion: result.serverVersion,
                  ...(result.serverVectorClock
                    ? { _vectorClock: result.serverVectorClock }
                    : {}),
                },
                result.serverVersion
              );
            }

            await deleteMutation(mutation.id);
            await saveToOfflineCache(
              mutation.tenantId,
              mutation.collection,
              idMappings.find((mapping: any) => mapping.localId === mutation.resourceId)?.canonicalId ||
                mutation.resourceId ||
                mutation.docId,
              result.data || mutation.payload
            );
            syncedCount += 1;
          } else if (result.status === 'conflict' || result.status === 'requires_review') {
            conflictCount += 1;
            await updateMutationStatus(
              mutation.id,
              'conflict',
              result.reason || 'Server reconciliation required.'
            );
            await recordSyncConflict({
              id: mutation.id,
              mutationId: mutation.id,
              tenantId: mutation.tenantId,
              collection: mutation.collection,
              resourceId: mutation.resourceId || mutation.docId,
              clientData: mutation.payload,
              serverData:
                result.data?.serverState && typeof result.data.serverState === 'object'
                  ? result.data.serverState
                  : undefined,
              conflictType: result.conflictCategory || 'STATE_CONFLICT',
              reason: result.reason,
            });
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

    if (needsFollowupReplay && this.state.isOnline && !this.forcedOffline) {
      queueMicrotask(() => {
        void this.processSyncQueue(tenantId);
      });
    }

    return { syncedCount, conflictCount };
  }
}

export const syncEngine =
  typeof window !== 'undefined'
    ? new ClinicalSyncEngine()
    : (null as unknown as ClinicalSyncEngine);
