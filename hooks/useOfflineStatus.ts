'use client';

import { useState, useEffect, useCallback } from 'react';
import { syncEngine, SyncEngineState } from '@/lib/offline/sync-engine';
import {
  measureLocalStoreLatency,
  resolveSyncConflict,
  SyncConflict,
} from '@/lib/offline/db';
import {
  getSecureConflicts,
  getSecurePendingMutations,
  getSecurePendingVectorClock,
} from '@/lib/offline/secure-store';
import { getCachedAuthSession } from '@/lib/offline/auth-storage';
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
  localStoreLatencyMs: number | null;
  vectorClock: Record<string, number>;
  replicaStatus: SyncEngineState['replicaStatus'];
  replicaReachable: boolean | null;
  replicaLatencyMs: number | null;
  replicaStoreLatencyMs: number | null;
  replicaCheckedAt: Date | null;
  replicaError: string | null;
  lastReplicationEvent: SyncEngineState['lastReplicationEvent'];
  offlineSimulationActive: boolean;
  triggerSync: (tenantId?: string) => Promise<{ syncedCount: number; conflictCount: number }>;
  setOfflineSimulation: (active: boolean) => Promise<void>;
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
  const [localStoreLatencyMs, setLocalStoreLatencyMs] = useState<number | null>(null);
  const [vectorClock, setVectorClock] = useState<Record<string, number>>({});
  const [replicaStatus, setReplicaStatus] = useState<SyncEngineState['replicaStatus']>('unknown');
  const [replicaReachable, setReplicaReachable] = useState<boolean | null>(null);
  const [replicaLatencyMs, setReplicaLatencyMs] = useState<number | null>(null);
  const [replicaStoreLatencyMs, setReplicaStoreLatencyMs] = useState<number | null>(null);
  const [replicaCheckedAt, setReplicaCheckedAt] = useState<Date | null>(null);
  const [replicaError, setReplicaError] = useState<string | null>(null);
  const [lastReplicationEvent, setLastReplicationEvent] = useState<SyncEngineState['lastReplicationEvent']>(null);
  const [offlineSimulationActive, setOfflineSimulationActive] = useState<boolean>(false);

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
      const cached = await getCachedAuthSession();
      if (!cached?.user?.uid || !tenantId) {
        setConflicts([]);
        return;
      }
      const activeConflicts = await getSecureConflicts(tenantId, cached.user.uid);
      setConflicts(activeConflicts as SyncConflict[]);
    } catch (err) {
      console.warn('Failed to load sync conflicts:', err);
    }
  }, [tenantId]);

  const refreshCounts = useCallback(async () => {
    try {
      const cached = await getCachedAuthSession();
      if (!cached?.user?.uid || !tenantId) {
        setPendingSyncCount(0);
        setVectorClock({});
        setLocalStoreLatencyMs(await measureLocalStoreLatency(tenantId));
        await refreshConflicts();
        return;
      }

      const [pending, clock, localLatency] = await Promise.all([
        getSecurePendingMutations(tenantId, cached.user.uid),
        getSecurePendingVectorClock(tenantId, cached.user.uid),
        measureLocalStoreLatency(tenantId),
      ]);
      setPendingSyncCount(pending.length);
      setVectorClock(clock);
      setLocalStoreLatencyMs(localLatency);
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
      void refreshConnectivity(true).then(() => {
        if (syncEngine) void syncEngine.refreshReplicaStatus(tenantId);
      });
    };

    const handleOfflineHint = () => {
      void refreshConnectivity(false);
    };

    window.addEventListener('online', handleOnlineHint);
    window.addEventListener('offline', handleOfflineHint);

    void refreshConnectivity(false).then(() => {
      if (syncEngine) void syncEngine.refreshReplicaStatus(tenantId);
    });
    void refreshCounts();

    let unsubscribe: (() => void) | undefined;
    if (syncEngine) {
      unsubscribe = syncEngine.subscribe((engineState: SyncEngineState) => {
        setIsOnline(engineState.isOnline);
        setIsSyncing(engineState.isSyncing);
        setPendingSyncCount(engineState.pendingCount);
        setLastSyncedAt(engineState.lastSyncedAt);
        setLastError(engineState.lastError);
        setReplicaStatus(engineState.replicaStatus);
        setReplicaReachable(engineState.replicaReachable);
        setReplicaLatencyMs(engineState.replicaLatencyMs);
        setReplicaStoreLatencyMs(engineState.replicaStoreLatencyMs);
        setReplicaCheckedAt(engineState.replicaCheckedAt);
        setReplicaError(engineState.replicaError);
        setLastReplicationEvent(engineState.lastReplicationEvent);
        setOfflineSimulationActive(engineState.offlineSimulationActive);
      });
    }

    // The singleton sync engine owns periodic network/replica probes. This hook
    // only refreshes local queue telemetry so multiple UI consumers do not create
    // duplicate authenticated Firestore status traffic.
    const interval = window.setInterval(() => {
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

  const handleOfflineSimulation = useCallback(
    async (active: boolean) => {
      if (!syncEngine) return;
      await syncEngine.setOfflineSimulation(active);
      await refreshCounts();
    },
    [refreshCounts]
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
    localStoreLatencyMs,
    vectorClock,
    replicaStatus,
    replicaReachable,
    replicaLatencyMs,
    replicaStoreLatencyMs,
    replicaCheckedAt,
    replicaError,
    lastReplicationEvent,
    offlineSimulationActive,
    triggerSync,
    setOfflineSimulation: handleOfflineSimulation,
    resolveConflict: handleResolveConflict,
    refreshConflicts,
  };
}
