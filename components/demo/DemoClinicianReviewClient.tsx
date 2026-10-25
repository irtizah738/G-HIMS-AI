'use client';

import { useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';

const physicianEmail = 'demo.doctor@example.invalid';

type Chart = {
  syntheticOnly: boolean;
  patientId: string;
  tenantId: string;
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

function formatMeasurement(input: unknown): string {
  if (input === null || input === undefined) return 'Not supplied';
  if (typeof input === 'string' || typeof input === 'number') return String(input);
  if (typeof input !== 'object') return 'Unsupported measurement';
  const value = input as Record<string, unknown>;

  // Canonical observation values are discriminated unions, not flat numbers.
  if (value.valueType === 'QUANTITY' && value.quantity && typeof value.quantity === 'object') {
    const quantity = value.quantity as Record<string, unknown>;
    if (typeof quantity.value === 'number' && Number.isFinite(quantity.value)) {
      return `${quantity.value} ${typeof quantity.unit === 'string' ? quantity.unit : ''}`.trim();
    }
  }
  if (value.valueType === 'COMPONENTS' && Array.isArray(value.components)) {
    const readings = value.components.map(part => {
      const item = part as Record<string, unknown>;
      const quantity = (item.value as Record<string, unknown> | undefined)?.quantity as Record<string, unknown> | undefined;
      const code = (item.code as { codings?: Array<{ code?: string }> } | undefined)?.codings?.[0]?.code;
      return { code, reading: quantity?.value, unit: quantity?.unit };
    });
    const systolic = readings.find(item => item.code === '8480-6');
    const diastolic = readings.find(item => item.code === '8462-4');
    if (typeof systolic?.reading === 'number' && typeof diastolic?.reading === 'number' &&
        Number.isFinite(systolic.reading) && Number.isFinite(diastolic.reading) &&
        systolic.unit === diastolic.unit) {
      return `${systolic.reading}/${diastolic.reading} ${systolic.unit || ''}`.trim();
    }
  }
  if (typeof value.value === 'string' || typeof value.value === 'number') {
    return `${value.value} ${typeof value.unit === 'string' ? value.unit : ''}`.trim();
  }
  return 'Value not representable in this view';
}

function dateOfMeasurement(value: number): string {
  return Number.isFinite(value) ? new Date(value).toISOString().slice(0, 10) : 'Date unavailable';
}

function Details({ label, rows }: { label: string; rows: Array<{ title: string; description?: string }> }) {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-5">
      <h2 className="text-lg font-semibold text-cyan-200">{label}</h2>
      {rows.length ? (
        <ul className="mt-3 space-y-3">
          {rows.map((r, i) => (
            <li key={`${r.title}-${i}`} className="border-b border-slate-800 pb-3 last:border-none last:pb-0">
              <p className="text-sm font-medium text-slate-100">{r.title}</p>
              {r.description && <p className="mt-1 text-xs text-slate-400">{r.description}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm text-slate-400">No records in this category.</p>}
    </section>
  );
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
      if (payload.syntheticOnly !== true || payload.patientId !== 'demo-ci-patient-001') {
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
                <p className="text-xs uppercase tracking-wider text-cyan-300">Verified synthetic patient</p>
                <h2 className="mt-1 text-2xl font-semibold">{chart.identity.fullName || 'Amina Shah (Synthetic)'}</h2>
                <p className="text-sm text-slate-300">
                  {chart.identity.mrn} · Projection revision {chart.revision}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Source checkpoint: {chart.sourceCheckpoint}
                </p>
              </div>
              <button onClick={closeReview} className="rounded-md border border-slate-600 px-4 py-2 text-sm">End review</button>
            </div>
            <section className="rounded-xl border border-cyan-700/60 bg-slate-900 p-5">
              <h2 className="text-xl font-semibold text-cyan-200">Renal trend — source-verified observations</h2>
              <p className="mt-2 text-sm text-slate-300">
                These are the actual synthetic LABORATORY facts stored in the canonical
                clinical observations collection. Their identifiers, dates, LOINC codes and
                provenance were checked server-side after physician authorization.
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
                      Recorded interpretation: {observation.recordedInterpretation || 'None recorded'} · {observation.status}
                    </p>
                    <p className="mt-2 break-all font-mono text-xs text-slate-400">
                      Evidence: {observation.sourceEvidenceId} · LOINC {observation.loincCode}
                    </p>
                  </article>
                ))}
              </div>
              {!chart.renalObservations?.length && (
                <p className="mt-3 text-sm text-amber-200">
                  Canonical renal evidence was not returned; no trend can be shown.
                </p>
              )}
              <p className="mt-3 text-xs text-slate-400">
                Observed values only. No deterioration threshold, clinical alert,
                diagnosis or treatment recommendation has been validated or generated.
              </p>
            </section>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Details label="Conditions" rows={(chart.activeProblems || []).map(r => ({
                title: r.display || 'Condition', description: r.clinicalStatus,
              }))} />
              <Details label="Allergies" rows={(chart.allergies || []).map(r => ({
                title: r.substance || 'Allergy', description: r.criticality,
              }))} />
              <Details label="Medication Orders" rows={(chart.currentMedications || []).map(r => ({
                title: r.medication || 'Medication',
                description: [r.dosageText, r.status].filter(Boolean).join(' · '),
              }))} />
              <Details label="Observations" rows={(chart.latestVitals || []).map(r => ({
                title: r.display || 'Observation', description: formatMeasurement(r.value),
              }))} />
              <Details label="Diagnostic Reports" rows={(chart.recentResults || []).map(r => ({
                title: r.display || 'Diagnostic report',
                description: [r.conclusion, r.status].filter(Boolean).join(' · '),
              }))} />
              <Details label="Diagnostic Orders" rows={(chart.recentDiagnosticOrders || []).map(r => ({
                title: r.display || 'Order', description: r.status,
              }))} />
              <Details label="Procedures" rows={(chart.recentProcedures || []).map(r => ({
                title: r.display || 'Procedure', description: r.status,
              }))} />
              <Details label="Care Plans" rows={(chart.activeCarePlans || []).map(r => ({
                title: r.title || 'Care plan', description: r.status,
              }))} />
              <Details label="Clinical Documents" rows={(chart.recentDocuments || []).map(r => ({
                title: r.title || 'Clinical document', description: r.status,
              }))} />
            </div>
            <p className="text-sm text-slate-400">
              Counts: {Object.entries(chart.counts).map(([k, v]) => `${k}: ${v}`).join(' · ')}.
              Review is read-only and does not constitute clinician approval.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
