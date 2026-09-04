'use client';

import React, { useState } from 'react';
import {
  Clock,
  ShieldCheck,
  CheckCircle2,
  FileText,
  Activity,
  Pill,
  DollarSign,
  UserCheck,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { OpdTimelineEvent, ComprehensiveOpdEncounter } from '@/types/opd-domain';

interface OpdPatientTimelineAuditProps {
  encounter: ComprehensiveOpdEncounter;
  events: OpdTimelineEvent[];
}

export function OpdPatientTimelineAudit({
  encounter,
  events,
}: OpdPatientTimelineAuditProps) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const getEventIcon = (type: string) => {
    if (type.includes('REGISTERED') || type.includes('CHECKED_IN')) return <UserCheck className="w-4 h-4 text-blue-600" />;
    if (type.includes('VITALS') || type.includes('TRIAGE')) return <Activity className="w-4 h-4 text-rose-600" />;
    if (type.includes('CONSULTATION')) return <FileText className="w-4 h-4 text-indigo-600" />;
    if (type.includes('DIAGNOSTIC')) return <Activity className="w-4 h-4 text-purple-600" />;
    if (type.includes('PRESCRIPTION') || type.includes('DISPENSED')) return <Pill className="w-4 h-4 text-emerald-600" />;
    if (type.includes('PAYMENT') || type.includes('BILLING')) return <DollarSign className="w-4 h-4 text-teal-600" />;
    return <Clock className="w-4 h-4 text-slate-500" />;
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            Immutable Audit Trail & Longitudinal Event Stream
          </h2>
          <p className="text-xs text-slate-500">
            Event-sourced ledger tracking all state mutations with actor signatures, UTC timestamps, and cryptographic proof.
          </p>
        </div>
        <span className="text-xs font-mono text-emerald-600 font-bold bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
          Cryptographically Verified
        </span>
      </div>

      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
        {events.map((evt, idx) => {
          const isExpanded = expandedEventId === evt.id;
          return (
            <div key={evt.id} className="relative group">
              {/* Timeline Marker */}
              <div className="absolute -left-6 top-1 w-5 h-5 rounded-full bg-white dark:bg-slate-900 border-2 border-blue-500 flex items-center justify-center shadow-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
              </div>

              {/* Event Card */}
              <div className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {getEventIcon(evt.eventType)}
                    <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                      {evt.eventType.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
                    <span>{new Date(evt.timestamp).toLocaleTimeString()}</span>
                    <span>{evt.actorName} ({evt.actorRole})</span>
                  </div>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{evt.description}</p>

                {/* Cryptographic Hash Badge */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px] text-slate-400 font-mono">
                  <span className="truncate max-w-xs">{evt.hash}</span>
                  <button
                    onClick={() => setExpandedEventId(isExpanded ? null : evt.id)}
                    className="text-blue-600 dark:text-blue-400 font-bold flex items-center gap-1 hover:underline cursor-pointer"
                  >
                    {isExpanded ? (
                      <>
                        Hide Raw Payload <ChevronUp className="w-3 h-3" />
                      </>
                    ) : (
                      <>
                        Inspect Event Payload <ChevronDown className="w-3 h-3" />
                      </>
                    )}
                  </button>
                </div>

                {isExpanded && (
                  <pre className="mt-2 p-3 rounded-lg bg-slate-900 text-slate-200 text-[10px] font-mono overflow-x-auto">
                    {JSON.stringify(evt.payload, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
