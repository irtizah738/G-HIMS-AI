'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { AuthClient } from '@/lib/auth/auth-client';
import type {
  ClinicalObservation,
  DiagnosticReport,
  ObservationValue,
} from '@/types/clinical-canonical';

interface DiagnosticResultPayload {
  success: boolean;
  status: string;
  order: Record<string, unknown>;
  patient: {
    patientId: string;
    mrn?: string;
    fullName?: string;
    dateOfBirth?: string;
    gender?: string;
  } | null;
  report: DiagnosticReport | null;
  observations: ClinicalObservation[];
  error?: string;
}

function formatObservationValue(value: ObservationValue): string {
  switch (value.valueType) {
    case 'QUANTITY':
      return `${value.quantity.value} ${value.quantity.unit || value.quantity.code || ''}`.trim();
    case 'STRING':
      return value.value;
    case 'CODED':
      return value.value.text || value.value.codings[0]?.display || value.value.codings[0]?.code || '';
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
          return `${label}: ${formatObservationValue(component.value)}`;
        })
        .join(' · ');
  }
}

function referenceRange(observation: ClinicalObservation): string {
  return (observation.referenceRange || [])
    .map((range) => {
      if (range.text) return range.text;
      const low = range.low ? `${range.low.value} ${range.low.unit || ''}`.trim() : '';
      const high = range.high ? `${range.high.value} ${range.high.unit || ''}`.trim() : '';
      if (low && high) return `${low} – ${high}`;
      return low || high;
    })
    .filter(Boolean)
    .join('; ');
}

function interpretation(observation: ClinicalObservation): string {
  return (
    observation.interpretation?.[0]?.text ||
    observation.interpretation?.[0]?.codings?.[0]?.display ||
    'Normal / not flagged'
  );
}

export function DiagnosticResultView({
  tenantId,
  orderId,
}: {
  tenantId: string;
  orderId: string;
}) {
  const [data, setData] = useState<DiagnosticResultPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await AuthClient.authorizedFetch(
          `/api/clinical/diagnostics/results/${encodeURIComponent(orderId)}`,
          { method: 'GET', cache: 'no-store' },
          tenantId
        );
        const payload = (await response.json()) as DiagnosticResultPayload;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || 'Diagnostic result could not be loaded.');
        }
        if (!cancelled) setData(payload);
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Diagnostic result could not be loaded.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, orderId]);

  const issuedAt = useMemo(() => {
    const value = data?.report?.issuedAt;
    return value ? new Date(value).toLocaleString() : 'Pending';
  }, [data?.report?.issuedAt]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading authoritative diagnostic evidence…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="max-w-lg w-full rounded-2xl border border-rose-200 bg-white p-6 space-y-3">
          <div className="flex items-center gap-2 text-rose-700 font-semibold">
            <AlertCircle className="w-5 h-5" />
            Diagnostic result unavailable
          </div>
          <p className="text-sm text-slate-600">{error}</p>
          <Link href="/" className="text-sm font-medium text-blue-700">
            Return to hospital dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!data?.report) {
    return (
      <div className="min-h-screen bg-slate-50 p-6 md:p-10">
        <div className="max-w-4xl mx-auto space-y-5">
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-600">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
          <div className="rounded-2xl border border-amber-200 bg-white p-6">
            <h1 className="font-semibold text-slate-900">Diagnostic result pending</h1>
            <p className="mt-2 text-sm text-slate-600">
              Order {orderId} exists, but no canonical diagnostic report has been released yet.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const report = data.report;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white px-3 py-1.5 rounded-lg border border-slate-200"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Hospital Dashboard
          </Link>
          <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md border border-blue-200">
            Tenant: {tenantId}
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-6 md:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-100 gap-4">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-xl bg-blue-50 text-blue-600 border border-blue-100">
                <FlaskConical className="w-5 h-5" />
              </span>
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  {report.code.text || report.code.codings[0]?.display || 'Diagnostic Report'}
                </h1>
                <p className="text-xs text-slate-500 font-mono">
                  Order ID: {orderId} · Report ID: {report.diagnosticReportId}
                </p>
              </div>
            </div>

            <span className="px-3 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> {report.status}
            </span>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
            <div>
              <span className="text-slate-400 block text-[11px]">Patient</span>
              <strong className="text-slate-800 text-sm">
                {data.patient?.fullName || data.patient?.patientId}
              </strong>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">MRN</span>
              <span className="font-mono text-slate-700 font-bold">
                {data.patient?.mrn || 'Not available'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Category</span>
              <span className="text-slate-700 font-medium">{report.category}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[11px]">Issued</span>
              <span className="text-slate-700 font-medium">{issuedAt}</span>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Verified observations</h2>
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <tr>
                    <th className="p-3 font-semibold">Observation</th>
                    <th className="p-3 font-semibold">Value</th>
                    <th className="p-3 font-semibold">Reference range</th>
                    <th className="p-3 font-semibold">Interpretation</th>
                    <th className="p-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.observations.map((observation) => (
                    <tr key={observation.observationId}>
                      <td className="p-3">
                        <div className="font-medium text-slate-800">
                          {observation.code.text ||
                            observation.code.codings[0]?.display ||
                            observation.code.codings[0]?.code}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400">
                          {observation.code.codings[0]?.system}:
                          {observation.code.codings[0]?.code}
                        </div>
                      </td>
                      <td className="p-3 font-semibold text-slate-900">
                        {formatObservationValue(observation.value)}
                      </td>
                      <td className="p-3 text-slate-500">
                        {referenceRange(observation) || '—'}
                      </td>
                      <td className="p-3 text-slate-700">
                        {interpretation(observation)}
                      </td>
                      <td className="p-3">
                        <span className="font-medium">{observation.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {report.conclusion && (
            <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 text-xs space-y-1">
              <h3 className="font-semibold text-blue-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                Verified report conclusion
              </h3>
              <p className="text-blue-800">{report.conclusion}</p>
            </div>
          )}

          <div className="text-[11px] text-slate-500 border-t border-slate-100 pt-4">
            Source evidence: <span className="font-mono">{report.sourceEvidenceId}</span>
            {' · '}
            Recorded by: <span className="font-mono">{report.provenance.recordedBy}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
