import { localDb } from './db';
import { SyncMutation, VectorClock, MutationAction } from '@/types/offline';
import { incrementClock, compareClocks, resolveVectorConflict } from './vector-clock';
import { db } from '@/lib/firebase/client';
import { doc, runTransaction } from 'firebase/firestore';

const CLIENT_NODE_ID = typeof window !== 'undefined'
  ? (localStorage.getItem('ghims_node_id') || (() => {
      const id = `node_${Math.random().toString(36).substring(2, 8)}`;
      localStorage.setItem('ghims_node_id', id);
      return id;
    })())
  : 'node_server';

export interface SyncWorkerState {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  conflictCount: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

type SyncStateListener = (state: SyncWorkerState) => void;

class ClinicalSyncCoordinator {
  private isProcessing = false;
  private listeners = new Set<SyncStateListener>();
  private state: SyncWorkerState = {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    isSyncing: false,
    pendingCount: 0,
    conflictCount: 0,
    lastSyncedAt: null,
    lastError: null,
  };
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.updateState({ isOnline: true });
        this.processSyncQueue();
      });

      window.addEventListener('offline', () => {
        this.updateState({ isOnline: false });
      });

      this.refreshMetrics();

      // Periodic queue drain every 20 seconds if online
      this.autoSyncTimer = setInterval(() => {
        if (this.state.isOnline && !this.state.isSyncing) {
          this.processSyncQueue();
        }
      }, 20000);
    }
  }

  public subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(partial: Partial<SyncWorkerState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((fn) => fn(this.state));
  }

  public getState(): SyncWorkerState {
    return { ...this.state };
  }

  public async refreshMetrics(tenantId?: string): Promise<{ pending: number; conflicts: number }> {
    try {
      let pendingQuery = localDb.mutations.filter((m) => m.status === 'pending' || m.status === 'failed');
      let conflictQuery = localDb.mutations.where('status').equals('conflict');

      if (tenantId) {
        pendingQuery = localDb.mutations
          .where('tenantId')
          .equals(tenantId)
          .filter((m) => m.status === 'pending' || m.status === 'failed');
        conflictQuery = localDb.mutations
          .where('tenantId')
          .equals(tenantId)
          .filter((m) => m.status === 'conflict');
      }

      const pending = await pendingQuery.count();
      const conflicts = await conflictQuery.count();

      this.updateState({ pendingCount: pending, conflictCount: conflicts });
      return { pending, conflicts };
    } catch {
      return { pending: 0, conflicts: 0 };
    }
  }

  /**
   * Queues an offline mutation in Dexie.js and optimistically writes to local storage tables.
   */
  public async queueMutation(
    tenantId: string,
    collection: string,
    docId: string,
    action: MutationAction,
    payload: Record<string, unknown>
  ): Promise<string> {
    const mutationId = `mut_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();

    // Fetch existing cache entry to compute next vector clock
    const cacheKey = `${tenantId}:${collection}:${docId}`;
    const existingCache = await localDb.offline_cache.get(cacheKey);
    const prevClock: VectorClock = existingCache?.vectorClock || {};
    const nextClock = incrementClock(prevClock, CLIENT_NODE_ID);

    const mutation: SyncMutation = {
      id: mutationId,
      tenantId,
      collection,
      docId,
      action,
      payload,
      vectorClock: nextClock,
      timestamp: now,
      retryCount: 0,
      status: 'pending',
    };

    // 1. Persist to Dexie mutations queue
    await localDb.mutations.put(mutation);

    // 2. Optimistic local cache update
    await localDb.offline_cache.put({
      key: cacheKey,
      tenantId,
      collection,
      data: payload,
      updatedAt: now,
      vectorClock: nextClock,
    });

    // 3. Optimistic specific table reflection
    if (collection === 'beds' || collection === 'bed_occupancy') {
      await localDb.bed_occupancy.put({
        id: docId,
        tenantId,
        wardId: (payload.wardId as string) || 'ward-gen',
        wardName: (payload.wardName as string) || 'General',
        bedNumber: (payload.bedNumber as string) || docId,
        roomNumber: (payload.roomNumber as string) || '101',
        status: (payload.status as any) || 'Available',
        ...payload,
        updatedAt: now,
        vectorClock: nextClock,
      } as any);
    } else if (collection === 'surgical_cases') {
      await localDb.surgical_cases.put({
        id: docId,
        tenantId,
        patientId: (payload.patientId as string) || '',
        theaterId: (payload.theaterId as string) || 'or-1',
        status: (payload.status as any) || 'scheduled',
        ...payload,
        updatedAt: now,
        vectorClock: nextClock,
      } as any);
    } else if (collection === 'patients' || collection === 'clinical_patients') {
      await localDb.clinical_patients.put({
        id: docId,
        tenantId,
        mrn: (payload.mrn as string) || '',
        name: (payload.name as string) || (payload.fullName as string) || 'Patient',
        ...payload,
        updatedAt: now,
        vectorClock: nextClock,
      } as any);
    }

    await this.refreshMetrics(tenantId);

    // Trigger sync immediately if online
    if (this.state.isOnline) {
      this.processSyncQueue(tenantId);
    }

    return mutationId;
  }

  /**
   * Processes all pending mutations sequentially using Firestore atomic runTransaction.
   */
  public async processSyncQueue(
    targetTenantId?: string
  ): Promise<{ syncedCount: number; conflictCount: number }> {
    if (this.isProcessing) {
      return { syncedCount: 0, conflictCount: 0 };
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.updateState({ isOnline: false });
      return { syncedCount: 0, conflictCount: 0 };
    }

    this.isProcessing = true;
    this.updateState({ isSyncing: true, lastError: null });

    let syncedCount = 0;
    let conflictCount = 0;

    try {
      let pendingList = await localDb.mutations
        .filter((m) => m.status === 'pending' || m.status === 'failed')
        .sortBy('timestamp');

      if (targetTenantId) {
        pendingList = pendingList.filter((m) => m.tenantId === targetTenantId);
      }

      for (const mutation of pendingList) {
        // Mark mutation as syncing in Dexie
        await localDb.mutations.update(mutation.id, { status: 'syncing' });

        try {
          const docRef = doc(db, 'tenants', mutation.tenantId, mutation.collection, mutation.docId);

          await runTransaction(db, async (transaction) => {
            const serverDocSnap = await transaction.get(docRef);

            if (mutation.action === 'DELETE') {
              if (serverDocSnap.exists()) {
                transaction.delete(docRef);
              }
              return;
            }

            if (!serverDocSnap.exists()) {
              // Clean creation on server
              const newPayload = {
                ...mutation.payload,
                _vectorClock: mutation.vectorClock,
                _lastSyncedAt: Date.now(),
                _clientTimestamp: mutation.timestamp,
                createdAt: (mutation.payload.createdAt as string) || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              };
              transaction.set(docRef, newPayload);
            } else {
              // Existing document on server: compare vector clocks
              const serverData = serverDocSnap.data() as Record<string, unknown>;
              const serverClock = (serverData._vectorClock as VectorClock) || {};
              const serverTimestamp = (serverData._clientTimestamp as number) || (serverData.updatedAt ? new Date(serverData.updatedAt as string).getTime() : 0);

              const comparison = compareClocks(mutation.vectorClock, serverClock);

              if (comparison === 'CONCURRENT') {
                // Concurrent conflict detected: run deterministic field merge + LWW
                const resolution = resolveVectorConflict(
                  { data: mutation.payload, clock: mutation.vectorClock, timestamp: mutation.timestamp },
                  { data: serverData, clock: serverClock, timestamp: serverTimestamp }
                );

                conflictCount += 1;

                const mergedPayload = {
                  ...resolution.resolvedData,
                  _vectorClock: resolution.resolvedClock,
                  _conflictResolved: true,
                  _lastSyncedAt: Date.now(),
                  updatedAt: new Date().toISOString(),
                };

                transaction.set(docRef, mergedPayload, { merge: true });
              } else {
                // Strict causal order (client dominates or equal)
                const nextClock = incrementClock(serverClock, CLIENT_NODE_ID);
                const updatedPayload = {
                  ...serverData,
                  ...mutation.payload,
                  _vectorClock: nextClock,
                  _lastSyncedAt: Date.now(),
                  updatedAt: new Date().toISOString(),
                };
                transaction.set(docRef, updatedPayload, { merge: true });
              }
            }
          });

          // Transaction succeeded: delete processed mutation from queue
          await localDb.mutations.delete(mutation.id);
          syncedCount += 1;
        } catch (itemErr: any) {
          console.warn(`Sync failed for mutation ${mutation.id}:`, itemErr);
          const errMsg = itemErr?.message || 'Transaction error';
          await localDb.mutations.update(mutation.id, {
            status: 'failed',
            retryCount: mutation.retryCount + 1,
            errorMessage: errMsg,
          });
        }
      }

      await this.refreshMetrics(targetTenantId);
      this.updateState({
        lastSyncedAt: Date.now(),
        lastError: null,
      });
    } catch (globalErr: any) {
      console.error('Fatal error during sync process:', globalErr);
      this.updateState({ lastError: globalErr?.message || 'Global sync failed' });
    } finally {
      this.isProcessing = false;
      this.updateState({ isSyncing: false });
    }

    return { syncedCount, conflictCount };
  }
}

// Global Singleton Coordinator
export const syncCoordinator = typeof window !== 'undefined'
  ? new ClinicalSyncCoordinator()
  : (null as unknown as ClinicalSyncCoordinator);

export async function queueMutation(
  tenantId: string,
  collection: string,
  docId: string,
  action: MutationAction,
  payload: Record<string, unknown>
): Promise<string> {
  if (syncCoordinator) {
    return await syncCoordinator.queueMutation(tenantId, collection, docId, action, payload);
  }
  return '';
}

export async function processSyncQueue(
  tenantId: string
): Promise<{ syncedCount: number; conflictCount: number }> {
  if (syncCoordinator) {
    return await syncCoordinator.processSyncQueue(tenantId);
  }
  return { syncedCount: 0, conflictCount: 0 };
}
