'use client';

import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  FileText,
  Pill,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import type {
  ComprehensiveOpdEncounter,
  OpdTimelineEvent,
} from '@/types/opd-domain';

export interface OpdTimelineIntegritySummary {
  mode: 'SERVER_APPEND_ONLY';
  eventCount: number;
  linkedAuditCount: number;
  unlinkedEventCount: number;
  ambiguousAuditCount: number;
  truncated: boolean;
  fullyLinked: boolean;
}

interface OpdPatientTimelineAuditProps {
  encounter: ComprehensiveOpdEncounter;
  events: OpdTimelineEvent[];
  loading?: boolean;
  error?: string | null;
  integrity?: OpdTimelineIntegritySummary | null;
  demo?: boolean;
}

function eventIcon(type: string) {
  if (type.includes('REGISTERED') || type.includes('CHECKED_IN')) {
    return <UserCheck className="h-4 w-4 text-blue-600" />;
  }
  if (type.includes('VITAL') || type.includes('TRIAGE')) {
    return <Activity className="h-4 w-4 text-rose-600" />;
  }
  if (
    type.includes('CONSULTATION') ||
    type.includes('NOTE') ||
    type.includes('DOCUMENT')
  ) {
    return <FileText className="h-4 w-4 text-indigo-600" />;
  }
  if (
    type.includes('DIAGNOSTIC') ||
    type.includes('LAB') ||
    type.includes('RADIOLOGY')
  ) {
    return <Activity className="h-4 w-4 text-purple-600" />;
  }
  if (
    type.includes('PRESCRIPTION') ||
    type.includes('MEDICATION') ||
    type.includes('DISPENSE')
  ) {
    return <Pill className="h-4 w-4 text-emerald-600" />;
  }
  if (
    type.includes('PAYMENT') ||
    type.includes('BILLING') ||
    type.includes('INVOICE') ||
    type.includes('RECEIPT')
  ) {
    return <DollarSign className="h-4 w-4 text-teal-600" />;
  }
  return <Clock className="h-4 w-4 text-slate-500" />;
}

function actorLabel(event: OpdTimelineEvent): string {
  const identity = String(event.actorName || event.actor || '').trim();
  if (!identity) return event.actorRole || 'Unknown actor';
  return event.actorRole
    ? `${identity} (${event.actorRole})`
    : identity;
}

export function OpdPatientTimelineAudit({
  encounter,
  events,
  loading = false,
  error = null,
  integrity = null,
  demo = false,
}: OpdPatientTimelineAuditProps) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const sortedEvents = [...events].sort(
    (left, right) =>
      Number(right.timestamp || 0) - Number(left.timestamp || 0) ||
      right.id.localeCompare(left.id)
  );

  const integrityLabel = demo
    ? 'DEMO — non-authoritative'
    : integrity?.ambiguousAuditCount
      ? `Integrity warning: ${integrity.ambiguousAuditCount} event(s) have duplicate audit linkage`
      : integrity?.truncated
        ? 'Integrity warning: timeline truncated by server safety limit'
        : integrity?.fullyLinked
        ? 'Server event + audit linked'
        : integrity
          ? `Integrity warning: ${integrity.unlinkedEventCount} unlinked event(s)`
          : 'Authoritative verification pending';

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            Authoritative Encounter Timeline & Audit Provenance
          </h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">
            Governed domain events are read from the server append-only event
            store and cross-linked to their audit records. This surface does not
            claim a cryptographic signature unless cryptographic proof is
            actually present in authoritative data.
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Encounter {encounter.id} · Patient {encounter.patientId}
          </p>
        </div>

        <span
          className={
            demo
              ? 'rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800'
              : integrity?.fullyLinked
                ? 'rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700'
                : 'rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700'
          }
        >
          {integrityLabel}
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold">Authoritative timeline unavailable</p>
            <p className="mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
          Loading server event and audit provenance…
        </div>
      )}

      {!loading && !error && sortedEvents.length === 0 && (
        <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-xs text-slate-500 dark:border-slate-700">
          No authoritative encounter events are available for this timeline.
        </div>
      )}

      {sortedEvents.length > 0 && (
        <div className="relative space-y-6 pl-6 before:absolute before:bottom-3 before:left-2.5 before:top-3 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
          {sortedEvents.map((event) => {
            const expanded = expandedEventId === event.id;
            const linked =
              event.integrityState === 'EVENT_AUDIT_LINKED' ||
              event.integrityState === 'DEMO_NON_AUTHORITATIVE';

            return (
              <div key={event.id} className="relative">
                <div className="absolute -left-6 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-blue-500 bg-white shadow-xs dark:bg-slate-900">
                  <div className="h-1.5 w-1.5 rounded-full bg-blue-600" />
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700/60 dark:bg-slate-800/40">
                  <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-2">
                      {eventIcon(event.eventType)}
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                        {event.eventType.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      <span className="font-mono">
                        {new Date(event.timestamp).toLocaleString()}
                      </span>
                      <span className="mx-2">·</span>
                      <span>{actorLabel(event)}</span>
                    </div>
                  </div>

                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                    {event.description}
                  </p>

                  <div className="mt-3 grid gap-2 text-[10px] text-slate-500 sm:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <span className="font-semibold">Event ID:</span>{' '}
                      <span className="font-mono">{event.id}</span>
                    </div>
                    <div>
                      <span className="font-semibold">Audit ID:</span>{' '}
                      <span className="font-mono">
                        {event.auditId || 'UNLINKED'}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold">Command:</span>{' '}
                      <span className="font-mono">
                        {event.commandId || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="font-semibold">Correlation:</span>{' '}
                      <span className="font-mono">
                        {event.correlationId || '—'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/60 pt-2 text-[10px] dark:border-slate-700/60">
                    <span
                      className={
                        linked
                          ? 'inline-flex items-center gap-1 font-semibold text-emerald-700'
                          : 'inline-flex items-center gap-1 font-semibold text-rose-700'
                      }
                    >
                      {linked ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <AlertTriangle className="h-3 w-3" />
                      )}
                      {demo
                        ? 'DEMO_NON_AUTHORITATIVE'
                        : event.integrityState || 'EVENT_ONLY'}
                    </span>

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedEventId(expanded ? null : event.id)
                      }
                      className="flex cursor-pointer items-center gap-1 font-bold text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {expanded ? (
                        <>
                          Hide provenance <ChevronUp className="h-3 w-3" />
                        </>
                      ) : (
                        <>
                          Inspect provenance <ChevronDown className="h-3 w-3" />
                        </>
                      )}
                    </button>
                  </div>

                  {expanded && (
                    <div className="mt-3 space-y-2 rounded-lg bg-slate-950 p-3 text-[10px] text-slate-200">
                      <div className="grid gap-1 font-mono sm:grid-cols-2">
                        <span>aggregate: {event.aggregateType || '—'} / {event.aggregateId || '—'}</span>
                        <span>audit action: {event.auditAction || '—'}</span>
                        <span>resource: {event.resourceType || '—'} / {event.resourceId || '—'}</span>
                        <span>recordedAt: {event.recordedAt ? new Date(event.recordedAt).toISOString() : '—'}</span>
                      </div>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-slate-800 pt-2 font-mono">
                        {JSON.stringify(
                          {
                            payload: event.payload ?? null,
                            auditMetadata: event.metadata ?? null,
                          },
                          null,
                          2
                        )}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
