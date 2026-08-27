'use client';

import { useState, useEffect, useCallback } from 'react';
import { syncCoordinator, queueMutation, processSyncQueue } from '@/lib/offline/sync-worker';
import { MutationAction } from '@/types/offline';

export interface UseOfflineSyncResult {
  isOnline: boolean;
  isSyncing: boolean;
  pendingMutationsCount: number;
  conflictCount: number;
  lastSyncedAt: number | null;
  lastError: string | null;
  triggerSync: (tenantId?: string) => Promise<{ syncedCount: number; conflictCount: number }>;
  saveClinicalDataOptimistic: (
    tenantId: string,
    collection: string,
    docId: string,
    action: MutationAction,
    payload: Record<string, unknown>
  ) => Promise<string>;
}

export function useOfflineSync(tenantId?: string): UseOfflineSyncResult {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [pendingMutationsCount, setPendingMutationsCount] = useState<number>(0);
  const [conflictCount, setConflictCount] = useState<number>(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (!syncCoordinator) return;

    const unsubscribe = syncCoordinator.subscribe((state) => {
      setIsOnline(state.isOnline);
      setIsSyncing(state.isSyncing);
      setPendingMutationsCount(state.pendingCount);
      setConflictCount(state.conflictCount);
      setLastSyncedAt(state.lastSyncedAt);
      setLastError(state.lastError);
    });

    if (tenantId) {
      syncCoordinator.refreshMetrics(tenantId);
    }

    return () => {
      unsubscribe();
    };
  }, [tenantId]);

  const triggerSync = useCallback(
    async (targetTenant?: string) => {
      const activeTenant = targetTenant || tenantId || 't-main';
      return await processSyncQueue(activeTenant);
    },
    [tenantId]
  );

  const saveClinicalDataOptimistic = useCallback(
    async (
      targetTenantId: string,
      collection: string,
      docId: string,
      action: MutationAction,
      payload: Record<string, unknown>
    ) => {
      return await queueMutation(targetTenantId, collection, docId, action, payload);
    },
    []
  );

  return {
    isOnline,
    isSyncing,
    pendingMutationsCount,
    conflictCount,
    lastSyncedAt,
    lastError,
    triggerSync,
    saveClinicalDataOptimistic,
  };
}
