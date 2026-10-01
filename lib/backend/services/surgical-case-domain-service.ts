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

interface PersistedEncounter {
  encounterId?: string;
  id?: string;
  tenantId?: string;
  patientId?: string;
  status?: string;
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

function reject(
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
