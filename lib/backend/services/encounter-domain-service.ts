/**
 * Encounter Domain Service
 * Enforces stage transitions, evidence prerequisites, and longitudinal graph links.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { OpdWorkflowRuntimeService } from './opd-workflow-runtime-service';
import {
  activateCareContext,
  closeCareContext,
  compatibilityEncounterId,
  normalizeCareSetting,
  normalizePatientCarePointers,
} from '@/lib/clinical/patient360/care-context';
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

export interface CommitEncounterDispositionPayload {
  encounterId: string;
  dispositionType:
    | 'DISCHARGED_HOME'
    | 'FOLLOW_UP_SCHEDULED'
    | 'INTERNAL_REFERRAL'
    | 'EXTERNAL_REFERRAL'
    | 'INPATIENT_ADMISSION_RECOMMENDED'
    | 'EMERGENCY_TRANSFER'
    | string;
  patientInstructions?: string;
  warningSignsRedFlags?: string;
  followUpScheduledDate?: string;
  followUpDepartment?: string;
  inpatientAdmissionRequest?: {
    targetWard: string;
    targetBedId?: string;
    clinicalIndication: string;
    admittingService?: string;
  };
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
  priority: 'STAT' | 'URGENT' | 'ROUTINE' | 'EMERGENCY';
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
      const persisted = await DomainStateRepository.getById<Record<string, unknown>>(
        tenantId,
        'encounters',
        encounterId
      );

      if (!persisted) {
        // Authoritative runtime never fabricates clinical state when Firestore
        // cannot resolve the encounter. Test/demo fixtures must be provisioned
        // explicitly into their isolated environments.
        this.encounterCache.delete(key);
        return null;
      }

      const encounterType = String(
        persisted.encounterType || persisted.type || 'OPD'
      ).toUpperCase() as CreateEncounterPayload['encounterType'];
      const rawStage = String(
        persisted.currentStage || persisted.currentStageId || 'REGISTERED'
      );
      const clinicalState =
        (persisted.clinicalState as ClinicalEncounterState | undefined) ||
        normalizeClinicalEncounterState(rawStage) ||
        'REGISTERED';

      const normalized: EncounterState = {
        encounterId: String(persisted.encounterId || persisted.id || encounterId),
        tenantId: String(persisted.tenantId || tenantId),
        patientId: String(persisted.patientId || ''),
        encounterType,
        chiefComplaint: String(persisted.chiefComplaint || ''),
        departmentId: String(persisted.departmentId || persisted.department || ''),
        status:
          String(persisted.status || 'ACTIVE').toUpperCase() === 'IN_PROGRESS'
            ? 'ACTIVE'
            : String(persisted.status || 'ACTIVE').toUpperCase(),
        currentStage: clinicalState,
        clinicalState,
        operationalState:
          (persisted.operationalState as OperationalQueueState | undefined) || 'NOT_QUEUED',
        financialClearanceState:
          (persisted.financialClearanceState as FinancialClearanceState | undefined) ||
          (encounterType === 'EMERGENCY' || encounterType === 'IPD'
            ? 'NOT_REQUIRED'
            : 'CONSULTATION_PAYMENT_PENDING'),
        resourceAssignmentState:
          (persisted.resourceAssignmentState as ResourceAssignmentState | undefined) || 'NONE',
        priority: String(persisted.priority || 'ROUTINE').toUpperCase() as EncounterState['priority'],
        assignedProviderId: String(persisted.assignedProviderId || persisted.assignedDoctor || ''),
        createdAt: Number(persisted.createdAt || persisted.startedAt || Date.now()),
        updatedAt: Number(persisted.updatedAt || persisted.startedAt || Date.now()),
      };

      this.encounterCache.set(key, normalized);
      return normalized;
    }

    return this.encounterCache.get(key) || null;
  }
  /**
   * Resolves the authoritative encounter snapshot using durable state when
   * available and the service's transaction-backed in-memory fallback in tests.
   * Domain services should use this instead of inventing parallel encounter caches.
   */
  public static async getAuthoritativeEncounter(
    tenantId: string,
    encounterId: string
  ): Promise<Record<string, unknown> | null> {
    const encounter = await this.loadEncounter(tenantId, encounterId);
    return encounter ? { ...encounter } : null;
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

    // Inpatient admission is a governed care transition because encounter
    // creation and bed/census assignment must commit atomically.
    if (payload.encounterType === 'IPD') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'CARE_TRANSITION_COMMAND_REQUIRED',
          message:
            'Inpatient admission must use AdmitPatientToInpatientCareCommand so IPD encounter, patient care context, and bed assignment are committed together.',
        },
      };
    }

    // 3. Authoritative patient precondition and state initialization.
    const patient = DomainStateRepository.isAvailable()
      ? await DomainStateRepository.getById<Record<string, unknown>>(
          context.tenantId,
          'patients',
          payload.patientId
        )
      : TransactionManager.getEphemeralStateForTesting(
          context.tenantId,
          'PATIENT_MPI',
          payload.patientId
        );
    if (!patient) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_NOT_FOUND',
          message: 'Encounter target patient does not exist in the authenticated tenant.',
        },
      };
    }

    if (
      ['MERGED', 'DECEASED', 'INACTIVE'].includes(
        String(patient.status || '').toUpperCase()
      )
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PATIENT_NOT_ACTIVE',
          message: 'A new encounter cannot be opened against a non-active patient identity.',
        },
      };
    }

    const now = Date.now();
    const encounterId = `enc_${crypto.randomUUID()}`;
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
        payload.encounterType === 'EMERGENCY'
          ? 'NOT_REQUIRED'
          : 'CONSULTATION_PAYMENT_PENDING',
      resourceAssignmentState: 'NONE',
      priority: payload.priority || 'ROUTINE',
      assignedProviderId: context.actorId,
      createdAt: now,
      updatedAt: now,
    };

    const activeCareContexts = activateCareContext(
      patient.activeCareContexts as any,
      normalizeCareSetting(payload.encounterType),
      encounterId,
      now
    );
    const patientState = {
      ...patient,
      activeCareContexts,
      activeEncounterId: compatibilityEncounterId(activeCareContexts),
      updatedAt: now,
    };

    // 4. Encounter + patient care context commit atomically.
    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'ENCOUNTER',
      aggregateId: encounterId,
      eventType: 'ENCOUNTER_CREATED',
      eventPayload: {
        encounterId,
        patientId: payload.patientId,
        encounterType: payload.encounterType,
        careSetting: normalizeCareSetting(payload.encounterType),
        chiefComplaint: payload.chiefComplaint,
      },
      auditAction: 'CREATE_ENCOUNTER',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: encounterId,
      auditReason: `Initiated ${payload.encounterType} encounter for patient ${payload.patientId}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState,
      additionalStateWrites: [
        {
          entityType: 'PATIENT_MPI',
          entityId: payload.patientId,
          domainState: patientState,
        },
      ],
    });

    this.encounterCache.set(this.cacheKey(context.tenantId, encounterId), domainState);

    const result: CommandResult = {
      success: true,
      commandId,
      idempotencyKey,
      entityId: encounterId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: { encounter: domainState, patient: patientState },
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
    const carePointers = normalizePatientCarePointers(
      patient.activeCareContexts as any
    );
    const candidateOpdIds = [...carePointers.activeOpdEncounterIds];
    if (candidateOpdIds.length === 0 && patient.activeEncounterId) {
      const legacyActive = await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        String(patient.activeEncounterId)
      );
      if (
        legacyActive &&
        normalizeCareSetting(legacyActive.encounterType || legacyActive.type) === 'OPD'
      ) {
        candidateOpdIds.push(String(patient.activeEncounterId));
      }
    }

    for (const activeOpdEncounterId of candidateOpdIds) {
      const active = await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        activeOpdEncounterId
      );
      if (
        active &&
        !['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED'].includes(
          String(active.status || '').toUpperCase()
        )
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'PATIENT_ACTIVE_OPD_ENCOUNTER_CONFLICT',
            message: `Patient already has active OPD encounter ${activeOpdEncounterId}.`,
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

    const activeCareContexts = activateCareContext(
      patient.activeCareContexts as any,
      'OPD',
      encounterId,
      now
    );
    const patientState = {
      ...patient,
      activeCareContexts,
      activeEncounterId: compatibilityEncounterId(activeCareContexts),
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

  public static async commitDisposition(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CommitEncounterDispositionPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Disposition authority required.' },
      };
    }

    const encounter = await this.loadEncounter(context.tenantId, payload.encounterId);
    if (!encounter) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'ENCOUNTER_NOT_FOUND', message: 'Encounter does not exist.' },
      };
    }
    if (['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED'].includes(String(encounter.status).toUpperCase())) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'ENCOUNTER_ALREADY_CLOSED', message: `Encounter is already ${encounter.status}.` },
      };
    }

    // OPD disposition is a terminal clinical action. It may only execute after
    // the authoritative workflow runtime has advanced the encounter to the
    // discharge/referral stage. This prevents clients from bypassing triage,
    // signed consultation evidence, diagnostics/pharmacy and billing guards by
    // calling CommitEncounterDispositionCommand directly.
    if (encounter.encounterType === 'OPD') {
      const authoritativeStage = OpdWorkflowRuntimeService.resolveStage(
        encounter.clinicalState || encounter.currentStage
      );
      if (authoritativeStage !== 'DISCHARGE_OR_REFERRAL') {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'OPD_DISPOSITION_STAGE_NOT_READY',
            message:
              'OPD disposition requires the authoritative workflow to reach DISCHARGE_OR_REFERRAL before encounter closure.',
          },
        };
      }
    }

    const patient = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'patients',
      encounter.patientId
    );
    if (!patient) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'PATIENT_NOT_FOUND', message: 'Encounter patient does not exist.' },
      };
    }

    const now = Date.now();
    const inpatientPending = payload.dispositionType === 'INPATIENT_ADMISSION_RECOMMENDED';
    if (inpatientPending && !payload.inpatientAdmissionRequest?.targetWard) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INPATIENT_ADMISSION_REQUEST_REQUIRED',
          message: 'Inpatient disposition requires a target ward and clinical indication.',
        },
      };
    }

    const updatedEncounter: EncounterState & Record<string, unknown> = {
      ...encounter,
      currentStage: inpatientPending ? 'DISPOSITION' : 'COMPLETED',
      clinicalState: inpatientPending ? 'DISPOSITION' : 'COMPLETED',
      operationalState: inpatientPending ? encounter.operationalState : 'COMPLETED',
      resourceAssignmentState: inpatientPending ? 'BED_REQUESTED' : 'RELEASED',
      status: inpatientPending ? 'ACTIVE' : 'COMPLETED',
      disposition: payload.dispositionType,
      dispositionData: {
        patientInstructions: payload.patientInstructions,
        warningSignsRedFlags: payload.warningSignsRedFlags,
        followUpScheduledDate: payload.followUpScheduledDate,
        followUpDepartment: payload.followUpDepartment,
        inpatientAdmissionRequest: payload.inpatientAdmissionRequest,
      },
      ...(inpatientPending ? {} : { completedAt: now }),
      updatedAt: now,
    };

    const encounterCareSetting = normalizeCareSetting(encounter.encounterType);
    const nextCareContexts = inpatientPending
      ? activateCareContext(
          patient.activeCareContexts as any,
          encounterCareSetting,
          encounter.encounterId,
          now
        )
      : closeCareContext(
          patient.activeCareContexts as any,
          encounterCareSetting,
          encounter.encounterId,
          now
        );
    const patientState = {
      ...patient,
      activeCareContexts: nextCareContexts,
      activeEncounterId: compatibilityEncounterId(nextCareContexts),
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'DOCTOR',
      aggregateType: 'ENCOUNTER',
      aggregateId: encounter.encounterId,
      eventType: inpatientPending
        ? 'INPATIENT_ADMISSION_REQUESTED'
        : 'ENCOUNTER_DISPOSITION_COMMITTED',
      eventPayload: {
        encounterId: encounter.encounterId,
        patientId: encounter.patientId,
        dispositionType: payload.dispositionType,
        inpatientAdmissionRequest: payload.inpatientAdmissionRequest,
      },
      auditAction: 'COMMIT_ENCOUNTER_DISPOSITION',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: encounter.encounterId,
      auditReason: `Encounter ${encounter.encounterId} disposition set to ${payload.dispositionType}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: updatedEncounter,
      additionalStateWrites: [
        { entityType: 'PATIENT_MPI', entityId: encounter.patientId, domainState: patientState },
      ],
    });

    this.encounterCache.set(this.cacheKey(context.tenantId, encounter.encounterId), updatedEncounter);

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: encounter.encounterId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: updatedEncounter,
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
    const callerCurrentState = payload.currentStage
      ? normalizeClinicalEncounterState(payload.currentStage)
      : persistedClinicalState;
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

    if (persistedClinicalState === targetClinicalState) {
      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: encounter.encounterId,
        data: encounter,
      };
    }

    if (persistedClinicalState !== callerCurrentState) {
      if (!isClinicalTransitionAllowed(persistedClinicalState, targetClinicalState)) {
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

    // OPD transitions must also satisfy the server-owned compiled v1.2 DAG.
    // The client never gets to decide or manually resolve the graph.
    if (encounter.encounterType === 'OPD') {
      const dagCheck = OpdWorkflowRuntimeService.validateTransition({
        currentStage: persistedClinicalState,
        targetStage: targetClinicalState,
        evidenceId: payload.evidenceId,
      });

      if (!dagCheck.allowed) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: dagCheck.code || 'OPD_WORKFLOW_TRANSITION_BLOCKED',
            message:
              dagCheck.message ||
              'OPD workflow runtime rejected the requested stage transition.',
          },
        };
      }
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
