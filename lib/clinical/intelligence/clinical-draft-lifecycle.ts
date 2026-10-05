import crypto from 'node:crypto';
import type {
  ClinicalDraftRevision,
  GovernedClinicalDraft,
} from '@/types/clinical-draft';

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record)
    .sort()
    .map((key) => JSON.stringify(key) + ':' + canonical(record[key]))
    .join(',') + '}';
}

export function clinicalDraftContentHash(title: string, content: string): string {
  return crypto
    .createHash('sha256')
    .update(canonical({ title: title.trim(), content: content.trim() }))
    .digest('hex');
}

function assertRevision(draft: GovernedClinicalDraft, expectedRevisionNumber: number) {
  if (
    !Number.isInteger(expectedRevisionNumber) ||
    expectedRevisionNumber !== draft.currentRevisionNumber
  ) {
    throw new Error(
      `CI10F_STALE_DRAFT_REVISION:expected=${expectedRevisionNumber}:current=${draft.currentRevisionNumber}`
    );
  }
}

function assertMutable(draft: GovernedClinicalDraft) {
  if (draft.status === 'SIGNED') throw new Error('CI10F_SIGNED_DRAFT_IMMUTABLE');
  if (draft.status === 'REJECTED') throw new Error('CI10F_REJECTED_DRAFT_IMMUTABLE');
}

export class ClinicalDraftLifecycle {
  public static reviewAndRevise(
    draft: GovernedClinicalDraft,
    input: {
      expectedRevisionNumber: number;
      title?: string;
      content: string;
      reviewNote?: string;
    },
    actorId: string,
    now = Date.now()
  ): { draft: GovernedClinicalDraft; revision: ClinicalDraftRevision } {
    assertMutable(draft);
    assertRevision(draft, input.expectedRevisionNumber);

    const title = String(input.title || draft.currentTitle).trim();
    const content = String(input.content || '').trim();
    if (!title || !content) throw new Error('CI10F_REVIEW_CONTENT_REQUIRED');

    const contentHash = clinicalDraftContentHash(title, content);
    if (contentHash === draft.currentContentHash) {
      throw new Error(
        'CI10F_CLINICIAN_EDIT_REQUIRED: approval requires an explicit clinician-edited revision.'
      );
    }

    const revisionNumber = draft.currentRevisionNumber + 1;
    const revisionId = `${draft.draftId}_r${revisionNumber}`;
    const revision: ClinicalDraftRevision = {
      revisionId,
      draftId: draft.draftId,
      tenantId: draft.tenantId,
      patientId: draft.patientId,
      encounterId: draft.encounterId,
      revisionNumber,
      source: 'CLINICIAN_EDITED',
      title,
      content,
      contentHash,
      claims: [],
      createdBy: actorId,
      createdAt: now,
      immutable: true,
      evidenceSnapshotId: draft.evidenceSnapshotId,
      evidenceSnapshotHash: draft.evidenceSnapshotHash,
      patient360Revision: draft.patient360Revision,
      patient360SourceCheckpoint: draft.patient360SourceCheckpoint,
    };

    const {
      approvedBy: _approvedBy,
      approvedAt: _approvedAt,
      approvedRevisionNumber: _approvedRevisionNumber,
      approvedContentHash: _approvedContentHash,
      signedBy: _signedBy,
      signedAt: _signedAt,
      signedEvidenceId: _signedEvidenceId,
      signedClinicalDocumentId: _signedClinicalDocumentId,
      rejectedBy: _rejectedBy,
      rejectedAt: _rejectedAt,
      rejectionReason: _rejectionReason,
      ...base
    } = draft;

    return {
      revision,
      draft: {
        ...base,
        status: 'REVIEWED_EDITED',
        currentRevisionId: revisionId,
        currentRevisionNumber: revisionNumber,
        currentTitle: title,
        currentContent: content,
        currentContentHash: contentHash,
        reviewedBy: actorId,
        reviewedAt: now,
        ...(input.reviewNote?.trim() ? { reviewNote: input.reviewNote.trim() } : {}),
        updatedAt: now,
      },
    };
  }

  public static approve(
    draft: GovernedClinicalDraft,
    input: {
      expectedRevisionNumber: number;
      approvalAttestation: boolean;
    },
    actorId: string,
    now = Date.now()
  ): GovernedClinicalDraft {
    assertMutable(draft);
    assertRevision(draft, input.expectedRevisionNumber);

    if (draft.status !== 'REVIEWED_EDITED' || !draft.reviewedBy || !draft.reviewedAt) {
      throw new Error('CI10F_REVIEW_AND_EDIT_REQUIRED_BEFORE_APPROVAL');
    }
    if (input.approvalAttestation !== true) {
      throw new Error('CI10F_EXPLICIT_APPROVAL_ATTESTATION_REQUIRED');
    }

    return {
      ...draft,
      status: 'APPROVED_FOR_SIGNATURE',
      approvedBy: actorId,
      approvedAt: now,
      approvedRevisionNumber: draft.currentRevisionNumber,
      approvedContentHash: draft.currentContentHash,
      updatedAt: now,
    };
  }

  public static sign(
    draft: GovernedClinicalDraft,
    input: {
      expectedRevisionNumber: number;
      signatureAttestation: boolean;
      evidenceId: string;
      clinicalDocumentId: string;
    },
    actorId: string,
    now = Date.now()
  ): GovernedClinicalDraft {
    assertMutable(draft);
    assertRevision(draft, input.expectedRevisionNumber);

    if (
      draft.status !== 'APPROVED_FOR_SIGNATURE' ||
      !draft.approvedBy ||
      !draft.approvedAt ||
      draft.approvedRevisionNumber !== draft.currentRevisionNumber ||
      draft.approvedContentHash !== draft.currentContentHash
    ) {
      throw new Error('CI10F_CURRENT_REVISION_NOT_APPROVED_FOR_SIGNATURE');
    }
    if (input.signatureAttestation !== true) {
      throw new Error('CI10F_EXPLICIT_SIGNATURE_ATTESTATION_REQUIRED');
    }

    return {
      ...draft,
      status: 'SIGNED',
      signedBy: actorId,
      signedAt: now,
      signedEvidenceId: input.evidenceId,
      signedClinicalDocumentId: input.clinicalDocumentId,
      updatedAt: now,
    };
  }

  public static reject(
    draft: GovernedClinicalDraft,
    reason: string,
    actorId: string,
    now = Date.now()
  ): GovernedClinicalDraft {
    assertMutable(draft);
    const normalizedReason = String(reason || '').trim();
    if (normalizedReason.length < 3) throw new Error('CI10F_REJECTION_REASON_REQUIRED');

    return {
      ...draft,
      status: 'REJECTED',
      rejectedBy: actorId,
      rejectedAt: now,
      rejectionReason: normalizedReason,
      updatedAt: now,
    };
  }
}
