/**
 * Governed removal from the operational MPI.
 *
 * This is NOT destruction of the legal clinical record. The original identity,
 * MRN registry, historical encounters, accounting records, and immutable
 * event/audit/outbox history remain retained.
 */
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '../transactions/transaction-manager';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { CommandContext, CommandResult } from '../types';
import type { PatientMPI } from '@/types/mpi';

export interface RemovePatientRecordPayload {
  patientId: string;
  expectedMrn: string;
  reason: string;
}

const ADMIN_ROLES = ['ADMIN', 'ADMINISTRATOR', 'SYSTEM_ADMIN', 'SUPER_ADMIN'];

function isLiveEncounter(encounter: Record<string, unknown>): boolean {
  const state = String(
    encounter.operationalState || encounter.status || encounter.clinicalState || ''
  ).trim().toUpperCase();
  // Unknown or partially specified encounter states remain blocking.
  return !['COMPLETED', 'CLOSED', 'DISCHARGED', 'CANCELLED', 'CANCELED', 'TRANSFERRED'].includes(state);
}

function hasActivePointers(patient: PatientMPI): boolean {
  const pointers = patient.activeCareContexts;
  return Boolean(
    patient.activeBedId ||
    patient.activeEncounterId ||
    pointers?.activeIpdEncounterId ||
    pointers?.activeEmergencyEncounterId ||
    pointers?.activeOpdEncounterIds?.length ||
    pointers?.activeTelehealthEncounterIds?.length
  );
}

function rejected(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string
): CommandResult {
  return { success: false, commandId, idempotencyKey, error: { code, message } };
}

export class PatientRecordRemovalDomainService {
  public static async remove(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RemovePatientRecordPayload
  ): Promise<CommandResult> {
    const decision = AuthorizationPipeline.evaluate(context, { requiredRoles: ADMIN_ROLES });
    if (!decision.authorized) {
      return rejected(
        commandId, idempotencyKey,
        decision.code || 'PATIENT_REMOVAL_FORBIDDEN',
        decision.reason || 'Only a hospital administrator may remove a patient from the active MPI.'
      );
    }

    const patientId = String(payload.patientId || '').trim();
    const expectedMrn = String(payload.expectedMrn || '').trim();
    const reason = String(payload.reason || '').trim();
    if (!patientId || !expectedMrn || reason.length < 20 || reason.length > 1000) {
      return rejected(
        commandId, idempotencyKey, 'PATIENT_REMOVAL_REASON_REQUIRED',
        'Select a patient, confirm their MRN and provide a specific reason (20–1000 characters).'
      );
    }

    // An online-only command: no offline queue, optimistic removal, or direct
    // client Firestore writes. The current tenant and actor come from the
    // verified server session, never from this payload.
    const existing = await DomainStateRepository.getById<PatientMPI>(
      context.tenantId, 'patients', patientId
    );
    if (!existing || existing.tenantId !== context.tenantId) {
      return rejected(commandId, idempotencyKey, 'PATIENT_NOT_FOUND', 'Patient not found in the authenticated tenant.');
    }

    if (String(existing.mrn || '').trim().toUpperCase() !== expectedMrn.toUpperCase()) {
      return rejected(commandId, idempotencyKey, 'PATIENT_MRN_CONFIRMATION_MISMATCH', 'Confirmation MRN does not match the patient record.');
    }

    // Review the complete encounter history with a finite upper bound.
    // If the query fails or is too large, abort; do not guess that care ended.
    const encounters = await DomainStateRepository.queryAllEqual<Record<string, unknown>>(
      context.tenantId, 'encounters', 'patientId', patientId,
      { pageSize: 250, maxRows: 5000 }
    );
    if (encounters.some(isLiveEncounter)) {
      return rejected(
        commandId, idempotencyKey, 'PATIENT_HAS_ACTIVE_CARE',
        'Patient has an active or unresolved encounter. Close or reconcile care episodes before removal.'
      );
    }

    const removedAt = Date.now();
    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'ADMINISTRATOR',
        actorRoles: context.roles,
        deviceId: context.deviceId,
        sessionId: context.sessionId,
        aggregateType: 'PATIENT_MPI',
        aggregateId: patientId,
        eventType: 'PATIENT_RECORD_REMOVED_FROM_ACTIVE_MPI',
        auditAction: 'PATIENT_RECORD_REMOVED',
        auditResourceType: 'PATIENT',
        auditResourceId: patientId,
        omitDomainStateFromAudit: true,
        outboxTopic: 'g-hims-patient-identity-events',
        commandId,
        idempotencyKey,
        correlationId: context.correlationId,
        source: 'web',
        readTargets: [
          { key: 'patient', entityType: 'PATIENT_MPI', entityId: patientId, required: true },
        ],
        prepare: (states) => {
          const current = states.patient as unknown as PatientMPI;
          if (!current || current.tenantId !== context.tenantId) {
            throw new AtomicMutationRejectedError('PATIENT_NOT_FOUND', 'Patient no longer exists in the authenticated tenant.');
          }
          const previousStatus = String(current.status || 'ACTIVE').toUpperCase();
          if (previousStatus === 'REMOVED') {
            throw new AtomicMutationRejectedError('PATIENT_ALREADY_REMOVED', 'This patient is already removed from the active MPI.');
          }
          if (previousStatus === 'MERGED') {
            throw new AtomicMutationRejectedError('PATIENT_MERGED_RECORD', 'Merged identities cannot be removed; inspect the primary identity.');
          }
          if (String(current.mrn || '').trim().toUpperCase() !== expectedMrn.toUpperCase()) {
            throw new AtomicMutationRejectedError('PATIENT_MRN_CONFIRMATION_MISMATCH', 'MRN changed before removal; inspect the latest record.');
          }
          if (hasActivePointers(current)) {
            throw new AtomicMutationRejectedError(
              'PATIENT_HAS_ACTIVE_CARE',
              'Active patient care pointers must be closed before removal.'
            );
          }

          return {
            domainState: {
              ...current,
              tenantId: context.tenantId,
              status: 'REMOVED',
              removal: {
                removedBy: context.actorId,
                removedAt,
                reason,
                previousStatus,
                commandId,
              },
              updatedAt: removedAt,
              version: Number(current.version || 0) + 1,
            },
            eventPayload: {
              patientId,
              mrn: current.mrn,
              previousStatus,
              resultingStatus: 'REMOVED',
              reason,
              removedBy: context.actorId,
              removedAt,
              retained: true,
            },
            auditReason: reason,
            auditMetadata: {
              mrn: current.mrn,
              previousStatus,
              newStatus: 'REMOVED',
              recordRetention: 'CLINICAL_AND_FINANCIAL_HISTORY_RETAINED',
              commandId,
            },
            resultData: {
              patientId,
              mrn: current.mrn,
              status: 'REMOVED',
              removedBy: context.actorId,
              removedAt,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: patientId,
        eventType: 'PATIENT_RECORD_REMOVED_FROM_ACTIVE_MPI',
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejected(commandId, idempotencyKey, error.code, error.message);
      }
      throw error;
    }
  }
}
