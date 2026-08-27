'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  Server,
  Database,
  ShieldCheck,
  Zap,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ArrowRight,
} from 'lucide-react';

export function SyncStatusIndicator() {
  const { networkMode, setNetworkMode, offlineMutations, triggerOfflineSync, stats, auditLogs } = useHospital();
  const [isOpen, setIsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const pendingCount = offlineMutations.filter((m) => m.syncStatus === 'pending').length;

  const handleForceSync = () => {
    setIsSyncing(true);
    setTimeout(() => {
      triggerOfflineSync();
      setIsSyncing(false);
    }, 900);
  };

  const handleToggleMode = () => {
    if (networkMode === 'online') {
      setNetworkMode('offline');
    } else {
      handleForceSync();
    }
  };

  // Determine current sync state
  const syncState: 'connected' | 'syncing' | 'offline' = isSyncing
    ? 'syncing'
    : networkMode === 'online'
    ? 'connected'
    : 'offline';

  return (
    <div className="relative inline-block text-left" id="global-sync-status-container">
      {/* Trigger Button */}
      <button
        id="btn-global-sync-status"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer select-none shadow-2xs ${
          syncState === 'connected'
            ? 'bg-emerald-50/80 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200/90 dark:border-emerald-800'
            : syncState === 'syncing'
            ? 'bg-blue-50/80 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/60 text-blue-800 dark:text-blue-300 border-blue-200/90 dark:border-blue-800 animate-pulse'
            : 'bg-amber-50/90 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/60 text-amber-900 dark:text-amber-300 border-amber-200/90 dark:border-amber-800'
        }`}
        title="Dual-Engine Sync Architecture Status"
      >
        <span className="relative flex h-2.5 w-2.5 items-center justify-center">
          {syncState === 'connected' && (
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          )}
          {syncState === 'syncing' && (
            <RefreshCw className="w-2.5 h-2.5 text-blue-600 dark:text-blue-400 animate-spin" />
          )}
          {syncState === 'offline' && (
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          )}
        </span>

        <span className="hidden sm:inline">
          {syncState === 'connected' && 'Dual Edge: Connected'}
          {syncState === 'syncing' && 'Syncing Vector Clocks...'}
          {syncState === 'offline' && `Offline Edge (${pendingCount} Queued)`}
        </span>
        <span className="sm:hidden font-mono">
          {syncState === 'connected' && 'Online'}
          {syncState === 'syncing' && 'Syncing'}
          {syncState === 'offline' && `Off (${pendingCount})`}
        </span>

        <ChevronDown className="w-3 h-3 opacity-60 ml-0.5" />
      </button>

      {/* Dropdown Flyout */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-2xs"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-[calc(100vw-1.5rem)] max-w-sm sm:w-96 rounded-2xl bg-white dark:bg-slate-850 shadow-2xl border border-slate-200/90 dark:border-slate-700 p-4 z-50 space-y-3.5 animate-in fade-in zoom-in-95 duration-150 text-slate-800 dark:text-slate-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-750 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400">
                  <Server className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-tight">Dual-Engine Sync Engine</h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Zero-downtime offline-first architecture</p>
                </div>
              </div>

              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wide border ${
                  syncState === 'connected'
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                    : syncState === 'syncing'
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                    : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                }`}
              >
                {syncState === 'connected' ? 'Active Sync' : syncState === 'syncing' ? 'Sync In Progress' : 'Edge Mode'}
              </span>
            </div>

            {/* Architecture Node Status Cards */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-750 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" /> Local Edge Store
                  </span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">IndexedDB / SQLite</p>
                <div className="text-[11px] font-mono font-bold text-slate-800 dark:text-slate-200 pt-0.5">
                  Latency: 1.2ms (Zero Lag)
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-750 space-y-1">
                <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Wifi className={`w-3.5 h-3.5 ${networkMode === 'online' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`} /> Cloud Replica
                  </span>
                  <span className={`w-2 h-2 rounded-full ${networkMode === 'online' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">Central Master DB</p>
                <div className="text-[11px] font-mono font-bold text-slate-800 dark:text-slate-200 pt-0.5">
                  {networkMode === 'online' ? 'Status: 18ms' : 'Status: Disconnected'}
                </div>
              </div>
            </div>

            {/* Vector Clock & Queued Mutations */}
            <div className="p-3 rounded-xl bg-blue-50/50 dark:bg-blue-950/40 border border-blue-100/80 dark:border-blue-900/60 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-500" /> Deterministic Vector Clock:
                </span>
                <span className="font-mono font-extrabold text-blue-800 dark:text-blue-300 text-[11px] bg-white dark:bg-slate-800 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                  v{241 + (offlineMutations.length || 0)} (CRDT LWW)
                </span>
              </div>

              <div className="flex items-center justify-between text-xs pt-1 border-t border-blue-100/60 dark:border-blue-900/40">
                <span className="text-slate-600 dark:text-slate-400 text-[11px]">Pending Offline Mutations:</span>
                <span className={`font-bold text-xs ${pendingCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {pendingCount === 0 ? '0 pending (Fully Replicated)' : `${pendingCount} operations queued`}
                </span>
              </div>
            </div>

            {/* Recent Sync Audit Log Snippet */}
            <div className="text-[11px] space-y-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 dark:text-slate-500">Last Replicated Event</span>
              <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-mono text-[10px] truncate">
                {auditLogs[0] ? `${auditLogs[0].timestamp.slice(11)} • ${auditLogs[0].action} on ${auditLogs[0].resource}` : 'Synchronized with metropolitan cluster master'}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 dark:border-slate-750">
              <button
                onClick={handleToggleMode}
                className="w-full py-2 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                {networkMode === 'online' ? (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-rose-500" /> Simulate Offline
                  </>
                ) : (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-emerald-500" /> Go Online
                  </>
                )}
              </button>

              <button
                onClick={handleForceSync}
                disabled={isSyncing}
                className="w-full py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50 active:scale-95"
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
