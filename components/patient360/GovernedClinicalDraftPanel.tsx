'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSignature,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  approveGovernedClinicalDraft,
  generateGovernedClinicalDraft,
  rejectGovernedClinicalDraft,
  reviewGovernedClinicalDraft,
  signGovernedClinicalDraft,
} from '@/lib/clinical/patient360/patient360-client';
import {
  CLINICAL_DRAFT_TYPES,
  type ClinicalDraftGenerationResponse,
  type ClinicalDraftType,
} from '@/types/clinical-draft';
import type { ClinicalCareSetting } from '@/types/consultant-visibility';

function statusClass(status: string): string {
  if (status === 'SIGNED') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  }
  if (status === 'APPROVED_FOR_SIGNATURE') {
    return 'border-blue-200 bg-blue-50 text-blue-800';
  }
  if (status === 'REJECTED') {
    return 'border-rose-200 bg-rose-50 text-rose-800';
  }
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function draftTypeLabel(type: ClinicalDraftType): string {
  return type
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

export function GovernedClinicalDraftPanel({
  tenantId,
  patientId,
  encounterId,
  careSetting,
  offline,
  currentRevision,
  currentSourceCheckpoint,
  value,
  onChange,
  onAuthoritativeChange,
}: {
  tenantId: string;
  patientId: string;
  encounterId: string;
  careSetting: ClinicalCareSetting;
  offline: boolean;
  currentRevision: number;
  currentSourceCheckpoint: string;
  value: ClinicalDraftGenerationResponse | null;
  onChange: (value: ClinicalDraftGenerationResponse | null) => void;
  onAuthoritativeChange?: () => Promise<void> | void;
}) {
  const [draftType, setDraftType] = useState<ClinicalDraftType>('SOAP');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [approvalAttestation, setApprovalAttestation] = useState(false);
  const [signatureAttestation, setSignatureAttestation] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [busy, setBusy] = useState<
    'GENERATE' | 'REVIEW' | 'APPROVE' | 'SIGN' | 'REJECT' | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const generationKey = useRef<string | null>(null);

  useEffect(() => {
    if (!value) {
      setTitle('');
      setContent('');
      setReviewNote('');
      setApprovalAttestation(false);
      setSignatureAttestation(false);
      setRejectionReason('');
      return;
    }
    setDraftType(value.draft.draftType);
    setTitle(value.draft.currentTitle);
    setContent(value.draft.currentContent);
    setApprovalAttestation(false);
    setSignatureAttestation(false);
  }, [
    value?.draft.draftId,
    value?.draft.currentRevisionNumber,
    value?.draft.status,
  ]);

  const draft = value?.draft || null;
  const stale = Boolean(
    draft &&
      (draft.patient360Revision !== currentRevision ||
        draft.patient360SourceCheckpoint !== currentSourceCheckpoint)
  );
  const editable = Boolean(
    draft && draft.status !== 'SIGNED' && draft.status !== 'REJECTED'
  );
  const changed = Boolean(
    draft &&
      (title.trim() !== draft.currentTitle.trim() ||
        content.trim() !== draft.currentContent.trim())
  );

  const beginNewDraft = () => {
    generationKey.current = null;
    setError(null);
    setMessage(null);
    onChange(null);
  };

  const generate = async () => {
    if (offline) {
      setError(
        'A governed clinical draft requires authoritative server connectivity.'
      );
      return;
    }
    try {
      setBusy('GENERATE');
      setError(null);
      setMessage(null);
      generationKey.current =
        generationKey.current ||
        `ci10g-draft:${patientId}:${encounterId}:${draftType}:${crypto.randomUUID()}`;
      const next = await generateGovernedClinicalDraft(tenantId, {
        patientId,
        encounterId,
        careSetting,
        draftType,
        idempotencyKey: generationKey.current,
      });
      generationKey.current = null;
      onChange(next);
      setMessage(
        'Draft generated from a frozen evidence snapshot. It is not part of the clinical record.'
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Governed clinical draft generation failed.'
      );
    } finally {
      setBusy(null);
    }
  };

  const saveReview = async () => {
    if (!draft || !editable || !changed) return;
    try {
      setBusy('REVIEW');
      setError(null);
      setMessage(null);
      const next = await reviewGovernedClinicalDraft(tenantId, {
        draftId: draft.draftId,
        expectedRevisionNumber: draft.currentRevisionNumber,
        title: title.trim(),
        content: content.trim(),
        reviewNote: reviewNote.trim() || undefined,
      });
      onChange({
        draft: next.draft,
        revision: next.revision || value!.revision,
        evidenceIndex: value!.evidenceIndex,
      });
      setApprovalAttestation(false);
      setSignatureAttestation(false);
      setMessage(
        'Clinician-edited immutable revision saved. Any previous approval is invalidated.'
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Clinician review could not be saved.'
      );
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    if (
      !draft ||
      draft.status !== 'REVIEWED_EDITED' ||
      !approvalAttestation
    ) {
      return;
    }
    try {
      setBusy('APPROVE');
      setError(null);
      setMessage(null);
      const next = await approveGovernedClinicalDraft(tenantId, {
        draftId: draft.draftId,
        expectedRevisionNumber: draft.currentRevisionNumber,
        approvalAttestation: true,
      });
      onChange({
        draft: next.draft,
        revision: value!.revision,
        evidenceIndex: value!.evidenceIndex,
      });
      setApprovalAttestation(false);
      setMessage(
        'Exact current revision approved for signature. Editing it again will invalidate this approval.'
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Draft approval could not be recorded.'
      );
    } finally {
      setBusy(null);
    }
  };

  const sign = async () => {
    if (
      !draft ||
      draft.status !== 'APPROVED_FOR_SIGNATURE' ||
      !signatureAttestation
    ) {
      return;
    }
    try {
      setBusy('SIGN');
      setError(null);
      setMessage(null);
      const next = await signGovernedClinicalDraft(tenantId, {
        draftId: draft.draftId,
        expectedRevisionNumber: draft.currentRevisionNumber,
        signatureAttestation: true,
      });
      onChange({
        draft: next.draft,
        revision: value!.revision,
        evidenceIndex: value!.evidenceIndex,
      });
      setSignatureAttestation(false);
      setMessage(
        `Signed authoritative clinical document ${next.clinicalDocumentId || ''} committed.`
      );
      await onAuthoritativeChange?.();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Draft signature could not be committed.'
      );
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!draft || !editable || rejectionReason.trim().length < 3) return;
    try {
      setBusy('REJECT');
      setError(null);
      setMessage(null);
      const next = await rejectGovernedClinicalDraft(tenantId, {
        draftId: draft.draftId,
        expectedRevisionNumber: draft.currentRevisionNumber,
        reason: rejectionReason.trim(),
      });
      onChange({
        draft: next.draft,
        revision: value!.revision,
        evidenceIndex: value!.evidenceIndex,
      });
      setMessage('Draft rejected and closed. It was not added to the clinical record.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Draft rejection failed.'
      );
    } finally {
      setBusy(null);
    }
  };

  if (!draft) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-950">
          <div className="flex items-center gap-2 font-bold">
            <ShieldCheck className="h-4 w-4" />
            Governed drafting boundary
          </div>
          <p className="mt-2 leading-relaxed">
            AI-generated text is non-authoritative. A qualified clinician must
            edit the generated text, save a new immutable revision, explicitly
            approve that exact revision, and explicitly sign it before G-HIMS
            creates an authoritative clinical document.
          </p>
        </div>

        {offline && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            New clinical drafts are disabled offline. CI-10I will qualify
            governed offline intelligence; CI-10G does not fabricate from stale
            edge data.
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Draft type
            <select
              value={draftType}
              onChange={(event) => {
                setDraftType(event.target.value as ClinicalDraftType);
                generationKey.current = null;
              }}
              disabled={offline || busy !== null}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
            >
              {CLINICAL_DRAFT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {draftTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={offline || busy !== null}
            className="self-end inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy === 'GENERATE' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSignature className="h-4 w-4" />
            )}
            Generate governed draft
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold">{draftTypeLabel(draft.draftType)}</div>
          <div className="mt-1 text-[10px] text-slate-500">
            Draft <span className="font-mono">{draft.draftId}</span> · revision{' '}
            {draft.currentRevisionNumber} · Patient 360 revision{' '}
            {draft.patient360Revision}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase ${statusClass(
              draft.status
            )}`}
          >
            {draft.status.replace(/_/g, ' ')}
          </span>
          {(draft.status === 'SIGNED' || draft.status === 'REJECTED') && (
            <button
              type="button"
              onClick={beginNewDraft}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-slate-700"
            >
              Start another draft
            </button>
          )}
        </div>
      </div>

      {stale && draft.status !== 'SIGNED' && draft.status !== 'REJECTED' && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Patient 360 changed after this draft was generated. Review the new
          chart state before continuing; signing is still server-governed but
          this draft may no longer represent the latest evidence.
        </div>
      )}

      {draft.status === 'SIGNED' && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          This revision is signed and immutable. Authoritative document:{' '}
          <span className="font-mono">
            {draft.signedClinicalDocumentId || 'committed'}
          </span>
        </div>
      )}

      {draft.status === 'REJECTED' && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          Draft rejected: {draft.rejectionReason || 'No reason recorded.'}
        </div>
      )}

      <div className="grid gap-3">
        <label className="grid gap-1 text-xs font-semibold text-slate-700">
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!editable || busy !== null}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50"
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-700">
          Clinical draft text
          <textarea
            rows={16}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            disabled={!editable || busy !== null}
            className="min-h-72 rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed disabled:bg-slate-50"
          />
        </label>
        {editable && (
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Review note
            <input
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              disabled={busy !== null}
              placeholder="Optional note about the clinician review"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </label>
        )}
      </div>

      {editable && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <button
            type="button"
            onClick={() => void saveReview()}
            disabled={offline || busy !== null || !changed || !title.trim() || !content.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {busy === 'REVIEW' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {draft.status === 'APPROVED_FOR_SIGNATURE'
              ? 'Save new revision and invalidate approval'
              : 'Save clinician-edited revision'}
          </button>
          {!changed && draft.status === 'GENERATED_REQUIRES_REVIEW' && (
            <p className="mt-2 text-[10px] text-slate-500">
              Approval is intentionally unavailable until the clinician makes
              and saves an explicit edit.
            </p>
          )}
        </div>
      )}

      {draft.status === 'REVIEWED_EDITED' && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <label className="flex items-start gap-2 text-xs text-blue-950">
            <input
              type="checkbox"
              checked={approvalAttestation}
              onChange={(event) =>
                setApprovalAttestation(event.target.checked)
              }
              disabled={busy !== null}
              className="mt-0.5"
            />
            <span>
              I have reviewed the complete current revision and explicitly
              approve this exact content for clinical signature.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void approve()}
            disabled={offline || busy !== null || !approvalAttestation}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {busy === 'APPROVE' && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Approve current revision
          </button>
        </div>
      )}

      {draft.status === 'APPROVED_FOR_SIGNATURE' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <label className="flex items-start gap-2 text-xs text-emerald-950">
            <input
              type="checkbox"
              checked={signatureAttestation}
              onChange={(event) =>
                setSignatureAttestation(event.target.checked)
              }
              disabled={busy !== null}
              className="mt-0.5"
            />
            <span>
              I am signing this exact approved revision as an authoritative
              clinical document and accept clinical responsibility for its
              contents.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void sign()}
            disabled={offline || busy !== null || !signatureAttestation}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            {busy === 'SIGN' && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Sign authoritative clinical document
          </button>
        </div>
      )}

      {editable && (
        <details className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <summary className="cursor-pointer text-xs font-bold text-rose-800">
            Reject this draft
          </summary>
          <div className="mt-3 grid gap-2">
            <input
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              disabled={busy !== null}
              placeholder="Clinical reason for rejection"
              className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs"
            />
            <button
              type="button"
              onClick={() => void reject()}
              disabled={
                offline || busy !== null || rejectionReason.trim().length < 3
              }
              className="inline-flex w-fit items-center gap-2 rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
              {busy === 'REJECT' && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Reject and close draft
            </button>
          </div>
        </details>
      )}

      {message && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
          {error}
        </div>
      )}

      <details className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <summary className="cursor-pointer text-xs font-bold text-slate-700">
          Draft provenance and safety
        </summary>
        <div className="mt-3 grid gap-1 text-[10px] text-slate-600">
          <div>
            Evidence snapshot:{' '}
            <span className="font-mono">{draft.evidenceSnapshotId}</span>
          </div>
          <div>
            Snapshot hash:{' '}
            <span className="break-all font-mono">
              {draft.evidenceSnapshotHash}
            </span>
          </div>
          <div>
            Current content hash:{' '}
            <span className="break-all font-mono">
              {draft.currentContentHash}
            </span>
          </div>
          <div>
            Generator: {draft.generationProvenance.provider} /{' '}
            {draft.generationProvenance.model}
          </div>
          <div>
            Policy: <span className="font-mono">{draft.generationPolicyVersion}</span>
          </div>
          <div>Direct clinical mutation allowed: no</div>
        </div>
      </details>
    </div>
  );
}
