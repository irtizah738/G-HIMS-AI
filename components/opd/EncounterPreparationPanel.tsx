'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ClipboardList,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { generateEncounterPreparationBrief } from '@/lib/clinical/intelligence/encounter-preparation-client';
import type { ClinicalEncounterPreparationResponse } from '@/types/clinical-encounter-preparation';

function dateTime(value?: number): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
}

function attentionClass(value: string): string {
  switch (value) {
    case 'CRITICAL_REVIEW_REQUIRED':
      return 'border-rose-300 bg-rose-50 text-rose-900';
    case 'ACTION_REQUIRED':
      return 'border-orange-300 bg-orange-50 text-orange-900';
    case 'REVIEW_REQUIRED':
      return 'border-amber-200 bg-amber-50 text-amber-900';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700';
  }
}

export function EncounterPreparationPanel({
  tenantId,
  patientId,
  encounterId,
  offline = false,
}: {
  tenantId: string;
  patientId: string;
  encounterId: string;
  offline?: boolean;
}) {
  const [result, setResult] =
    useState<ClinicalEncounterPreparationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evidenceById = useMemo(
    () =>
      new Map(
        (result?.evidenceIndex || []).map((item) => [
          item.evidenceId,
          item,
        ])
      ),
    [result]
  );

  const generate = async () => {
    if (offline) {
      setError(
        'A fresh encounter-preparation brief requires authoritative server connectivity.'
      );
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const next = await generateEncounterPreparationBrief(
        tenantId,
        patientId,
        encounterId
      );
      setResult(next);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Encounter preparation could not be generated.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setResult(null);
    setError(null);
    if (!offline && tenantId && patientId && encounterId) {
      void generate();
    }
    // Generation is scoped to the authoritative encounter identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, patientId, encounterId, offline]);

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm dark:border-indigo-900 dark:bg-slate-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Encounter Preparation Intelligence
            </h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">
            Evidence-grounded pre-consultation brief for this encounter. It is
            read-only and cannot prefill, sign, prescribe, order, diagnose, or
            mutate the chart.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void generate()}
          disabled={offline || loading}
          className="inline-flex w-fit items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh brief
        </button>
      </div>

      {offline && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          G-HIMS will not synthesize a new encounter brief from stale offline-only
          data. Continue clinical documentation normally and refresh after sync.
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          {error}
        </div>
      )}

      {loading && !result && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Building evidence packet and encounter brief…
        </div>
      )}

      {result && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${attentionClass(
                result.brief.attentionLevel
              )}`}
            >
              {result.brief.attentionLevel.replace(/_/g, ' ')}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-semibold text-slate-600">
              {result.brief.claimCount} evidence-backed items
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-mono text-slate-500">
              P360 rev {result.brief.patient360Revision}
            </span>
          </div>

          <div className="mt-3 text-[11px] text-slate-500">
            Generated {dateTime(result.brief.generatedAt)}
            {result.brief.previousEncounterAt
              ? ` · prior encounter baseline ${dateTime(
                  result.brief.previousEncounterAt
                )}`
              : ''}
            {result.brief.lastReviewedAt
              ? ` · consultant last reviewed ${dateTime(
                  result.brief.lastReviewedAt
                )}`
              : ''}
          </div>

          <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Review the underlying evidence before acting. This brief does not
                establish clinical significance or replace history-taking,
                examination, reconciliation, or clinician judgment.
              </span>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {result.brief.sections.map((section) => (
              <details
                key={section.sectionId}
                open={[
                  'REASON_FOR_VISIT',
                  'NEW_ABNORMAL_INVESTIGATIONS',
                  'OUTSTANDING_WORK',
                  'MEDICATION_DISCREPANCIES',
                ].includes(section.sectionId)}
                className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/40"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {section.title}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                      {section.state.replace(/_/g, ' ')} · {section.claims.length}
                    </span>
                  </div>
                </summary>

                {section.caveats.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {section.caveats.map((caveat) => (
                      <div
                        key={caveat}
                        className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                      >
                        {caveat}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 space-y-2">
                  {section.claims.map((claim) => (
                    <div
                      key={claim.claimId}
                      className={`rounded-lg border p-3 ${attentionClass(
                        claim.attention
                      )}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-xs font-medium">{claim.text}</div>
                        {claim.attention !== 'INFORMATION' && (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        )}
                      </div>
                      {claim.caveat && (
                        <div className="mt-1 text-[10px] opacity-80">
                          {claim.caveat}
                        </div>
                      )}

                      <div className="mt-2 space-y-1">
                        {claim.evidenceRefs.map((evidenceId) => {
                          const evidence = evidenceById.get(evidenceId);
                          return (
                            <details
                              key={evidenceId}
                              className="rounded-md border border-slate-200/80 bg-white/80 px-2.5 py-2 text-slate-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200"
                            >
                              <summary className="cursor-pointer text-[10px] font-mono">
                                {evidence
                                  ? `${evidence.sourceType} · ${evidence.label} · ${evidence.provenanceStatus}`
                                  : evidenceId}
                              </summary>
                              {evidence && (
                                <div className="mt-2 space-y-2 text-[10px]">
                                  <div>
                                    Entity:{' '}
                                    <span className="font-mono">
                                      {evidence.sourceEntityId}
                                    </span>
                                  </div>
                                  <div>
                                    Source events:{' '}
                                    <span className="font-mono">
                                      {evidence.sourceEventIds.length
                                        ? evidence.sourceEventIds.join(', ')
                                        : 'No direct event match'}
                                    </span>
                                  </div>
                                  <div>
                                    Content hash:{' '}
                                    <span className="font-mono">
                                      {evidence.contentHash}
                                    </span>
                                  </div>
                                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[9px] dark:bg-slate-950">
                                    {JSON.stringify(evidence.content, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </details>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {section.claims.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900">
                      No evidence-backed item emitted for this section.
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>

          {result.brief.warnings.length > 0 && (
            <details className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/40">
              <summary className="cursor-pointer text-xs font-bold text-amber-900 dark:text-amber-100">
                Evidence limitations and safety warnings
              </summary>
              <ul className="mt-2 space-y-1 text-[11px] text-amber-900 dark:text-amber-100">
                {result.brief.warnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
