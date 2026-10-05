'use client';

import { Database, ShieldCheck } from 'lucide-react';
import type { ClinicalCopilotEvidenceDisplayItem } from '@/types/clinical-copilot-workspace';

function dateTime(value?: number): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
}

export function ClinicalCopilotEvidencePanel({
  items,
}: {
  items: ClinicalCopilotEvidenceDisplayItem[];
}) {
  const eventVerified = items.filter(
    (item) => item.provenanceStatus === 'EVENT_VERIFIED'
  ).length;

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
        No copilot artifact has been generated yet. Evidence appears here only
        after a governed intelligence artifact is created.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Referenced evidence
          </div>
          <div className="mt-1 text-xl font-bold">{items.length}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">
            Event verified
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-900">
            {eventVerified}
          </div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-amber-600">
            Projection only
          </div>
          <div className="mt-1 text-xl font-bold text-amber-900">
            {items.length - eventVerified}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item, index) => (
          <details
            key={`${item.sourceArtifact}:${item.evidenceId}:${index}`}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3"
          >
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 shrink-0 text-slate-500" />
                    <span className="text-xs font-semibold text-slate-900">
                      {item.label}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    {item.sourceType.replace(/_/g, ' ')} ·{' '}
                    <span className="font-mono">{item.sourceEntityId}</span>
                    {item.occurredAt ? ` · ${dateTime(item.occurredAt)}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[9px] font-bold text-indigo-700">
                    {item.sourceArtifact.replace(/_/g, ' ')}
                  </span>
                  <span
                    className={
                      item.provenanceStatus === 'EVENT_VERIFIED'
                        ? 'rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700'
                        : 'rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700'
                    }
                  >
                    {item.provenanceStatus.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            </summary>

            <div className="mt-3 grid gap-2 text-[10px] text-slate-600">
              {item.status && (
                <div>
                  Status: <span className="font-semibold">{item.status}</span>
                </div>
              )}
              <div>
                Evidence ID:{' '}
                <span className="break-all font-mono">{item.evidenceId}</span>
              </div>
              <div>
                Source events:{' '}
                <span className="break-all font-mono">
                  {item.sourceEventIds.length
                    ? item.sourceEventIds.join(', ')
                    : 'No direct event ID match'}
                </span>
              </div>
              <div>
                Content hash:{' '}
                <span className="break-all font-mono">{item.contentHash}</span>
              </div>
            </div>
          </details>
        ))}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        Evidence identifiers and hashes are shown for traceability. Copilot
        artifacts remain review-only unless a governed clinical draft reaches
        explicit qualified-clinician signature.
      </div>
    </div>
  );
}
