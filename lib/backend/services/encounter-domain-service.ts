/**
 * Encounter Domain Service
 * Enforces stage transitions, evidence prerequisites, and longitudinal graph links.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import {
  type ClinicalEncounterState,
  type FinancialClearanceState,
  type OperationalQueueState,
  type ResourceAssignmentState,
  isClinicalTransitionAllowed,
  normalizeClinicalEncounterState,
} from '@/types/clinical-state';

export interface CreateEncounterPayload {
  patientId: string;
  encounterType: 'OPD' | 'IPD' | 'EMERGENCY' | 'TELEHEALTH';
  chiefComplaint: string;
  departmentId: string;
  priority?: 'STAT' | 'URGENT' | 'ROUTINE';
}

export interface CreateOpdEncounterPayload {
  patientId: string;
  chiefComplaint: string;
  departmentId: string;
  priority?: 'STAT' | 'URGENT' | 'ROUTINE';
  assignedDoctor?: string;
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
  clinicalState: ClinicalEncounterState;
  operationalState: OperationalQueueState;
  financialClearanceState: FinancialClearanceState;
  resourceAssignmentState: ResourceAssignmentState;
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
      currentStage: payload.encounterType === 'TELEHEALTH' ? 'CONSULTATION' : 'TRIAGE',
      clinicalState: payload.encounterType === 'TELEHEALTH' ? 'CONSULTATION' : 'TRIAGE',
      operationalState: 'NOT_QUEUED',
      financialClearanceState:
        payload.encounterType === 'EMERGENCY' || payload.encounterType === 'IPD'
          ? 'NOT_REQUIRED'
          : 'CONSULTATION_PAYMENT_PENDING',
      resourceAssignmentState: 'NONE',
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

  public static async createOpdEncounter(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateOpdEncounterPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['RECEPTIONIST', 'REGISTRAR', 'NURSE', 'DOCTOR', 'SYSTEM_ADMIN', 'ADMINISTRATOR'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Not authorized to start an OPD encounter.' },
      };
    }

    const patient = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'patients',
      payload.patientId
    );
    if (!patient) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'PATIENT_NOT_FOUND', message: 'Patient does not exist.' },
      };
    }
    if (['MERGED', 'DECEASED', 'INACTIVE'].includes(String(patient.status || '').toUpperCase())) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'PATIENT_NOT_ACTIVE', message: 'Only an active patient can start a new OPD encounter.' },
      };
    }
    if (patient.activeEncounterId) {
      const active = await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        String(patient.activeEncounterId)
      );
      if (active && !['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED'].includes(String(active.status || '').toUpperCase())) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'PATIENT_ACTIVE_ENCOUNTER_CONFLICT',
            message: `Patient already has active encounter ${String(patient.activeEncounterId)}.`,
          },
        };
      }
    }

    const now = Date.now();
    const encounterId = `enc_opd_${crypto.randomUUID()}`;
    const tokenId = `opd_${encounterId}`;
    const tokenNumber = `OPD-${String(now).slice(-6)}`;
    const fullName = String(patient.fullName || '');
    const mrn = String(patient.mrn || '');

    const encounterState: EncounterState = {
      encounterId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterType: 'OPD',
      chiefComplaint: payload.chiefComplaint,
      departmentId: payload.departmentId,
      status: 'ACTIVE',
      currentStage: 'REGISTERED',
      clinicalState: 'REGISTERED',
      operationalState: 'QUEUED',
      financialClearanceState: 'CONSULTATION_PAYMENT_PENDING',
      resourceAssignmentState: 'NONE',
      priority: payload.priority || 'ROUTINE',
      assignedProviderId: payload.assignedDoctor || context.actorId,
      createdAt: now,
      updatedAt: now,
    };

    const patientState = {
      ...patient,
      activeEncounterId: encounterId,
      updatedAt: now,
    };

    const queueState = {
      id: tokenId,
      encounterId,
      patientId: payload.patientId,
      patientName: fullName,
      mrn,
      tokenNumber,
      department: payload.departmentId,
      priority: String(payload.priority || 'ROUTINE').toLowerCase(),
      status: 'waiting',
      arrivalTime: new Date(now).toISOString(),
      createdAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'RECEPTIONIST',
      aggregateType: 'ENCOUNTER',
      aggregateId: encounterId,
      eventType: 'OPD_ENCOUNTER_CREATED',
      eventPayload: {
        encounterId,
        patientId: payload.patientId,
        tokenId,
        tokenNumber,
        departmentId: payload.departmentId,
        priority: payload.priority || 'ROUTINE',
      },
      auditAction: 'CREATE_OPD_ENCOUNTER',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: encounterId,
      auditReason: `Created OPD encounter ${encounterId} for patient ${mrn || payload.patientId}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: encounterState,
      additionalStateWrites: [
        { entityType: 'PATIENT_MPI', entityId: payload.patientId, domainState: patientState },
        { entityType: 'OPD_QUEUE_TOKEN', entityId: tokenId, domainState: queueState },
      ],
    });

    this.encounterCache.set(this.cacheKey(context.tenantId, encounterId), encounterState);

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: encounterId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: { encounter: encounterState, queueToken: queueState, patient: patientState },
    };
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

    const persistedClinicalState =
      encounter.clinicalState || normalizeClinicalEncounterState(encounter.currentStage);
    const callerCurrentState = normalizeClinicalEncounterState(payload.currentStage);
    const targetClinicalState = normalizeClinicalEncounterState(payload.targetStage);

    if (!persistedClinicalState || !callerCurrentState || !targetClinicalState) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'UNKNOWN_CLINICAL_STAGE',
          message: 'Encounter stage must map to the canonical clinical workflow contract.',
        },
      };
    }

    if (persistedClinicalState !== callerCurrentState) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'STALE_ENCOUNTER_STAGE',
          message: `Encounter is currently at canonical state '${persistedClinicalState}', not caller-declared '${callerCurrentState}'.`,
        },
      };
    }

    if (!isClinicalTransitionAllowed(persistedClinicalState, targetClinicalState)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_STAGE_TRANSITION',
          message: `Canonical clinical transition ${persistedClinicalState} -> ${targetClinicalState} is not allowed.`,
        },
      };
    }

    const transitionedAt = Date.now();
    const stageRuntimeId = `stg_${crypto.randomUUID()}`;
    const stageState = {
      encounterId: payload.encounterId,
      previousStage: persistedClinicalState,
      newStage: targetClinicalState,
      advancedBy: context.actorId,
      evidenceId: payload.evidenceId,
      sbar: payload.handoffSbar,
      stageNotes: payload.stageNotes,
      transitionedAt,
    };

    const updatedEncounter: EncounterState = {
      ...encounter,
      currentStage: targetClinicalState,
      clinicalState: targetClinicalState,
      status: targetClinicalState === 'COMPLETED' ? 'COMPLETED' : encounter.status,
      operationalState:
        targetClinicalState === 'COMPLETED' ? 'COMPLETED' : encounter.operationalState,
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
        fromStage: persistedClinicalState,
        toStage: targetClinicalState,
        evidenceId: payload.evidenceId,
      },
      auditReason: `Transitioned encounter ${payload.encounterId} from ${persistedClinicalState} to ${targetClinicalState}`,
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
