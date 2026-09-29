/**
 * G-HIMS OPD Queue Domain Service
 * Server-authoritative queue state for call-in, completion and no-show transitions.
 */

import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
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

    const token = await DomainStateRepository.getById<OpdQueueState>(
      context.tenantId,
      'opd_queue',
      payload.tokenId
    );

    if (!token) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'OPD_TOKEN_NOT_FOUND',
          message: `OPD token ${payload.tokenId} was not found.`,
        },
      };
    }

    if (!ALLOWED_TRANSITIONS[token.status]?.includes(payload.targetStatus)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_OPD_QUEUE_TRANSITION',
          message: `Cannot transition OPD token from ${token.status} to ${payload.targetStatus}.`,
        },
      };
    }

    const updated: OpdQueueState = {
      ...token,
      status: payload.targetStatus,
      ...(payload.targetDepartment ? { department: payload.targetDepartment } : {}),
      ...(payload.assignedDoctorName ? { assignedDoctorName: payload.assignedDoctorName } : {}),
      ...(payload.assignedRoomOrBay ? { assignedRoomOrBay: payload.assignedRoomOrBay } : {}),
      updatedAt: Date.now(),
    };

    const tx = await TransactionManager.executeAtomicWrite(
      context,
      commandId,
      idempotencyKey,
      {
        entityType: 'OPD_QUEUE_TOKEN',
        entityId: token.id,
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
        domainState: updated,
        eventPayload: {
          tokenId: token.id,
          encounterId: token.encounterId,
          patientId: token.patientId,
          previousStatus: token.status,
          newStatus: payload.targetStatus,
        },
        auditReason: `OPD token ${token.tokenNumber} transitioned from ${token.status} to ${payload.targetStatus}`,
        outboxTopic: 'g-hims-clinical-events',
      }
    );

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: token.id,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: updated,
    };
  }
}
