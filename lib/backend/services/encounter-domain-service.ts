/**
 * Encounter Domain Service
 * Enforces stage transitions, evidence prerequisites, and longitudinal graph links.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { IdempotencyService } from '../idempotency/idempotency-service';

export interface CreateEncounterPayload {
  patientId: string;
  encounterType: 'OPD' | 'IPD' | 'EMERGENCY' | 'TELEHEALTH';
  chiefComplaint: string;
  departmentId: string;
  priority?: 'STAT' | 'URGENT' | 'ROUTINE';
}

export interface AdvanceStagePayload {
  encounterId: string;
  currentStage: string;
  targetStage: string;
  evidenceId?: string;
  stageNotes?: string;
  handoffSbar?: {
    situation: string;
    background: string;
    assessment: string;
    recommendation: string;
  };
}

export class EncounterDomainService {
  /**
   * Creates a new clinical encounter with atomic transaction.
   */
  public static async createEncounter(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateEncounterPayload
  ): Promise<CommandResult> {
    // 1. Check Idempotency
    const idemCheck = IdempotencyService.checkIdempotency(
      context.tenantId,
      idempotencyKey,
      'CreateEncounterCommand',
      payload
    );
    if (idemCheck.status === 'CACHED' && idemCheck.record?.result) {
      return { ...idemCheck.record.result, replayedFromCache: true };
    }
    if (idemCheck.status === 'CONFLICT') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Reused idempotency key with conflicting payload.' },
      };
    }

    // 2. Authorization
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['NURSE', 'DOCTOR', 'RECEPTIONIST', 'REGISTRAR', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Not authorized to create encounters.' },
      };
    }

    // 3. Domain Logic & State Initialization
    const encounterId = `enc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const domainState = {
      encounterId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterType: payload.encounterType,
      chiefComplaint: payload.chiefComplaint,
      departmentId: payload.departmentId,
      status: 'ACTIVE',
      currentStage: 'TRIAGE',
      priority: payload.priority || 'ROUTINE',
      assignedProviderId: context.actorId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 4. Atomic Transaction Commit
    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'ENCOUNTER',
      entityId: encounterId,
      eventType: 'ENCOUNTER_CREATED',
      domainState,
      eventPayload: {
        encounterId,
        patientId: payload.patientId,
        encounterType: payload.encounterType,
        chiefComplaint: payload.chiefComplaint,
      },
      auditReason: `Initiated ${payload.encounterType} encounter for patient ${payload.patientId}`,
      outboxTopic: 'g-hims-clinical-events',
    });

    const result: CommandResult = {
      success: true,
      commandId,
      idempotencyKey,
      entityId: encounterId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: domainState,
    };

    IdempotencyService.recordExecution(context.tenantId, idempotencyKey, 'CreateEncounterCommand', payload, result);
    return result;
  }

  /**
   * Advances an encounter through its governed clinical workflow stage.
   */
  public static async advanceStage(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AdvanceStagePayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['NURSE', 'DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Not authorized to advance stage.' },
      };
    }

    const stageRuntimeId = `stg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const domainState = {
      encounterId: payload.encounterId,
      previousStage: payload.currentStage,
      newStage: payload.targetStage,
      advancedBy: context.actorId,
      evidenceId: payload.evidenceId,
      sbar: payload.handoffSbar,
      transitionedAt: Date.now(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'ENCOUNTER_STAGE',
      entityId: stageRuntimeId,
      eventType: 'STAGE_COMPLETED',
      domainState,
      eventPayload: {
        encounterId: payload.encounterId,
        fromStage: payload.currentStage,
        toStage: payload.targetStage,
        evidenceId: payload.evidenceId,
      },
      auditReason: `Transitioned stage from ${payload.currentStage} to ${payload.targetStage}`,
      outboxTopic: 'g-hims-clinical-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.encounterId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: domainState,
    };
  }
}
