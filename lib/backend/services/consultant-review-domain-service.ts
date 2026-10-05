import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import type { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { ConsultantVisibilityService } from '@/lib/clinical/intelligence/consultant-visibility-service';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { normalizeCareSetting } from '@/lib/clinical/patient360/care-context';
import type { ConsultantReviewCheckpoint } from '@/types/consultant-visibility';

export interface RecordConsultantPatientReviewPayload {
  patientId: string;
  encounterId: string;
  careSetting: 'OPD' | 'IPD' | 'EMERGENCY' | 'TELEHEALTH';
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  reviewedChangeIds?: string[];
  note?: string;
}

export class ConsultantReviewDomainService {
  public static async record(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordConsultantPatientReviewPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'ATTENDING_PHYSICIAN', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Consultant review authority required.',
        },
      };
    }

    const [patient, encounter, projection] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'patients',
        payload.patientId
      ),
      DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        payload.encounterId
      ),
      Patient360ProjectionService.getProjection(context.tenantId, payload.patientId),
    ]);

    if (!patient) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'PATIENT_NOT_FOUND', message: 'Patient does not exist.' },
      };
    }
    if (!encounter || String(encounter.patientId || '') !== payload.patientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_PATIENT_MISMATCH',
          message: 'Consultant review encounter does not belong to the patient.',
        },
      };
    }

    assertPatient360PatientAccess(context, patient, encounter);

    if (!projection) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT360_PROJECTION_NOT_READY',
          message: 'Patient 360 must be current before a consultant review checkpoint can be recorded.',
        },
      };
    }

    if (
      projection.revision !== payload.patient360Revision ||
      projection.sourceCheckpoint !== payload.patient360SourceCheckpoint
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'CONSULTANT_REVIEW_STALE',
          message: 'Patient 360 changed before the review checkpoint was committed. Reload and review the latest state.',
          details: {
            expectedRevision: projection.revision,
            expectedSourceCheckpoint: projection.sourceCheckpoint,
          },
        },
      };
    }

    const careSetting = normalizeCareSetting(
      payload.careSetting || encounter.encounterType || encounter.type
    );
    const expectedCareSetting = normalizeCareSetting(
      encounter.encounterType || encounter.type
    );
    if (careSetting !== expectedCareSetting) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'CONSULTANT_REVIEW_CARE_CONTEXT_MISMATCH',
          message: 'Requested consultant care setting does not match the encounter.',
        },
      };
    }

    const now = Date.now();
    const checkpointId = ConsultantVisibilityService.checkpointId(
      context.actorId,
      payload.patientId,
      payload.encounterId
    );
    const checkpoint: ConsultantReviewCheckpoint = {
      checkpointId,
      tenantId: context.tenantId,
      consultantId: context.actorId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      careSetting,
      reviewedAt: now,
      patient360Revision: projection.revision,
      patient360SourceCheckpoint: projection.sourceCheckpoint,
      lastEventId: projection.lastEventId,
      lastEventRecordedAt: projection.lastEventRecordedAt,
      reviewedChangeIds: Array.from(new Set(payload.reviewedChangeIds || [])).slice(0, 500),
      note: payload.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CONSULTANT',
      aggregateType: 'CONSULTANT_REVIEW_CHECKPOINT',
      aggregateId: checkpointId,
      eventType: 'CONSULTANT_PATIENT_REVIEW_RECORDED',
      eventPayload: {
        checkpointId,
        consultantId: context.actorId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        careSetting,
        patient360Revision: projection.revision,
        patient360SourceCheckpoint: projection.sourceCheckpoint,
        reviewedChangeIds: checkpoint.reviewedChangeIds,
      },
      auditAction: 'RECORD_CONSULTANT_PATIENT_REVIEW',
      auditResourceType: 'PATIENT360',
      auditResourceId: payload.patientId,
      auditReason: `Consultant ${context.actorId} reviewed Patient 360 revision ${projection.revision} for encounter ${payload.encounterId}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: checkpoint,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: checkpointId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: checkpoint,
    };
  }
}
