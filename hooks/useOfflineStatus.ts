'use client';

import { useState, useEffect, useCallback } from 'react';
import { syncEngine, SyncEngineState } from '@/lib/offline/sync-engine';
import { getPendingMutations, getSyncConflicts, resolveSyncConflict, SyncConflict } from '@/lib/offline/db';

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
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [networkType, setNetworkType] = useState<string>('ethernet/wifi');
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // Measure network latency
  const measureLatency = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator.onLine) {
      setLatencyMs(null);
      return;
    }

    try {
      const startTime = performance.now();
      // Fetch small header
      const res = await fetch('/favicon.ico', { method: 'HEAD', cache: 'no-store' });
      if (res.ok) {
        const endTime = performance.now();
        setLatencyMs(Math.round(endTime - startTime));
      }
    } catch {
      setLatencyMs(null);
    }
  }, []);

  // Fetch active conflicts
  const refreshConflicts = useCallback(async () => {
    try {
      const activeConflicts = await getSyncConflicts(tenantId);
      setConflicts(activeConflicts);
    } catch (err) {
      console.warn('Failed to load sync conflicts:', err);
    }
  }, [tenantId]);

  // Refresh pending mutation count
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

    // 1. Register Service Worker
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // Check for background sync support
          // @ts-ignore
          if (reg.sync) {
            // @ts-ignore
            reg.sync.register('sync-clinical-queue').catch(() => {});
          }
        })
        .catch((err) => {
          console.warn('Service worker registration failed:', err);
        });
    }

    // 2. Network connection info
    // @ts-ignore
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection) {
      setNetworkType(connection.effectiveType || connection.type || 'wifi');
      const updateConn = () => {
        setNetworkType(connection.effectiveType || connection.type || 'wifi');
      };
      connection.addEventListener('change', updateConn);
    }

    // 3. Online/Offline Listeners
    const handleOnline = () => {
      setIsOnline(true);
      measureLatency();
      if (syncEngine) {
        syncEngine.processSyncQueue(tenantId);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setLatencyMs(null);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial checks
    measureLatency();
    refreshCounts();

    // 4. Subscribe to SyncEngine
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

    // Periodic ping & queue check
    const interval = setInterval(() => {
      measureLatency();
      refreshCounts();
    }, 15000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (unsubscribe) unsubscribe();
      clearInterval(interval);
    };
  }, [tenantId, measureLatency, refreshCounts]);

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
