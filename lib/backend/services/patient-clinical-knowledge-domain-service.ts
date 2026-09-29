import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  KnownStatus,
  PatientClinicalKnowledgeStatus,
} from '@/types/clinical-canonical';

export type ClinicalKnowledgeDomain = 'ALLERGIES' | 'MEDICATIONS' | 'PROBLEM_LIST';

export interface PatientClinicalKnowledgeDomainRecord {
  tenantId: string;
  patientId: string;
  domain: ClinicalKnowledgeDomain;
  status: KnownStatus;
  reviewedBy: string;
  reviewedAt: number;
  encounterId?: string;
  reason?: string;
}

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

function domainDocumentId(patientId: string, domain: ClinicalKnowledgeDomain): string {
  return `${patientId}__${domain}`;
}

function defaultAggregate(
  tenantId: string,
  patientId: string
): PatientClinicalKnowledgeStatus {
  return {
    patientId,
    tenantId,
    allergyStatus: 'NOT_ASSESSED',
    medicationStatus: 'NOT_ASSESSED',
    problemListStatus: 'NOT_ASSESSED',
    updatedAt: 0,
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

  public static documentId(
    patientId: string,
    domain: ClinicalKnowledgeDomain
  ): string {
    return domainDocumentId(patientId, domain);
  }

  public static buildRecord(input: {
    tenantId: string;
    patientId: string;
    domain: ClinicalKnowledgeDomain;
    status: KnownStatus;
    actorId: string;
    reviewedAt: number;
    encounterId?: string;
    reason?: string;
  }): PatientClinicalKnowledgeDomainRecord {
    return {
      tenantId: input.tenantId,
      patientId: input.patientId,
      domain: input.domain,
      status: input.status,
      reviewedBy: input.actorId,
      reviewedAt: input.reviewedAt,
      encounterId: input.encounterId,
      reason: input.reason,
    };
  }

  public static async getDomainRecord(
    tenantId: string,
    patientId: string,
    domain: ClinicalKnowledgeDomain
  ): Promise<PatientClinicalKnowledgeDomainRecord | null> {
    return DomainStateRepository.getById<PatientClinicalKnowledgeDomainRecord>(
      tenantId,
      'patientClinicalKnowledgeStatus',
      domainDocumentId(patientId, domain)
    );
  }

  public static async getAggregate(
    tenantId: string,
    patientId: string
  ): Promise<PatientClinicalKnowledgeStatus> {
    const records =
      await DomainStateRepository.queryEqual<PatientClinicalKnowledgeDomainRecord>(
        tenantId,
        'patientClinicalKnowledgeStatus',
        'patientId',
        patientId,
        10
      );

    const aggregate = defaultAggregate(tenantId, patientId);
    for (const record of records) {
      aggregate.updatedAt = Math.max(aggregate.updatedAt, record.reviewedAt);
      if (record.domain === 'ALLERGIES') {
        aggregate.allergyStatus = record.status;
        aggregate.lastAllergyReviewAt = record.reviewedAt;
      } else if (record.domain === 'MEDICATIONS') {
        aggregate.medicationStatus = record.status;
        aggregate.lastMedicationReconciliationAt = record.reviewedAt;
      } else if (record.domain === 'PROBLEM_LIST') {
        aggregate.problemListStatus = record.status;
        aggregate.lastProblemListReviewAt = record.reviewedAt;
      }
    }

    return aggregate;
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
    const record = this.buildRecord({
      tenantId: context.tenantId,
      patientId: payload.patientId,
      domain: payload.domain,
      status: payload.status,
      actorId: context.actorId,
      reviewedAt,
      encounterId: payload.encounterId,
      reason: payload.reason,
    });
    const entityId = domainDocumentId(payload.patientId, payload.domain);

    const tx = await TransactionManager.executeAtomicWrite(
      context,
      commandId,
      idempotencyKey,
      {
        entityType: 'PATIENT_CLINICAL_KNOWLEDGE_STATUS',
        entityId,
        eventType: 'PATIENT_CLINICAL_KNOWLEDGE_STATUS_UPDATED',
        domainState: record,
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
      entityId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: record,
    };
  }
}
