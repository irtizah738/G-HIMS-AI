'use client';

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { AuthGuard } from '@/components/auth/auth-guard';
import { AuthClient } from '@/lib/auth/auth-client';
import type { ValidationCaseView, ValidationJudgment } from '@/types/clinical-validation-workspace';

const ATTESTATION = 'I confirm this is my independent clinical assessment of synthetic evidence.';

interface WorkspaceResponse {
  success: boolean;
  role?: 'COORDINATOR' | 'REVIEWER';
  study?: { id: string; clinicalPolicyApproved: boolean };
  cases?: ValidationCaseView[];
  error?: { code?: string };
}

function ClinicalValidationWorkspace({ tenantId }: { tenantId: string }) {
  const [cases, setCases] = useState<ValidationCaseView[]>([]);
  const [role, setRole] = useState<'COORDINATOR' | 'REVIEWER' | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [reviewerAUid, setReviewerAUid] = useState('');
  const [reviewerBUid, setReviewerBUid] = useState('');
  const [adjudicatorUid, setAdjudicatorUid] = useState('');
  const [judgment, setJudgment] = useState<ValidationJudgment>('INSUFFICIENT_EVIDENCE');
  const [confidence, setConfidence] = useState<'LOW'|'MEDIUM'|'HIGH'>('LOW');
  const [refs, setRefs] = useState<string[]>([]);
  const [rationale, setRationale] = useState('');
  const [attested, setAttested] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const endpoint = '/api/clinical/validation?tenantId=' + encodeURIComponent(tenantId);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await AuthClient.authorizedFetch(endpoint, { method: 'GET', cache: 'no-store' }, tenantId);
      const data = await response.json() as WorkspaceResponse;
      if (!response.ok || !data.success) throw new Error(data.error?.code || 'Unable to load validation cases.');
      setCases(data.cases || []);
      setRole(data.role || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load cases.');
    } finally {
      setLoading(false);
    }
  }, [endpoint, tenantId]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => cases.find(item => item.caseId === selectedId), [cases, selectedId]);

  const submit = async (data: Record<string, unknown>) => {
    setSubmitting(true); setError(''); setStatus('');
    try {
      const response = await AuthClient.authorizedFetch(endpoint, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }, tenantId);
      const payload = await response.json() as WorkspaceResponse;
      if (!response.ok || !payload.success) throw new Error(payload.error?.code || 'Request was rejected');
      setStatus('Recorded successfully. Independent submissions are immutable and cannot be edited.');
      setRationale(''); setRefs([]); setAttested(false); setSelectedId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = Boolean(selected && selected.role !== 'COORDINATOR' &&
    selected.status === 'PENDING' && refs.length > 0 && rationale.trim().length >= 20 && attested);

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
        <p className="text-sm font-bold">Synthetic-only clinical validation — not approved for patient care</p>
        <p className="mt-1 text-xs">
          TEST emulator only. Clinical policy and institutional sign-off are pending.
          Cases contain no real patients. Neither model predictions nor other primary
          reviewers' assessments are displayed before independent submission.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Clinical Validation &amp; Review</h1>
          <p className="text-xs text-slate-600">Study renal-ciqp-synthetic-v1 · {role || 'Awaiting authorization'}</p>
        </div>
        <button type="button" disabled={loading || submitting} onClick={() => void load()}
          className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">Refresh assigned cases</button>
      </div>
      {error && <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>}
      {status && <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{status}</div>}
      {loading && <p className="text-sm text-slate-600">Loading authorized study data…</p>}
      {role === 'COORDINATOR' && (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Initialize fixed synthetic study</h2>
          <p className="mb-4 mt-1 text-sm text-slate-600">
            Enter three distinct Firebase staff UIDs with active tenant accounts.
            Both primary reviewers must be credentialed clinicians with the explicit
            CLINICAL_VALIDATION_REVIEW permission; the adjudicator is separate.
            This creates only three curated pilot cases. It never imports patient data.
          </p>
          <form className="grid gap-3 md:grid-cols-3" onSubmit={event => {
            event.preventDefault();
            void submit({ action: 'INITIALIZE_STUDY', reviewerAUid, reviewerBUid, adjudicatorUid });
          }}>
            {([
              ['Reviewer A UID', reviewerAUid, setReviewerAUid],
              ['Reviewer B UID', reviewerBUid, setReviewerBUid],
              ['Adjudicator UID', adjudicatorUid, setAdjudicatorUid],
            ] as const).map(([label, value, setter]) => (
              <label key={label} className="block text-xs font-semibold">{label}
                <input type="text" value={value} onChange={e => setter(e.target.value.trim())}
                  required minLength={8} maxLength={128}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
            ))}
            <div className="md:col-span-3">
              <button type="submit" disabled={submitting || cases.length > 0}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                Create synthetic case assignments
              </button>
            </div>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Study assignments and review results are server-side and event-audited.
            Coordinators cannot view confidential primary opinions from this screen.
          </p>
        </section>
      )}
      {role && (
        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Assigned cases</h2>
          {cases.length === 0 ? <p className="mt-3 text-sm text-slate-600">No synthetic cases have been assigned.</p> : (
            <div className="mt-3 space-y-2">
              {cases.map(item => (
                <button key={item.caseId} type="button" onClick={() => {
                  setSelectedId(item.caseId); setRefs([]); setRationale('');
                  setConfidence('LOW'); setJudgment('INSUFFICIENT_EVIDENCE'); setAttested(false); setStatus('');
                }} aria-pressed={item.caseId === selectedId}
                  className={'w-full rounded-xl border p-3 text-left text-sm ' +
                    (selectedId === item.caseId ? 'border-blue-500 bg-blue-50' : 'bg-slate-50 hover:bg-slate-100')}>
                  <span className="font-semibold">{item.caseId}</span>
                  <span className="ml-3 text-xs text-slate-600">{item.role} · {item.status.replaceAll('_',' ')}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {selected && (
        <section className="space-y-4 rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">{selected.caseId}</h2>
          <p className="text-sm">{selected.question}</p>
          <h3 className="text-sm font-bold">Frozen synthetic evidence</h3>
          <div className="space-y-2">
            {selected.evidence.map(item => (
              <label key={item.evidenceId} className="flex gap-3 rounded-lg border bg-slate-50 p-3">
                <input type="checkbox" checked={refs.includes(item.evidenceId)}
                  disabled={selected.role === 'COORDINATOR' || selected.status !== 'PENDING'}
                  onChange={e => setRefs(current => e.target.checked
                    ? [...current, item.evidenceId]
                    : current.filter(id => id !== item.evidenceId))}
                  aria-label={'Cite ' + item.evidenceId}/>
                <span>
                  <strong className="text-xs">{item.label} · {item.evidenceId}</strong>
                  <p className="text-sm">{item.fact}</p>
                </span>
              </label>
            ))}
          </div>
          {selected.role === 'ADJUDICATOR' && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <h3 className="text-sm font-bold">Independent primary reviews</h3>
              {!selected.primaryAssessments ? <p className="text-sm">Hidden until both primary assessments are locked.</p> :
                selected.primaryAssessments.map((a, index) => (
                  <article key={index} className="mt-2 rounded-lg bg-white p-3 text-sm">
                    <strong>Primary reviewer {index + 1}: {a.judgment}</strong>
                    <p className="text-xs text-slate-700">{a.rationale}</p>
                  </article>
                ))}
            </div>
          )}
          {selected.myAssessment && <div className="rounded-lg border bg-slate-50 p-3 text-sm">
            <strong>Submitted assessment: {selected.myAssessment.judgment}</strong>
            <p>{selected.myAssessment.rationale}</p>
            <p className="mt-1 text-xs">Immutable; submitted without model predictions.</p>
          </div>}
          {selected.role !== 'COORDINATOR' && selected.status === 'PENDING' && (
            <form className="space-y-3" onSubmit={e => {
              e.preventDefault();
              if (!canSubmit) return;
              void submit({ action: 'SUBMIT_ASSESSMENT', caseId: selected.caseId, judgment,
                confidence, evidenceRefs: refs, rationale, attestation: ATTESTATION });
            }}>
              <label className="block text-xs font-semibold">
                Clinical assessment (independent)
                <select value={judgment} onChange={e => setJudgment(e.target.value as ValidationJudgment)}
                  className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm">
                  <option value="YES">Clinically significant deterioration may require review</option>
                  <option value="NO">No represented renal-deterioration signal</option>
                  <option value="INSUFFICIENT_EVIDENCE">Insufficient evidence to determine</option>
                </select>
              </label>
              <label className="block text-xs font-semibold">Confidence
                <select value={confidence} onChange={e => setConfidence(e.target.value as 'LOW'|'MEDIUM'|'HIGH')}
                  className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm">
                  <option>LOW</option><option>MEDIUM</option><option>HIGH</option>
                </select>
              </label>
              <label className="block text-xs font-semibold">Clinical reasoning (20–2500 characters)
                <textarea required minLength={20} maxLength={2500} value={rationale}
                  onChange={e => setRationale(e.target.value)} rows={4}
                  className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm" />
              </label>
              <label className="flex gap-2 text-sm">
                <input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)}/>
                {ATTESTATION}
              </label>
              <button type="submit" disabled={!canSubmit || submitting ||
                (selected.role === 'ADJUDICATOR' && !selected.primaryAssessments)}
                className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                Submit immutable {selected.role === 'ADJUDICATOR' ? 'adjudication' : 'independent review'}
              </button>
            </form>
          )}
        </section>
      )}
    </section>
  );
}

export default function ClinicalValidationPage({ params }: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = use(params);
  return <AuthGuard requiredTenantId={tenantId}>
    <ClinicalValidationWorkspace tenantId={tenantId} />
  </AuthGuard>;
}
