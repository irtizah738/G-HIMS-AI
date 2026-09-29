'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  FileText,
  FlaskConical,
  HeartPulse,
  Loader2,
  Pill,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  loadPatient360ClinicalView,
  type Patient360ClinicalView,
} from '@/lib/clinical/patient360/patient360-client';
import type { Patient360ObservationSummary } from '@/types/patient360-projection';

function valueText(value: Patient360ObservationSummary['value']): string {
  switch (value.valueType) {
    case 'QUANTITY':
      return `${value.quantity.value} ${value.quantity.unit || value.quantity.code || ''}`.trim();
    case 'STRING':
      return value.value;
    case 'CODED':
      return value.value.text || value.value.codings[0]?.display || value.value.codings[0]?.code || 'Coded value';
    case 'BOOLEAN':
      return value.value ? 'Yes' : 'No';
    case 'COMPONENTS':
      return value.components
        .map((component) => {
          const label =
            component.code.text ||
            component.code.codings[0]?.display ||
            component.code.codings[0]?.code ||
            'Component';
          return `${label}: ${valueText(component.value)}`;
        })
        .join(' · ');
  }
}

function dateTime(value?: number | string): string {
  if (value === undefined || value === null || value === '') return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
}

function KnowledgeBanner({
  label,
  status,
}: {
  label: string;
  status: 'KNOWN' | 'UNKNOWN';
}) {
  if (status === 'KNOWN') return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>
        <strong>{label} status is unknown.</strong> No confirmed canonical record has been established.
      </span>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
      {children}
    </div>
  );
}

export function Patient360View({
  tenantId,
  patientId,
}: {
  tenantId: string;
  patientId: string;
}) {
  const [view, setView] = useState<Patient360ClinicalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const next = await loadPatient360ClinicalView(tenantId, patientId);
      setView(next);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Patient 360 could not be loaded.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // tenantId/patientId are the identity boundary for this clinical view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, patientId]);

  const latestResultAt = useMemo(() => {
    const timestamps =
      view?.projection.recentResults
        .map((item) => item.issuedAt || 0)
        .filter(Boolean) || [];
    return timestamps.length ? Math.max(...timestamps) : 0;
  }, [view]);

  if (loading && !view) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading authoritative Patient 360…
        </div>
      </div>
    );
  }

  if (!view || error) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="w-full max-w-lg rounded-2xl border border-rose-200 bg-white p-6">
          <div className="flex items-center gap-2 font-semibold text-rose-700">
            <AlertTriangle className="h-5 w-5" />
            Patient 360 unavailable
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {error || 'No Patient 360 projection is available for this patient.'}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { projection, timeline, source, freshness } = view;
  const offline = source === 'LOCAL_EDGE';
  const highCriticalityAllergies = projection.allergies.filter(
    (item) => item.criticality === 'HIGH'
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-5 p-5 md:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600"
          >
            <ArrowLeft className="h-4 w-4" />
            Hospital Dashboard
          </Link>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={
                offline
                  ? 'inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-800'
                  : 'inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800'
              }
            >
              {offline ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
              {offline ? 'Encrypted offline snapshot' : 'Authoritative server projection'}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-slate-500">
              rev {freshness.revision} · v{freshness.projectionVersion}
            </span>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-600 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {offline && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            You are viewing the last encrypted Patient 360 projection hydrated for this authenticated user.
            The detailed event timeline is unavailable until server connectivity returns.
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight">
                  {projection.identity.fullName}
                </h1>
                <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-semibold text-slate-700">
                  {projection.identity.mrn || projection.patientId}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                <span>DOB: {projection.identity.dateOfBirth || 'Unknown'}</span>
                <span>Gender: {projection.identity.gender || 'Unknown'}</span>
                <span>Blood group: {projection.identity.bloodGroup || 'Unknown'}</span>
                <span>Tenant: {tenantId}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:min-w-[430px]">
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Problems</div>
                <div className="mt-1 text-lg font-bold">{projection.activeProblems.length}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Allergies</div>
                <div className="mt-1 text-lg font-bold">{projection.allergies.length}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Meds</div>
                <div className="mt-1 text-lg font-bold">{projection.currentMedications.length}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Results</div>
                <div className="mt-1 text-lg font-bold">{projection.recentResults.length}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            <KnowledgeBanner
              label="Allergy"
              status={projection.dataQuality.allergyKnowledge}
            />
            <KnowledgeBanner
              label="Problem list"
              status={projection.dataQuality.problemListKnowledge}
            />
            <KnowledgeBanner
              label="Medication"
              status={projection.dataQuality.medicationKnowledge}
            />
          </div>

          {highCriticalityAllergies.length > 0 && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-rose-800">
                <AlertTriangle className="h-4 w-4" />
                High-criticality allergy alert
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {highCriticalityAllergies.map((item) => (
                  <span
                    key={item.allergyId}
                    className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-800"
                  >
                    {item.substance}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="grid gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-bold">Active clinical context</h2>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Active problems
                  </h3>
                  <div className="mt-2 space-y-2">
                    {projection.activeProblems.length ? (
                      projection.activeProblems.map((item) => (
                        <div key={item.conditionId} className="rounded-lg border border-slate-200 p-3">
                          <div className="text-sm font-semibold">{item.display}</div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {item.system || 'LOCAL'} {item.code || ''} · {item.verificationStatus}
                          </div>
                        </div>
                      ))
                    ) : projection.dataQuality.problemListKnowledge === 'UNKNOWN' ? (
                      <EmptyState>Problem list has not been established.</EmptyState>
                    ) : (
                      <EmptyState>No active problems in the canonical projection.</EmptyState>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Allergies & intolerances
                  </h3>
                  <div className="mt-2 space-y-2">
                    {projection.allergies.length ? (
                      projection.allergies.map((item) => (
                        <div key={item.allergyId} className="rounded-lg border border-slate-200 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold">{item.substance}</span>
                            <span className="text-[10px] font-bold text-rose-700">
                              {item.criticality}
                            </span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {item.category} · {item.verificationStatus}
                          </div>
                        </div>
                      ))
                    ) : projection.dataQuality.allergyKnowledge === 'UNKNOWN' ? (
                      <EmptyState>Allergy status has not been confirmed.</EmptyState>
                    ) : (
                      <EmptyState>No active allergies in the canonical projection.</EmptyState>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <HeartPulse className="h-4 w-4 text-rose-600" />
                <h2 className="text-sm font-bold">Latest vital observations</h2>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projection.latestVitals.length ? (
                  projection.latestVitals.map((item) => (
                    <div key={item.observationId} className="rounded-xl border border-slate-200 p-4">
                      <div className="text-[11px] font-medium text-slate-500">{item.display}</div>
                      <div className="mt-1 text-lg font-bold">{valueText(item.value)}</div>
                      <div className="mt-2 text-[10px] text-slate-400">
                        {dateTime(item.effectiveAt)}
                        {item.interpretation ? ` · ${item.interpretation}` : ''}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <EmptyState>No canonical vital observations are available.</EmptyState>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-violet-600" />
                  <h2 className="text-sm font-bold">Recent diagnostic reports</h2>
                </div>
                {latestResultAt > 0 && (
                  <span className="text-[10px] text-slate-400">
                    Latest {dateTime(latestResultAt)}
                  </span>
                )}
              </div>

              <div className="mt-4 space-y-2">
                {projection.recentResults.length ? (
                  projection.recentResults.map((item) => (
                    <Link
                      key={item.diagnosticReportId}
                      href={item.orderId
                        ? `/${encodeURIComponent(tenantId)}/diagnostics/results/${encodeURIComponent(item.orderId)}`
                        : '#'}
                      className="block rounded-xl border border-slate-200 p-4 transition hover:bg-slate-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{item.display}</div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {item.category} · {dateTime(item.issuedAt)}
                          </div>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700">
                          {item.status}
                        </span>
                      </div>
                      {item.conclusion && (
                        <p className="mt-2 line-clamp-2 text-xs text-slate-600">{item.conclusion}</p>
                      )}
                    </Link>
                  ))
                ) : (
                  <EmptyState>No canonical diagnostic reports are available.</EmptyState>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Pill className="h-4 w-4 text-emerald-600" />
                <h2 className="text-sm font-bold">Current medication orders</h2>
              </div>
              <div className="mt-4 space-y-2">
                {projection.currentMedications.length ? (
                  projection.currentMedications.map((item) => (
                    <div key={item.medicationOrderId} className="rounded-lg border border-slate-200 p-3">
                      <div className="text-sm font-semibold">{item.medication}</div>
                      <div className="mt-1 text-xs text-slate-600">
                        {item.dosageText}
                        {item.frequency ? ` · ${item.frequency}` : ''}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">
                        {item.status} · {dateTime(item.authoredAt)}
                      </div>
                    </div>
                  ))
                ) : projection.dataQuality.medicationKnowledge === 'UNKNOWN' ? (
                  <EmptyState>Medication history has not been established.</EmptyState>
                ) : (
                  <EmptyState>No current medications in the canonical projection.</EmptyState>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-600" />
                <h2 className="text-sm font-bold">Recent signed documents</h2>
              </div>
              <div className="mt-4 space-y-2">
                {projection.recentDocuments.length ? (
                  projection.recentDocuments.map((item) => (
                    <div key={item.clinicalDocumentId} className="rounded-lg border border-slate-200 p-3">
                      <div className="text-sm font-semibold">
                        {item.title || item.documentType}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">
                        Signed {dateTime(item.signedAt)} · {item.status}
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState>No signed canonical documents are available.</EmptyState>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-bold">Clinical timeline</h2>
              </div>
              <div className="mt-4 space-y-3">
                {timeline.length ? (
                  timeline.slice(0, 30).map((item) => (
                    <div key={item.timelineItemId} className="border-l-2 border-slate-200 pl-3">
                      <div className="text-xs font-medium text-slate-800">{item.summary}</div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {dateTime(item.occurredAt)}
                      </div>
                    </div>
                  ))
                ) : offline ? (
                  <EmptyState>Detailed timeline requires server connectivity.</EmptyState>
                ) : (
                  <EmptyState>No patient-scoped timeline events are available.</EmptyState>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="text-[10px] text-slate-400">
          Projection checkpoint: <span className="font-mono">{freshness.sourceCheckpoint}</span>
          {' · '}Projected {dateTime(freshness.projectedAt)}
        </div>
      </div>
    </div>
  );
}
