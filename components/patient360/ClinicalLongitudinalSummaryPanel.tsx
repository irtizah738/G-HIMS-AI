'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { FileText, Loader2, RefreshCw } from 'lucide-react';
import { generateLongitudinalClinicalSummary } from '@/lib/clinical/patient360/patient360-client';
import type { ClinicalLongitudinalSummaryResponse } from '@/types/clinical-longitudinal-summary';

function dateTime(value?: number): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-white p-3 text-xs text-slate-500">
      {children}
    </div>
  );
}

export function ClinicalLongitudinalSummaryPanel({
  tenantId,
  patientId,
  offline,
  currentRevision,
}: {
  tenantId: string;
  patientId: string;
  offline: boolean;
  currentRevision: number;
}) {
  const [result, setResult] =
    useState<ClinicalLongitudinalSummaryResponse | null>(null);
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
        'A fresh longitudinal clinical summary requires authoritative server connectivity.'
      );
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const next = await generateLongitudinalClinicalSummary(
        tenantId,
        patientId
      );
      setResult(next);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Longitudinal clinical summary could not be generated.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-indigo-600" />
            <h2 className="text-sm font-bold">
              CI-10B Longitudinal Clinical Snapshot
            </h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">
            Deterministic, evidence-grounded synthesis of the longitudinal chart.
            Every clinical claim is linked to frozen evidence; unsupported absence
            is never converted into a negative clinical finding.
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
          {result ? 'Regenerate from current chart' : 'Build clinical snapshot'}
        </button>
      </div>

      {offline && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          CI-10B will not generate a new summary from stale edge data. Offline
          summary continuity is reserved for the later governed offline-production
          phase.
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
          {error}
        </div>
      )}

      {result && (
        <>
          {result.summary.patient360Revision !== currentRevision && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              The chart revision changed after this snapshot was generated.
              Regenerate before using it for current clinical review.
            </div>
          )}

          <div className="mt-4 grid gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Claims
              </div>
              <div className="mt-1 text-xl font-bold">
                {result.summary.claimCount}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Evidence
              </div>
              <div className="mt-1 text-xl font-bold">
                {result.summary.evidenceCoverage.totalEvidenceRefs}
              </div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-emerald-600">
                Event verified
              </div>
              <div className="mt-1 text-xl font-bold text-emerald-800">
                {result.summary.evidenceCoverage.eventVerifiedRefs}
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-amber-600">
                Projection only
              </div>
              <div className="mt-1 text-xl font-bold text-amber-800">
                {result.summary.evidenceCoverage.projectionOnlyRefs}
              </div>
            </div>
          </div>

          <div className="mt-3 text-[11px] text-slate-500">
            Snapshot <span className="font-mono">{result.summary.summaryId}</span>
            {' · '}Patient 360 revision {result.summary.patient360Revision}
            {' · '}generated {dateTime(result.summary.generatedAt)}
          </div>

          <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-950">
            This is a read-only clinical intelligence artifact, not a signed note,
            diagnosis, prescription, order, or treatment decision. Clinician review
            remains mandatory.
          </div>

          <div className="mt-4 space-y-3">
            {result.summary.sections.map((section) => (
              <details
                key={section.sectionId}
                open={section.sectionId === 'ACTIVE_PROBLEMS'}
                className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {section.title}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                      {section.state.replace(/_/g, ' ')} · {section.claims.length}{' '}
                      claim{section.claims.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </summary>

                {section.caveats.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {section.caveats.map((caveat) => (
                      <div
                        key={caveat}
                        className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
                      >
                        {caveat}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 space-y-2">
                  {section.claims.length > 0 ? (
                    section.claims.map((claim) => (
                      <div
                        key={claim.claimId}
                        className="rounded-lg border border-slate-200 bg-white p-3"
                      >
                        <div className="text-xs font-medium text-slate-800">
                          {claim.text}
                        </div>
                        {claim.caveat && (
                          <div className="mt-1 text-[10px] text-amber-700">
                            {claim.caveat}
                          </div>
                        )}

                        <div className="mt-2 space-y-1">
                          {claim.evidenceRefs.map((evidenceId) => {
                            const evidence = evidenceById.get(evidenceId);
                            return (
                              <details
                                key={evidenceId}
                                className="rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2"
                              >
                                <summary className="cursor-pointer text-[10px] font-mono text-slate-600">
                                  {evidence
                                    ? \`\${evidence.sourceType} · \${evidence.label} · \${evidence.provenanceStatus}\`
                                    : evidenceId}
                                </summary>

                                {evidence && (
                                  <div className="mt-2 space-y-2 text-[10px] text-slate-600">
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
                                          : 'No direct event ID match'}
                                      </span>
                                    </div>
                                    <div>
                                      Content hash:{' '}
                                      <span className="font-mono">
                                        {evidence.contentHash}
                                      </span>
                                    </div>
                                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-[9px]">
                                      {JSON.stringify(evidence.content, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </details>
                            );
                          })}
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState>
                      No evidence-backed claim is emitted for this section.
                    </EmptyState>
                  )}
                </div>
              </details>
            ))}
          </div>

          {result.summary.warnings.length > 0 && (
            <details className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <summary className="cursor-pointer text-xs font-bold text-amber-900">
                Evidence limitations and safety warnings
              </summary>
              <ul className="mt-2 space-y-1 text-[11px] text-amber-900">
                {result.summary.warnings.map((warning) => (
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
