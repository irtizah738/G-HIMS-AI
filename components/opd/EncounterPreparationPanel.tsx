'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ClipboardCheck, Loader2, RefreshCw } from 'lucide-react';
import { generateEncounterPreparationBrief } from '@/lib/clinical/patient360/patient360-client';
import type { ClinicalEncounterPreparationResponse } from '@/types/clinical-encounter-preparation';
import type { ClinicalCareSetting } from '@/types/consultant-visibility';

function badgeClass(severity: string): string {
  if (severity === 'CRITICAL_REVIEW_REQUIRED') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'ACTION_REQUIRED') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (severity === 'REVIEW_REQUIRED') return 'border-blue-200 bg-blue-50 text-blue-800';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export function EncounterPreparationPanel({
  tenantId,
  patientId,
  encounterId,
  careSetting,
  online,
}: {
  tenantId: string;
  patientId: string;
  encounterId: string;
  careSetting?: ClinicalCareSetting;
  online: boolean;
}) {
  const [result, setResult] = useState<ClinicalEncounterPreparationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const autoKey = useRef('');

  const evidenceById = useMemo(
    () => new Map((result?.evidenceIndex || []).map((item) => [item.evidenceId, item])),
    [result]
  );

  const generate = async () => {
    if (!online) {
      setError('A fresh encounter brief requires authoritative server connectivity.');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const next = await generateEncounterPreparationBrief(tenantId, {
        patientId,
        encounterId,
        careSetting,
      });
      setResult(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Encounter preparation failed.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const key = `${tenantId}:${patientId}:${encounterId}`;
    if (!online || autoKey.current === key) return;
    autoKey.current = key;
    void generate();
    // The encounter identity is the generation boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, patientId, encounterId, online]);

  return (
    <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm dark:bg-slate-900 dark:border-indigo-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-indigo-600" />
            <h2 className="text-sm font-bold">Encounter Preparation Intelligence</h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">
            Evidence-grounded pre-consultation brief for this encounter. It highlights what changed and what still needs review; it does not diagnose, prescribe, order, sign, or acknowledge work.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={!online || loading}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh brief
        </button>
      </div>

      {!online && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          CI-10C will not fabricate a fresh brief from stale offline-only state.
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
          {error}
        </div>
      )}

      {result && (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-rose-50 p-3">
              <div className="text-[10px] uppercase text-rose-500">Critical</div>
              <div className="mt-1 text-xl font-bold text-rose-800">{result.brief.attention.critical}</div>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <div className="text-[10px] uppercase text-amber-500">Action</div>
              <div className="mt-1 text-xl font-bold text-amber-800">{result.brief.attention.actionRequired}</div>
            </div>
            <div className="rounded-xl bg-blue-50 p-3">
              <div className="text-[10px] uppercase text-blue-500">Review</div>
              <div className="mt-1 text-xl font-bold text-blue-800">{result.brief.attention.reviewRequired}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-[10px] uppercase text-slate-400">Evidence</div>
              <div className="mt-1 text-xl font-bold">{result.brief.evidenceCoverage.totalEvidenceRefs}</div>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {result.brief.sections.map((section) => (
              <details
                key={section.sectionId}
                open={['REASON_FOR_VISIT','CHANGES_SINCE_REVIEW','NEW_ABNORMAL_INVESTIGATIONS','MEDICATION_DISCREPANCIES','OUTSTANDING_WORK'].includes(section.sectionId)}
                className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold">{section.title}</span>
                    <span className="text-[9px] font-bold uppercase text-slate-500">
                      {section.state.replace(/_/g,' ')} · {section.claims.length}
                    </span>
                  </div>
                </summary>

                {section.caveats.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {section.caveats.map((caveat) => (
                      <div key={caveat} className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] text-amber-900">
                        {caveat}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 space-y-2">
                  {section.claims.map((claim) => (
                    <div key={claim.claimId} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                      <div className="flex items-start gap-2">
                        {claim.severity === 'CRITICAL_REVIEW_REQUIRED' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium">{claim.text}</div>
                          <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${badgeClass(claim.severity)}`}>
                            {claim.severity.replace(/_/g,' ')}
                          </span>
                          {claim.caveat && <div className="mt-1 text-[10px] text-amber-700">{claim.caveat}</div>}
                        </div>
                      </div>

                      <div className="mt-2 space-y-1">
                        {claim.evidenceRefs.map((evidenceId) => {
                          const evidence = evidenceById.get(evidenceId);
                          return (
                            <details key={evidenceId} className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-[9px] dark:border-slate-800 dark:bg-slate-800">
                              <summary className="cursor-pointer font-mono text-slate-600 dark:text-slate-300">
                                {evidence ? `${evidence.sourceType} · ${evidence.label} · ${evidence.provenanceStatus}` : evidenceId}
                              </summary>
                              {evidence && (
                                <div className="mt-2 space-y-1 text-slate-500">
                                  <div>Entity: <span className="font-mono">{evidence.sourceEntityId}</span></div>
                                  <div>Events: <span className="font-mono">{evidence.sourceEventIds.length ? evidence.sourceEventIds.join(', ') : 'No direct event ID match'}</span></div>
                                  <div>Hash: <span className="font-mono">{evidence.contentHash}</span></div>
                                </div>
                              )}
                            </details>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-[10px] text-indigo-950">
            Brief <span className="font-mono">{result.brief.briefId}</span> · Patient 360 revision {result.brief.patient360Revision} · clinician review required.
          </div>
        </>
      )}
    </section>
  );
}
