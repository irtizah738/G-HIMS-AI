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

/**
 * Encounter.status is the canonical lifecycle authority. operationalState is
 * queue state (e.g. QUEUED/NOT_QUEUED) and clinicalState is clinical progress;
 * neither can overrule a terminal encounter.status.
 *
 * Missing/unknown lifecycle states remain blockers: guessing that an
 * unresolved encounter has ended is not safe.
 */
const TERMINAL_ENCOUNTER_STATUSES = new Set([
  'COMPLETED', 'CLOSED', 'DISCHARGED', 'CANCELLED', 'CANCELED', 'TRANSFERRED',
]);

export function unresolvedRemovalEncounter(
  encounter: Record<string, unknown>
): { encounterId: string; status: string; encounterType: string } | null {
  const status = String(encounter.status || '').trim().toUpperCase();
  if (TERMINAL_ENCOUNTER_STATUSES.has(status)) return null;
  return {
    encounterId: String(encounter.encounterId || encounter.id || 'UNKNOWN').trim(),
    status: status || 'UNKNOWN',
    encounterType: String(encounter.encounterType || encounter.type || 'UNKNOWN').trim().toUpperCase(),
  };
}

function activePointerSummary(patient: PatientMPI): string[] {
  const p = patient.activeCareContexts;
  return [
    ...(patient.activeBedId ? [`Bed ${patient.activeBedId}`] : []),
    ...(patient.activeEncounterId ? [`Legacy encounter ${patient.activeEncounterId}`] : []),
    ...(p?.activeIpdEncounterId ? [`IPD encounter ${p.activeIpdEncounterId}`] : []),
    ...(p?.activeEmergencyEncounterId ? [`Emergency encounter ${p.activeEmergencyEncounterId}`] : []),
    ...(p?.activeOpdEncounterIds || []).map(id => `OPD encounter ${id}`),
    ...(p?.activeTelehealthEncounterIds || []).map(id => `Telehealth encounter ${id}`),
  ];
}

function hasActivePointers(patient: PatientMPI): boolean {
  return activePointerSummary(patient).length > 0;
}

function rejected(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string,
  details?: unknown
): CommandResult {
  return { success: false, commandId, idempotencyKey, error: { code, message, details } };
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
    const blocker = encounters.map(unresolvedRemovalEncounter).find(
      (value): value is NonNullable<typeof value> => value !== null
    );
    if (blocker) {
      return rejected(
        commandId, idempotencyKey, 'PATIENT_HAS_ACTIVE_CARE',
        `Encounter ${blocker.encounterId} (${blocker.encounterType}) is ${blocker.status}. Complete its governed clinical disposition or reconcile the encounter lifecycle before removing this patient.`,
        {
          blockingEncounterId: blocker.encounterId,
          encounterStatus: blocker.status,
          encounterType: blocker.encounterType,
        }
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
              `Patient retains active care pointers: ${activePointerSummary(current).join(', ')}. Close the linked care episodes and reconcile these pointers before removal.`
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
