import crypto from 'node:crypto';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { ClinicalDraftLifecycle } from '@/lib/clinical/intelligence/clinical-draft-lifecycle';
import { buildCanonicalClinicalDocument } from '@/lib/clinical/canonical-fact-builders';
import type { ClinicalDocument } from '@/types/clinical-canonical';
import type {
  ClinicalDraftRevision,
  ClinicalDraftType,
  GovernedClinicalDraft,
} from '@/types/clinical-draft';
import { CLINICAL_SAFETY_POLICY_VERSION } from '@/types/clinical-intelligence-safety';

export interface ReviewClinicalDraftPayload {
  draftId: string;
  expectedRevisionNumber: number;
  title?: string;
  content: string;
  reviewNote?: string;
}

export interface ApproveClinicalDraftPayload {
  draftId: string;
  expectedRevisionNumber: number;
  approvalAttestation: boolean;
}

export interface SignClinicalDraftPayload {
  draftId: string;
  expectedRevisionNumber: number;
  signatureAttestation: boolean;
}

export interface RejectClinicalDraftPayload {
  draftId: string;
  expectedRevisionNumber: number;
  reason: string;
}

function qualifiedClinicianAuth(context: CommandContext) {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: ['DOCTOR', 'CONSULTANT', 'ATTENDING_PHYSICIAN'],
    requiredPrivilege: 'SIGN_CLINICAL_NOTES',
  });
}

function canonicalDocumentType(
  draftType: ClinicalDraftType
): ClinicalDocument['documentType'] {
  switch (draftType) {
    case 'SOAP':
      return 'SOAP';
    case 'DISCHARGE_SUMMARY':
      return 'DISCHARGE';
    case 'ENCOUNTER_SUMMARY':
      return 'ENCOUNTER_SUMMARY';
    case 'HANDOVER':
      return 'HANDOVER';
    case 'REFERRAL':
      return 'REFERRAL';
    case 'PATIENT_INSTRUCTIONS':
      return 'PATIENT_INSTRUCTIONS';
  }
}

function rejection(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string,
  details?: unknown
): CommandResult {
  return {
    success: false,
    commandId,
    idempotencyKey,
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
}

function mutationError(
  commandId: string,
  idempotencyKey: string,
  error: unknown
): CommandResult {
  if (error instanceof AtomicMutationRejectedError) {
    return rejection(
      commandId,
      idempotencyKey,
      error.code,
      error.message,
      error.details
    );
  }
  const message = error instanceof Error ? error.message : 'Clinical draft mutation failed.';
  const code =
    message.match(/^(CI10F_[A-Z0-9_]+)/)?.[1] ||
    (message.startsWith('DOMAIN_STATE_VERSION_CONFLICT')
      ? 'CI10F_DRAFT_VERSION_CONFLICT'
      : 'CI10F_DRAFT_MUTATION_FAILED');
  return rejection(commandId, idempotencyKey, code, message);
}

export class ClinicalDraftDomainService {
  private static authorize(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string
  ): CommandResult | null {
    const auth = qualifiedClinicianAuth(context);
    if (auth.authorized) return null;
    return rejection(
      commandId,
      idempotencyKey,
      auth.code || 'CI10F_UNAUTHORIZED',
      auth.reason || 'Qualified clinician authority is required for governed clinical drafts.'
    );
  }

  private static async assertDraftAccess(
    context: CommandContext,
    draftId: string
  ): Promise<GovernedClinicalDraft> {
    const draft =
      await DomainStateRepository.getById<GovernedClinicalDraft>(
        context.tenantId,
        'clinicalDrafts',
        draftId
      );
    if (!draft) throw new Error('CI10F_DRAFT_NOT_FOUND');

    const [patient, encounter] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'patients',
        draft.patientId
      ),
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        draft.encounterId
      ),
    ]);
    if (!patient) throw new Error('CI10F_PATIENT_NOT_FOUND');
    if (!encounter || String(encounter.patientId || '') !== draft.patientId) {
      throw new Error('CI10F_ENCOUNTER_PATIENT_MISMATCH');
    }
    assertPatient360PatientAccess(context, patient, encounter);
    return draft;
  }

  public static async reviewAndRevise(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ReviewClinicalDraftPayload
  ): Promise<CommandResult> {
    const denied = this.authorize(context, commandId, idempotencyKey);
    if (denied) return denied;

    try {
      const visibleDraft = await this.assertDraftAccess(context, payload.draftId);
      if (visibleDraft.currentRevisionNumber !== payload.expectedRevisionNumber) {
        return rejection(
          commandId,
          idempotencyKey,
          'CI10F_STALE_DRAFT_REVISION',
          'The draft changed before this review was submitted.'
        );
      }

      const nextRevisionId = `${payload.draftId}_r${payload.expectedRevisionNumber + 1}`;
      const result = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        aggregateType: 'CLINICAL_DRAFT',
        aggregateId: payload.draftId,
        eventType: 'CLINICAL_DRAFT_REVIEWED_AND_EDITED',
        outboxTopic: 'g-hims-clinical-intelligence-events',
        commandId,
        idempotencyKey,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'draft',
            entityType: 'CLINICAL_DRAFT',
            entityId: payload.draftId,
            required: true,
          },
        ],
        prepare: (current) => {
          const draft = current.draft as unknown as GovernedClinicalDraft;
          const next = ClinicalDraftLifecycle.reviewAndRevise(
            draft,
            payload,
            context.actorId
          );
          if (next.revision.revisionId !== nextRevisionId) {
            throw new AtomicMutationRejectedError(
              'CI10F_REVISION_ID_MISMATCH',
              'The next immutable revision ID was not deterministic.'
            );
          }

          return {
            domainState: next.draft,
            additionalStateWrites: [
              {
                entityType: 'CLINICAL_DRAFT_REVISION',
                entityId: next.revision.revisionId,
                domainState: next.revision,
              },
            ],
            eventPayload: {
              draftId: payload.draftId,
              patientId: draft.patientId,
              encounterId: draft.encounterId,
              draftType: draft.draftType,
              previousRevisionNumber: draft.currentRevisionNumber,
              revisionNumber: next.revision.revisionNumber,
              revisionId: next.revision.revisionId,
              contentHash: next.revision.contentHash,
              approvalInvalidated: Boolean(draft.approvedAt),
            },
            auditReason: `Clinician reviewed and edited governed ${draft.draftType} draft`,
            auditMetadata: {
              patientId: draft.patientId,
              encounterId: draft.encounterId,
              revisionId: next.revision.revisionId,
              contentHash: next.revision.contentHash,
            },
            resultData: {
              draft: next.draft,
              revision: next.revision,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.draftId,
        eventId: result.eventId,
        auditId: result.auditId,
        outboxId: result.outboxId,
        data: result.resultData,
      };
    } catch (error) {
      return mutationError(commandId, idempotencyKey, error);
    }
  }

  public static async approve(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ApproveClinicalDraftPayload
  ): Promise<CommandResult> {
    const denied = this.authorize(context, commandId, idempotencyKey);
    if (denied) return denied;

    try {
      await this.assertDraftAccess(context, payload.draftId);
      const result = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        aggregateType: 'CLINICAL_DRAFT',
        aggregateId: payload.draftId,
        eventType: 'CLINICAL_DRAFT_APPROVED_FOR_SIGNATURE',
        outboxTopic: 'g-hims-clinical-intelligence-events',
        commandId,
        idempotencyKey,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'draft',
            entityType: 'CLINICAL_DRAFT',
            entityId: payload.draftId,
            required: true,
          },
        ],
        prepare: (current) => {
          const draft = current.draft as unknown as GovernedClinicalDraft;
          const approved = ClinicalDraftLifecycle.approve(
            draft,
            payload,
            context.actorId
          );
          return {
            domainState: approved,
            eventPayload: {
              draftId: draft.draftId,
              patientId: draft.patientId,
              encounterId: draft.encounterId,
              draftType: draft.draftType,
              revisionNumber: approved.approvedRevisionNumber,
              contentHash: approved.approvedContentHash,
            },
            auditReason: `Explicitly approved clinician-edited ${draft.draftType} draft for signature`,
            auditMetadata: {
              patientId: draft.patientId,
              encounterId: draft.encounterId,
              revisionNumber: approved.approvedRevisionNumber,
              contentHash: approved.approvedContentHash,
            },
            resultData: approved,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.draftId,
        eventId: result.eventId,
        auditId: result.auditId,
        outboxId: result.outboxId,
        data: result.resultData,
      };
    } catch (error) {
      return mutationError(commandId, idempotencyKey, error);
    }
  }

  public static async reject(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RejectClinicalDraftPayload
  ): Promise<CommandResult> {
    const denied = this.authorize(context, commandId, idempotencyKey);
    if (denied) return denied;

    try {
      await this.assertDraftAccess(context, payload.draftId);
      const result = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        aggregateType: 'CLINICAL_DRAFT',
        aggregateId: payload.draftId,
        eventType: 'CLINICAL_DRAFT_REJECTED',
        outboxTopic: 'g-hims-clinical-intelligence-events',
        commandId,
        idempotencyKey,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'draft',
            entityType: 'CLINICAL_DRAFT',
            entityId: payload.draftId,
            required: true,
          },
        ],
        prepare: (current) => {
          const draft = current.draft as unknown as GovernedClinicalDraft;
          if (draft.currentRevisionNumber !== payload.expectedRevisionNumber) {
            throw new AtomicMutationRejectedError(
              'CI10F_STALE_DRAFT_REVISION',
              'The draft changed before rejection was submitted.'
            );
          }
          const rejected = ClinicalDraftLifecycle.reject(
            draft,
            payload.reason,
            context.actorId
          );
          return {
            domainState: rejected,
            eventPayload: {
              draftId: draft.draftId,
              patientId: draft.patientId,
              encounterId: draft.encounterId,
              draftType: draft.draftType,
              revisionNumber: draft.currentRevisionNumber,
            },
            auditReason: `Rejected governed ${draft.draftType} draft`,
            auditMetadata: {
              patientId: draft.patientId,
              encounterId: draft.encounterId,
              reason: payload.reason.trim(),
            },
            resultData: rejected,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.draftId,
        eventId: result.eventId,
        auditId: result.auditId,
        outboxId: result.outboxId,
        data: result.resultData,
      };
    } catch (error) {
      return mutationError(commandId, idempotencyKey, error);
    }
  }

  public static async sign(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: SignClinicalDraftPayload
  ): Promise<CommandResult> {
    const denied = this.authorize(context, commandId, idempotencyKey);
    if (denied) return denied;

    try {
      const visibleDraft = await this.assertDraftAccess(context, payload.draftId);
      const evidenceSnapshot = await ClinicalEvidenceService.getSnapshot(
        context.tenantId,
        visibleDraft.evidenceSnapshotId
      );
      if (
        !evidenceSnapshot ||
        evidenceSnapshot.patientId !== visibleDraft.patientId ||
        evidenceSnapshot.purpose !== 'CLINICAL_DRAFT' ||
        evidenceSnapshot.snapshotHash !== visibleDraft.evidenceSnapshotHash
      ) {
        return rejection(
          commandId,
          idempotencyKey,
          'CI10F_EVIDENCE_SNAPSHOT_INTEGRITY_FAILURE',
          'The immutable evidence snapshot backing this draft cannot be verified.'
        );
      }

      const evidenceId = `ev_note_${crypto.randomUUID()}`;
      const clinicalDocumentId = `doc_${evidenceId}`;
      const signedAt = Date.now();

      const result = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        aggregateType: 'CLINICAL_DRAFT',
        aggregateId: payload.draftId,
        eventType: 'CLINICAL_DRAFT_SIGNED',
        outboxTopic: 'g-hims-clinical-events',
        commandId,
        idempotencyKey,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'draft',
            entityType: 'CLINICAL_DRAFT',
            entityId: payload.draftId,
            required: true,
          },
          {
            key: 'revision',
            entityType: 'CLINICAL_DRAFT_REVISION',
            entityId: visibleDraft.currentRevisionId,
            required: true,
          },
          {
            key: 'encounter',
            entityType: 'ENCOUNTER',
            entityId: visibleDraft.encounterId,
            required: true,
          },
          {
            key: 'patient360',
            entityType: 'PATIENT360_PROJECTION',
            entityId: visibleDraft.patientId,
            required: true,
          },
        ],
        prepare: (current) => {
          const draft = current.draft as unknown as GovernedClinicalDraft;
          const revision = current.revision as unknown as ClinicalDraftRevision;
          const encounter = current.encounter || {};
          const patient360 = current.patient360 || {};

          if (
            draft.safetyGateStatus !== 'PASSED' ||
            !draft.safetyEvaluationId ||
            draft.safetyPolicyVersion !== CLINICAL_SAFETY_POLICY_VERSION
          ) {
            throw new AtomicMutationRejectedError(
              'CI10H_SAFETY_EVALUATION_REQUIRED',
              'This governed draft predates or does not satisfy the current clinical intelligence safety policy. Generate and review a new draft before signing.',
              {
                safetyGateStatus: draft.safetyGateStatus || null,
                safetyEvaluationId: draft.safetyEvaluationId || null,
                draftSafetyPolicyVersion: draft.safetyPolicyVersion || null,
                requiredSafetyPolicyVersion: CLINICAL_SAFETY_POLICY_VERSION,
              }
            );
          }

          if (
            Number(patient360.revision || 0) !== draft.patient360Revision ||
            String(patient360.sourceCheckpoint || '') !==
              draft.patient360SourceCheckpoint
          ) {
            throw new AtomicMutationRejectedError(
              'CI10H_STALE_DRAFT_EVIDENCE',
              'Patient 360 changed after this governed draft was generated. Generate and review a new draft before signing.',
              {
                draftRevision: draft.patient360Revision,
                currentRevision: patient360.revision,
                draftCheckpoint: draft.patient360SourceCheckpoint,
                currentCheckpoint: patient360.sourceCheckpoint,
              }
            );
          }

          if (
            draft.patientId !== visibleDraft.patientId ||
            draft.encounterId !== visibleDraft.encounterId ||
            draft.currentRevisionId !== revision.revisionId ||
            revision.draftId !== draft.draftId ||
            revision.revisionNumber !== draft.currentRevisionNumber ||
            revision.contentHash !== draft.currentContentHash ||
            revision.content !== draft.currentContent ||
            String(encounter.patientId || '') !== draft.patientId
          ) {
            throw new AtomicMutationRejectedError(
              'CI10F_DRAFT_INTEGRITY_FAILURE',
              'Draft, immutable revision, encounter, and content hash are not internally consistent.'
            );
          }

          const signedDraft = ClinicalDraftLifecycle.sign(
            draft,
            {
              expectedRevisionNumber: payload.expectedRevisionNumber,
              signatureAttestation: payload.signatureAttestation,
              evidenceId,
              clinicalDocumentId,
            },
            context.actorId,
            signedAt
          );

          const documentType = canonicalDocumentType(draft.draftType);
          const clinicalDocument = buildCanonicalClinicalDocument({
            tenantId: context.tenantId,
            patientId: draft.patientId,
            encounterId: draft.encounterId,
            sourceEvidenceId: evidenceId,
            actorId: context.actorId,
            category: documentType,
            content: revision.content,
            signedAt,
            sourceDraftId: draft.draftId,
            structuredData: {
              governedDraft: {
                draftId: draft.draftId,
                draftType: draft.draftType,
                revisionId: revision.revisionId,
                revisionNumber: revision.revisionNumber,
                contentHash: revision.contentHash,
                evidenceSnapshotId: draft.evidenceSnapshotId,
                evidenceSnapshotHash: draft.evidenceSnapshotHash,
                generationPolicyVersion: draft.generationPolicyVersion,
                reviewedBy: draft.reviewedBy,
                reviewedAt: draft.reviewedAt,
                approvedBy: draft.approvedBy,
                approvedAt: draft.approvedAt,
              },
            },
          });

          const signedEvidence = {
            evidenceId,
            evidenceType: 'SIGNED_CLINICAL_NOTE',
            tenantId: context.tenantId,
            patientId: draft.patientId,
            encounterId: draft.encounterId,
            category: documentType,
            content: revision.content,
            sourceDraftId: draft.draftId,
            sourceDraftRevisionId: revision.revisionId,
            sourceDraftRevisionNumber: revision.revisionNumber,
            sourceDraftContentHash: revision.contentHash,
            evidenceSnapshotId: draft.evidenceSnapshotId,
            evidenceSnapshotHash: draft.evidenceSnapshotHash,
            signedBy: context.actorId,
            signedAt,
            createdAt: signedAt,
            status: 'FINAL',
          };

          return {
            domainState: signedDraft,
            additionalStateWrites: [
              {
                entityType: 'ENCOUNTER_EVIDENCE',
                entityId: evidenceId,
                domainState: signedEvidence,
              },
              {
                entityType: 'CLINICAL_DOCUMENT',
                entityId: clinicalDocument.clinicalDocumentId,
                domainState: clinicalDocument,
              },
            ],
            eventPayload: {
              draftId: draft.draftId,
              patientId: draft.patientId,
              encounterId: draft.encounterId,
              draftType: draft.draftType,
              revisionId: revision.revisionId,
              revisionNumber: revision.revisionNumber,
              contentHash: revision.contentHash,
              evidenceId,
              clinicalDocumentId: clinicalDocument.clinicalDocumentId,
              evidenceSnapshotId: draft.evidenceSnapshotId,
              evidenceSnapshotHash: draft.evidenceSnapshotHash,
            },
            auditReason: `Signed explicitly approved governed ${draft.draftType} draft`,
            auditMetadata: {
              patientId: draft.patientId,
              encounterId: draft.encounterId,
              revisionId: revision.revisionId,
              revisionNumber: revision.revisionNumber,
              contentHash: revision.contentHash,
              evidenceSnapshotId: draft.evidenceSnapshotId,
            },
            resultData: {
              draft: signedDraft,
              evidenceId,
              clinicalDocumentId: clinicalDocument.clinicalDocumentId,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.draftId,
        eventId: result.eventId,
        auditId: result.auditId,
        outboxId: result.outboxId,
        data: result.resultData,
      };
    } catch (error) {
      return mutationError(commandId, idempotencyKey, error);
    }
  }
}
