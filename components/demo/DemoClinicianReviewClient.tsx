'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  Activity, ArrowRight, BookOpenCheck, BrainCircuit,
  ChevronRight, ClipboardCheck, GitBranch, LockKeyhole,
  ShieldCheck, Stethoscope, TrendingUp,
} from 'lucide-react';
import { auth } from '@/lib/firebase/client';
import { HelixisDemoBrandMark } from './HelixisDemoBrandMark';
import { Patient360View } from '@/components/patient360/Patient360View';
import type { Patient360ClinicalView } from '@/lib/clinical/patient360/patient360-client';
import type { Patient360Projection, Patient360EncounterSummary } from '@/types/patient360-projection';
import {
  reconstructDemoClinicalContext,
  type DemoReconstruction,
} from '@/lib/clinical/intelligence/demo-case-reconstruction';

const PHYSICIAN_EMAIL = 'demo.doctor@example.invalid';
type WorkspaceTab = 'intelligence' | 'evidence' | 'review' | 'record';

type RenalEvidence = {
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
};
type VerifiedChart = {
  syntheticOnly: true;
  patientId: string;
  tenantId: string;
  projection: Patient360Projection;
  selectedCareContext: Patient360EncounterSummary | null;
  revision: number;
  sourceCheckpoint: string;
  identity: { fullName?: string; mrn?: string };
  renalObservations?: RenalEvidence[];
};

function dateLabel(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'Date unavailable';
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : 'Date unavailable';
}

/** Values come exclusively from already-authorized canonical LABORATORY documents. */
function renalEvidence(chart: VerifiedChart | null) {
  const labs = chart?.renalObservations || [];
  const creatinine = labs
    .filter(item => item.loincCode === '2160-0' && item.unit === 'mg/dL' && Number.isFinite(item.value))
    .sort((a, b) => a.effectiveAt - b.effectiveAt);
  const potassium = labs.find(item => item.loincCode === '2823-3' && Number.isFinite(item.value));
  const prior = creatinine.length === 2 ? creatinine[0] : undefined;
  const recent = creatinine.length === 2 ? creatinine[1] : undefined;
  const sameDate = prior && recent && prior.effectiveAt === recent.effectiveAt;
  const delta = prior && recent && !sameDate ? recent.value - prior.value : null;
  return { prior, recent, potassium, delta, complete: Boolean(prior && recent && !sameDate && potassium) };
}

function observedBloodPressure(chart: VerifiedChart): string | null {
  const candidate = chart.projection.latestVitals.find(item =>
    item.code === '85354-9' && item.value.valueType === 'COMPONENTS');
  if (!candidate || candidate.value.valueType !== 'COMPONENTS') return null;
  const components = candidate.value.components;
  const byCode = (code: string) => {
    const found = components.find(part => part.code.codings.some(item => item.code === code));
    return found?.value.valueType === 'QUANTITY' ? found.value.quantity : null;
  };
  const systolic = byCode('8480-6');
  const diastolic = byCode('8462-4');
  if (!systolic || !diastolic || systolic.unit !== diastolic.unit ||
      !Number.isFinite(systolic.value) || !Number.isFinite(diastolic.value)) return null;
  return `${systolic.value}/${diastolic.value} ${systolic.unit}`;
}

const PIPELINE = [
  { title: 'Encounter preparation', description: 'Organize history for clinician review' },
  { title: 'Trend intelligence', description: 'Assess observations against approved clinical logic' },
  { title: 'Medication reconciliation', description: 'Review sources and possible discrepancies' },
  { title: 'Governed clinical draft', description: 'Create an editable, explicitly non-authoritative draft' },
];

export function DemoClinicianReviewClient() {
  const [password, setPassword] = useState('');
  const [chart, setChart] = useState<VerifiedChart | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>('intelligence');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [comparison, setComparison] = useState<'fragments' | 'context'>('fragments');
  const [inspected, setInspected] = useState<string[]>([]);

  const reconstruction: DemoReconstruction | null = useMemo(() => {
    if (!chart) return null;
    try {
      return reconstructDemoClinicalContext(chart.projection, chart.renalObservations || []);
    } catch {
      // Never fabricate or partially reconstruct a chart with missing evidence.
      return null;
    }
  }, [chart]);
  const renal = useMemo(() => renalEvidence(chart), [chart]);
  const bp = useMemo(() => chart ? observedBloodPressure(chart) : null, [chart]);

  async function review(event: FormEvent) {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    setChart(null);
    try {
      const session = await signInWithEmailAndPassword(auth, PHYSICIAN_EMAIL, password);
      const token = await session.user.getIdToken();
      const response = await fetch('/api/clinical-intelligence-demo/physician-chart', {
        method: 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('CLINICIAN_PREVIEW_NOT_AUTHORIZED');
      const payload = await response.json() as VerifiedChart;
      if (payload.syntheticOnly !== true || payload.patientId !== 'demo-ci-patient-001' ||
          payload.tenantId !== 'central-metro-hospital' ||
          payload.projection?.patientId !== payload.patientId ||
          payload.projection?.tenantId !== payload.tenantId ||
          payload.projection?.identity?.mrn !== 'CI-DEMO-001' ||
          payload.projection?.timelineReady !== true) {
        throw new Error('DEMO_IDENTITY_MISMATCH');
      }
      setChart(payload);
      setComparison('fragments');
      setInspected([]);
      setTab('intelligence');
    } catch {
      setError('Clinician access or chart loading failed. Verify the DEMO physician account and protected preview permissions.');
      await signOut(auth).catch(() => undefined);
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  async function endReview() {
    setChart(null);
    setComparison('fragments');
    setInspected([]);
    setTab('intelligence');
    setPassword('');
    setError('');
    await signOut(auth).catch(() => undefined);
  }

  const nativeClinicalView: Patient360ClinicalView | null = chart ? {
    tenantId: chart.tenantId,
    patientId: chart.patientId,
    projection: chart.projection,
    timeline: [], // Do not invent a canonical timeline that has not been separately qualified.
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
    <main className="min-h-screen bg-[#0B132B] text-[#F8F9FA]">
      <div className="border-b border-slate-800 bg-[#0B132B]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-8">
          <HelixisDemoBrandMark />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-semibold text-amber-200">
              SYNTHETIC · NOT CLINICALLY VALIDATED
            </span>
            {chart && (
              <button type="button" onClick={() => void endReview()}
                className="rounded-lg border border-slate-600 px-3 py-2 text-slate-300 hover:text-white">
                End review
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-7 px-5 pb-16 pt-9 md:px-8">
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-end">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-800/60 bg-cyan-950/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.12em] text-cyan-200">
              <Activity className="h-3.5 w-3.5" /> Evidence-first clinical workspace
            </div>
            <h1 className="max-w-3xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              See what changed.<br /><span className="text-[#00F5D4]">Follow the evidence.</span>
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
              Helixis Clinical Intelligence is designed to turn longitudinal hospital
              data into explainable, clinician-governed review. The underlying EHR is
              supporting evidence—not the product homepage.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-700 bg-slate-900/80 p-4 text-center">
            {[
              ['01', 'Changes'], ['02', 'Provenance'], ['03', 'Clinical authority'],
            ].map(([number, label]) => (
              <div key={number}>
                <div className="text-xl font-bold text-cyan-300">{number}</div>
                <div className="mt-1 text-[11px] leading-4 text-slate-400">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {!chart ? (
          <form onSubmit={review} className="max-w-xl space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-xl">
            <div className="flex items-center gap-3">
              <LockKeyhole className="h-5 w-5 text-cyan-300" />
              <div>
                <h2 className="text-lg font-semibold">Open verified synthetic evidence</h2>
                <p className="mt-1 text-xs text-slate-400">Vercel SSO plus Firebase physician identity required</p>
              </div>
            </div>
            <label className="block text-sm">
              <span className="text-slate-300">Authorized DEMO physician</span>
              <input value={PHYSICIAN_EMAIL} readOnly autoComplete="username"
                className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-800 p-3 text-slate-200" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-300">Private DEMO-only password</span>
              <input required type="password" value={password} onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-800 p-3 focus:border-cyan-400 focus:outline-none" />
            </label>
            {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
            <button type="submit" disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 disabled:opacity-50">
              {busy ? 'Verifying identity…' : 'Explore Clinical Intelligence'}
              {!busy && <ArrowRight className="h-4 w-4" />}
            </button>
            <p className="text-xs leading-5 text-amber-200">
              For synthetic research and investor qualification only. Nothing here
              constitutes a clinical warning, treatment recommendation, or validated AI output.
            </p>
          </form>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-slate-800 p-2 text-cyan-200"><Stethoscope className="h-5 w-5" /></span>
                <div>
                  <p className="text-sm font-semibold">{chart.identity.fullName || 'Synthetic patient'}</p>
                  <p className="text-xs text-slate-400">
                    {chart.identity.mrn} · Projection rev {chart.projection.revision} · DEMO tenant
                  </p>
                </div>
              </div>
              <p className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                <ShieldCheck className="h-4 w-4" /> Physician identity + project verified
              </p>
            </div>

            <nav aria-label="Clinical Intelligence workspace sections"
              className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
              {([
                ['intelligence', 'Intelligence overview', BrainCircuit],
                ['evidence', 'Source provenance', GitBranch],
                ['review', 'Clinician review checklist', ClipboardCheck],
                ['record', 'Supporting Patient 360', BookOpenCheck],
              ] as const).map(([key, label, Icon]) => (
                <button type="button" key={key} onClick={() => setTab(key)}
                  aria-current={tab === key ? 'page' : undefined}
                  className={tab === key
                    ? 'inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-4 py-2.5 text-xs font-bold text-slate-950'
                    : 'inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:border-cyan-600'}>
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </nav>

            {tab === 'intelligence' && (
              <div className="space-y-6">
                <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6 md:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">
                        The problem / fragmented records to clinical context
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold">A clinician needs the story, not five disconnected record views.</h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                        This simulation separates the same authorized synthetic chart into its
                        original record categories, then reconstructs a chronological context
                        with source IDs and explicit uncertainty. It is not a live third-party EHR integration.
                      </p>
                    </div>
                    {reconstruction && (
                      <span className="rounded-full border border-cyan-800 bg-cyan-950/40 px-3 py-2 text-xs text-cyan-200">
                        {reconstruction.totalFacts} linked synthetic facts · {reconstruction.sourceGroups.length} categories
                      </span>
                    )}
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Compare the same source facts">
                    <button type="button" onClick={() => setComparison('fragments')}
                      aria-pressed={comparison === 'fragments'}
                      className={comparison === 'fragments'
                        ? 'rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-950'
                        : 'rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200'}>
                      Before · source categories
                    </button>
                    <button type="button" onClick={() => setComparison('context')}
                      aria-pressed={comparison === 'context'}
                      className={comparison === 'context'
                        ? 'rounded-lg bg-cyan-300 px-4 py-2 text-sm font-bold text-slate-950'
                        : 'rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200'}>
                      With Helixis · reconstructed context
                    </button>
                  </div>
                  {!reconstruction ? (
                    <p className="mt-5 rounded-lg border border-rose-600/50 p-4 text-sm text-rose-200">
                      Verified source records are incomplete or inconsistent. Context reconstruction is withheld.
                    </p>
                  ) : comparison === 'fragments' ? (
                    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {reconstruction.sourceGroups.map(group => (
                        <div key={group.id} className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
                          <p className="text-sm font-bold">{group.label}</p>
                          <p className="mt-1 text-xs text-slate-400">{group.sourceDescription}</p>
                          <p className="mt-3 text-2xl font-semibold text-cyan-300">{group.facts.length}</p>
                          <p className="mt-1 text-xs text-slate-400">Linked source records</p>
                          <p className="mt-3 text-xs text-slate-300">{group.facts.slice(0, 2).map(item => item.label).join(' · ') || 'No records'}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-5 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
                      <div className="rounded-xl border border-cyan-800/60 bg-slate-950/60 p-5">
                        <h3 className="text-base font-bold text-cyan-200">Chronological evidence chain</h3>
                        <ol className="mt-4 space-y-3">
                          {reconstruction.chronology.slice(0, 12).map(item => (
                            <li key={item.id} className="border-l-2 border-cyan-700 pl-3">
                              <p className="text-xs font-medium text-white">{item.label} · {item.value}</p>
                              <p className="mt-1 text-[11px] text-slate-400">
                                {item.recordedAt ? dateLabel(item.recordedAt) : 'Date not recorded'}
                                {' · '}{item.collection}/{item.evidenceId}
                              </p>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div className="rounded-xl border border-amber-700/50 bg-amber-950/10 p-5">
                        <h3 className="text-base font-bold text-amber-200">What remains uncertain?</h3>
                        <ul className="mt-3 space-y-3">
                          {reconstruction.reviewGaps.map(gap => (
                            <li key={gap.id} className="border-b border-slate-800 pb-3 last:border-none">
                              <p className="text-xs font-semibold text-slate-100">{gap.label}</p>
                              <p className="mt-1 text-xs leading-5 text-slate-400">{gap.explanation}</p>
                            </li>
                          ))}
                        </ul>
                        <button onClick={() => setTab('review')} type="button"
                          className="mt-3 text-xs font-semibold text-cyan-300">
                          Inspect the reviewer checklist →
                        </button>
                      </div>
                    </div>
                  )}
                  {reconstruction && comparison === 'fragments' && (
                    <button type="button" onClick={() => setComparison('context')}
                      className="mt-5 inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950">
                      Reconstruct the clinical context <ArrowRight className="h-4 w-4" />
                    </button>
                  )}
                </section>
                <section className="rounded-2xl border border-slate-700 bg-slate-900 p-6 md:p-8">
                  <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">
                    Prepared encounter evidence / non-authoritative
                  </p>
                  <h2 className="mt-2 text-xl font-semibold">A single, inspectable pre-encounter brief</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Deterministically assembled from verified source facts, not generated by an AI model.
                    Each sentence identifies the canonical records that support it; no diagnosis,
                    deterioration warning, or treatment advice is inferred.
                  </p>
                  {reconstruction?.encounterBrief.length ? (
                    <div className="mt-5 grid gap-3 lg:grid-cols-2">
                      {reconstruction.encounterBrief.map(item => (
                        <article key={item.id} className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                          <p className="text-sm leading-6 text-slate-100">{item.statement}</p>
                          <div className="mt-3 space-y-1 border-t border-slate-800 pt-3">
                            <p className="text-[11px] font-semibold uppercase text-cyan-300">Supporting records</p>
                            {item.evidenceRefs.map(ref => (
                              <p key={ref} className="break-all font-mono text-[11px] text-slate-400">{ref}</p>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-amber-200">No verified context available; an encounter brief is withheld.</p>
                  )}
                </section>
                <section className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
                  <div className="rounded-2xl border border-cyan-800/70 bg-gradient-to-br from-slate-900 via-slate-900 to-cyan-950/50 p-6 md:p-8">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyan-300">
                        <TrendingUp className="h-4 w-4" /> 01 / What changed?
                      </p>
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-200">
                        Interpretation pending clinical review
                      </span>
                    </div>
                    <h2 className="mt-5 text-2xl font-semibold tracking-tight">Renal laboratory measurements</h2>
                    {renal.complete && renal.prior && renal.recent && renal.delta !== null ? (
                      <>
                        <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                          <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-5">
                            <p className="text-xs text-slate-400">Earlier creatinine · {dateLabel(renal.prior.effectiveAt)}</p>
                            <p className="mt-2 text-4xl font-bold">{renal.prior.value.toFixed(1)} <span className="text-base font-normal text-slate-400">mg/dL</span></p>
                          </div>
                          <ArrowRight className="hidden h-6 w-6 text-cyan-300 sm:block" />
                          <div className="rounded-xl border border-cyan-700 bg-cyan-950/30 p-5">
                            <p className="text-xs text-cyan-200">Later creatinine · {dateLabel(renal.recent.effectiveAt)}</p>
                            <p className="mt-2 text-4xl font-bold">{renal.recent.value.toFixed(1)} <span className="text-base font-normal text-slate-300">mg/dL</span></p>
                          </div>
                        </div>
                        <p className="mt-4 text-sm font-medium text-slate-200">
                          Observed change: {renal.delta > 0 ? '+' : ''}{renal.delta.toFixed(1)} mg/dL
                          <span className="ml-2 font-normal text-slate-400">(arithmetic difference, not a deterioration warning)</span>
                        </p>
                      </>
                    ) : (
                      <p className="mt-5 rounded-xl border border-amber-700/50 bg-amber-950/20 p-4 text-sm text-amber-200">
                        Verified comparable source values are incomplete. No change is calculated.
                      </p>
                    )}
                    <button type="button" onClick={() => setTab('evidence')}
                      className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200">
                      Inspect original source records <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Additional evidence</p>
                      <p className="mt-4 text-sm text-slate-300">Potassium</p>
                      <p className="mt-1 text-3xl font-bold">
                        {renal.potassium ? renal.potassium.value : '—'}
                        <span className="ml-2 text-base font-normal text-slate-400">{renal.potassium?.unit || ''}</span>
                      </p>
                      <p className="mt-2 text-xs text-slate-400">
                        {renal.potassium ? dateLabel(renal.potassium.effectiveAt) : 'No verified observation'}
                      </p>
                      <div className="mt-5 border-t border-slate-700 pt-4">
                        <p className="text-sm text-slate-300">Latest recorded blood pressure</p>
                        <p className="mt-1 text-2xl font-semibold">{bp || 'Not available'}</p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-amber-600/40 bg-amber-950/20 p-5">
                      <p className="flex items-center gap-2 text-sm font-bold text-amber-200">
                        <ClipboardCheck className="h-4 w-4" /> Clinician review required
                      </p>
                      <p className="mt-2 text-xs leading-5 text-amber-100/80">
                        These facts are real synthetic source records; their clinical significance
                        has not been adjudicated. No escalation thresholds or alert language
                        have been approved for this demo.
                      </p>
                    </div>
                  </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
                  <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
                    <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">02 / Why can we trust the source?</p>
                    <h2 className="mt-3 text-xl font-semibold">Evidence, not a black box</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-300">
                      The source measurements, laboratory identifiers, timestamps and
                      Patient 360 revision remain inspectable. The event-driven Helixis Health Platform
                      is the underlying infrastructure—not something a hospital must replace its EHR to adopt.
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-slate-300">
                      <span className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2">Patient 360 v{chart.projection.projectionVersion}</span>
                      <span className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2">Revision {chart.projection.revision}</span>
                      <span className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2">{chart.renalObservations?.length || 0} source observations</span>
                    </div>
                    <button type="button" onClick={() => setTab('evidence')}
                      className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-cyan-300">
                      View provenance chain <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
                    <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">03 / Clinical Intelligence workflow</p>
                    <h2 className="mt-3 text-xl font-semibold">From evidence to governed review</h2>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {PIPELINE.map((step, i) => (
                        <div key={step.title} className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-100">{String(i + 1).padStart(2, '0')} · {step.title}</p>
                            <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                          </div>
                          <p className="mt-2 text-xs leading-5 text-slate-400">{step.description}</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 text-xs text-amber-200">
                      Workflow preview only — live AI generation, approval and signing remain disabled
                      until clinically and technically qualified.
                    </p>
                  </div>
                </section>
                <button type="button" onClick={() => setTab('record')}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-900 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-cyan-500">
                  <BookOpenCheck className="h-4 w-4 text-cyan-300" /> Open the supporting Helixis AI Patient 360
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}

            {tab === 'evidence' && (
              <section className="space-y-5 rounded-2xl border border-slate-700 bg-slate-900 p-5 md:p-7">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">Source provenance</p>
                  <h2 className="mt-2 text-2xl font-semibold">Verify every displayed laboratory fact</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                    Data below was fetched from three canonical Firestore observation
                    documents after physician authentication and exact-project
                    verification. Nothing is an AI-generated clinical conclusion.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {(chart.renalObservations || []).map(item => (
                    <article key={item.observationId} className="rounded-xl border border-slate-700 bg-slate-950/60 p-5">
                      <p className="text-xs font-bold uppercase tracking-wider text-cyan-300">{item.display}</p>
                      <p className="mt-3 text-3xl font-bold">{item.value} <span className="text-sm font-normal text-slate-400">{item.unit}</span></p>
                      <p className="mt-2 text-xs text-slate-400">{dateLabel(item.effectiveAt)} · {item.status}</p>
                      <p className="mt-4 text-xs font-semibold text-slate-300">Recorded interpretation</p>
                      <p className="mt-1 text-xs text-slate-400">{item.recordedInterpretation || 'None recorded'}</p>
                      <div className="mt-4 border-t border-slate-700 pt-4">
                        <p className="break-all font-mono text-[11px] text-slate-300">Evidence: {item.sourceEvidenceId}</p>
                        <p className="mt-1 font-mono text-[11px] text-slate-400">LOINC {item.loincCode} · {item.sourceType}</p>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/70 p-5">
                  <GitBranch className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
                  <div>
                    <p className="text-sm font-semibold">Canonical Patient 360 checkpoint</p>
                    <p className="mt-2 break-all font-mono text-xs text-slate-400">{chart.projection.sourceCheckpoint}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      Project g-hims-ci-demo · Tenant {chart.tenantId} · Synthetic source data only
                    </p>
                  </div>
                </div>
                <button type="button" onClick={() => setTab('intelligence')}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300">
                  <ArrowRight className="h-4 w-4 rotate-180" /> Back to Intelligence overview
                </button>
              </section>
            )}

            {tab === 'review' && (
              <section className="space-y-5 rounded-2xl border border-slate-700 bg-slate-900 p-6">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">Governance / evaluation</p>
                  <h2 className="mt-2 text-2xl font-semibold">Clinician evidence-review checklist</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                    A review exercise, not an authoritative clinical decision. Marks are held
                    only in this browser view and are never written to Firestore or counted as
                    external clinical validation.
                  </p>
                </div>
                {!reconstruction ? (
                  <p className="text-sm text-rose-200">Source verification incomplete. Review is unavailable.</p>
                ) : (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      {[
                        { id: 'source', title: 'Inspect dated source records', description: 'Check lab source IDs, units, dates, and LOINC codes.' },
                        { id: 'context', title: 'Reconstruct the chronology', description: 'Compare the prior visit, prescriptions, observations, and current encounter.' },
                        { id: 'uncertainty', title: 'Inspect uncertainty and missing information', description: 'Confirm gaps are not falsely presented as normal clinical findings.' },
                        { id: 'governance', title: 'Check clinical authority boundary', description: 'No warnings, treatment recommendations, prescriptions, or signed notes are issued.' },
                      ].map(task => (
                        <label key={task.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
                          <input type="checkbox" checked={inspected.includes(task.id)}
                            onChange={e => setInspected(current =>
                              e.target.checked ? [...current, task.id] : current.filter(id => id !== task.id))}
                            className="mt-1 h-4 w-4 accent-cyan-400" />
                          <span>
                            <span className="block text-sm font-semibold">{task.title}</span>
                            <span className="mt-1 block text-xs leading-5 text-slate-400">{task.description}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
                      <p className="text-sm font-semibold">Inspected in this browser: {inspected.length}/4</p>
                      <p className="mt-2 text-xs text-amber-200">
                        {inspected.length === 4
                          ? 'All review-exercise steps inspected. This is not clinician sign-off or clinical study evidence.'
                          : 'The review exercise is incomplete; no approval has been recorded.'}
                      </p>
                    </div>
                    <button onClick={() => { setInspected([]); setTab('intelligence'); }} type="button"
                      className="rounded-lg border border-slate-600 px-4 py-2 text-xs font-semibold">
                      Reset exercise and return to the intelligence overview
                    </button>
                  </>
                )}
              </section>
            )}

            {tab === 'record' && nativeClinicalView && (
              <section className="space-y-4">
                <div className="rounded-xl border border-slate-700 bg-slate-900 p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-cyan-300">Supporting hospital record</p>
                  <h2 className="mt-2 text-xl font-semibold">Native Helixis AI Patient 360</h2>
                  <p className="mt-2 text-sm text-slate-300">
                    This is the actual Patient 360 component from the Helixis AI codebase,
                    using the same authenticated synthetic projection. Read-only authority
                    applies; clinical commands, AI generation and note signing remain unavailable.
                  </p>
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-700">
                  <Patient360View tenantId={chart.tenantId} patientId={chart.patientId}
                    demoReadOnlyView={nativeClinicalView} />
                </div>
              </section>
            )}
          </>
        )}
        <footer className="border-t border-slate-800 pt-5 text-xs leading-5 text-slate-500">
          Helixis Clinical Intelligence · Synthetic, isolated DEMO · Clinicians retain authority.
          <span className="ml-2">No real patient data or validated clinical advice is presented.</span>
        </footer>
      </div>
    </main>
  );
}
