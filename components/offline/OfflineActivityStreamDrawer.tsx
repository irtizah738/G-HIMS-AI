'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  RefreshCw,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  CloudUpload,
  Wifi,
  WifiOff,
  Code,
  Download,
  ShieldAlert,
  ArrowRight,
  Filter,
  FileJson,
  Layers,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { localDb } from '@/lib/offline/db';
import { SyncMutation, MutationStatus } from '@/types/offline';
import { syncCoordinator, processSyncQueue } from '@/lib/offline/sync-worker';

interface OfflineActivityStreamDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  isOnline: boolean;
  onSyncTriggered?: () => void;
}

export const OfflineActivityStreamDrawer: React.FC<OfflineActivityStreamDrawerProps> = ({
  isOpen,
  onClose,
  tenantId,
  isOnline,
  onSyncTriggered,
}) => {
  const [mutations, setMutations] = useState<SyncMutation[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedMutation, setSelectedMutation] = useState<SyncMutation | null>(null);
  const [isProcessingItem, setIsProcessingItem] = useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [expandedDocIds, setExpandedDocIds] = useState<Record<string, boolean>>({});

  // Fetch mutations from Dexie
  const loadMutations = useCallback(async () => {
    try {
      setLoading(true);
      const all = await localDb.mutations
        .where('tenantId')
        .equals(tenantId)
        .sortBy('timestamp');
      
      // Fallback if tenant filter returns none, check all
      if (all.length === 0) {
        const globalAll = await localDb.mutations.orderBy('timestamp').toArray();
        setMutations(globalAll.reverse());
      } else {
        setMutations(all.reverse());
      }
    } catch (err) {
      console.warn('Failed to query local mutations:', err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (isOpen) {
      loadMutations();
    }
  }, [isOpen, loadMutations]);

  // Filter mutations
  const filteredMutations = useMemo(() => {
    if (filterStatus === 'all') return mutations;
    return mutations.filter((m) => m.status === filterStatus);
  }, [mutations, filterStatus]);

  // Aggregate Counts
  const counts = useMemo(() => {
    return {
      all: mutations.length,
      pending: mutations.filter((m) => m.status === 'pending').length,
      failed: mutations.filter((m) => m.status === 'failed').length,
      conflict: mutations.filter((m) => m.status === 'conflict').length,
    };
  }, [mutations]);

  // Resolution Action 1: Retry specific mutation
  const handleRetryMutation = async (mutation: SyncMutation) => {
    try {
      setIsProcessingItem(mutation.id);
      await localDb.mutations.update(mutation.id, {
        status: 'pending',
        errorMessage: undefined,
      });
      setActionSuccessMsg(`Operation queued for immediate retry.`);
      await loadMutations();

      if (isOnline) {
        await processSyncQueue(tenantId);
        if (onSyncTriggered) onSyncTriggered();
        await loadMutations();
      }
    } catch (e: any) {
      console.error('Failed to retry mutation:', e);
    } finally {
      setIsProcessingItem(null);
      setTimeout(() => setActionSuccessMsg(null), 3000);
    }
  };

  // Resolution Action 2: Discard / Revert failed mutation
  const handleDiscardMutation = async (id: string) => {
    try {
      setIsProcessingItem(id);
      await localDb.mutations.delete(id);
      setActionSuccessMsg(`Local offline operation safely discarded.`);
      await loadMutations();
      if (syncCoordinator) {
        await syncCoordinator.refreshMetrics(tenantId);
      }
    } catch (e: any) {
      console.error('Failed to delete mutation:', e);
    } finally {
      setIsProcessingItem(null);
      setTimeout(() => setActionSuccessMsg(null), 3000);
    }
  };

  // Resolution Action 3: Re-sync entire queue
  const handleSyncAll = async () => {
    try {
      setLoading(true);
      await processSyncQueue(tenantId);
      if (onSyncTriggered) onSyncTriggered();
      await loadMutations();
      setActionSuccessMsg('Full sync initiated against Cloud Firestore.');
    } catch (e: any) {
      console.error('Global sync failed:', e);
    } finally {
      setLoading(false);
      setTimeout(() => setActionSuccessMsg(null), 3000);
    }
  };

  // Resolution Action 4: Export offline audit trail (JSON)
  const handleExportAuditTrail = () => {
    const exportData = {
      tenantId,
      exportedAt: new Date().toISOString(),
      isOnline,
      queueSummary: counts,
      mutations: mutations.map((m) => ({
        id: m.id,
        collection: m.collection,
        docId: m.docId,
        action: m.action,
        status: m.status,
        timestamp: new Date(m.timestamp).toISOString(),
        retryCount: m.retryCount,
        errorMessage: m.errorMessage,
        payload: m.payload,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ghims_offline_stream_${tenantId}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setActionSuccessMsg('Offline audit stream exported.');
    setTimeout(() => setActionSuccessMsg(null), 3000);
  };

  const toggleExpand = (id: string) => {
    setExpandedDocIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/60 backdrop-blur-xs transition-opacity duration-300">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div
          id="offline-activity-stream-drawer"
          className="w-screen max-w-xl bg-white shadow-2xl flex flex-col dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800"
        >
          {/* Drawer Header */}
          <div className="p-5 border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-850">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Offline Activity & Sync Stream
                  </h2>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1 font-semibold">
                      {isOnline ? (
                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <Wifi className="h-3 w-3" /> Online
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <WifiOff className="h-3 w-3 animate-pulse" /> Low-Connectivity Mode
                        </span>
                      )}
                    </span>
                    <span>•</span>
                    <span>Tenant: {tenantId}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Quick Status Banners */}
            {actionSuccessMsg && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 flex items-center gap-2 animate-in fade-in">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span>{actionSuccessMsg}</span>
              </div>
            )}

            {/* Filter Tabs & Resolution Action Toolbar */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center gap-1 rounded-lg bg-slate-200/80 p-1 text-xs dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setFilterStatus('all')}
                  className={`rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
                    filterStatus === 'all'
                      ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  All ({counts.all})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('pending')}
                  className={`rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
                    filterStatus === 'pending'
                      ? 'bg-amber-500 text-white shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Pending ({counts.pending})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('failed')}
                  className={`rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
                    filterStatus === 'failed'
                      ? 'bg-rose-600 text-white shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Failed / Errors ({counts.failed})
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSyncAll}
                  disabled={loading || !isOnline}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer"
                  title="Push all pending mutations to Firestore"
                >
                  <CloudUpload className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>Sync Queue</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportAuditTrail}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 transition cursor-pointer"
                  title="Download JSON audit log"
                >
                  <Download className="h-3.5 w-3.5 text-slate-500" />
                  <span>Export</span>
                </button>

                <button
                  type="button"
                  onClick={loadMutations}
                  className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 transition cursor-pointer"
                  title="Refresh activity logs"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Drawer Body: Activity List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loading && mutations.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <RefreshCw className="mx-auto h-8 w-8 animate-spin text-blue-500 mb-2" />
                <p className="text-xs">Inspecting local Dexie queue...</p>
              </div>
            ) : filteredMutations.length === 0 ? (
              <div className="py-12 text-center rounded-2xl border border-dashed border-slate-200 p-8 dark:border-slate-800">
                <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500 mb-2" />
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  No {filterStatus !== 'all' ? filterStatus : ''} Offline Operations
                </h4>
                <p className="mt-1 text-xs text-slate-500 max-w-xs mx-auto">
                  All bed status updates, transfers, and clinical notes are fully reconciled with Firestore.
                </p>
              </div>
            ) : (
              filteredMutations.map((mutation) => {
                const isExpanded = !!expandedDocIds[mutation.id];
                const isProcessing = isProcessingItem === mutation.id;

                return (
                  <div
                    key={mutation.id}
                    className={`rounded-xl border p-3.5 transition-all text-xs ${
                      mutation.status === 'failed'
                        ? 'border-rose-200 bg-rose-50/40 dark:border-rose-900/60 dark:bg-rose-950/20'
                        : mutation.status === 'conflict'
                        ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20'
                        : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-850'
                    }`}
                  >
                    {/* Item Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-md px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase ${
                              mutation.action === 'CREATE'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : mutation.action === 'UPDATE'
                                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            }`}
                          >
                            {mutation.action}
                          </span>

                          <span className="font-bold text-slate-900 dark:text-white font-mono">
                            {mutation.collection}/{mutation.docId}
                          </span>

                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              mutation.status === 'failed'
                                ? 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200'
                                : mutation.status === 'pending'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                                : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {mutation.status === 'failed' && <AlertTriangle className="h-3 w-3 text-rose-600" />}
                            {mutation.status === 'pending' && <Clock className="h-3 w-3 text-amber-600" />}
                            {mutation.status.toUpperCase()}
                          </span>
                        </div>

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                          <span>Queued: {new Date(mutation.timestamp).toLocaleTimeString()}</span>
                          <span>•</span>
                          <span>Retries: {mutation.retryCount || 0}</span>
                        </div>
                      </div>

                      {/* Action buttons per mutation */}
                      <div className="flex items-center gap-1 shrink-0">
                        {mutation.status === 'failed' && (
                          <button
                            type="button"
                            onClick={() => handleRetryMutation(mutation)}
                            disabled={isProcessing}
                            className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white shadow-2xs hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
                            title="Retry syncing this operation"
                          >
                            <RotateCcw className={`h-3 w-3 ${isProcessing ? 'animate-spin' : ''}`} />
                            <span>Retry</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleDiscardMutation(mutation.id)}
                          disabled={isProcessing}
                          className="rounded-lg border border-slate-200 p-1 text-slate-400 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:hover:bg-slate-800 transition cursor-pointer"
                          title="Discard local operation from queue"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Error Resolution Guidance if Failed */}
                    {mutation.errorMessage && (
                      <div className="mt-2.5 rounded-lg border border-rose-200 bg-rose-100/70 p-2.5 dark:border-rose-900 dark:bg-rose-950/60">
                        <div className="font-semibold text-rose-900 dark:text-rose-200 flex items-center gap-1.5 text-[11px]">
                          <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-rose-600" />
                          <span>Sync Interruption:</span>
                        </div>
                        <p className="mt-0.5 font-mono text-[10px] text-rose-800 dark:text-rose-300 break-all">
                          {mutation.errorMessage}
                        </p>
                        <div className="mt-1.5 text-[10px] text-rose-700 dark:text-rose-300">
                          <strong>Resolution Path:</strong> Verify network uplink, review vector clock, or click <em>Retry</em> to replay transaction.
                        </div>
                      </div>
                    )}

                    {/* Expand / Collapse Payload Details */}
                    <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => toggleExpand(mutation.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        <Code className="h-3 w-3" />
                        <span>{isExpanded ? 'Hide Payload' : 'Inspect Local Payload'}</span>
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </button>

                      <span className="text-[10px] text-slate-400 font-mono">
                        ID: {mutation.id.slice(0, 10)}...
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="mt-2 rounded-lg bg-slate-900 p-2.5 font-mono text-[10px] text-slate-200 overflow-x-auto max-h-48 leading-relaxed">
                        <pre>{JSON.stringify(mutation.payload, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Drawer Footer */}
          <div className="p-4 border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-850 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              IndexedDB Store: <strong className="text-slate-700 dark:text-slate-200">ghims_clinical_dexie_db</strong>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-200 px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
            >
              Close Stream
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
