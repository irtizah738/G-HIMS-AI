import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  KnownStatus,
  PatientClinicalKnowledgeStatus,
} from '@/types/clinical-canonical';

export type ClinicalKnowledgeDomain = 'ALLERGIES' | 'MEDICATIONS' | 'PROBLEM_LIST';

export interface ReviewPatientClinicalKnowledgePayload {
  patientId: string;
  encounterId?: string;
  domain: ClinicalKnowledgeDomain;
  status: KnownStatus;
  reason?: string;
}

const ALLOWED_STATUSES: KnownStatus[] = [
  'KNOWN',
  'KNOWN_NONE',
  'UNKNOWN',
  'NOT_ASSESSED',
  'PATIENT_UNABLE_TO_REPORT',
];

function defaultState(
  tenantId: string,
  patientId: string,
  now: number
): PatientClinicalKnowledgeStatus {
  return {
    patientId,
    tenantId,
    allergyStatus: 'NOT_ASSESSED',
    medicationStatus: 'NOT_ASSESSED',
    problemListStatus: 'NOT_ASSESSED',
    updatedAt: now,
  };
}

export class PatientClinicalKnowledgeDomainService {
  private static requiredRoles(domain: ClinicalKnowledgeDomain): string[] {
    switch (domain) {
      case 'ALLERGIES':
        return ['NURSE', 'DOCTOR', 'CONSULTANT', 'PHARMACIST', 'SYSTEM_ADMIN'];
      case 'MEDICATIONS':
        return ['PHARMACIST', 'DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'];
      case 'PROBLEM_LIST':
        return ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'];
    }
  }

  public static async getOrDefault(
    tenantId: string,
    patientId: string,
    now = Date.now()
  ): Promise<PatientClinicalKnowledgeStatus> {
    const existing =
      await DomainStateRepository.getById<PatientClinicalKnowledgeStatus>(
        tenantId,
        'patientClinicalKnowledgeStatus',
        patientId
      );
    return existing || defaultState(tenantId, patientId, now);
  }

  public static withDomainStatus(
    current: PatientClinicalKnowledgeStatus,
    domain: ClinicalKnowledgeDomain,
    status: KnownStatus,
    reviewedAt: number
  ): PatientClinicalKnowledgeStatus {
    const next: PatientClinicalKnowledgeStatus = {
      ...current,
      updatedAt: reviewedAt,
    };

    if (domain === 'ALLERGIES') {
      next.allergyStatus = status;
      next.lastAllergyReviewAt = reviewedAt;
    } else if (domain === 'MEDICATIONS') {
      next.medicationStatus = status;
      next.lastMedicationReconciliationAt = reviewedAt;
    } else {
      next.problemListStatus = status;
      next.lastProblemListReviewAt = reviewedAt;
    }

    return next;
  }

  public static async review(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ReviewPatientClinicalKnowledgePayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: this.requiredRoles(payload.domain),
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Clinical knowledge review authority required.',
        },
      };
    }

    if (
      !payload.patientId ||
      !['ALLERGIES', 'MEDICATIONS', 'PROBLEM_LIST'].includes(payload.domain) ||
      !ALLOWED_STATUSES.includes(payload.status)
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_CLINICAL_KNOWLEDGE_STATUS',
          message: 'Patient, knowledge domain and a valid knowledge status are required.',
        },
      };
    }

    const patient = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'patients',
      payload.patientId
    );
    if (!patient) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_NOT_FOUND',
          message: 'Patient record was not found.',
        },
      };
    }

    if (payload.encounterId) {
      const encounter = await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        payload.encounterId
      );
      if (!encounter || String(encounter.patientId || '') !== payload.patientId) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'ENCOUNTER_PATIENT_MISMATCH',
            message: 'Encounter was not found or belongs to a different patient.',
          },
        };
      }
    }

    const reviewedAt = Date.now();
    const current = await this.getOrDefault(
      context.tenantId,
      payload.patientId,
      reviewedAt
    );
    const next = this.withDomainStatus(
      current,
      payload.domain,
      payload.status,
      reviewedAt
    );

    const tx = await TransactionManager.executeAtomicWrite(
      context,
      commandId,
      idempotencyKey,
      {
        entityType: 'PATIENT_CLINICAL_KNOWLEDGE_STATUS',
        entityId: payload.patientId,
        eventType: 'PATIENT_CLINICAL_KNOWLEDGE_STATUS_UPDATED',
        domainState: next,
        eventPayload: {
          patientId: payload.patientId,
          encounterId: payload.encounterId,
          domain: payload.domain,
          status: payload.status,
          reviewedAt,
          reason: payload.reason,
        },
        auditReason: `Reviewed ${payload.domain} knowledge status as ${payload.status} for patient ${payload.patientId}`,
        outboxTopic: 'g-hims-clinical-events',
      }
    );

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.patientId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: next,
    };
  }
}
