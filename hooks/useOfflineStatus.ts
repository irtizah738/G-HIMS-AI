'use client';

import { useState, useEffect, useCallback } from 'react';
import { syncEngine, SyncEngineState } from '@/lib/offline/sync-engine';
import {
  getPendingMutations,
  getSyncConflicts,
  resolveSyncConflict,
  SyncConflict,
} from '@/lib/offline/db';
import { probeApplicationConnectivity } from '@/lib/offline/connectivity';

export interface OfflineStatusResult {
  isOnline: boolean;
  isSyncing: boolean;
  pendingSyncCount: number;
  conflictsCount: number;
  conflicts: SyncConflict[];
  latencyMs: number | null;
  networkType: string;
  lastSyncedAt: Date | null;
  lastError: string | null;
  triggerSync: (tenantId?: string) => Promise<{ syncedCount: number; conflictCount: number }>;
  resolveConflict: (
    conflictId: string,
    strategy: 'LWW_SERVER' | 'OVERWRITE_CLIENT' | 'MANUAL_MERGE',
    resolvedBy?: string
  ) => Promise<void>;
  refreshConflicts: () => Promise<void>;
}

export function useOfflineStatus(tenantId?: string): OfflineStatusResult {
  // Default optimistic-online until the real application-origin probe completes.
  // This avoids false offline mode in sandboxed preview environments.
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [networkType, setNetworkType] = useState<string>('ethernet/wifi');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const refreshConnectivity = useCallback(
    async (processQueueWhenOnline = false) => {
      if (typeof window === 'undefined') return;

      const result = syncEngine
        ? await syncEngine.refreshConnectivity(processQueueWhenOnline)
        : await probeApplicationConnectivity();

      setIsOnline(result.isOnline);
      setLatencyMs(result.latencyMs);
    },
    []
  );

  const refreshConflicts = useCallback(async () => {
    try {
      const activeConflicts = await getSyncConflicts(tenantId);
      setConflicts(activeConflicts);
    } catch (err) {
      console.warn('Failed to load sync conflicts:', err);
    }
  }, [tenantId]);

  const refreshCounts = useCallback(async () => {
    try {
      const pending = await getPendingMutations(tenantId);
      setPendingSyncCount(pending.length);
      await refreshConflicts();
    } catch (err) {
      console.warn('Error reading offline queue:', err);
    }
  }, [tenantId, refreshConflicts]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          const registration = reg as ServiceWorkerRegistration & {
            sync?: { register: (tag: string) => Promise<void> };
          };
          registration.sync?.register('sync-clinical-queue').catch(() => {});
        })
        .catch((err) => {
          console.warn('Service worker registration failed:', err);
        });
    }

    const connection = (
      navigator as Navigator & {
        connection?: {
          effectiveType?: string;
          type?: string;
          addEventListener?: (event: string, cb: () => void) => void;
          removeEventListener?: (event: string, cb: () => void) => void;
        };
        mozConnection?: {
          effectiveType?: string;
          type?: string;
          addEventListener?: (event: string, cb: () => void) => void;
          removeEventListener?: (event: string, cb: () => void) => void;
        };
        webkitConnection?: {
          effectiveType?: string;
          type?: string;
          addEventListener?: (event: string, cb: () => void) => void;
          removeEventListener?: (event: string, cb: () => void) => void;
        };
      }
    ).connection || (
      navigator as Navigator & {
        mozConnection?: {
          effectiveType?: string;
          type?: string;
          addEventListener?: (event: string, cb: () => void) => void;
          removeEventListener?: (event: string, cb: () => void) => void;
        };
      }
    ).mozConnection || (
      navigator as Navigator & {
        webkitConnection?: {
          effectiveType?: string;
          type?: string;
          addEventListener?: (event: string, cb: () => void) => void;
          removeEventListener?: (event: string, cb: () => void) => void;
        };
      }
    ).webkitConnection;

    const updateConnectionType = () => {
      if (!connection) return;
      setNetworkType(connection.effectiveType || connection.type || 'wifi');
    };

    updateConnectionType();
    connection?.addEventListener?.('change', updateConnectionType);

    // Browser online/offline events are hints only. Confirm them against the
    // G-HIMS application origin before changing clinical connectivity state.
    const handleOnlineHint = () => {
      void refreshConnectivity(true);
    };

    const handleOfflineHint = () => {
      void refreshConnectivity(false);
    };

    window.addEventListener('online', handleOnlineHint);
    window.addEventListener('offline', handleOfflineHint);

    void refreshConnectivity(false);
    void refreshCounts();

    let unsubscribe: (() => void) | undefined;
    if (syncEngine) {
      unsubscribe = syncEngine.subscribe((engineState: SyncEngineState) => {
        setIsOnline(engineState.isOnline);
        setIsSyncing(engineState.isSyncing);
        setPendingSyncCount(engineState.pendingCount);
        setLastSyncedAt(engineState.lastSyncedAt);
        setLastError(engineState.lastError);
      });
    }

    const interval = window.setInterval(() => {
      void refreshConnectivity(false);
      void refreshCounts();
    }, 15000);

    return () => {
      window.removeEventListener('online', handleOnlineHint);
      window.removeEventListener('offline', handleOfflineHint);
      connection?.removeEventListener?.('change', updateConnectionType);
      unsubscribe?.();
      window.clearInterval(interval);
    };
  }, [tenantId, refreshConnectivity, refreshCounts]);

  const triggerSync = useCallback(
    async (overrideTenantId?: string) => {
      if (!syncEngine) {
        return { syncedCount: 0, conflictCount: 0 };
      }
      setIsSyncing(true);
      try {
        const result = await syncEngine.processSyncQueue(overrideTenantId || tenantId);
        await refreshCounts();
        return result;
      } finally {
        setIsSyncing(false);
      }
    },
    [tenantId, refreshCounts]
  );

  const handleResolveConflict = useCallback(
    async (
      conflictId: string,
      strategy: 'LWW_SERVER' | 'OVERWRITE_CLIENT' | 'MANUAL_MERGE',
      resolvedBy?: string
    ) => {
      await resolveSyncConflict(conflictId, strategy, resolvedBy);
      await refreshConflicts();
    },
    [refreshConflicts]
  );

  return {
    isOnline,
    isSyncing,
    pendingSyncCount,
    conflictsCount: conflicts.length,
    conflicts,
    latencyMs,
    networkType,
    lastSyncedAt,
    lastError,
    triggerSync,
    resolveConflict: handleResolveConflict,
    refreshConflicts,
  };
}
