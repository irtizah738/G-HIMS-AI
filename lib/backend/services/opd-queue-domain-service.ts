/**
 * G-HIMS OPD Queue Domain Service
 * Server-authoritative queue state for call-in, completion and no-show transitions.
 */

import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { AtomicMutationRejectedError, TransactionManager } from '../transactions/transaction-manager';
import { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';

export type OpdQueueStatus = 'waiting' | 'called' | 'in_consultation' | 'completed' | 'no_show' | 'transferred';

export interface UpdateOpdQueueStatusPayload {
  tokenId: string;
  targetStatus: Exclude<OpdQueueStatus, 'waiting'>;
  targetDepartment?: string;
  assignedDoctorName?: string;
  assignedRoomOrBay?: string;
}

interface OpdQueueState {
  id: string;
  encounterId: string;
  patientId: string;
  patientName: string;
  mrn: string;
  tokenNumber: string;
  department: string;
  priority: string;
  status: OpdQueueStatus;
  arrivalTime: string;
  createdAt: number;
  updatedAt?: number;
}

const ALLOWED_TRANSITIONS: Record<OpdQueueStatus, OpdQueueStatus[]> = {
  waiting: ['called', 'in_consultation', 'no_show', 'transferred'],
  called: ['in_consultation', 'no_show', 'transferred'],
  in_consultation: ['completed', 'transferred'],
  completed: [],
  no_show: [],
  transferred: [],
};

export class OpdQueueDomainService {
  public static async updateStatus(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: UpdateOpdQueueStatusPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['RECEPTIONIST', 'NURSE', 'DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN', 'ADMINISTRATOR'],
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Not authorized to manage OPD queue state.',
        },
      };
    }

    // Resolve the immutable encounter linkage first, then re-read both token and
    // encounter inside the committing transaction. This prevents a stale UI or
    // concurrent cashier/queue action from bypassing the payment gate.
    const tokenLink = await DomainStateRepository.getById<OpdQueueState>(
      context.tenantId,
      'opd_queue',
      payload.tokenId
    );

    if (!tokenLink?.encounterId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'OPD_TOKEN_NOT_FOUND',
          message: `OPD token ${payload.tokenId} was not found or has no encounter linkage.`,
        },
      };
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'OPD_STAFF',
        aggregateType: 'OPD_QUEUE_TOKEN',
        aggregateId: payload.tokenId,
        eventType:
          payload.targetStatus === 'called'
            ? 'OPD_PATIENT_CALLED'
            : payload.targetStatus === 'in_consultation'
              ? 'OPD_SERVICE_STARTED'
              : payload.targetStatus === 'completed'
                ? 'OPD_CONSULTATION_COMPLETED'
                : payload.targetStatus === 'transferred'
                  ? 'OPD_QUEUE_TRANSFERRED'
                  : 'OPD_PATIENT_NO_SHOW',
        auditAction: 'UPDATE_OPD_QUEUE_STATUS',
        auditResourceType: 'OPD_QUEUE_TOKEN',
        auditResourceId: payload.tokenId,
        outboxTopic: 'g-hims-clinical-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'token',
            entityType: 'OPD_QUEUE_TOKEN',
            entityId: payload.tokenId,
            required: true,
          },
          {
            key: 'encounter',
            entityType: 'ENCOUNTER',
            entityId: tokenLink.encounterId,
            required: true,
          },
        ],
        prepare: (current) => {
          const token = current.token as unknown as OpdQueueState;
          const encounter = current.encounter || {};

          if (String(token.encounterId || '') !== tokenLink.encounterId) {
            throw new AtomicMutationRejectedError(
              'OPD_TOKEN_ENCOUNTER_CHANGED',
              'Queue token encounter linkage changed during service-start validation.'
            );
          }

          if (!ALLOWED_TRANSITIONS[token.status]?.includes(payload.targetStatus)) {
            throw new AtomicMutationRejectedError(
              'INVALID_OPD_QUEUE_TRANSITION',
              `Cannot transition OPD token from ${token.status} to ${payload.targetStatus}.`
            );
          }

          if (payload.targetStatus === 'in_consultation') {
            const clearance = String(
              encounter.financialClearanceState || 'CONSULTATION_PAYMENT_PENDING'
            ).toUpperCase();
            if (!['CONSULTATION_CLEARED', 'NOT_REQUIRED'].includes(clearance)) {
              throw new AtomicMutationRejectedError(
                'CONSULTATION_PAYMENT_REQUIRED',
                'Consultation payment must be authoritatively cleared before OPD service can start.',
                { financialClearanceState: clearance }
              );
            }

            const clinicalState = String(
              encounter.clinicalState || encounter.currentStage || ''
            ).toUpperCase();
            if (!['REGISTERED', 'TRIAGE'].includes(clinicalState)) {
              throw new AtomicMutationRejectedError(
                'OPD_QUEUE_CLINICAL_STATE_MISMATCH',
                `Queue service cannot start while encounter clinical state is '${clinicalState}'.`
              );
            }
          }

          const now = Date.now();
          const updated: OpdQueueState = {
            ...token,
            status: payload.targetStatus,
            ...(payload.targetDepartment ? { department: payload.targetDepartment } : {}),
            ...(payload.assignedDoctorName ? { assignedDoctorName: payload.assignedDoctorName } : {}),
            ...(payload.assignedRoomOrBay ? { assignedRoomOrBay: payload.assignedRoomOrBay } : {}),
            updatedAt: now,
          };

          const updatedEncounter =
            payload.targetStatus === 'in_consultation'
              ? {
                  ...encounter,
                  operationalState: 'IN_SERVICE',
                  updatedAt: now,
                }
              : encounter;

          return {
            domainState: updated,
            additionalStateWrites:
              payload.targetStatus === 'in_consultation'
                ? [
                    {
                      entityType: 'ENCOUNTER',
                      entityId: token.encounterId,
                      domainState: updatedEncounter,
                    },
                  ]
                : [],
            eventPayload: {
              tokenId: token.id,
              encounterId: token.encounterId,
              patientId: token.patientId,
              previousStatus: token.status,
              newStatus: payload.targetStatus,
              financialClearanceState: encounter.financialClearanceState,
            },
            auditReason: `OPD token ${token.tokenNumber} transitioned from ${token.status} to ${payload.targetStatus}`,
            resultData: updated,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.tokenId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        };
      }
      throw error;
    }
  }
}
