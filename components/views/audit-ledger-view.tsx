'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useHospital } from '@/lib/context/hospital-context';
import { useTenant } from '@/lib/tenant/context';
import {
  Server,
  Wifi,
  WifiOff,
  RefreshCw,
  ShieldCheck,
  Lock,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Activity,
  Layers,
  Database,
  ExternalLink,
  KeyRound,
} from 'lucide-react';

export function AuditLedgerView() {
  const {
    networkMode,
    setNetworkMode,
    offlineMutations,
    triggerOfflineSync,
    auditLogs,
    stats,
  } = useHospital();
  const { tenantId } = useTenant();

  const [activeTab, setActiveTab] = useState<'sync' | 'audit'>('sync');

  return (
    <div className="space-y-6 pb-12">
      {/* Header & Network Toggle */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <Server className="w-4 h-4" />
            </span>
            <h1 className="text-lg font-bold text-slate-900">Dual-Engine Local Sync &amp; Audit Ledger</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Zero-latency offline operation with automated vector-clock mutation replay and immutable HIPAA/ISO 27001 audit trail
          </p>
        </div>

        {/* Network Mode Controller & Deep Link */}
        <div className="flex items-center gap-3">
          <Link
            href={`/${tenantId || 'central-metro-hospital'}/admin/audit-logs`}
            className="px-3.5 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Full HIPAA Audit Explorer</span>
            <ExternalLink className="w-3 h-3 ml-0.5" />
          </Link>

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setNetworkMode('online')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                networkMode === 'online' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600'
              }`}
            >
              <Wifi className="w-3.5 h-3.5" /> Online (Cloud)
            </button>
            <button
              onClick={() => setNetworkMode('offline')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                networkMode === 'offline' ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-600'
              }`}
            >
              <WifiOff className="w-3.5 h-3.5" /> Offline Mode (Edge)
            </button>
          </div>

          {networkMode === 'offline' && (
            <button
              onClick={triggerOfflineSync}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer animate-pulse"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Sync ({stats.syncQueuePendingCount})
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('sync')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'sync'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Offline Mutation Queue ({offlineMutations.length})
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'audit'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          HIPAA & ISO 27001 Security Audit Log ({auditLogs.length})
        </button>
      </div>

      {activeTab === 'sync' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Status Box */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Database className="w-4 h-4 text-blue-600" />
                Edge Engine Health
              </h3>

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-slate-500 font-semibold block">Active Storage Engine:</span>
                  <strong className="text-slate-900 font-mono">IndexedDB + SQLite Edge Gateway</strong>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-slate-500 font-semibold block">Conflict Resolution Strategy:</span>
                  <strong className="text-slate-900">Deterministic Vector Clocks (LWW-Physician Priority)</strong>
                </div>

                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 space-y-1">
                  <span className="text-emerald-800 font-semibold block">Uptime In Disaster/Outage:</span>
                  <strong className="text-emerald-950 font-bold">99.9% Full Read/Write Continuity</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Mutations List */}
          <div className="lg:col-span-8 space-y-4">
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-bold text-slate-900">Event-Driven Mutation Stream</h3>
                <span className="text-xs text-slate-500">Auto-synced on reconnect</span>
              </div>

              {offlineMutations.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  All clinical events and billing items are in sync with cloud database.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {offlineMutations.map((mut) => (
                    <div key={mut.id} className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-slate-900">{mut.actionType}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          mut.syncStatus === 'synced' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {mut.syncStatus.toUpperCase()}
                        </span>
                      </div>

                      <div className="text-slate-600 font-mono text-[11px]">
                        Entity: <strong className="text-slate-800">{mut.entity}</strong> • {mut.timestamp}
                      </div>

                      <pre className="p-2 bg-white rounded border border-slate-200 text-[10px] font-mono overflow-x-auto text-slate-700">
                        {JSON.stringify(mut.payload, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900">Immutable Audit Trail (HIPAA Security Rule §164.312(b))</h3>
            <p className="text-xs text-slate-500">Every chart modification, revenue reconciliation, and HL7 dispatch is cryptographically signed</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase tracking-wider">
                  <th className="py-2.5 text-left">Timestamp</th>
                  <th className="py-2.5 text-left">User / Actor</th>
                  <th className="py-2.5 text-left">Role</th>
                  <th className="py-2.5 text-left">Action</th>
                  <th className="py-2.5 text-left">Resource Target</th>
                  <th className="py-2.5 text-left">IP Address</th>
                  <th className="py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="text-slate-800">
                    <td className="py-2.5 font-mono text-slate-500">{log.timestamp}</td>
                    <td className="py-2.5 font-bold text-slate-900">{log.userName}</td>
                    <td className="py-2.5 text-slate-600">{log.role}</td>
                    <td className="py-2.5 font-mono font-bold text-blue-700">{log.action}</td>
                    <td className="py-2.5 text-slate-700">{log.resource}</td>
                    <td className="py-2.5 font-mono text-slate-500">{log.ipAddress}</td>
                    <td className="py-2.5 text-right">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        log.status === 'SUCCESS'
                          ? 'bg-emerald-100 text-emerald-800'
                          : log.status === 'WARNING'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
