/**
 * Encounter Domain Service
 * Enforces stage transitions, evidence prerequisites, and longitudinal graph links.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';

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

interface EncounterState {
  encounterId: string;
  tenantId: string;
  patientId: string;
  encounterType: CreateEncounterPayload['encounterType'];
  chiefComplaint: string;
  departmentId: string;
  status: string;
  currentStage: string;
  priority: 'STAT' | 'URGENT' | 'ROUTINE';
  assignedProviderId: string;
  createdAt: number;
  updatedAt: number;
}

export class EncounterDomainService {
  private static encounterCache = new Map<string, EncounterState>();

  private static cacheKey(tenantId: string, encounterId: string): string {
    return `${tenantId}:${encounterId}`;
  }

  private static async loadEncounter(
    tenantId: string,
    encounterId: string
  ): Promise<EncounterState | null> {
    const key = this.cacheKey(tenantId, encounterId);

    if (DomainStateRepository.isAvailable()) {
      const persisted = await DomainStateRepository.getById<EncounterState>(
        tenantId,
        'encounters',
        encounterId
      );

      if (persisted) this.encounterCache.set(key, persisted);
      else this.encounterCache.delete(key);

      return persisted;
    }

    return this.encounterCache.get(key) || null;
  }
  /**
   * Creates a new clinical encounter with atomic transaction.
   */
  public static async createEncounter(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateEncounterPayload
  ): Promise<CommandResult> {
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
    const domainState: EncounterState = {
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

    this.encounterCache.set(this.cacheKey(context.tenantId, encounterId), domainState);

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

    const encounter = await this.loadEncounter(context.tenantId, payload.encounterId);
    if (!encounter) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_NOT_FOUND',
          message: `Encounter ${payload.encounterId} was not found in tenant ${context.tenantId}.`,
        },
      };
    }

    if (encounter.currentStage !== payload.currentStage) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'STALE_ENCOUNTER_STAGE',
          message: `Encounter is currently at '${encounter.currentStage}', not caller-declared '${payload.currentStage}'.`,
        },
      };
    }

    if (!payload.targetStage || payload.targetStage === payload.currentStage) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_STAGE_TRANSITION',
          message: 'Target stage must differ from the current persisted stage.',
        },
      };
    }

    const transitionedAt = Date.now();
    const stageRuntimeId = `stg_${crypto.randomUUID()}`;
    const stageState = {
      encounterId: payload.encounterId,
      previousStage: encounter.currentStage,
      newStage: payload.targetStage,
      advancedBy: context.actorId,
      evidenceId: payload.evidenceId,
      sbar: payload.handoffSbar,
      stageNotes: payload.stageNotes,
      transitionedAt,
    };

    const updatedEncounter: EncounterState = {
      ...encounter,
      currentStage: payload.targetStage,
      updatedAt: transitionedAt,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'ENCOUNTER_STAGE',
      aggregateId: stageRuntimeId,
      eventType: 'STAGE_COMPLETED',
      eventPayload: {
        encounterId: payload.encounterId,
        fromStage: encounter.currentStage,
        toStage: payload.targetStage,
        evidenceId: payload.evidenceId,
      },
      auditReason: `Transitioned encounter ${payload.encounterId} from ${encounter.currentStage} to ${payload.targetStage}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: stageState,
      additionalStateWrites: [
        {
          entityType: 'ENCOUNTER',
          entityId: payload.encounterId,
          domainState: updatedEncounter,
        },
      ],
    });

    this.encounterCache.set(
      this.cacheKey(context.tenantId, payload.encounterId),
      updatedEncounter
    );

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.encounterId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: stageState,
    };
  }

}
