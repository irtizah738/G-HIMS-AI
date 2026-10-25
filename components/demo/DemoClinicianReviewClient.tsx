'use client';

import { useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { Patient360View } from '@/components/patient360/Patient360View';
import type { Patient360ClinicalView } from '@/lib/clinical/patient360/patient360-client';
import type { Patient360Projection, Patient360EncounterSummary } from '@/types/patient360-projection';

const physicianEmail = 'demo.doctor@example.invalid';

type Chart = {
  syntheticOnly: boolean;
  patientId: string;
  tenantId: string;
  projection: Patient360Projection;
  selectedCareContext: Patient360EncounterSummary | null;
  revision: number;
  sourceCheckpoint: string;
  counts: Record<string, number>;
  identity: { fullName?: string; mrn?: string };
  activeProblems?: Array<{ display?: string; clinicalStatus?: string }>;
  allergies?: Array<{ substance?: string; criticality?: string }>;
  currentMedications?: Array<{ medication?: string; dosageText?: string; status?: string }>;
  latestVitals?: Array<{ display?: string; value?: unknown; effectiveAt?: number }>;
  renalObservations?: Array<{
    observationId: string;
    display: string;
    value: number;
    unit: string;
    loincCode: string;
    effectiveAt: number;
    status: string;
    sourceEvidenceId: string;
    sourceType: string;
    recordedInterpretation?: string;
  }>;
  recentResults?: Array<{ display?: string; conclusion?: string; status?: string }>;
  recentDiagnosticOrders?: Array<{ display?: string; status?: string }>;
  recentProcedures?: Array<{ display?: string; status?: string }>;
  activeCarePlans?: Array<{ title?: string; status?: string }>;
  recentDocuments?: Array<{ title?: string; status?: string }>;
};

function dateOfMeasurement(value: number): string {
  return Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : 'Date unavailable';
}

export function DemoClinicianReviewClient() {
  const [password, setPassword] = useState('');
  const [chart, setChart] = useState<Chart | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function review(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    setChart(null);
    try {
      const session = await signInWithEmailAndPassword(auth, physicianEmail, password);
      const token = await session.user.getIdToken();
      const response = await fetch('/api/clinical-intelligence-demo/physician-chart', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('CLINICIAN_PREVIEW_NOT_AUTHORIZED');
      const payload = await response.json() as Chart;
      if (payload.syntheticOnly !== true || payload.patientId !== 'demo-ci-patient-001' ||
          payload.tenantId !== 'central-metro-hospital' ||
          payload.projection?.patientId !== payload.patientId ||
          payload.projection?.tenantId !== payload.tenantId ||
          payload.projection?.identity?.mrn !== 'CI-DEMO-001' ||
          payload.projection?.timelineReady !== true) {
        throw new Error('DEMO_IDENTITY_MISMATCH');
      }
      setChart(payload);
    } catch {
      setError('Could not authorize and load the synthetic chart. Confirm the DEMO physician credentials and protected preview permissions.');
      await signOut(auth).catch(() => undefined);
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  async function closeReview() {
    setChart(null);
    setPassword('');
    setError('');
    await signOut(auth).catch(() => undefined);
  }

  // Build the exact native Patient360ClinicalView contract from the already
  // authorized synthetic canonical projection. No local mock projection or
  // ordinary hospital-session API fallback is used in read-only mode.
  const nativeClinicalView: Patient360ClinicalView | null = chart ? {
    tenantId: chart.tenantId,
    patientId: chart.patientId,
    projection: chart.projection,
    timeline: [],
    selectedCareContext: chart.selectedCareContext,
    dischargeReadiness: null,
    deterioration: null,
    medicationSafety: null,
    consultantVisibility: null,
    source: 'SERVER',
    freshness: {
      projectionVersion: chart.projection.projectionVersion,
      revision: chart.projection.revision,
      sourceCheckpoint: chart.projection.sourceCheckpoint,
      projectedAt: chart.projection.projectedAt,
      contentHash: chart.projection.contentHash,
      lastEventId: chart.projection.lastEventId,
      lastEventRecordedAt: chart.projection.lastEventRecordedAt,
    },
  } : null;

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-7">
        <header>
          <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">
            G-HIMS Clinical Intelligence / Authorized Clinician Review
          </p>
          <h1 className="mt-2 text-3xl font-bold">Patient 360 — Synthetic Clinical Evidence</h1>
          <p className="mt-3 text-sm text-slate-300">
            This uses the canonical, versioned Firestore Patient 360 projection, not an invented result.
            Authentication requires the separately provisioned DEMO physician account and Vercel SSO.
          </p>
          <p className="mt-3 rounded-lg border border-amber-500/50 bg-amber-950/40 p-3 text-sm text-amber-200">
            SYNTHETIC DEMO ONLY — NOT CLINICALLY VALIDATED. Read-only review:
            no diagnoses, prescriptions, note signing, or AI-generated conclusions are authorized here.
          </p>
        </header>

        {!chart ? (
          <form onSubmit={review} className="max-w-lg space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-6">
            <label className="block text-sm">
              <span className="text-slate-300">Authorized DEMO physician</span>
              <input value={physicianEmail} readOnly autoComplete="username"
                className="mt-2 w-full rounded-md border border-slate-600 bg-slate-800 p-3 text-slate-300" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-300">DEMO-only password</span>
              <input required type="password" value={password} onChange={e => setPassword(e.target.value)}
                autoComplete="current-password" className="mt-2 w-full rounded-md border border-slate-600 bg-slate-800 p-3" />
            </label>
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            <button disabled={busy} type="submit"
              className="rounded-md bg-cyan-300 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">
              {busy ? 'Checking clinical authority…' : 'Authenticate and read Patient 360'}
            </button>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-cyan-600/50 bg-slate-900 p-5">
              <div>
                <p className="text-xs uppercase tracking-wider text-cyan-300">Authenticated DEMO physician · native application UI</p>
                <h2 className="mt-1 text-xl font-semibold">{chart.identity.fullName}</h2>
                <p className="mt-1 text-sm text-slate-300">
                  MRN {chart.identity.mrn} · revision {chart.revision} · synthetic record
                </p>
              </div>
              <button onClick={closeReview} className="rounded-md border border-slate-600 px-4 py-2 text-sm">End review</button>
            </div>
            {nativeClinicalView && (
              <div className="overflow-hidden rounded-xl border border-slate-600">
                <Patient360View
                  tenantId={chart.tenantId}
                  patientId={chart.patientId}
                  demoReadOnlyView={nativeClinicalView}
                />
              </div>
            )}
            <section className="rounded-xl border border-cyan-700/60 bg-slate-900 p-5">
              <h2 className="text-xl font-semibold text-cyan-200">Renal trend — canonical source evidence</h2>
              <p className="mt-2 text-sm text-slate-300">
                Supporting laboratory records retrieved after physician authorization;
                this supplementary panel is not part of the original G-HIMS AI Patient 360 component.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {(chart.renalObservations || []).map(observation => (
                  <article key={observation.observationId}
                    className="rounded-lg border border-slate-700 bg-slate-800 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                      {observation.display} · {dateOfMeasurement(observation.effectiveAt)}
                    </p>
                    <p className="mt-2 text-2xl font-bold text-white">
                      {observation.value} <span className="text-sm font-normal text-slate-300">{observation.unit}</span>
                    </p>
                    <p className="mt-2 text-xs text-slate-300">
                      Source interpretation: {observation.recordedInterpretation || 'None recorded'} · {observation.status}
                    </p>
                    <p className="mt-2 break-all font-mono text-xs text-slate-400">
                      Evidence: {observation.sourceEvidenceId} · LOINC {observation.loincCode}
                    </p>
                  </article>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Observed, synthetic values only. No deterioration threshold, treatment
                recommendation, or clinical AI warning has been validated here.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
