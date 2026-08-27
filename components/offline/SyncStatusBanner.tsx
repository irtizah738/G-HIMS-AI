'use client';

import React, { useState } from 'react';
import { useOfflineStatus } from '@/hooks/useOfflineStatus';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  Database,
  CheckCircle2,
  Clock,
  ShieldCheck,
  X,
  ChevronRight,
  Layers,
  ArrowUpRight,
  FileSpreadsheet,
} from 'lucide-react';

interface SyncStatusBannerProps {
  tenantId?: string;
  className?: string;
}

export function SyncStatusBanner({ tenantId = 'central-metro-hospital', className = '' }: SyncStatusBannerProps) {
  const {
    isOnline,
    isSyncing,
    pendingSyncCount,
    conflictsCount,
    conflicts,
    latencyMs,
    networkType,
    lastSyncedAt,
    triggerSync,
    resolveConflict,
  } = useOfflineStatus(tenantId);

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const handleManualSync = async () => {
    setSyncFeedback('Synchronizing offline queue with Firestore...');
    const result = await triggerSync(tenantId);
    setSyncFeedback(`Synced ${result.syncedCount} records (${result.conflictCount} conflicts resolved)`);
    setTimeout(() => setSyncFeedback(null), 4000);
  };

  return (
    <>
      {/* Top Clinical Connectivity Ribbon */}
      <div
        className={`w-full transition-all duration-300 ${
          !isOnline
            ? 'bg-amber-600 text-white'
            : isSyncing
            ? 'bg-blue-600 text-white'
            : conflictsCount > 0
            ? 'bg-rose-700 text-white'
            : 'bg-slate-900 text-slate-200'
        } ${className}`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-between gap-3 text-xs font-medium">
          {/* Status Badge & Latency */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 font-bold">
              {!isOnline ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping shrink-0" />
                  <WifiOff className="w-4 h-4 text-white shrink-0" />
                  <span>OFFLINE (IndexedDB Edge Mode Active)</span>
                </>
              ) : isSyncing ? (
                <>
                  <RefreshCw className="w-4 h-4 text-white animate-spin shrink-0" />
                  <span>SYNCHRONIZING CLOUD LEDGER...</span>
                </>
              ) : conflictsCount > 0 ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-300 animate-bounce shrink-0" />
                  <span>{conflictsCount} CLINICAL CONFLICT(S) REQUIRE REVIEW</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="text-slate-100">Live Hospital Cloud Synced</span>
                </>
              )}
            </div>

            {/* Network Latency & Pending Count */}
            <div className="hidden md:flex items-center gap-3 text-[11px] opacity-90 pl-3 border-l border-white/20">
              {isOnline && latencyMs !== null && (
                <span>
                  Latency: <strong className="font-mono">{latencyMs}ms</strong> ({networkType})
                </span>
              )}
              {pendingSyncCount > 0 && (
                <span className="bg-black/30 px-2 py-0.5 rounded font-mono font-bold text-amber-200">
                  {pendingSyncCount} pending local write{pendingSyncCount > 1 ? 's' : ''}
                </span>
              )}
              {lastSyncedAt && isOnline && (
                <span className="hidden lg:inline text-slate-400">
                  Last sync: {lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              )}
            </div>
          </div>

          {/* Action Triggers */}
          <div className="flex items-center gap-2">
            {syncFeedback && (
              <span className="hidden sm:inline-block text-[11px] bg-black/40 px-2.5 py-0.5 rounded text-emerald-200 font-mono">
                {syncFeedback}
              </span>
            )}

            {isOnline && (
              <button
                type="button"
                onClick={handleManualSync}
                disabled={isSyncing}
                className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Sync Now</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsDrawerOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-white text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Database className="w-3 h-3" />
              <span>Queue &amp; Conflicts</span>
              {(pendingSyncCount > 0 || conflictsCount > 0) && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-white text-slate-900 font-black text-[10px]">
                  {pendingSyncCount + conflictsCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Slide-over Queue & Conflict Inspector Drawer */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/60 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col h-full overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Drawer Header */}
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-blue-400" />
                  <h2 className="text-base font-bold text-white">Edge Sync Queue &amp; Conflict Terminal</h2>
                </div>
                <p className="text-xs text-slate-400 mt-0.5 font-mono">Tenant ID: {tenantId}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-3 gap-2 p-4 bg-slate-50 border-b border-slate-200 text-xs">
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <p className="text-[10px] text-slate-500 font-semibold uppercase">Network State</p>
                <p className={`font-bold mt-0.5 ${isOnline ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {isOnline ? 'Online (Connected)' : 'Offline (Edge Active)'}
                </p>
              </div>
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <p className="text-[10px] text-slate-500 font-semibold uppercase">Pending Mutations</p>
                <p className="font-bold text-blue-700 mt-0.5">{pendingSyncCount} in IndexedDB</p>
              </div>
              <div className="p-3 bg-white rounded-xl border border-slate-200">
                <p className="text-[10px] text-slate-500 font-semibold uppercase">Unresolved Conflicts</p>
                <p className={`font-bold mt-0.5 ${conflictsCount > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                  {conflictsCount} Detected
                </p>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Active Conflicts Section */}
              {conflicts.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wider text-rose-700 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4" /> Detected Clinical Conflicts
                    </h3>
                    <span className="text-[11px] text-slate-500 font-mono">Vector Clock LWW Ready</span>
                  </div>

                  <div className="space-y-3">
                    {conflicts.map((c) => (
                      <div key={c.id} className="p-4 rounded-xl bg-rose-50/70 border border-rose-200 space-y-3 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-rose-900">
                            {c.collection} • ID: {c.resourceId}
                          </span>
                          <span className="text-[10px] bg-rose-200 text-rose-800 font-bold px-2 py-0.5 rounded">
                            {c.conflictType}
                          </span>
                        </div>

                        <p className="text-slate-600 text-[11px]">
                          Detected concurrent modification on sensitive clinical entity while device was operating offline.
                        </p>

                        {/* Side-by-side snapshot comparison */}
                        <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                          <div className="p-2.5 bg-white rounded-lg border border-rose-200">
                            <p className="font-bold text-slate-700 mb-1">Server State (Firestore)</p>
                            <pre className="max-h-24 overflow-y-auto text-slate-600">
                              {JSON.stringify(c.serverData, null, 2)}
                            </pre>
                          </div>
                          <div className="p-2.5 bg-white rounded-lg border border-rose-200">
                            <p className="font-bold text-blue-700 mb-1">Client Offline Update</p>
                            <pre className="max-h-24 overflow-y-auto text-slate-600">
                              {JSON.stringify(c.clientData, null, 2)}
                            </pre>
                          </div>
                        </div>

                        {/* Resolution Actions */}
                        <div className="flex items-center justify-end gap-2 pt-1 border-t border-rose-200/60">
                          <button
                            type="button"
                            onClick={() => resolveConflict(c.id, 'LWW_SERVER', 'Physician Review')}
                            className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 text-[11px] font-bold cursor-pointer"
                          >
                            Accept Server (LWW)
                          </button>
                          <button
                            type="button"
                            onClick={() => resolveConflict(c.id, 'OVERWRITE_CLIENT', 'Physician Review')}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold cursor-pointer"
                          >
                            Apply Client Overwrite
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Offline Engine Architecture Overview */}
              <div className="p-4 rounded-xl bg-slate-900 text-white space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Zero-Downtime Resilience Engine
                  </h3>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  G-HIMS continuously stores vital records, OPD consultation notes, triage codes, and billing calculations
                  in an isolated local IndexedDB partition. All updates re-synchronize deterministically with cryptographic
                  audit trails when network connectivity resumes.
                </p>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-300 pt-2 border-t border-slate-800">
                  <div>
                    <span className="text-slate-500 block">Conflict Strategy:</span>
                    <span className="text-emerald-400 font-bold">LWW + Physician Audit Log</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Storage Layer:</span>
                    <span className="text-blue-400 font-bold">IndexedDB (idb v8)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                Close Terminal
              </button>
              <button
                type="button"
                onClick={handleManualSync}
                disabled={!isOnline || isSyncing}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>Process Sync Queue Now</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
