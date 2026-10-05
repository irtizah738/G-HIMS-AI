import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { normalizeCareSetting } from '@/lib/clinical/patient360/care-context';
import type {
  ClinicalConsultationRequest,
  ClinicalHandoff,
  ClinicalEscalationProjection,
} from '@/types/clinical-coordination';
import type { ClinicalOpenItemProjection } from '@/types/consultant-visibility';

interface ScopedClinicalPayload {
  patientId: string;
  encounterId: string;
}

export interface RequestConsultationPayload extends ScopedClinicalPayload {
  requestedSpecialty: string;
  requestedConsultantId?: string;
  clinicalQuestion: string;
  priority?: 'ROUTINE' | 'URGENT' | 'STAT';
  sourceRefs?: string[];
}

export interface AcceptConsultationPayload extends ScopedClinicalPayload {
  consultationId: string;
}

export interface CompleteConsultationPayload extends ScopedClinicalPayload {
  consultationId: string;
  assessment: string;
  recommendations: string[];
  followUpRequired?: boolean;
  primaryTeamReviewRequired?: boolean;
}

export interface CreateClinicalHandoffPayload extends ScopedClinicalPayload {
  toClinicianId?: string;
  toDepartmentId?: string;
  toRole?: string;
  currentProblemSummary: string;
  activeRisks?: string[];
  pendingDiagnostics?: string[];
  pendingProcedures?: string[];
  pendingConsultations?: string[];
  medicationConcerns?: string[];
  unresolvedItems?: string[];
  expectedActions?: string[];
}

export interface AcceptClinicalHandoffPayload extends ScopedClinicalPayload {
  handoffId: string;
}

export interface AcknowledgeOpenItemPayload extends ScopedClinicalPayload {
  openItemId: string;
  note?: string;
}

export interface ResolveOpenItemPayload extends ScopedClinicalPayload {
  openItemId: string;
  resolutionReason: string;
  resolutionRef?: string;
}

export interface AcknowledgeEscalationPayload extends ScopedClinicalPayload {
  escalationId: string;
  note?: string;
}

function clinicalCoordinatorAuth(context: CommandContext) {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: [
      'DOCTOR',
      'CONSULTANT',
      'ATTENDING_PHYSICIAN',
      'SYSTEM_ADMIN',
    ],
    requiredPrivilege: 'SIGN_CLINICAL_NOTES',
    allowBreakGlass: true,
  });
}

function handoffAuth(context: CommandContext) {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: [
      'NURSE',
      'DOCTOR',
      'CONSULTANT',
      'ATTENDING_PHYSICIAN',
      'SYSTEM_ADMIN',
    ],
    requiredPrivilege: 'RECORD_VITALS',
    allowBreakGlass: true,
  });
}

async function loadScopedPatientEncounter(
  context: CommandContext,
  payload: ScopedClinicalPayload
): Promise<
  | { patient: Record<string, unknown>; encounter: Record<string, unknown> }
  | { error: { code: string; message: string } }
> {
  const [patient, encounter] = await Promise.all([
    DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'patients',
      payload.patientId
    ),
    DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'encounters',
      payload.encounterId
    ),
  ]);

  if (!patient) {
    return { error: { code: 'PATIENT_NOT_FOUND', message: 'Patient does not exist.' } };
  }
  if (!encounter || String(encounter.patientId || '') !== payload.patientId) {
    return {
      error: {
        code: 'ENCOUNTER_PATIENT_MISMATCH',
        message: 'Encounter does not belong to the supplied patient.',
      },
    };
  }

  assertPatient360PatientAccess(context, patient, encounter);
  return { patient, encounter };
}

function failure(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string
): CommandResult {
  return {
    success: false,
    commandId,
    idempotencyKey,
    error: { code, message },
  };
}

export class ClinicalCoordinationDomainService {
  public static async requestConsultation(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RequestConsultationPayload
  ): Promise<CommandResult> {
    const auth = clinicalCoordinatorAuth(context);
    if (!auth.authorized) {
      return failure(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Credentialed clinician authority is required to request consultation.'
      );
    }

    const scoped = await loadScopedPatientEncounter(context, payload);
    if ('error' in scoped) {
      return failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);
    }

    const requestedSpecialty = String(payload.requestedSpecialty || '').trim();
    const clinicalQuestion = String(payload.clinicalQuestion || '').trim();
    if (!requestedSpecialty || !clinicalQuestion) {
      return failure(
        commandId,
        idempotencyKey,
        'CONSULTATION_REQUEST_INVALID',
        'Requested specialty and explicit clinical question are required.'
      );
    }

    const now = Date.now();
    const consultationId = `consult_${crypto.randomUUID()}`;
    const consultation: ClinicalConsultationRequest = {
      consultationId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      careSetting: normalizeCareSetting(
        scoped.encounter.encounterType || scoped.encounter.type
      ),
      requestedSpecialty,
      requestedConsultantId: payload.requestedConsultantId?.trim() || undefined,
      assignedConsultantId: payload.requestedConsultantId?.trim() || undefined,
      clinicalQuestion,
      priority: payload.priority || 'ROUTINE',
      status: payload.requestedConsultantId ? 'ASSIGNED' : 'REQUESTED',
      sourceRefs: Array.from(new Set(payload.sourceRefs || [])).slice(0, 100),
      requestedBy: context.actorId,
      requestedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'CLINICAL_CONSULTATION_REQUEST',
      aggregateId: consultationId,
      eventType: 'CLINICAL_CONSULTATION_REQUESTED',
      eventPayload: {
        consultationId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        requestedSpecialty,
        requestedConsultantId: consultation.requestedConsultantId,
        priority: consultation.priority,
        clinicalQuestion,
      },
      auditAction: 'REQUEST_CLINICAL_CONSULTATION',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: payload.encounterId,
      auditReason: `Requested ${requestedSpecialty} consultation for patient ${payload.patientId}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: consultation,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: consultationId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: consultation,
    };
  }

  public static async acceptConsultation(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AcceptConsultationPayload
  ): Promise<CommandResult> {
    const auth = clinicalCoordinatorAuth(context);
    if (!auth.authorized) {
      return failure(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Credentialed consultant authority is required.'
      );
    }

    const scoped = await loadScopedPatientEncounter(context, payload);
    if ('error' in scoped) {
      return failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);
    }

    const current = await DomainStateRepository.getById<ClinicalConsultationRequest>(
      context.tenantId,
      'consultationRequests',
      payload.consultationId
    );
    if (!current) {
      return failure(commandId, idempotencyKey, 'CONSULTATION_NOT_FOUND', 'Consultation request was not found.');
    }
    if (
      current.patientId !== payload.patientId ||
      current.encounterId !== payload.encounterId
    ) {
      return failure(commandId, idempotencyKey, 'CONSULTATION_SCOPE_MISMATCH', 'Consultation does not match the patient encounter.');
    }
    if (!['REQUESTED', 'ASSIGNED'].includes(current.status)) {
      return failure(commandId, idempotencyKey, 'CONSULTATION_NOT_ACCEPTABLE', 'Only requested or assigned consultations can be accepted.');
    }
    if (
      current.requestedConsultantId &&
      current.requestedConsultantId !== context.actorId &&
      !context.roles.some((role) => ['SYSTEM_ADMIN'].includes(String(role).toUpperCase()))
    ) {
      return failure(commandId, idempotencyKey, 'CONSULTATION_ASSIGNEE_MISMATCH', 'Consultation is assigned to another consultant.');
    }

    const now = Date.now();
    const next: ClinicalConsultationRequest = {
      ...current,
      assignedConsultantId: context.actorId,
      acceptedBy: context.actorId,
      acceptedAt: now,
      status: 'ACCEPTED',
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CONSULTANT',
      aggregateType: 'CLINICAL_CONSULTATION_REQUEST',
      aggregateId: current.consultationId,
      eventType: 'CLINICAL_CONSULTATION_ACCEPTED',
      eventPayload: {
        consultationId: current.consultationId,
        patientId: current.patientId,
        encounterId: current.encounterId,
        assignedConsultantId: context.actorId,
        acceptedAt: now,
      },
      auditAction: 'ACCEPT_CLINICAL_CONSULTATION',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: current.encounterId,
      auditReason: `Consultant ${context.actorId} accepted consultation ${current.consultationId}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: next,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: current.consultationId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: next,
    };
  }

  public static async completeConsultation(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CompleteConsultationPayload
  ): Promise<CommandResult> {
    const auth = clinicalCoordinatorAuth(context);
    if (!auth.authorized) {
      return failure(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Credentialed consultant authority is required.'
      );
    }

    const scoped = await loadScopedPatientEncounter(context, payload);
    if ('error' in scoped) {
      return failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);
    }

    const current = await DomainStateRepository.getById<ClinicalConsultationRequest>(
      context.tenantId,
      'consultationRequests',
      payload.consultationId
    );
    if (!current) {
      return failure(commandId, idempotencyKey, 'CONSULTATION_NOT_FOUND', 'Consultation request was not found.');
    }
    if (
      current.patientId !== payload.patientId ||
      current.encounterId !== payload.encounterId
    ) {
      return failure(commandId, idempotencyKey, 'CONSULTATION_SCOPE_MISMATCH', 'Consultation does not match the patient encounter.');
    }
    if (!['ACCEPTED', 'IN_REVIEW'].includes(current.status)) {
      return failure(commandId, idempotencyKey, 'CONSULTATION_NOT_COMPLETABLE', 'Consultation must be accepted before completion.');
    }
    if (
      current.assignedConsultantId &&
      current.assignedConsultantId !== context.actorId &&
      !context.roles.some((role) => String(role).toUpperCase() === 'SYSTEM_ADMIN')
    ) {
      return failure(commandId, idempotencyKey, 'CONSULTATION_ASSIGNEE_MISMATCH', 'Only the assigned consultant may complete this consultation.');
    }

    const assessment = String(payload.assessment || '').trim();
    const recommendations = (payload.recommendations || [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 100);
    if (!assessment) {
      return failure(commandId, idempotencyKey, 'CONSULTATION_ASSESSMENT_REQUIRED', 'Consultation assessment is required.');
    }

    const now = Date.now();
    const next: ClinicalConsultationRequest = {
      ...current,
      status: 'COMPLETED',
      completedBy: context.actorId,
      completedAt: now,
      assessment,
      recommendations,
      followUpRequired: Boolean(payload.followUpRequired),
      primaryTeamReviewRequired: Boolean(payload.primaryTeamReviewRequired),
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CONSULTANT',
      aggregateType: 'CLINICAL_CONSULTATION_REQUEST',
      aggregateId: current.consultationId,
      eventType: 'CLINICAL_CONSULTATION_COMPLETED',
      eventPayload: {
        consultationId: current.consultationId,
        patientId: current.patientId,
        encounterId: current.encounterId,
        completedBy: context.actorId,
        followUpRequired: next.followUpRequired,
        primaryTeamReviewRequired: next.primaryTeamReviewRequired,
      },
      auditAction: 'COMPLETE_CLINICAL_CONSULTATION',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: current.encounterId,
      auditReason: `Completed consultation ${current.consultationId} for patient ${current.patientId}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: next,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: current.consultationId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: next,
    };
  }

  public static async createHandoff(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateClinicalHandoffPayload
  ): Promise<CommandResult> {
    const auth = handoffAuth(context);
    if (!auth.authorized) {
      return failure(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Credentialed clinical handoff authority is required.'
      );
    }

    const scoped = await loadScopedPatientEncounter(context, payload);
    if ('error' in scoped) {
      return failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);
    }

    const summary = String(payload.currentProblemSummary || '').trim();
    const toClinicianId = payload.toClinicianId?.trim() || undefined;
    const toDepartmentId = payload.toDepartmentId?.trim() || undefined;
    const toRole = payload.toRole?.trim() || undefined;
    if (!summary || (!toClinicianId && !toDepartmentId && !toRole)) {
      return failure(
        commandId,
        idempotencyKey,
        'HANDOFF_TARGET_REQUIRED',
        'Handoff requires a problem summary and at least one receiving clinician, department, or role.'
      );
    }

    const now = Date.now();
    const handoffId = `handoff_${crypto.randomUUID()}`;
    const handoff: ClinicalHandoff = {
      handoffId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      episodeId: String(scoped.encounter.episodeId || '').trim() || undefined,
      careSetting: normalizeCareSetting(scoped.encounter.encounterType || scoped.encounter.type),
      fromClinicianId: context.actorId,
      fromDepartmentId: context.departmentId,
      toClinicianId,
      toDepartmentId,
      toRole,
      currentProblemSummary: summary,
      activeRisks: (payload.activeRisks || []).map(String).map((v) => v.trim()).filter(Boolean).slice(0, 100),
      pendingDiagnostics: (payload.pendingDiagnostics || []).map(String).map((v) => v.trim()).filter(Boolean).slice(0, 100),
      pendingProcedures: (payload.pendingProcedures || []).map(String).map((v) => v.trim()).filter(Boolean).slice(0, 100),
      pendingConsultations: (payload.pendingConsultations || []).map(String).map((v) => v.trim()).filter(Boolean).slice(0, 100),
      medicationConcerns: (payload.medicationConcerns || []).map(String).map((v) => v.trim()).filter(Boolean).slice(0, 100),
      unresolvedItems: (payload.unresolvedItems || []).map(String).map((v) => v.trim()).filter(Boolean).slice(0, 200),
      expectedActions: (payload.expectedActions || []).map(String).map((v) => v.trim()).filter(Boolean).slice(0, 100),
      status: 'PENDING_ACCEPTANCE',
      createdAt: now,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'CLINICAL_HANDOFF',
      aggregateId: handoffId,
      eventType: 'CLINICAL_HANDOFF_CREATED',
      eventPayload: {
        handoffId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        toClinicianId,
        toDepartmentId,
        toRole,
        expectedActions: handoff.expectedActions,
      },
      auditAction: 'CREATE_CLINICAL_HANDOFF',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: payload.encounterId,
      auditReason: `Created clinical handoff ${handoffId} for patient ${payload.patientId}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: handoff,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: handoffId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: handoff,
    };
  }

  public static async acceptHandoff(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AcceptClinicalHandoffPayload
  ): Promise<CommandResult> {
    const auth = handoffAuth(context);
    if (!auth.authorized) {
      return failure(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Credentialed clinical handoff authority is required.'
      );
    }

    const scoped = await loadScopedPatientEncounter(context, payload);
    if ('error' in scoped) {
      return failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);
    }

    const current = await DomainStateRepository.getById<ClinicalHandoff>(
      context.tenantId,
      'clinicalHandoffs',
      payload.handoffId
    );
    if (!current) {
      return failure(commandId, idempotencyKey, 'HANDOFF_NOT_FOUND', 'Clinical handoff was not found.');
    }
    if (
      current.patientId !== payload.patientId ||
      current.encounterId !== payload.encounterId
    ) {
      return failure(commandId, idempotencyKey, 'HANDOFF_SCOPE_MISMATCH', 'Clinical handoff does not match the supplied patient encounter.');
    }
    if (current.status !== 'PENDING_ACCEPTANCE') {
      return failure(commandId, idempotencyKey, 'HANDOFF_NOT_PENDING', 'Only a pending handoff can be accepted.');
    }
    if (
      current.toClinicianId &&
      current.toClinicianId !== context.actorId &&
      !context.roles.some((role) => String(role).toUpperCase() === 'SYSTEM_ADMIN')
    ) {
      return failure(commandId, idempotencyKey, 'HANDOFF_ASSIGNEE_MISMATCH', 'Handoff is assigned to another clinician.');
    }

    const actorDepartments = new Set(
      [...(context.departmentIds || []), ...(context.departmentId ? [context.departmentId] : [])]
        .map((item) => String(item).trim().toUpperCase())
        .filter(Boolean)
    );
    if (
      current.toDepartmentId &&
      !actorDepartments.has(current.toDepartmentId.toUpperCase()) &&
      !context.roles.some((role) => String(role).toUpperCase() === 'SYSTEM_ADMIN')
    ) {
      return failure(commandId, idempotencyKey, 'HANDOFF_DEPARTMENT_MISMATCH', 'Receiving clinician is outside the targeted handoff department.');
    }

    const now = Date.now();
    const next: ClinicalHandoff = {
      ...current,
      status: 'ACCEPTED',
      acceptedAt: now,
      acceptedBy: context.actorId,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'CLINICAL_HANDOFF',
      aggregateId: current.handoffId,
      eventType: 'CLINICAL_HANDOFF_ACCEPTED',
      eventPayload: {
        handoffId: current.handoffId,
        patientId: current.patientId,
        encounterId: current.encounterId,
        acceptedBy: context.actorId,
        acceptedAt: now,
      },
      auditAction: 'ACCEPT_CLINICAL_HANDOFF',
      auditResourceType: 'ENCOUNTER',
      auditResourceId: current.encounterId,
      auditReason: `Accepted clinical handoff ${current.handoffId}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: next,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: current.handoffId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: next,
    };
  }

  public static async acknowledgeOpenItem(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AcknowledgeOpenItemPayload
  ): Promise<CommandResult> {
    const auth = clinicalCoordinatorAuth(context);
    if (!auth.authorized) {
      return failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Consultant authority required.');
    }

    const scoped = await loadScopedPatientEncounter(context, payload);
    if ('error' in scoped) {
      return failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);
    }

    const current = await DomainStateRepository.getById<ClinicalOpenItemProjection>(
      context.tenantId,
      'clinicalOpenItems',
      payload.openItemId
    );
    if (!current) {
      return failure(commandId, idempotencyKey, 'CLINICAL_OPEN_ITEM_NOT_FOUND', 'Clinical attention item was not found.');
    }
    if (current.patientId !== payload.patientId || current.encounterId !== payload.encounterId) {
      return failure(commandId, idempotencyKey, 'CLINICAL_OPEN_ITEM_SCOPE_MISMATCH', 'Clinical attention item does not match patient encounter.');
    }
    if (current.status === 'RESOLVED') {
      return failure(commandId, idempotencyKey, 'CLINICAL_OPEN_ITEM_ALREADY_RESOLVED', 'Resolved attention items cannot be acknowledged.');
    }

    const now = Date.now();
    const next = {
      ...current,
      status: 'ACKNOWLEDGED' as const,
      acknowledgedAt: now,
      acknowledgedBy: context.actorId,
      acknowledgementNote: String(payload.note || '').trim() || undefined,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CONSULTANT',
      aggregateType: 'CLINICAL_OPEN_ITEM',
      aggregateId: current.openItemId,
      eventType: 'CLINICAL_OPEN_ITEM_ACKNOWLEDGED',
      eventPayload: {
        openItemId: current.openItemId,
        patientId: current.patientId,
        encounterId: current.encounterId,
        acknowledgedAt: now,
      },
      auditAction: 'ACKNOWLEDGE_CLINICAL_OPEN_ITEM',
      auditResourceType: 'PATIENT360',
      auditResourceId: current.patientId,
      auditReason: `Acknowledged consultant attention item ${current.openItemId}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: next,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: current.openItemId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: next,
    };
  }

  public static async resolveOpenItem(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ResolveOpenItemPayload
  ): Promise<CommandResult> {
    const auth = clinicalCoordinatorAuth(context);
    if (!auth.authorized) {
      return failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Consultant authority required.');
    }

    const scoped = await loadScopedPatientEncounter(context, payload);
    if ('error' in scoped) {
      return failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);
    }

    const current = await DomainStateRepository.getById<ClinicalOpenItemProjection>(
      context.tenantId,
      'clinicalOpenItems',
      payload.openItemId
    );
    if (!current) {
      return failure(commandId, idempotencyKey, 'CLINICAL_OPEN_ITEM_NOT_FOUND', 'Clinical attention item was not found.');
    }
    if (current.patientId !== payload.patientId || current.encounterId !== payload.encounterId) {
      return failure(commandId, idempotencyKey, 'CLINICAL_OPEN_ITEM_SCOPE_MISMATCH', 'Clinical attention item does not match patient encounter.');
    }
    if ((current.resolutionMode || 'SOURCE_STATE') !== 'MANUAL') {
      return failure(
        commandId,
        idempotencyKey,
        'CLINICAL_OPEN_ITEM_SOURCE_CONTROLLED',
        'This attention item is controlled by authoritative source state and will resolve automatically when that source is resolved.'
      );
    }

    const resolutionReason = String(payload.resolutionReason || '').trim();
    if (!resolutionReason) {
      return failure(commandId, idempotencyKey, 'CLINICAL_OPEN_ITEM_RESOLUTION_REQUIRED', 'Resolution reason is required.');
    }

    const now = Date.now();
    const next = {
      ...current,
      status: 'RESOLVED' as const,
      resolvedAt: now,
      resolvedBy: context.actorId,
      resolutionReason,
      resolutionRef: payload.resolutionRef?.trim() || undefined,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CONSULTANT',
      aggregateType: 'CLINICAL_OPEN_ITEM',
      aggregateId: current.openItemId,
      eventType: 'CLINICAL_OPEN_ITEM_RESOLVED',
      eventPayload: {
        openItemId: current.openItemId,
        patientId: current.patientId,
        encounterId: current.encounterId,
        resolvedAt: now,
        resolutionRef: next.resolutionRef,
      },
      auditAction: 'RESOLVE_CLINICAL_OPEN_ITEM',
      auditResourceType: 'PATIENT360',
      auditResourceId: current.patientId,
      auditReason: resolutionReason,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: next,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: current.openItemId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: next,
    };
  }

  public static async acknowledgeEscalation(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AcknowledgeEscalationPayload
  ): Promise<CommandResult> {
    const auth = clinicalCoordinatorAuth(context);
    if (!auth.authorized) {
      return failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Consultant authority required.');
    }

    const scoped = await loadScopedPatientEncounter(context, payload);
    if ('error' in scoped) {
      return failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);
    }

    const current = await DomainStateRepository.getById<ClinicalEscalationProjection>(
      context.tenantId,
      'clinicalEscalations',
      payload.escalationId
    );
    if (!current) {
      return failure(commandId, idempotencyKey, 'CLINICAL_ESCALATION_NOT_FOUND', 'Clinical escalation was not found.');
    }
    if (current.patientId !== payload.patientId || current.encounterId !== payload.encounterId) {
      return failure(commandId, idempotencyKey, 'CLINICAL_ESCALATION_SCOPE_MISMATCH', 'Clinical escalation does not match patient encounter.');
    }
    if (current.state === 'RESOLVED') {
      return failure(commandId, idempotencyKey, 'CLINICAL_ESCALATION_ALREADY_RESOLVED', 'Resolved escalation cannot be acknowledged.');
    }

    const now = Date.now();
    const next: ClinicalEscalationProjection = {
      ...current,
      state: 'ACKNOWLEDGED',
      acknowledgedAt: now,
      acknowledgedBy: context.actorId,
      note: String(payload.note || '').trim() || current.note,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CONSULTANT',
      aggregateType: 'CLINICAL_ESCALATION',
      aggregateId: current.escalationId,
      eventType: 'CLINICAL_ESCALATION_ACKNOWLEDGED',
      eventPayload: {
        escalationId: current.escalationId,
        patientId: current.patientId,
        encounterId: current.encounterId,
        acknowledgedAt: now,
      },
      auditAction: 'ACKNOWLEDGE_CLINICAL_ESCALATION',
      auditResourceType: 'PATIENT360',
      auditResourceId: current.patientId,
      auditReason: `Acknowledged clinical escalation ${current.escalationId}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: next,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: current.escalationId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: next,
    };
  }
}
