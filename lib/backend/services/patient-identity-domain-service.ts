/**
 * G-HIMS Patient Identity Safety Service
 *
 * Patient registration is owned exclusively by server/runtime/registration-orchestrator.
 * Patient merge is owned exclusively by PatientMergeDomainService.
 *
 * This service intentionally contains no process-local patient registry, no patient
 * creation logic and no merge implementation. It owns only the explicit high-risk
 * patient-identity confirmation evidence used by governed clinical workflows.
 */

import type { CommandContext, CommandResult } from '../types';
import { TransactionManager } from '../transactions/transaction-manager';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { PatientMPI } from '@/types/mpi';

export interface ConfirmPatientIdentityPayload {
  patientId: string;
  expectedMrn: string;
  expectedFullName: string;
  expectedDob: string;
  encounterId?: string;
  actionType:
    | 'PRESCRIBE_HIGH_ALERT_MEDICATION'
    | 'ORDER_BLOOD_TRANSFUSION'
    | 'SCHEDULE_SURGERY'
    | 'STAT_LAB_OVERRIDE';
  actionSummary: string;
  clinicianVerificationSignature: string;
}

export class PatientIdentityDomainService {
  /**
   * Explicit two-identifier verification evidence for high-risk actions.
   *
   * This does not authorize the high-risk action itself. The downstream command
   * still evaluates role, clinical privilege, patient/encounter scope and other
   * domain invariants.
   */
  public static async confirmPatientIdentity(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ConfirmPatientIdentityPayload
  ): Promise<CommandResult> {
    const patient = await DomainStateRepository.getById<PatientMPI>(
      context.tenantId,
      'patients',
      payload.patientId
    );

    if (!patient || patient.tenantId !== context.tenantId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_NOT_FOUND',
          message: 'Target patient not found in tenant.',
        },
      };
    }

    if (patient.status === 'REMOVED') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_REMOVED_FROM_ACTIVE_MPI',
          message: 'Removed patient identity cannot be used for new clinical identity confirmation.',
        },
      };
    }

    if (patient.status === 'MERGED') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'STALE_MERGED_PATIENT_CONTEXT',
          message:
            `Patient record has been merged into '${patient.mergedIntoPatientId}'. Please switch to the authoritative primary record.`,
        },
      };
    }

    if (payload.encounterId) {
      const encounter = await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        payload.encounterId
      );
      if (
        !encounter ||
        String(encounter.patientId || '') !== patient.id
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'ENCOUNTER_PATIENT_MISMATCH',
            message:
              'Identity confirmation encounter does not belong to the supplied patient.',
          },
        };
      }
    }

    const mrnMatches =
      patient.mrn.trim().toUpperCase() ===
      payload.expectedMrn.trim().toUpperCase();
    const expectedName = payload.expectedFullName.trim().toLowerCase();
    const actualName = patient.fullName.trim().toLowerCase();
    const nameMatches =
      actualName === expectedName ||
      (expectedName.length >= 3 && actualName.includes(expectedName));
    const dobMatches =
      Boolean(payload.expectedDob) &&
      patient.dateOfBirth === payload.expectedDob;

    if (!mrnMatches || !nameMatches || !dobMatches) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_IDENTITY_VERIFICATION_MISMATCH',
          message:
            'Critical safety check failed: supplied identifiers do not match the authoritative patient record.',
          details: {
            mrnMatches,
            nameMatches,
            dobMatches,
          },
        },
      };
    }

    const confirmedAt = Date.now();
    const confirmationId =
      `identity_confirm_${payload.patientId}_${crypto.randomUUID()}`;

    const evidence = {
      confirmationId,
      tenantId: context.tenantId,
      patientId: patient.id,
      encounterId: payload.encounterId,
      actionType: payload.actionType,
      actionSummary: payload.actionSummary.trim(),
      verificationSignature: payload.clinicianVerificationSignature.trim(),
      confirmedBy: context.actorId,
      confirmedAt,
      immutable: true,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'PATIENT_IDENTITY_CONFIRMATION',
      aggregateId: confirmationId,
      eventType: 'PATIENT_IDENTITY_EXPLICITLY_CONFIRMED',
      eventPayload: {
        confirmationId,
        patientId: patient.id,
        encounterId: payload.encounterId,
        actionType: payload.actionType,
        confirmedAt,
      },
      auditAction: 'PATIENT_IDENTITY_CONFIRMED',
      auditResourceType: 'PATIENT',
      auditResourceId: patient.id,
      auditReason:
        `Explicit identity confirmation recorded before ${payload.actionType}.`,
      outboxTopic: 'g-hims-patient-safety-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: evidence,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: confirmationId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: evidence,
    };
  }

  /**
   * Generation-1 synchronous process-memory validation is intentionally retired.
   * Callers must resolve patient/encounter state through an authoritative async
   * repository or CommandBus domain service.
   */
  public static validatePatientContext(): {
    valid: false;
    reason: string;
  } {
    return {
      valid: false,
      reason:
        'AUTHORITATIVE_CONTEXT_REQUIRED: process-local patient validation is retired.',
    };
  }
}
