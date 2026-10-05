'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, Loader2, RefreshCw } from 'lucide-react';
import { generateMedicationReconciliationCopilot } from '@/lib/clinical/patient360/patient360-client';
import type { ClinicalCareSetting } from '@/types/consultant-visibility';
import type { MedicationReconciliationCopilotResponse } from '@/types/medication-reconciliation-copilot';

function severityClass(severity: string): string {
  if (severity === 'CRITICAL_REVIEW_REQUIRED') {
    return 'border-rose-200 bg-rose-50 text-rose-800';
  }
  if (severity === 'ACTION_REQUIRED') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  if (severity === 'REVIEW_REQUIRED') {
    return 'border-blue-200 bg-blue-50 text-blue-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export function MedicationReconciliationCopilotPanel({
  tenantId,
  patientId,
  encounterId,
  careSetting,
  offline,
  currentRevision,
}: {
  tenantId: string;
  patientId: string;
  encounterId: string;
  careSetting: ClinicalCareSetting;
  offline: boolean;
  currentRevision: number;
}) {
  const [result, setResult] =
    useState<MedicationReconciliationCopilotResponse | null>(null);
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
        'A fresh medication reconciliation review requires authoritative server connectivity.'
      );
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const next = await generateMedicationReconciliationCopilot(
        tenantId,
        { patientId, encounterId, careSetting }
      );
      setResult(next);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Medication reconciliation review could not be generated.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-violet-700" />
            <h2 className="text-sm font-bold">
              CI-10E Medication Reconciliation Copilot
            </h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">
            Evidence-grounded comparison of medication history, current orders,
            dispense/admin records, allergies and reconciliation evidence. It
            highlights discrepancies for clinician/pharmacist review and cannot
            alter medication therapy.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void generate()}
          disabled={offline || loading}
          className="inline-flex w-fit items-center gap-2 rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {result ? 'Refresh reconciliation review' : 'Review medications'}
        </button>
      </div>

      {offline && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          CI-10E will not create a fresh reconciliation artifact from stale
          offline-only data.
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
          {error}
        </div>
      )}

      {result && (
        <>
          {result.artifact.patient360Revision !== currentRevision && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Patient 360 changed after this medication review was generated.
              Regenerate before using it for reconciliation.
            </div>
          )}

          <div className="mt-4 grid gap-2 sm:grid-cols-5">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-[10px] uppercase text-slate-400">Findings</div>
              <div className="mt-1 text-xl font-bold">{result.artifact.counts.total}</div>
            </div>
            <div className="rounded-xl bg-rose-50 p-3">
              <div className="text-[10px] uppercase text-rose-500">Critical</div>
              <div className="mt-1 text-xl font-bold text-rose-800">
                {result.artifact.counts.critical}
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <div className="text-[10px] uppercase text-amber-500">Action</div>
              <div className="mt-1 text-xl font-bold text-amber-800">
                {result.artifact.counts.actionRequired}
              </div>
            </div>
            <div className="rounded-xl bg-blue-50 p-3">
              <div className="text-[10px] uppercase text-blue-500">Review</div>
              <div className="mt-1 text-xl font-bold text-blue-800">
                {result.artifact.counts.reviewRequired}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-[10px] uppercase text-slate-400">Info</div>
              <div className="mt-1 text-xl font-bold">
                {result.artifact.counts.information}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-6">
            {[
              ['Orders', result.artifact.coverage.orders],
              ['Dispenses', result.artifact.coverage.dispenses],
              ['Administrations', result.artifact.coverage.administrations],
              ['Reconciliations', result.artifact.coverage.reconciliationRecords],
              ['Allergies', result.artifact.coverage.allergies],
              ['CI-9 findings', result.artifact.coverage.ci9Findings],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-2.5">
                <div className="text-[9px] uppercase text-slate-400">{label}</div>
                <div className="mt-1 text-sm font-bold">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950">
            This artifact is review-only. It cannot start, stop, resume,
            substitute, prescribe, dose-adjust, administer or dispense a
            medication, and it cannot complete medication reconciliation.
          </div>

          <div className="mt-4 space-y-2">
            {result.artifact.findings.length > 0 ? (
              result.artifact.findings.map((finding) => (
                <details
                  key={finding.findingId}
                  className={`rounded-xl border px-4 py-3 ${severityClass(
                    finding.severity
                  )}`}
                >
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{finding.title}</div>
                        <p className="mt-1 text-xs">{finding.description}</p>
                      </div>
                      <span className="shrink-0 text-[9px] font-bold uppercase">
                        {finding.severity.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </summary>

                  {finding.caveat && (
                    <div className="mt-3 rounded-lg border border-white/60 bg-white/60 p-2 text-[10px]">
                      {finding.caveat}
                    </div>
                  )}

                  <div className="mt-3 space-y-1">
                    {finding.evidenceRefs.map((evidenceId) => {
                      const evidence = evidenceById.get(evidenceId);
                      return (
                        <details
                          key={evidenceId}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] text-slate-700"
                        >
                          <summary className="cursor-pointer font-mono">
                            {evidence
                              ? `${evidence.sourceType} · ${evidence.label} · ${evidence.provenanceStatus}`
                              : evidenceId}
                          </summary>
                          {evidence && (
                            <div className="mt-2 space-y-1">
                              <div>
                                Entity:{' '}
                                <span className="font-mono">
                                  {evidence.sourceEntityId}
                                </span>
                              </div>
                              <div>
                                Events:{' '}
                                <span className="font-mono">
                                  {evidence.sourceEventIds.length
                                    ? evidence.sourceEventIds.join(', ')
                                    : 'No direct event ID match'}
                                </span>
                              </div>
                              <div>
                                Hash:{' '}
                                <span className="font-mono">
                                  {evidence.contentHash}
                                </span>
                              </div>
                            </div>
                          )}
                        </details>
                      );
                    })}
                  </div>
                </details>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-500">
                No CI-10E discrepancy is derived from the represented evidence.
                This does not prove medication reconciliation is clinically complete.
              </div>
            )}
          </div>

          {result.artifact.findings.some(
            (item) =>
              item.severity === 'CRITICAL_REVIEW_REQUIRED' ||
              item.severity === 'ACTION_REQUIRED' ||
              item.severity === 'REVIEW_REQUIRED'
          ) && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Resolve or clinically account for the review findings through the
              authoritative medication workflows before affirming that no
              unresolved discrepancies remain.
            </div>
          )}

          <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <summary className="cursor-pointer text-xs font-bold text-slate-700">
              Safety and evidence limitations
            </summary>
            <ul className="mt-2 space-y-1 text-[10px] text-slate-600">
              {result.artifact.warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
