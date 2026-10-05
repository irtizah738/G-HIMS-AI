'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { generateClinicalTrendIntelligence } from '@/lib/clinical/patient360/patient360-client';
import type {
  ClinicalTrendDirection,
  ClinicalTrendIntelligenceResponse,
} from '@/types/clinical-trend-intelligence';

function dateTime(value?: number): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
}

function directionIcon(direction: ClinicalTrendDirection) {
  if (direction === 'INCREASING') {
    return <TrendingUp className="h-4 w-4 text-amber-600" />;
  }
  if (direction === 'DECREASING') {
    return <TrendingDown className="h-4 w-4 text-blue-600" />;
  }
  return <Activity className="h-4 w-4 text-slate-500" />;
}

function statusClass(status: string): string {
  if (status === 'COMPUTED') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (
    status === 'MIXED_UNITS' ||
    status === 'CONFLICTING_SAME_TIME' ||
    status === 'INVALID_TEMPORAL_DATA'
  ) {
    return 'border-rose-200 bg-rose-50 text-rose-800';
  }
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

export function ClinicalTrendIntelligencePanel({
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
    useState<ClinicalTrendIntelligenceResponse | null>(null);
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
        'A fresh clinical trend analysis requires authoritative server connectivity.'
      );
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const next = await generateClinicalTrendIntelligence(
        tenantId,
        patientId
      );
      setResult(next);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Clinical trend intelligence could not be generated.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-2xl border border-cyan-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-cyan-700" />
            <h2 className="text-sm font-bold">
              CI-10D Clinical Trend Intelligence
            </h2>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">
            Deterministic longitudinal trend computation over frozen quantitative
            observations. Mixed units, conflicting timestamps, invalid records,
            and insufficient data suppress direction rather than forcing a result.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void generate()}
          disabled={offline || loading}
          className="inline-flex w-fit items-center gap-2 rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {result ? 'Recompute from current chart' : 'Compute trends'}
        </button>
      </div>

      {offline && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          CI-10D will not generate a fresh trend artifact from stale offline-only
          state.
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
              Patient 360 changed after this trend artifact was generated.
              Recompute before relying on it for current chart review.
            </div>
          )}

          <div className="mt-4 grid gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Metrics
              </div>
              <div className="mt-1 text-xl font-bold">
                {result.artifact.metrics.length}
              </div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-emerald-600">
                Computed
              </div>
              <div className="mt-1 text-xl font-bold text-emerald-800">
                {result.artifact.computedMetricCount}
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-amber-600">
                Suppressed
              </div>
              <div className="mt-1 text-xl font-bold text-amber-800">
                {result.artifact.nonComputableMetricCount}
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Excluded evidence
              </div>
              <div className="mt-1 text-xl font-bold">
                {result.artifact.excludedEvidence.length}
              </div>
            </div>
          </div>

          <div className="mt-3 text-[11px] text-slate-500">
            Artifact{' '}
            <span className="font-mono">{result.artifact.artifactId}</span>
            {' · '}Patient 360 revision {result.artifact.patient360Revision}
            {' · '}generated {dateTime(result.artifact.generatedAt)}
          </div>

          <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-950">
            Trend direction, magnitude, slope and abnormality are descriptive
            chart-review aids only. They do not establish diagnosis, causality,
            severity or treatment significance.
          </div>

          <div className="mt-4 space-y-3">
            {result.artifact.metrics.map((metric) => (
              <details
                key={metric.metricKey}
                open={metric.status === 'COMPUTED'}
                className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {directionIcon(metric.direction)}
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {metric.display}
                        </div>
                        <div className="text-[10px] font-mono text-slate-500">
                          {metric.metricKey}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${statusClass(metric.status)}`}
                      >
                        {metric.status.replace(/_/g, ' ')}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[9px] font-bold uppercase text-slate-500">
                        {metric.direction.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                </summary>

                {metric.explanation && (
                  <div className="mt-3 rounded-lg border border-cyan-100 bg-cyan-50 p-3 text-xs text-cyan-950">
                    {metric.explanation.text}
                  </div>
                )}

                {metric.status === 'COMPUTED' && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <div className="rounded-lg bg-white p-2.5">
                      <div className="text-[9px] uppercase text-slate-400">
                        First
                      </div>
                      <div className="mt-1 text-sm font-bold">
                        {metric.firstValue} {metric.unit || ''}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-2.5">
                      <div className="text-[9px] uppercase text-slate-400">
                        Last
                      </div>
                      <div className="mt-1 text-sm font-bold">
                        {metric.lastValue} {metric.unit || ''}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-2.5">
                      <div className="text-[9px] uppercase text-slate-400">
                        Absolute change
                      </div>
                      <div className="mt-1 text-sm font-bold">
                        {metric.absoluteChange} {metric.unit || ''}
                      </div>
                    </div>
                    <div className="rounded-lg bg-white p-2.5">
                      <div className="text-[9px] uppercase text-slate-400">
                        Source abnormal
                      </div>
                      <div className="mt-1 text-sm font-bold">
                        {metric.abnormalPointCount}/{metric.pointCount}
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-[10px]">
                    <thead className="text-slate-400">
                      <tr>
                        <th className="px-2 py-1">Effective</th>
                        <th className="px-2 py-1">Value</th>
                        <th className="px-2 py-1">Status</th>
                        <th className="px-2 py-1">Source flag</th>
                        <th className="px-2 py-1">Evidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metric.points.map((point, index) => {
                        const evidence = evidenceById.get(point.evidenceId);
                        return (
                          <tr
                            key={`${point.evidenceId}:${point.effectiveAt}:${index}`}
                            className="border-t border-slate-100"
                          >
                            <td className="px-2 py-1.5">
                              {dateTime(point.effectiveAt)}
                            </td>
                            <td className="px-2 py-1.5 font-semibold">
                              {point.value} {point.unit}
                            </td>
                            <td className="px-2 py-1.5">{point.status}</td>
                            <td className="px-2 py-1.5">
                              {point.abnormal
                                ? point.abnormalBasis || 'ABNORMAL'
                                : '—'}
                            </td>
                            <td className="px-2 py-1.5">
                              {evidence ? (
                                <details>
                                  <summary className="cursor-pointer font-mono text-cyan-700">
                                    {evidence.sourceEntityId}
                                  </summary>
                                  <div className="mt-1 space-y-1 text-slate-500">
                                    <div>
                                      Provenance: {evidence.provenanceStatus}
                                    </div>
                                    <div className="font-mono">
                                      {evidence.sourceEventIds.length
                                        ? evidence.sourceEventIds.join(', ')
                                        : 'No direct event ID match'}
                                    </div>
                                    <div className="font-mono">
                                      {evidence.contentHash}
                                    </div>
                                  </div>
                                </details>
                              ) : (
                                <span className="font-mono">
                                  {point.evidenceId}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {metric.caveats.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {metric.caveats.map((caveat) => (
                      <div
                        key={caveat}
                        className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[10px] text-amber-900"
                      >
                        {caveat}
                      </div>
                    ))}
                  </div>
                )}

                {metric.exclusions.length > 0 && (
                  <details className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2">
                    <summary className="cursor-pointer text-[10px] font-bold text-rose-800">
                      Metric exclusions ({metric.exclusions.length})
                    </summary>
                    <div className="mt-2 space-y-1 text-[10px] text-rose-800">
                      {metric.exclusions.map((item, index) => (
                        <div
                          key={`${item.evidenceId}:${item.reason}:${index}`}
                        >
                          {item.reason.replace(/_/g, ' ')} — {item.detail}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </details>
            ))}
          </div>

          {result.artifact.metrics.length === 0 && (
            <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-4 text-xs text-slate-500">
              No quantitative coded observation series is currently eligible for
              deterministic trend computation.
            </div>
          )}

          {result.artifact.excludedEvidence.length > 0 && (
            <details className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <summary className="cursor-pointer text-xs font-bold text-amber-900">
                Excluded observation evidence (
                {result.artifact.excludedEvidence.length})
              </summary>
              <div className="mt-2 space-y-1 text-[10px] text-amber-900">
                {result.artifact.excludedEvidence.map((item, index) => (
                  <div
                    key={`${item.evidenceId}:${item.reason}:${index}`}
                  >
                    <span className="font-bold">
                      {item.reason.replace(/_/g, ' ')}
                    </span>
                    {' — '}
                    {item.detail}
                  </div>
                ))}
              </div>
            </details>
          )}

          {result.artifact.warnings.length > 0 && (
            <details className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <summary className="cursor-pointer text-xs font-bold text-amber-900">
                Trend safety warnings
              </summary>
              <ul className="mt-2 space-y-1 text-[10px] text-amber-900">
                {result.artifact.warnings.map((warning) => (
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
