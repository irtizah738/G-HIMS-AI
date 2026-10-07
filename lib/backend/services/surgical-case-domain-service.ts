/**
 * DRP-S authoritative perioperative scheduling boundary.
 *
 * The browser may propose surgical scheduling commands, but patient identity,
 * encounter ownership, operating-room topology, overlap checks, checklist
 * evidence and case-state transitions are all evaluated server-side.
 */

import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '../transactions/transaction-manager';
import type { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { HospitalRoom } from '@/types/resource-management';
import type { PatientMPI } from '@/types/mpi';
import type { SurgicalCase, SurgicalCaseStatus } from '@/types/inpatient-or';
import type { ClinicalHandoff } from '@/types/clinical-coordination';
import { normalizeCareSetting } from '@/lib/clinical/patient360/care-context';

interface PersistedEncounter {
  encounterId?: string;
  id?: string;
  tenantId?: string;
  patientId?: string;
  status?: string;
  encounterType?: string;
  type?: string;
}

interface OrScheduleSlot {
  caseId: string;
  startTime: string;
  endTime: string;
  status: 'ACTIVE' | 'CANCELLED' | 'COMPLETED';
}

interface OrRoomSchedule {
  roomId: string;
  tenantId: string;
  facilityId: string;
  slots: OrScheduleSlot[];
  updatedAt: string;
}

interface SurgicalChecklistEvidence {
  signIn?: {
    completed: boolean;
    evidenceSummary: string;
    verifiedByActorId: string;
    verifiedAt: string;
  };
  timeOut?: {
    completed: boolean;
    evidenceSummary: string;
    verifiedByActorId: string;
    verifiedAt: string;
  };
  signOut?: {
    completed: boolean;
    evidenceSummary: string;
    verifiedByActorId: string;
    verifiedAt: string;
  };
}

type GovernedSurgicalCase = SurgicalCase & {
  facilityId: string;
  departmentId: string;
  encounterId: string;
  safetyChecklistEvidence?: SurgicalChecklistEvidence;
  pacuRoomId?: string;
  pacuHandoffId?: string;
  pacuTransferStatus?: 'PENDING_ACCEPTANCE' | 'ACCEPTED' | 'RECOVERY_COMPLETED';
  pacuTransferredAt?: string;
  pacuTransferredBy?: string;
  pacuAcceptedAt?: string;
  pacuAcceptedBy?: string;
  pacuRecoveryCompletedAt?: string;
  pacuRecoveryCompletedBy?: string;
  pacuRecoveryAssessment?: string;
  pacuDisposition?: 'WARD' | 'ICU' | 'DISCHARGE';
  createdByActorId: string;
  updatedByActorId: string;
};

export interface ScheduleSurgicalCasePayload {
  patientId: string;
  encounterId: string;
  roomId: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
  procedureName: string;
  urgency: 'elective' | 'urgent' | 'emergency';
  anesthesiaType?: 'general' | 'regional' | 'local' | 'mac' | 'sedation';
  surgeonEmployeeId?: string;
  notes?: string;
}

export interface RecordSurgicalSafetyChecklistPayload {
  caseId: string;
  phase: 'SIGN_IN' | 'TIME_OUT' | 'SIGN_OUT';
  completed: boolean;
  evidenceSummary: string;
}

export interface AdvanceSurgicalCasePayload {
  caseId: string;
  targetStatus:
    | 'pre_op'
    | 'intra_op'
    | 'post_op_pacu'
    | 'completed';
}

export interface TransferSurgicalCaseToPacuPayload {
  caseId: string;
  pacuRoomId: string;
  handoffSummary: string;
  activeRisks?: string[];
  medicationConcerns?: string[];
  expectedActions?: string[];
}

export interface AcceptPacuTransferPayload {
  caseId: string;
  handoffId: string;
}

export interface CompletePacuRecoveryPayload {
  caseId: string;
  recoveryAssessment: string;
  disposition: 'WARD' | 'ICU' | 'DISCHARGE';
}

export interface CancelSurgicalCasePayload {
  caseId: string;
  reason: string;
}

const TRANSITIONS: Record<string, SurgicalCaseStatus[]> = {
  scheduled: ['pre_op', 'cancelled'],
  pre_op: ['intra_op', 'cancelled'],
  intra_op: ['post_op_pacu'],
  post_op_pacu: ['completed'],
  completed: [],
  cancelled: [],
};

function reject<T = never>(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string,
  details?: unknown
): CommandResult<T> {
  return {
    success: false,
    commandId,
    idempotencyKey,
    error: { code, message, details },
  };
}

function assertFacilityScope(context: CommandContext, facilityId: string): void {
  const actorFacilities = context.facilityIds || [];
  if (
    actorFacilities.length > 0 &&
    !actorFacilities.includes(facilityId) &&
    !context.roles.includes('SYSTEM_ADMIN')
  ) {
    throw new AtomicMutationRejectedError(
      'FACILITY_SCOPE_MISMATCH',
      'Operating room is outside the authenticated actor facility scope.'
    );
  }
}

function validateWindow(startIso: string, endIso: string): {
  start: number;
  end: number;
} {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new AtomicMutationRejectedError(
      'SURGICAL_SCHEDULE_INVALID',
      'Surgical case end time must be after a valid start time.'
    );
  }
  if (end - start > 24 * 60 * 60 * 1000) {
    throw new AtomicMutationRejectedError(
      'SURGICAL_SCHEDULE_INVALID',
      'A single surgical case may not reserve an operating room for more than 24 hours.'
    );
  }
  return { start, end };
}

function phaseKey(
  phase: RecordSurgicalSafetyChecklistPayload['phase']
): keyof SurgicalChecklistEvidence {
  if (phase === 'SIGN_IN') return 'signIn';
  if (phase === 'TIME_OUT') return 'timeOut';
  return 'signOut';
}

function requireClinicalProcedurePrivilege(
  context: CommandContext,
  requiredRoles: string[]
): ReturnType<typeof AuthorizationPipeline.evaluate> {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles,
    requiredPrivilege: 'PERFORM_PROCEDURES',
  });
}

export class SurgicalCaseDomainService {
  public static async scheduleCase(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ScheduleSurgicalCasePayload
  ): Promise<CommandResult<GovernedSurgicalCase>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SURGEON',
        'DOCTOR',
        'CONSULTANT',
        'NURSE',
        'OR_COORDINATOR',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Operating-room scheduling authority required.'
      );
    }

    let requested: { start: number; end: number };
    try {
      requested = validateWindow(
        payload.scheduledStartTime,
        payload.scheduledEndTime
      );
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }

    const caseId = `surg_${crypto.randomUUID()}`;
    const scheduleId = `or_schedule_${payload.roomId}`;
    const now = new Date().toISOString();

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SURGICAL_CASE',
        aggregateId: caseId,
        eventType: 'SURGICAL_CASE_SCHEDULED',
        auditAction: 'SURGICAL_CASE_SCHEDULED',
        auditResourceType: 'SURGICAL_CASE',
        auditResourceId: caseId,
        outboxTopic: 'g-hims-perioperative-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'patient',
            entityType: 'PATIENT_MPI',
            entityId: payload.patientId,
            required: true,
          },
          {
            key: 'encounter',
            entityType: 'ENCOUNTER',
            entityId: payload.encounterId,
            required: true,
          },
          {
            key: 'room',
            entityType: 'HOSPITAL_ROOM',
            entityId: payload.roomId,
            required: true,
          },
          {
            key: 'schedule',
            entityType: 'OR_ROOM_SCHEDULE',
            entityId: scheduleId,
            required: false,
          },
        ],
        prepare: (current) => {
          const patient = current.patient as unknown as PatientMPI;
          const encounter = current.encounter as unknown as PersistedEncounter;
          const room = current.room as unknown as HospitalRoom;
          const schedule = current.schedule as unknown as OrRoomSchedule | null;

          if (patient.tenantId !== context.tenantId) {
            throw new AtomicMutationRejectedError(
              'PATIENT_TENANT_MISMATCH',
              'Surgical case patient is outside the authenticated tenant.'
            );
          }
          if (String(encounter.patientId || '') !== patient.id) {
            throw new AtomicMutationRejectedError(
              'ENCOUNTER_PATIENT_MISMATCH',
              'Surgical encounter does not belong to the supplied patient.'
            );
          }
          if (
            !['ACTIVE', 'IN_PROGRESS', 'ADMITTED'].includes(
              String(encounter.status || '').toUpperCase()
            )
          ) {
            throw new AtomicMutationRejectedError(
              'ENCOUNTER_NOT_ACTIVE',
              'Surgery may only be scheduled against an active encounter.'
            );
          }

          assertFacilityScope(context, room.facilityId);

          if (room.roomType !== 'operating_room') {
            throw new AtomicMutationRejectedError(
              'ROOM_NOT_OPERATING_ROOM',
              'Selected facility room is not classified as an operating room.'
            );
          }
          if (
            ['OUT_OF_SERVICE', 'MAINTENANCE', 'LOST', 'RETIRED'].includes(
              room.status
            )
          ) {
            throw new AtomicMutationRejectedError(
              'OPERATING_ROOM_UNAVAILABLE',
              `Operating room ${room.roomNumber} is currently ${room.status}.`
            );
          }

          const activeSlots = (schedule?.slots || []).filter(
            (slot) =>
              slot.status === 'ACTIVE' &&
              Number.isFinite(Date.parse(slot.startTime)) &&
              Number.isFinite(Date.parse(slot.endTime))
          );

          const conflict = activeSlots.find((slot) => {
            const start = Date.parse(slot.startTime);
            const end = Date.parse(slot.endTime);
            return requested.start < end && requested.end > start;
          });

          if (conflict) {
            throw new AtomicMutationRejectedError(
              'OR_SCHEDULE_CONFLICT',
              'Operating-room schedule overlaps an existing active case.',
              { conflictingCaseId: conflict.caseId }
            );
          }

          const surgicalCase: GovernedSurgicalCase = {
            id: caseId,
            tenantId: context.tenantId,
            patientId: patient.id,
            patientName: patient.fullName,
            patientMRN: patient.mrn,
            facilityId: room.facilityId,
            departmentId: room.departmentId,
            encounterId: payload.encounterId,
            procedureName: payload.procedureName.trim(),
            surgicalProcedureName: payload.procedureName.trim(),
            suiteId: room.roomId,
            suiteName: room.roomNumber,
            orRoomId: room.roomId,
            orRoomName: room.roomNumber,
            surgeonId: payload.surgeonEmployeeId,
            scheduledStartTime: payload.scheduledStartTime,
            scheduledEndTime: payload.scheduledEndTime,
            estimatedDurationMinutes: Math.ceil(
              (requested.end - requested.start) / 60000
            ),
            urgency: payload.urgency,
            anesthesiaType: payload.anesthesiaType,
            status: 'scheduled',
            stage: 'scheduled',
            notes: payload.notes,
            whoChecklist: {
              signInComplete: false,
              timeOutComplete: false,
              signOutComplete: false,
            },
            createdByActorId: context.actorId,
            updatedByActorId: context.actorId,
            createdAt: now,
            updatedAt: now,
          };

          const nextSchedule: OrRoomSchedule = {
            roomId: room.roomId,
            tenantId: context.tenantId,
            facilityId: room.facilityId,
            slots: [
              ...activeSlots,
              {
                caseId,
                startTime: payload.scheduledStartTime,
                endTime: payload.scheduledEndTime,
                status: 'ACTIVE',
              },
            ],
            updatedAt: now,
          };

          return {
            domainState: surgicalCase,
            additionalStateWrites: [
              {
                entityType: 'OR_ROOM_SCHEDULE',
                entityId: scheduleId,
                domainState: nextSchedule,
              },
            ],
            eventPayload: {
              caseId,
              patientId: patient.id,
              encounterId: payload.encounterId,
              roomId: room.roomId,
              facilityId: room.facilityId,
              startTime: payload.scheduledStartTime,
              endTime: payload.scheduledEndTime,
              urgency: payload.urgency,
            },
            auditReason:
              `Scheduled surgical case ${caseId} in operating room ${room.roomNumber}.`,
            resultData: surgicalCase,
          };
        },
      });

      const surgicalCase = tx.resultData as GovernedSurgicalCase;
      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: surgicalCase.id,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: surgicalCase,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        const missingMap: Record<string, string> = {
          PATIENT_MPI: 'PATIENT_NOT_FOUND',
          ENCOUNTER: 'ENCOUNTER_NOT_FOUND',
          HOSPITAL_ROOM: 'OPERATING_ROOM_NOT_FOUND',
        };
        const missingType = String(
          (error.details as { entityType?: string } | undefined)?.entityType || ''
        );
        return reject(
          commandId,
          idempotencyKey,
          error.code === 'REQUIRED_STATE_NOT_FOUND'
            ? missingMap[missingType] || 'SURGICAL_SCHEDULE_STATE_NOT_FOUND'
            : error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async recordSafetyChecklist(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordSurgicalSafetyChecklistPayload
  ): Promise<CommandResult<GovernedSurgicalCase>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SURGEON',
        'DOCTOR',
        'CONSULTANT',
        'ANESTHESIOLOGIST',
        'NURSE',
        'SYSTEM_ADMIN',
      ],
    });
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Surgical safety checklist authority required.'
      );
    }

    const now = new Date().toISOString();
    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SURGICAL_CASE',
        aggregateId: payload.caseId,
        eventType: 'SURGICAL_SAFETY_CHECKLIST_RECORDED',
        auditAction: 'SURGICAL_SAFETY_CHECKLIST_RECORDED',
        auditResourceType: 'SURGICAL_CASE',
        auditResourceId: payload.caseId,
        outboxTopic: 'g-hims-perioperative-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'case',
            entityType: 'SURGICAL_CASE',
            entityId: payload.caseId,
            required: true,
          },
        ],
        prepare: (current) => {
          const surgicalCase = current.case as unknown as GovernedSurgicalCase;
          assertFacilityScope(context, surgicalCase.facilityId);

          if (['completed', 'cancelled'].includes(String(surgicalCase.status))) {
            throw new AtomicMutationRejectedError(
              'SURGICAL_CASE_FINALIZED',
              'Checklist evidence cannot be changed after the case is finalized.'
            );
          }

          const key = phaseKey(payload.phase);
          const evidence: SurgicalChecklistEvidence = {
            ...(surgicalCase.safetyChecklistEvidence || {}),
            [key]: {
              completed: payload.completed,
              evidenceSummary: payload.evidenceSummary.trim(),
              verifiedByActorId: context.actorId,
              verifiedAt: now,
            },
          };

          const next: GovernedSurgicalCase = {
            ...surgicalCase,
            safetyChecklistEvidence: evidence,
            whoChecklist: {
              signInComplete: Boolean(evidence.signIn?.completed),
              timeOutComplete: Boolean(evidence.timeOut?.completed),
              signOutComplete: Boolean(evidence.signOut?.completed),
            },
            updatedByActorId: context.actorId,
            updatedAt: now,
          };

          return {
            domainState: next,
            eventPayload: {
              caseId: next.id,
              phase: payload.phase,
              completed: payload.completed,
              verifiedByActorId: context.actorId,
            },
            auditReason:
              `Recorded WHO surgical safety phase ${payload.phase} for case ${next.id}.`,
            resultData: next,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.caseId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData as GovernedSurgicalCase,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code === 'REQUIRED_STATE_NOT_FOUND'
            ? 'SURGICAL_CASE_NOT_FOUND'
            : error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async advanceCase(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AdvanceSurgicalCasePayload
  ): Promise<CommandResult<GovernedSurgicalCase>> {
    if (payload.targetStatus === 'post_op_pacu' || payload.targetStatus === 'completed') {
      return reject(
        commandId,
        idempotencyKey,
        'PACU_TRANSITION_COMMAND_REQUIRED',
        'PACU entry and recovery completion must use the dedicated governed PACU transition commands.'
      );
    }

    const clinicalTargets = new Set([
      'intra_op',
      'post_op_pacu',
      'completed',
    ]);
    const auth = clinicalTargets.has(payload.targetStatus)
      ? requireClinicalProcedurePrivilege(context, [
          'SURGEON',
          'DOCTOR',
          'CONSULTANT',
          'ANESTHESIOLOGIST',
          'SYSTEM_ADMIN',
        ])
      : AuthorizationPipeline.evaluate(context, {
          requiredRoles: [
            'SURGEON',
            'DOCTOR',
            'CONSULTANT',
            'NURSE',
            'OR_COORDINATOR',
            'SYSTEM_ADMIN',
          ],
        });

    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Surgical case transition authority required.'
      );
    }

    const preflight = await DomainStateRepository.getById<GovernedSurgicalCase>(
      context.tenantId,
      'surgicalCases',
      payload.caseId
    );
    if (!preflight) {
      return reject(
        commandId,
        idempotencyKey,
        'SURGICAL_CASE_NOT_FOUND',
        'Surgical case does not exist.'
      );
    }
    const scheduleId = `or_schedule_${preflight.orRoomId}`;
    const now = new Date().toISOString();
    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SURGICAL_CASE',
        aggregateId: payload.caseId,
        eventType: 'SURGICAL_CASE_STATUS_CHANGED',
        auditAction: 'SURGICAL_CASE_STATUS_CHANGED',
        auditResourceType: 'SURGICAL_CASE',
        auditResourceId: payload.caseId,
        outboxTopic: 'g-hims-perioperative-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'case',
            entityType: 'SURGICAL_CASE',
            entityId: payload.caseId,
            required: true,
          },
          {
            key: 'schedule',
            entityType: 'OR_ROOM_SCHEDULE',
            entityId: scheduleId,
            required: false,
          },
        ],
        prepare: (current) => {
          const surgicalCase = current.case as unknown as GovernedSurgicalCase;
          const roomSchedule = current.schedule as unknown as OrRoomSchedule | null;
          assertFacilityScope(context, surgicalCase.facilityId);
          if (surgicalCase.orRoomId !== preflight.orRoomId) {
            throw new AtomicMutationRejectedError(
              'SURGICAL_CASE_ROOM_CONCURRENCY_CONFLICT',
              'Operating-room assignment changed during case transition.'
            );
          }

          const currentStatus = (surgicalCase.status || 'scheduled') as SurgicalCaseStatus;
          if (!(TRANSITIONS[currentStatus] || []).includes(payload.targetStatus)) {
            throw new AtomicMutationRejectedError(
              'SURGICAL_CASE_STATE_CONFLICT',
              `Case cannot move from ${currentStatus} to ${payload.targetStatus}.`
            );
          }

          const checklist = surgicalCase.safetyChecklistEvidence || {};
          if (
            payload.targetStatus === 'intra_op' &&
            (!checklist.signIn?.completed || !checklist.timeOut?.completed)
          ) {
            throw new AtomicMutationRejectedError(
              'WHO_CHECKLIST_INCOMPLETE',
              'WHO Sign In and Time Out must be complete before intra-operative start.'
            );
          }
          if (
            payload.targetStatus === 'post_op_pacu' &&
            !checklist.signOut?.completed
          ) {
            throw new AtomicMutationRejectedError(
              'WHO_SIGN_OUT_INCOMPLETE',
              'WHO Sign Out must be complete before transfer to PACU.'
            );
          }

          const next: GovernedSurgicalCase = {
            ...surgicalCase,
            status: payload.targetStatus,
            stage: payload.targetStatus,
            actualStartTime:
              payload.targetStatus === 'intra_op'
                ? surgicalCase.actualStartTime || now
                : surgicalCase.actualStartTime,
            actualEndTime:
              payload.targetStatus === 'post_op_pacu' ||
              payload.targetStatus === 'completed'
                ? surgicalCase.actualEndTime || now
                : surgicalCase.actualEndTime,
            updatedByActorId: context.actorId,
            updatedAt: now,
          };

          const scheduleWrite =
            payload.targetStatus === 'completed'
              ? [{
                  entityType: 'OR_ROOM_SCHEDULE',
                  entityId: scheduleId,
                  domainState: {
                    roomId: surgicalCase.orRoomId,
                    tenantId: context.tenantId,
                    facilityId: surgicalCase.facilityId,
                    slots: (roomSchedule?.slots || []).map((slot) =>
                      slot.caseId === surgicalCase.id
                        ? { ...slot, status: 'COMPLETED' as const }
                        : slot
                    ),
                    updatedAt: now,
                  },
                }]
              : [];

          return {
            domainState: next,
            additionalStateWrites: scheduleWrite,
            eventPayload: {
              caseId: next.id,
              previousStatus: currentStatus,
              targetStatus: payload.targetStatus,
            },
            auditReason:
              `Advanced surgical case ${next.id} from ${currentStatus} to ${payload.targetStatus}.`,
            resultData: next,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.caseId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData as GovernedSurgicalCase,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code === 'REQUIRED_STATE_NOT_FOUND'
            ? 'SURGICAL_CASE_NOT_FOUND'
            : error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }


  public static async transferToPacu(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: TransferSurgicalCaseToPacuPayload
  ): Promise<CommandResult<GovernedSurgicalCase>> {
    const auth = requireClinicalProcedurePrivilege(context, [
      'SURGEON',
      'DOCTOR',
      'CONSULTANT',
      'ANESTHESIOLOGIST',
      'SYSTEM_ADMIN',
    ]);
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'PACU transfer authority required.'
      );
    }

    const preflight = await DomainStateRepository.getById<GovernedSurgicalCase>(
      context.tenantId,
      'surgicalCases',
      payload.caseId
    );
    if (!preflight) {
      return reject(
        commandId,
        idempotencyKey,
        'SURGICAL_CASE_NOT_FOUND',
        'Surgical case does not exist.'
      );
    }
    if (!preflight.encounterId) {
      return reject(
        commandId,
        idempotencyKey,
        'SURGICAL_ENCOUNTER_NOT_BOUND',
        'Surgical case does not have an authoritative encounter binding.'
      );
    }

    const handoffId = `handoff_pacu_${crypto.randomUUID()}`;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        aggregateType: 'SURGICAL_CASE',
        aggregateId: payload.caseId,
        eventType: 'SURGICAL_CASE_TRANSFERRED_TO_PACU',
        auditAction: 'SURGICAL_CASE_TRANSFERRED_TO_PACU',
        auditResourceType: 'SURGICAL_CASE',
        auditResourceId: payload.caseId,
        outboxTopic: 'g-hims-perioperative-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          { key: 'case', entityType: 'SURGICAL_CASE', entityId: payload.caseId, required: true },
          { key: 'room', entityType: 'HOSPITAL_ROOM', entityId: payload.pacuRoomId, required: true },
          { key: 'encounter', entityType: 'ENCOUNTER', entityId: preflight.encounterId, required: true },
        ],
        prepare: (current) => {
          const surgicalCase = current.case as unknown as GovernedSurgicalCase;
          const room = current.room as unknown as HospitalRoom;
          const encounter = current.encounter as unknown as PersistedEncounter;

          assertFacilityScope(context, surgicalCase.facilityId);
          if (String(surgicalCase.status || '') !== 'intra_op') {
            throw new AtomicMutationRejectedError(
              'PACU_TRANSFER_STATE_INVALID',
              'Only an intra-operative case may transfer to PACU.'
            );
          }
          const encounterCareSetting = normalizeCareSetting(
            encounter.encounterType || encounter.type
          );
          if (
            String(encounter.patientId || '') !== surgicalCase.patientId ||
            encounterCareSetting === 'UNKNOWN' ||
            ['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED', 'CLOSED'].includes(
              String(encounter.status || '').trim().toUpperCase()
            )
          ) {
            throw new AtomicMutationRejectedError(
              'PACU_ENCOUNTER_SCOPE_INVALID',
              'Surgical case must remain bound to an active authoritative clinical encounter before PACU transfer.'
            );
          }
          if (!surgicalCase.safetyChecklistEvidence?.signOut?.completed) {
            throw new AtomicMutationRejectedError(
              'WHO_SIGN_OUT_INCOMPLETE',
              'WHO Sign Out must be complete before PACU transfer.'
            );
          }
          if (room.facilityId !== surgicalCase.facilityId || room.roomType !== 'recovery') {
            throw new AtomicMutationRejectedError(
              'PACU_ROOM_INVALID',
              'PACU transfer requires a recovery room in the same facility.'
            );
          }
          if (['OUT_OF_SERVICE', 'MAINTENANCE', 'LOST', 'RETIRED'].includes(room.status)) {
            throw new AtomicMutationRejectedError(
              'PACU_ROOM_UNAVAILABLE',
              'Selected PACU recovery room is unavailable.'
            );
          }
          if (Number(room.currentOccupancy || 0) >= Number(room.capacity || 0)) {
            throw new AtomicMutationRejectedError(
              'PACU_CAPACITY_EXHAUSTED',
              'Selected PACU recovery room has no remaining capacity.'
            );
          }

          const handoff: ClinicalHandoff = {
            handoffId,
            tenantId: context.tenantId,
            patientId: surgicalCase.patientId,
            encounterId: surgicalCase.encounterId,
            sourceEncounterId: surgicalCase.encounterId,
            episodeId: surgicalCase.id,
            careSetting: encounterCareSetting,
            fromClinicianId: context.actorId,
            fromDepartmentId: surgicalCase.departmentId,
            toDepartmentId: room.departmentId,
            toRole: 'PACU_CLINICIAN',
            currentProblemSummary: payload.handoffSummary.trim(),
            activeRisks: (payload.activeRisks || []).map((item) => item.trim()).filter(Boolean),
            pendingDiagnostics: [],
            pendingProcedures: [],
            pendingConsultations: [],
            medicationConcerns: (payload.medicationConcerns || []).map((item) => item.trim()).filter(Boolean),
            unresolvedItems: [],
            expectedActions: (payload.expectedActions || []).map((item) => item.trim()).filter(Boolean),
            sourceRefs: [surgicalCase.id],
            sourceArtifactId: surgicalCase.id,
            sourceArtifactType: 'SURGICAL_CASE',
            status: 'PENDING_ACCEPTANCE',
            createdAt: nowMs,
            updatedAt: nowMs,
          };

          const next: GovernedSurgicalCase = {
            ...surgicalCase,
            status: 'post_op_pacu',
            stage: 'post_op_pacu',
            actualEndTime: surgicalCase.actualEndTime || now,
            pacuRoomId: room.roomId,
            pacuHandoffId: handoffId,
            pacuTransferStatus: 'PENDING_ACCEPTANCE',
            pacuTransferredAt: now,
            pacuTransferredBy: context.actorId,
            updatedByActorId: context.actorId,
            updatedAt: now,
          };

          return {
            domainState: next,
            additionalStateWrites: [
              {
                entityType: 'HOSPITAL_ROOM',
                entityId: room.roomId,
                domainState: {
                  ...room,
                  currentOccupancy: Number(room.currentOccupancy || 0) + 1,
                  status:
                    Number(room.currentOccupancy || 0) + 1 >= Number(room.capacity || 0)
                      ? 'IN_USE'
                      : room.status,
                  updatedAt: now,
                },
              },
              {
                entityType: 'CLINICAL_HANDOFF',
                entityId: handoffId,
                domainState: handoff,
              },
            ],
            eventPayload: {
              caseId: surgicalCase.id,
              patientId: surgicalCase.patientId,
              encounterId: surgicalCase.encounterId,
              pacuRoomId: room.roomId,
              handoffId,
              receivingDepartmentId: room.departmentId,
            },
            auditReason: `Transferred surgical case ${surgicalCase.id} to PACU with handoff ${handoffId}.`,
            resultData: next,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.caseId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData as GovernedSurgicalCase,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  public static async acceptPacuTransfer(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AcceptPacuTransferPayload
  ): Promise<CommandResult<GovernedSurgicalCase>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'NURSE',
        'HEAD_NURSE',
        'ANESTHESIOLOGIST',
        'DOCTOR',
        'CONSULTANT',
        'SYSTEM_ADMIN',
      ],
      allowBreakGlass: true,
    });
    if (!auth.authorized) {
      return reject(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'PACU acceptance authority required.');
    }

    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        aggregateType: 'SURGICAL_CASE',
        aggregateId: payload.caseId,
        eventType: 'PACU_TRANSFER_ACCEPTED',
        auditAction: 'PACU_TRANSFER_ACCEPTED',
        auditResourceType: 'SURGICAL_CASE',
        auditResourceId: payload.caseId,
        outboxTopic: 'g-hims-perioperative-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          { key: 'case', entityType: 'SURGICAL_CASE', entityId: payload.caseId, required: true },
          { key: 'handoff', entityType: 'CLINICAL_HANDOFF', entityId: payload.handoffId, required: true },
        ],
        prepare: (current) => {
          const surgicalCase = current.case as unknown as GovernedSurgicalCase;
          const handoff = current.handoff as unknown as ClinicalHandoff;

          if (
            surgicalCase.status !== 'post_op_pacu' ||
            surgicalCase.pacuHandoffId !== handoff.handoffId ||
            handoff.status !== 'PENDING_ACCEPTANCE'
          ) {
            throw new AtomicMutationRejectedError(
              'PACU_HANDOFF_STATE_INVALID',
              'PACU handoff is not pending acceptance for this surgical case.'
            );
          }
          const actorDepartments = new Set(
            [
              ...(context.departmentIds || []),
              ...(context.departmentId ? [context.departmentId] : []),
            ]
              .map((department) => String(department || '').trim().toUpperCase())
              .filter(Boolean)
          );
          const targetDepartment = String(handoff.toDepartmentId || '').trim().toUpperCase();
          if (
            !context.roles.includes('SYSTEM_ADMIN') &&
            (!targetDepartment || !actorDepartments.has(targetDepartment))
          ) {
            throw new AtomicMutationRejectedError(
              'PACU_RECEIVER_DEPARTMENT_MISMATCH',
              'PACU handoff may only be accepted by a clinician assigned to the receiving recovery department.'
            );
          }

          const nextCase: GovernedSurgicalCase = {
            ...surgicalCase,
            pacuTransferStatus: 'ACCEPTED',
            pacuAcceptedAt: now,
            pacuAcceptedBy: context.actorId,
            updatedByActorId: context.actorId,
            updatedAt: now,
          };
          const nextHandoff: ClinicalHandoff = {
            ...handoff,
            status: 'ACCEPTED',
            acceptedAt: nowMs,
            acceptedBy: context.actorId,
            updatedAt: nowMs,
          };

          return {
            domainState: nextCase,
            additionalStateWrites: [{
              entityType: 'CLINICAL_HANDOFF',
              entityId: nextHandoff.handoffId,
              domainState: nextHandoff,
            }],
            eventPayload: {
              caseId: nextCase.id,
              handoffId: nextHandoff.handoffId,
              acceptedBy: context.actorId,
              acceptedAt: nowMs,
            },
            auditReason: `Accepted PACU handoff ${nextHandoff.handoffId} for surgical case ${nextCase.id}.`,
            resultData: nextCase,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.caseId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData as GovernedSurgicalCase,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  public static async completePacuRecovery(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CompletePacuRecoveryPayload
  ): Promise<CommandResult<GovernedSurgicalCase>> {
    const auth = requireClinicalProcedurePrivilege(context, [
      'ANESTHESIOLOGIST',
      'DOCTOR',
      'CONSULTANT',
      'SURGEON',
      'SYSTEM_ADMIN',
    ]);
    if (!auth.authorized) {
      return reject(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'PACU recovery completion authority required.');
    }

    const preflight = await DomainStateRepository.getById<GovernedSurgicalCase>(
      context.tenantId,
      'surgicalCases',
      payload.caseId
    );
    if (!preflight?.pacuRoomId) {
      return reject(commandId, idempotencyKey, 'PACU_ROOM_NOT_BOUND', 'Surgical case does not have an authoritative PACU room assignment.');
    }
    if (!preflight.orRoomId) {
      return reject(commandId, idempotencyKey, 'OPERATING_ROOM_NOT_BOUND', 'Surgical case does not have an authoritative operating-room assignment.');
    }

    const orRoomId = preflight.orRoomId;
    const scheduleId = `or_schedule_${orRoomId}`;
    const now = new Date().toISOString();
    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        aggregateType: 'SURGICAL_CASE',
        aggregateId: payload.caseId,
        eventType: 'PACU_RECOVERY_COMPLETED',
        auditAction: 'PACU_RECOVERY_COMPLETED',
        auditResourceType: 'SURGICAL_CASE',
        auditResourceId: payload.caseId,
        outboxTopic: 'g-hims-perioperative-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          { key: 'case', entityType: 'SURGICAL_CASE', entityId: payload.caseId, required: true },
          { key: 'room', entityType: 'HOSPITAL_ROOM', entityId: preflight.pacuRoomId, required: true },
          { key: 'schedule', entityType: 'OR_ROOM_SCHEDULE', entityId: scheduleId, required: false },
        ],
        prepare: (current) => {
          const surgicalCase = current.case as unknown as GovernedSurgicalCase;
          const room = current.room as unknown as HospitalRoom;
          const roomSchedule = current.schedule as unknown as OrRoomSchedule | null;

          if (surgicalCase.status !== 'post_op_pacu' || surgicalCase.pacuTransferStatus !== 'ACCEPTED') {
            throw new AtomicMutationRejectedError(
              'PACU_RECOVERY_NOT_ACCEPTED',
              'PACU recovery cannot complete until the receiving clinician accepts the transfer.'
            );
          }
          if (room.roomId !== surgicalCase.pacuRoomId || room.roomType !== 'recovery') {
            throw new AtomicMutationRejectedError(
              'PACU_ROOM_CONCURRENCY_CONFLICT',
              'PACU room binding changed during recovery completion.'
            );
          }

          const nextCase: GovernedSurgicalCase = {
            ...surgicalCase,
            status: 'completed',
            stage: 'completed',
            pacuTransferStatus: 'RECOVERY_COMPLETED',
            pacuRecoveryCompletedAt: now,
            pacuRecoveryCompletedBy: context.actorId,
            pacuRecoveryAssessment: payload.recoveryAssessment.trim(),
            pacuDisposition: payload.disposition,
            updatedByActorId: context.actorId,
            updatedAt: now,
          };

          const nextRoom: HospitalRoom = {
            ...room,
            currentOccupancy: Math.max(0, Number(room.currentOccupancy || 0) - 1),
            status:
              Math.max(0, Number(room.currentOccupancy || 0) - 1) < Number(room.capacity || 0)
                ? 'AVAILABLE'
                : room.status,
            updatedAt: now,
          };

          const nextSchedule: OrRoomSchedule = {
            roomId: orRoomId,
            tenantId: context.tenantId,
            facilityId: surgicalCase.facilityId,
            slots: (roomSchedule?.slots || []).map((slot) =>
              slot.caseId === surgicalCase.id
                ? { ...slot, status: 'COMPLETED' as const }
                : slot
            ),
            updatedAt: now,
          };

          return {
            domainState: nextCase,
            additionalStateWrites: [
              { entityType: 'HOSPITAL_ROOM', entityId: nextRoom.roomId, domainState: nextRoom },
              { entityType: 'OR_ROOM_SCHEDULE', entityId: scheduleId, domainState: nextSchedule },
            ],
            eventPayload: {
              caseId: nextCase.id,
              pacuRoomId: nextRoom.roomId,
              disposition: payload.disposition,
              recoveryCompletedBy: context.actorId,
            },
            auditReason: `Completed PACU recovery for surgical case ${nextCase.id}; disposition ${payload.disposition}.`,
            resultData: nextCase,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.caseId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData as GovernedSurgicalCase,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  public static async cancelCase(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CancelSurgicalCasePayload
  ): Promise<CommandResult<GovernedSurgicalCase>> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SURGEON',
        'DOCTOR',
        'CONSULTANT',
        'OR_COORDINATOR',
        'SYSTEM_ADMIN',
      ],
    });
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Surgical cancellation authority required.'
      );
    }

    const preflight = await DomainStateRepository.getById<GovernedSurgicalCase>(
      context.tenantId,
      'surgicalCases',
      payload.caseId
    );
    if (!preflight) {
      return reject(
        commandId,
        idempotencyKey,
        'SURGICAL_CASE_NOT_FOUND',
        'Surgical case does not exist.'
      );
    }
    const scheduleId = `or_schedule_${preflight.orRoomId}`;
    const now = new Date().toISOString();
    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'SURGICAL_CASE',
        aggregateId: payload.caseId,
        eventType: 'SURGICAL_CASE_CANCELLED',
        auditAction: 'SURGICAL_CASE_CANCELLED',
        auditResourceType: 'SURGICAL_CASE',
        auditResourceId: payload.caseId,
        outboxTopic: 'g-hims-perioperative-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'case',
            entityType: 'SURGICAL_CASE',
            entityId: payload.caseId,
            required: true,
          },
          {
            key: 'schedule',
            entityType: 'OR_ROOM_SCHEDULE',
            entityId: scheduleId,
            required: false,
          },
        ],
        prepare: (current) => {
          const surgicalCase = current.case as unknown as GovernedSurgicalCase;
          const roomSchedule = current.schedule as unknown as OrRoomSchedule | null;
          assertFacilityScope(context, surgicalCase.facilityId);
          if (surgicalCase.orRoomId !== preflight.orRoomId) {
            throw new AtomicMutationRejectedError(
              'SURGICAL_CASE_ROOM_CONCURRENCY_CONFLICT',
              'Operating-room assignment changed during cancellation.'
            );
          }

          const status = surgicalCase.status || 'scheduled';
          if (!['scheduled', 'pre_op'].includes(status)) {
            throw new AtomicMutationRejectedError(
              'SURGICAL_CASE_CANCELLATION_LOCKED',
              'A case cannot be cancelled after intra-operative start.'
            );
          }

          const next: GovernedSurgicalCase = {
            ...surgicalCase,
            status: 'cancelled',
            stage: 'cancelled',
            notes: [
              surgicalCase.notes,
              `Cancellation: ${payload.reason.trim()}`,
            ]
              .filter(Boolean)
              .join('\n'),
            updatedByActorId: context.actorId,
            updatedAt: now,
          };

          const nextSchedule: OrRoomSchedule = {
            roomId: surgicalCase.orRoomId || preflight.orRoomId || '',
            tenantId: context.tenantId,
            facilityId: surgicalCase.facilityId,
            slots: (roomSchedule?.slots || []).map((slot) =>
              slot.caseId === surgicalCase.id
                ? { ...slot, status: 'CANCELLED' as const }
                : slot
            ),
            updatedAt: now,
          };

          return {
            domainState: next,
            additionalStateWrites: [{
              entityType: 'OR_ROOM_SCHEDULE',
              entityId: scheduleId,
              domainState: nextSchedule,
            }],
            eventPayload: {
              caseId: next.id,
              previousStatus: status,
              reason: payload.reason.trim(),
            },
            auditReason:
              `Cancelled surgical case ${next.id}: ${payload.reason.trim()}`,
            resultData: next,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.caseId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData as GovernedSurgicalCase,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code === 'REQUIRED_STATE_NOT_FOUND'
            ? 'SURGICAL_CASE_NOT_FOUND'
            : error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }
}
