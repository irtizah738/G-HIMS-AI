/**
 * G-HIMS durable patient merge service.
 * Merge is a governed compensating identity operation: the secondary record is
 * retained and marked MERGED; history is never deleted.
 */
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { PatientMPI } from '@/types/mpi';

export interface DurablePatientMergePayload {
  primaryPatientId: string;
  secondaryPatientId: string;
  mergeReason: string;
  overrideDemographicConflict?: boolean;
}

export class PatientMergeDomainService {
  public static async merge(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: DurablePatientMergePayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'ADMINISTRATOR',
        'SYSTEM_ADMIN',
        'SUPER_ADMIN',
        'MEDICAL_DIRECTOR',
        'REGISTRAR',
        'RECEPTIONIST',
        'HIM_OFFICER',
        'RECORDS_OFFICER',
        'PATIENT_SAFETY_OFFICER',
        'QUALITY_MANAGER',
        'DOCTOR',
        'CONSULTANT',
      ],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED_PATIENT_MERGE',
          message: auth.reason || 'Patient merge requires elevated identity-governance authority.',
        },
      };
    }

    if (!payload.primaryPatientId || !payload.secondaryPatientId || !payload.mergeReason?.trim()) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'INVALID_MERGE_REQUEST', message: 'Primary, secondary and merge reason are required.' },
      };
    }

    if (payload.primaryPatientId === payload.secondaryPatientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'INVALID_MERGE_SELF', message: 'A patient record cannot be merged into itself.' },
      };
    }

    const [primary, secondary] = await Promise.all([
      DomainStateRepository.getById<PatientMPI>(context.tenantId, 'patients', payload.primaryPatientId),
      DomainStateRepository.getById<PatientMPI>(context.tenantId, 'patients', payload.secondaryPatientId),
    ]);

    if (!primary || !secondary) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: !primary ? 'PRIMARY_PATIENT_NOT_FOUND' : 'SECONDARY_PATIENT_NOT_FOUND',
          message: 'Both patient records must exist in the authenticated tenant.',
        },
      };
    }

    if (String(primary.status || 'ACTIVE').toUpperCase() === 'REMOVED' ||
        String(secondary.status || 'ACTIVE').toUpperCase() === 'REMOVED') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_REMOVED_FROM_ACTIVE_MPI',
          message: 'Removed identities cannot be merged or reactivated through the merge command.',
        },
      };
    }

    if (String(primary.status || 'ACTIVE').toUpperCase() === 'MERGED') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'PRIMARY_ALREADY_MERGED', message: 'Primary patient is not an active authoritative record.' },
      };
    }

    if (String(secondary.status || 'ACTIVE').toUpperCase() === 'MERGED') {
      const mergedIntoPatientId = String(
        (secondary as PatientMPI & { mergedIntoPatientId?: string }).mergedIntoPatientId || ''
      ).trim();

      // A stale UI/retry may repeat a merge that already succeeded. Treat the
      // same-target retry as an idempotent success instead of presenting a red
      // error, while still rejecting attempts to redirect a retired identity
      // into a different survivor.
      if (mergedIntoPatientId === payload.primaryPatientId) {
        return {
          success: true,
          commandId,
          idempotencyKey,
          entityId: payload.primaryPatientId,
          data: {
            primaryPatientId: payload.primaryPatientId,
            secondaryPatientId: payload.secondaryPatientId,
            status: 'MERGED',
            alreadyMerged: true,
            allergies: Array.isArray(primary.allergies) ? primary.allergies : [],
            chronicConditions: Array.isArray(primary.chronicConditions)
              ? primary.chronicConditions
              : [],
          },
        };
      }

      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'SECONDARY_ALREADY_MERGED',
          message: mergedIntoPatientId
            ? `Secondary patient is already merged into ${mergedIntoPatientId}.`
            : 'Secondary patient has already been merged.',
        },
      };
    }

    const primaryGender = String(primary.gender || '').toLowerCase();
    const secondaryGender = String(secondary.gender || '').toLowerCase();
    if (primaryGender && secondaryGender && primaryGender !== secondaryGender && !payload.overrideDemographicConflict) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'MERGE_DEMOGRAPHIC_CONFLICT',
          message: 'Demographic conflict requires explicit governed override.',
        },
      };
    }

    const now = Date.now();
    const allergies = Array.from(new Set([
      ...(Array.isArray(primary.allergies) ? primary.allergies : []),
      ...(Array.isArray(secondary.allergies) ? secondary.allergies : []),
    ]));
    const chronicConditions = Array.from(new Set([
      ...(Array.isArray(primary.chronicConditions) ? primary.chronicConditions : []),
      ...(Array.isArray(secondary.chronicConditions) ? secondary.chronicConditions : []),
    ]));

    const primaryState = {
      ...primary,
      id: payload.primaryPatientId,
      tenantId: context.tenantId,
      status: 'ACTIVE',
      allergies,
      chronicConditions,
      updatedAt: now,
      version: Number(primary.version || 0) + 1,
    };

    const secondaryState = {
      ...secondary,
      id: payload.secondaryPatientId,
      tenantId: context.tenantId,
      status: 'MERGED',
      mergedIntoPatientId: payload.primaryPatientId,
      mergeReason: payload.mergeReason.trim(),
      mergedAt: now,
      mergedBy: context.actorId,
      updatedAt: now,
      version: Number(secondary.version || 0) + 1,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'MEDICAL_DIRECTOR',
      aggregateType: 'PATIENT_MPI',
      aggregateId: payload.primaryPatientId,
      eventType: 'PATIENT_RECORDS_MERGED',
      eventPayload: {
        primaryPatientId: payload.primaryPatientId,
        secondaryPatientId: payload.secondaryPatientId,
        mergeReason: payload.mergeReason.trim(),
      },
      auditAction: 'PATIENT_MERGED',
      auditResourceType: 'PATIENT',
      auditResourceId: payload.primaryPatientId,
      auditReason: payload.mergeReason.trim(),
      outboxTopic: 'g-hims-patient-identity-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: primaryState,
      additionalStateWrites: [{
        entityType: 'PATIENT_MPI',
        entityId: payload.secondaryPatientId,
        domainState: secondaryState,
      }],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.primaryPatientId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        primaryPatientId: payload.primaryPatientId,
        secondaryPatientId: payload.secondaryPatientId,
        status: 'MERGED',
        allergies,
        chronicConditions,
      },
    };
  }
}
