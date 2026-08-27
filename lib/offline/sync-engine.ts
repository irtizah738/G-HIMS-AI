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
import { db } from '@/lib/firebase/client';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { logAuditEvent } from '@/lib/audit/logger';

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
  payload: Record<string, any>;
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
      this.refreshPendingCount();

      // Periodic check every 25 seconds if online
      this.autoSyncInterval = setInterval(() => {
        if (this.state.isOnline && !this.state.isSyncing) {
          this.processSyncQueue();
        }
      }, 25000);
    }
  }

  private initNetworkListeners() {
    window.addEventListener('online', () => {
      this.updateState({ isOnline: true });
      this.processSyncQueue();
    });

    window.addEventListener('offline', () => {
      this.updateState({ isOnline: false });
    });

    // Listen to messages from Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'TRIGGER_SYNC_QUEUE') {
          this.processSyncQueue();
        }
      });
    }
  }

  public subscribe(listener: (state: SyncEngineState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateState(partial: Partial<SyncEngineState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => {
      try {
        listener(this.state);
      } catch (err) {
        console.error('Error in sync engine listener:', err);
      }
    });
  }

  public getState(): SyncEngineState {
    return { ...this.state };
  }

  public async refreshPendingCount(tenantId?: string): Promise<number> {
    try {
      const pending = await getPendingMutations(tenantId);
      const count = pending.length;
      this.updateState({ pendingCount: count });
      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Queues an offline mutation and updates the local cache for optimistic UI rendering.
   */
  public async queueMutation(params: QueueMutationParams): Promise<OfflineMutation> {
    const { tenantId, collection, action, resourceId, payload, optimisticCache = true } = params;

    // 1. Write mutation to IndexedDB queue
    const mutation = await addMutation({
      tenantId,
      collection,
      action,
      resourceId,
      payload,
    });

    // 2. Optimistic local cache update
    if (optimisticCache) {
      if (action === 'DELETE') {
        // Cached item could be flagged or removed
      } else {
        await saveToOfflineCache(tenantId, collection, resourceId, payload);
      }
    }

    await this.refreshPendingCount(tenantId);

    // 3. If online, trigger immediate sync or request background sync registration
    if (this.state.isOnline) {
      this.processSyncQueue(tenantId);
    } else {
      this.registerBackgroundSync();
    }

    return mutation;
  }

  /**
   * Registers a Background Sync tag with the Service Worker.
   */
  public async registerBackgroundSync() {
    try {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const registration = await navigator.serviceWorker.ready;
        // @ts-ignore: SyncManager types
        if (registration.sync) {
          // @ts-ignore
          await registration.sync.register('sync-clinical-queue');
        }
      }
    } catch (err) {
      console.warn('Background sync registration not supported or failed:', err);
    }
  }

  /**
   * Processes all pending mutations in chronological order with conflict detection.
   */
  public async processSyncQueue(tenantId?: string): Promise<{ syncedCount: number; conflictCount: number }> {
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
      const pendingMutations = await getPendingMutations(tenantId);

      for (const mut of pendingMutations) {
        this.updateState({ activeProcessingId: mut.id });
        await updateMutationStatus(mut.id, 'syncing');

        try {
          const docId = mut.resourceId || mut.docId;
          // Resolve Firestore Document Reference
          const docRef = this.getFirestoreDocRef(mut.tenantId, mut.collection, docId);

          if (mut.action === 'CREATE' || mut.action === 'UPDATE') {
            // Check for server-side concurrent conflicts
            const serverDocSnap = await getDoc(docRef);

            if (serverDocSnap.exists()) {
              const serverData = serverDocSnap.data() as Record<string, any>;
              const serverUpdatedAt = serverData.updatedAt || serverData.timestamp || null;
              const serverTime = serverUpdatedAt ? new Date(serverUpdatedAt).getTime() : 0;
              const clientTime = mut.clientTimestamp || mut.timestamp;

              // Sensitive clinical conflict check: If server was modified after client mutation was generated
              const isSensitiveResource = ['patients', 'vitals', 'soapNotes', 'medications', 'triage', 'invoices', 'claims'].includes(
                mut.collection
              );

              if (isSensitiveResource && serverTime > clientTime) {
                // Conflict detected: Last-Write-Wins with explicit audit flag
                conflictCount += 1;

                await recordSyncConflict({
                  tenantId: mut.tenantId,
                  collection: mut.collection,
                  resourceId: docId,
                  serverData,
                  clientData: mut.payload,
                  conflictType: 'CONCURRENT_EDIT',
                });

                await logAuditEvent({
                  tenantId: mut.tenantId,
                  action: 'CONFLICT_DETECTED',
                  resource: `${mut.collection}:${docId}`,
                  status: 'WARNING',
                  details: `Concurrent edit collision detected during offline replay. Server updatedAt: ${serverUpdatedAt}, Client queue time: ${mut.timestamp}`,
                  metadata: {
                    mutationId: mut.id,
                    serverTime,
                    clientTime,
                  },
                });

                // Apply deterministic resolution: LWW with merged audit marker
                const mergedPayload = {
                  ...serverData,
                  ...mut.payload,
                  _conflictResolved: true,
                  _replayedAt: new Date().toISOString(),
                };

                await setDoc(docRef, mergedPayload, { merge: true });

                await logAuditEvent({
                  tenantId: mut.tenantId,
                  action: 'OFFLINE_SYNC_OVERRIDE',
                  resource: `${mut.collection}:${docId}`,
                  status: 'CONFLICT_RESOLVED',
                  details: `Replayed offline mutation with LWW resolution strategy for ${mut.collection}:${docId}`,
                });
              } else {
                // Clean update
                await setDoc(docRef, { ...mut.payload, updatedAt: new Date().toISOString() }, { merge: true });
              }
            } else {
              // Document does not exist on server: clean create
              await setDoc(docRef, { ...mut.payload, createdAt: mut.payload.createdAt || new Date().toISOString() });
            }

            // Sync successful: remove from mutation queue & update local cache
            await deleteMutation(mut.id);
            await saveToOfflineCache(mut.tenantId, mut.collection, docId, mut.payload);
            syncedCount += 1;

            await logAuditEvent({
              tenantId: mut.tenantId,
              action: 'OFFLINE_SYNC_COMPLETE',
              resource: `${mut.collection}:${docId}`,
              status: 'SUCCESS',
              details: `Successfully synchronized offline ${mut.action} mutation to cloud Firestore`,
            });
          } else if (mut.action === 'DELETE') {
            await deleteDoc(docRef);
            await deleteMutation(mut.id);
            syncedCount += 1;

            await logAuditEvent({
              tenantId: mut.tenantId,
              action: 'DELETE',
              resource: `${mut.collection}:${docId}`,
              status: 'SUCCESS',
              details: `Offline deletion applied to cloud Firestore for ${mut.collection}:${docId}`,
            });
          }
        } catch (err: any) {
          console.error(`Failed to process mutation ${mut.id}:`, err);
          const errorMsg = err?.message || 'Unknown network error';
          await updateMutationStatus(mut.id, 'failed', errorMsg);
          this.updateState({ lastError: errorMsg });
        }
      }

      await this.refreshPendingCount(tenantId);
      this.updateState({
        lastSyncedAt: new Date(),
        activeProcessingId: null,
      });
    } catch (globalErr: any) {
      console.error('Global error in sync queue loop:', globalErr);
      this.updateState({ lastError: globalErr?.message || 'Sync loop failed' });
    } finally {
      this.isProcessing = false;
      this.updateState({ isSyncing: false, activeProcessingId: null });
    }

    return { syncedCount, conflictCount };
  }

  private getFirestoreDocRef(tenantId: string, collectionName: string, docId: string) {
    // Check if it's a tenant-scoped collection or top-level collection
    const tenantScopedCollections = ['tariffs', 'invoices', 'claims', 'audit_logs', 'encounters', 'orders'];
    if (tenantScopedCollections.includes(collectionName)) {
      return doc(db, 'tenants', tenantId, collectionName, docId);
    }
    return doc(db, collectionName, docId);
  }
}

// Global Singleton Instance
export const syncEngine = typeof window !== 'undefined' ? new ClinicalSyncEngine() : (null as unknown as ClinicalSyncEngine);
