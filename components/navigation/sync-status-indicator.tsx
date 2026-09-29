'use client';

import React, { useMemo, useState } from 'react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  Server,
  Database,
  Zap,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';

export function SyncStatusIndicator() {
  const { activeTenant } = useAuth();
  const tenantId = activeTenant?.tenantId;

  const {
    isOnline,
    isSyncing,
    pendingSyncCount,
    conflictsCount,
    localStoreLatencyMs,
    vectorClock,
    replicaStatus,
    replicaReachable,
    replicaLatencyMs,
    replicaStoreLatencyMs,
    replicaCheckedAt,
    replicaError,
    lastReplicationEvent,
    lastError,
    offlineSimulationActive,
    triggerSync,
    setOfflineSimulation,
  } = useOfflineStatus(tenantId);

  const [isOpen, setIsOpen] = useState(false);
  const [manualResult, setManualResult] = useState<string | null>(null);

  const syncState: 'connected' | 'syncing' | 'offline' | 'degraded' = isSyncing
    ? 'syncing'
    : !isOnline
      ? 'offline'
      : replicaReachable === true
        ? 'connected'
        : 'degraded';

  const vectorEntries = useMemo(
    () => Object.entries(vectorClock).sort(([a], [b]) => a.localeCompare(b)),
    [vectorClock]
  );

  const vectorLabel = useMemo(() => {
    if (vectorEntries.length === 0) return '∅';
    const visible = vectorEntries.slice(0, 2).map(([node, counter]) => `${node}:${counter}`);
    return vectorEntries.length > 2
      ? `${visible.join(' · ')} +${vectorEntries.length - 2}`
      : visible.join(' · ');
  }, [vectorEntries]);

  const handleForceSync = async () => {
    setManualResult(null);
    try {
      const result = await triggerSync(tenantId);
      setManualResult(
        result.conflictCount > 0
          ? `${result.syncedCount} accepted · ${result.conflictCount} review`
          : `${result.syncedCount} accepted · 0 conflicts`
      );
    } catch (error) {
      setManualResult(error instanceof Error ? error.message : 'Sync failed');
    }
  };

  const handleToggleOfflineTest = async () => {
    if (!offlineSimulationActive && !isOnline) return;

    try {
      setManualResult(null);
      await setOfflineSimulation(!offlineSimulationActive);
      if (offlineSimulationActive) {
        setManualResult('Offline test ended; live connectivity re-verified.');
      } else {
        setManualResult('Offline test active; new governed commands will remain queued locally.');
      }
    } catch (error) {
      setManualResult(error instanceof Error ? error.message : 'Unable to change offline test state');
    }
  };

  const replicaDetail = (() => {
    if (replicaStatus === 'ready') {
      const parts = [
        replicaLatencyMs !== null ? `RTT ${replicaLatencyMs}ms` : null,
        replicaStoreLatencyMs !== null ? `DB ${replicaStoreLatencyMs}ms` : null,
      ].filter(Boolean);
      return parts.join(' · ') || 'Authoritative store verified';
    }
    if (replicaStatus === 'unauthenticated') return 'Awaiting authenticated session';
    if (replicaStatus === 'offline') return 'Disconnected';
    if (replicaStatus === 'unavailable') return replicaError ? `Unavailable · ${replicaError}` : 'Unavailable';
    return 'Checking authoritative store...';
  })();

  const replicationText = lastReplicationEvent
    ? `${lastReplicationEvent.at.toLocaleTimeString()} · ${lastReplicationEvent.outcome} · ${lastReplicationEvent.syncedCount} accepted · ${lastReplicationEvent.conflictCount} conflicts${lastReplicationEvent.batchIds[0] ? ` · ${lastReplicationEvent.batchIds[0]}` : ''}`
    : 'No sync replay completed in this browser session';

  const replicationHealthy =
    pendingSyncCount === 0 &&
    conflictsCount === 0 &&
    replicaStatus === 'ready' &&
    replicaReachable === true;

  const runtimeMode = String(process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE || '').toUpperCase();
  const offlineSimulationAllowed = runtimeMode !== 'PRODUCTION';

  return (
    <div className="relative inline-block text-left" id="global-sync-status-container">
      <button
        id="btn-global-sync-status"
        onClick={() => setIsOpen(!isOpen)}
        className={`h-9 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 rounded-xl border text-xs font-semibold transition-all cursor-pointer select-none shadow-2xs ${
          syncState === 'connected'
            ? 'bg-emerald-50/80 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200/90 dark:border-emerald-800'
            : syncState === 'syncing'
              ? 'bg-blue-50/80 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200/90 dark:border-blue-800 animate-pulse'
              : syncState === 'offline'
                ? 'bg-amber-50/90 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/60 text-amber-900 dark:text-amber-300 border-amber-200/90 dark:border-amber-800'
                : 'bg-rose-50/90 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-200/90 dark:border-rose-800'
        }`}
        title="Live edge/cloud sync status"
      >
        <span className="relative flex h-2 w-2 items-center justify-center shrink-0">
          {syncState === 'connected' && (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </>
          )}
          {syncState === 'syncing' && (
            <RefreshCw className="w-2.5 h-2.5 text-blue-600 dark:text-blue-400 animate-spin" />
          )}
          {syncState === 'offline' && (
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          )}
          {syncState === 'degraded' && (
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
          )}
        </span>

        <span className="hidden sm:inline font-medium">
          {syncState === 'connected' && 'Live Edge'}
          {syncState === 'syncing' && 'Syncing...'}
          {syncState === 'offline' && (pendingSyncCount > 0 ? `Offline (${pendingSyncCount})` : 'Offline')}
          {syncState === 'degraded' && 'Replica Degraded'}
        </span>

        <ChevronDown className="w-3 h-3 opacity-60 shrink-0 ml-0.5" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-2xs"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-[calc(100vw-1.5rem)] max-w-sm sm:w-96 rounded-2xl bg-white dark:bg-slate-850 shadow-2xl border border-slate-200/90 dark:border-slate-700 p-4 z-50 space-y-3.5 animate-in fade-in zoom-in-95 duration-150 text-slate-800 dark:text-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-750 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400">
                  <Server className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-tight">
                    Dual-Engine Sync Engine
                  </h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Live IndexedDB queue + authoritative cloud replay
                  </p>
                </div>
              </div>

              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wide border ${
                  syncState === 'connected'
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                    : syncState === 'syncing'
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                      : syncState === 'offline'
                        ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                        : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                }`}
              >
                {syncState === 'connected'
                  ? 'Verified Sync'
                  : syncState === 'syncing'
                    ? 'Sync In Progress'
                    : syncState === 'offline'
                      ? offlineSimulationActive ? 'Offline Test' : 'Edge Mode'
                      : 'Replica Degraded'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-750 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    Local Edge Store
                  </span>
                  <span className={`w-2 h-2 rounded-full ${localStoreLatencyMs !== null ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">IndexedDB / Dexie</p>
                <div className="text-[11px] font-mono font-bold text-slate-800 dark:text-slate-200 pt-0.5">
                  {localStoreLatencyMs !== null ? `Read: ${localStoreLatencyMs.toFixed(2)}ms` : 'Status: Unavailable'}
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-750 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Wifi className={`w-3.5 h-3.5 ${replicaReachable ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`} />
                    Cloud Replica
                  </span>
                  <span className={`w-2 h-2 rounded-full ${replicaReachable === true ? 'bg-emerald-500' : replicaReachable === false ? 'bg-rose-500' : 'bg-slate-400'}`} />
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">Authenticated master-store probe</p>
                <div className="text-[10px] font-mono font-bold text-slate-800 dark:text-slate-200 pt-0.5 break-words">
                  {replicaDetail}
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-blue-50/50 dark:bg-blue-950/40 border border-blue-100/80 dark:border-blue-900/60 space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  Pending Queue Vector Clock:
                </span>
                <span
                  title={vectorEntries.length > 0 ? JSON.stringify(vectorClock) : 'No queued causal divergence'}
                  className="max-w-[170px] truncate font-mono font-extrabold text-blue-800 dark:text-blue-300 text-[10px] bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800"
                >
                  {vectorLabel}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs pt-1 border-t border-blue-100/60 dark:border-blue-900/40">
                <span className="text-slate-600 dark:text-slate-400 text-[11px]">Pending Offline Commands:</span>
                <span className={`font-bold text-xs ${pendingSyncCount > 0 ? 'text-amber-600 dark:text-amber-400' : replicationHealthy ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300'}`}>
                  {pendingSyncCount > 0
                    ? `${pendingSyncCount} queued`
                    : replicationHealthy
                      ? '0 queued (Replica Verified)'
                      : '0 queued'}
                </span>
              </div>

              {conflictsCount > 0 && (
                <div className="flex items-center justify-between text-[11px] text-rose-600 dark:text-rose-300">
                  <span>Server reconciliation review:</span>
                  <strong>{conflictsCount} conflict{conflictsCount === 1 ? '' : 's'}</strong>
                </div>
              )}
            </div>

            <div className="text-[11px] space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Last Replication Result
                </span>
                {replicaCheckedAt && (
                  <span className="text-[9px] text-slate-400 font-mono">
                    probe {replicaCheckedAt.toLocaleTimeString()}
                  </span>
                )}
              </div>
              <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-mono text-[10px] break-words">
                {replicationText}
              </div>
              {(lastError || replicaError) && (
                <div className="flex items-start gap-1.5 text-[10px] text-rose-600 dark:text-rose-300">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>{lastError || replicaError}</span>
                </div>
              )}
              {manualResult && (
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                  {manualResult}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 dark:border-slate-750">
              <button
                onClick={handleToggleOfflineTest}
                disabled={
                  !offlineSimulationAllowed ||
                  (!offlineSimulationActive && !isOnline) ||
                  isSyncing
                }
                className="w-full py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  !offlineSimulationAllowed
                    ? 'Offline simulation is disabled in production.'
                    : 'Test the real IndexedDB queue path without changing device connectivity.'
                }
              >
                {offlineSimulationActive ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-emerald-500" /> End Offline Test
                  </>
                ) : !isOnline ? (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-amber-500" /> Await Network
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-rose-500" /> Test Offline Mode
                  </>
                )}
              </button>

              <button
                onClick={handleForceSync}
                disabled={isSyncing || !isOnline || offlineSimulationActive || !tenantId}
                className="w-full py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Replaying...' : 'Force Sync Now'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
