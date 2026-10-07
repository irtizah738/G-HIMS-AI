import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { RenalDialysisOrder, RenalDialysisSession } from '@/types/wave2-clinical-domains';
import {
  clinicianAuthorization,
  ensureSameScope,
  loadWave2ScopedEncounter,
  nurseAuthorization,
  uniqueWave2Strings,
  wave2Failure,
} from './wave2-clinical-common';

export interface CreateDialysisOrderPayload {
  patientId: string;
  encounterId: string;
  modality: RenalDialysisOrder['modality'];
  prescribedDurationMinutes: number;
  targetUltrafiltrationMl?: number;
  anticoagulationPlan?: string;
  vascularAccessPlan: string;
  medicationOrderIds?: string[];
  diagnosticReportIds?: string[];
}

export interface StartDialysisSessionPayload {
  patientId: string;
  encounterId: string;
  dialysisOrderId: string;
  machineId: string;
  accessDeviceId?: string;
  dialyzerLot?: string;
  reprocessingCycle?: number;
  preObservation: RenalDialysisSession['preObservation'];
}

export interface CompleteDialysisSessionPayload {
  patientId: string;
  encounterId: string;
  dialysisSessionId: string;
  status: 'COMPLETED' | 'ABORTED';
  postObservation: NonNullable<RenalDialysisSession['postObservation']>;
  ultrafiltrationMl?: number;
  complications?: string[];
  medicationOrderIds?: string[];
  diagnosticReportIds?: string[];
  abortReason?: string;
}

async function validateDialysisClinicalRefs(
  context: CommandContext,
  patientId: string,
  encounterId: string,
  medicationOrderIds: string[],
  diagnosticReportIds: string[]
): Promise<{ code: string; message: string } | null> {
  for (const medicationOrderId of medicationOrderIds) {
    const medicationOrder = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'medicationOrders',
      medicationOrderId
    );
    if (
      !medicationOrder ||
      String(medicationOrder.patientId || '') !== patientId ||
      String(medicationOrder.encounterId || '') !== encounterId
    ) {
      return {
        code: 'DIALYSIS_MEDICATION_ORDER_SCOPE_MISMATCH',
        message: `Medication order ${medicationOrderId} does not belong to this patient encounter.`,
      };
    }
  }

  for (const diagnosticReportId of diagnosticReportIds) {
    const report = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'diagnosticReports',
      diagnosticReportId
    );
    if (!report || String(report.patientId || '') !== patientId) {
      return {
        code: 'DIALYSIS_DIAGNOSTIC_REPORT_SCOPE_MISMATCH',
        message: `Diagnostic report ${diagnosticReportId} does not belong to this patient.`,
      };
    }
  }
  return null;
}

export class RenalDialysisDomainService {
  public static async createOrder(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateDialysisOrderPayload
  ): Promise<CommandResult> {
    const auth = clinicianAuthorization(context);
    if (!auth.authorized) {
      return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Dialysis prescribing authority is required.');
    }
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    if (
      !Number.isInteger(payload.prescribedDurationMinutes) ||
      payload.prescribedDurationMinutes < 30 ||
      payload.prescribedDurationMinutes > 720 ||
      !String(payload.vascularAccessPlan || '').trim()
    ) {
      return wave2Failure(commandId, idempotencyKey, 'DIALYSIS_ORDER_INVALID', 'Dialysis duration and vascular access plan are required and must be clinically bounded.');
    }

    const medicationOrderIds = uniqueWave2Strings(payload.medicationOrderIds);
    const diagnosticReportIds = uniqueWave2Strings(payload.diagnosticReportIds);
    const referenceError = await validateDialysisClinicalRefs(
      context,
      payload.patientId,
      payload.encounterId,
      medicationOrderIds,
      diagnosticReportIds
    );
    if (referenceError) {
      return wave2Failure(commandId, idempotencyKey, referenceError.code, referenceError.message);
    }

    const now = Date.now();
    const dialysisOrderId = `dial_ord_${crypto.randomUUID()}`;
    const order: RenalDialysisOrder = {
      dialysisOrderId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      modality: payload.modality,
      prescribedDurationMinutes: payload.prescribedDurationMinutes,
      targetUltrafiltrationMl: payload.targetUltrafiltrationMl,
      anticoagulationPlan: String(payload.anticoagulationPlan || '').trim() || undefined,
      vascularAccessPlan: String(payload.vascularAccessPlan).trim(),
      medicationOrderIds,
      diagnosticReportIds,
      status: 'ACTIVE',
      orderedBy: context.actorId,
      orderedAt: now,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'RENAL_DIALYSIS_ORDER',
      aggregateId: dialysisOrderId,
      eventType: 'RENAL_DIALYSIS_ORDER_CREATED',
      eventPayload: {
        dialysisOrderId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        modality: payload.modality,
        prescribedDurationMinutes: payload.prescribedDurationMinutes,
      },
      auditAction: 'CREATE_DIALYSIS_ORDER',
      auditResourceType: 'RENAL_DIALYSIS_ORDER',
      auditResourceId: dialysisOrderId,
      auditReason: `Created ${payload.modality} order for ${payload.patientId}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: order,
      expectedPrimaryServerVersion: 0,
    });

    return { success: true, commandId, idempotencyKey, entityId: dialysisOrderId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: order };
  }

  public static async startSession(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: StartDialysisSessionPayload
  ): Promise<CommandResult> {
    const auth = nurseAuthorization(context);
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Dialysis execution authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const order = await DomainStateRepository.getById<RenalDialysisOrder>(
      context.tenantId,
      'renalDialysisOrders',
      payload.dialysisOrderId
    );
    if (!ensureSameScope(order as unknown as Record<string, unknown> | null, payload.patientId, payload.encounterId) || order?.status !== 'ACTIVE') {
      return wave2Failure(commandId, idempotencyKey, 'DIALYSIS_ORDER_NOT_ACTIVE', 'An active dialysis order for the same patient encounter is required.');
    }
    if (!String(payload.machineId || '').trim()) {
      return wave2Failure(commandId, idempotencyKey, 'DIALYSIS_MACHINE_REQUIRED', 'An authoritative dialysis machine identifier is required.');
    }

    const dialysisSessionId = `dial_sess_${payload.dialysisOrderId}`;
    const existing = await DomainStateRepository.getById<RenalDialysisSession>(
      context.tenantId,
      'renalDialysisSessions',
      dialysisSessionId
    );
    if (existing) {
      return wave2Failure(commandId, idempotencyKey, 'DIALYSIS_SESSION_ALREADY_EXISTS', 'This dialysis order already has a session record.');
    }

    const now = Date.now();
    const session: RenalDialysisSession = {
      dialysisSessionId,
      dialysisOrderId: order.dialysisOrderId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      status: 'IN_PROGRESS',
      machineId: String(payload.machineId).trim(),
      accessDeviceId: String(payload.accessDeviceId || '').trim() || undefined,
      dialyzerLot: String(payload.dialyzerLot || '').trim() || undefined,
      reprocessingCycle: payload.reprocessingCycle,
      preObservation: payload.preObservation || {},
      complications: [],
      medicationOrderIds: [...order.medicationOrderIds],
      diagnosticReportIds: [...order.diagnosticReportIds],
      startedBy: context.actorId,
      startedAt: now,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'RENAL_DIALYSIS_SESSION',
      aggregateId: dialysisSessionId,
      eventType: 'RENAL_DIALYSIS_SESSION_STARTED',
      eventPayload: {
        dialysisSessionId,
        dialysisOrderId: order.dialysisOrderId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        machineId: session.machineId,
        accessDeviceId: session.accessDeviceId,
        dialyzerLot: session.dialyzerLot,
        reprocessingCycle: session.reprocessingCycle,
      },
      auditAction: 'START_DIALYSIS_SESSION',
      auditResourceType: 'RENAL_DIALYSIS_SESSION',
      auditResourceId: dialysisSessionId,
      auditReason: `Started dialysis session for order ${order.dialysisOrderId}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: session,
      expectedPrimaryServerVersion: 0,
    });
    return { success: true, commandId, idempotencyKey, entityId: dialysisSessionId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: session };
  }

  public static async completeSession(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CompleteDialysisSessionPayload
  ): Promise<CommandResult> {
    const auth = nurseAuthorization(context);
    if (!auth.authorized) return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Dialysis completion authority is required.');
    const scoped = await loadWave2ScopedEncounter(context, payload.patientId, payload.encounterId);
    if ('error' in scoped) return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);

    const session = await DomainStateRepository.getById<RenalDialysisSession>(
      context.tenantId,
      'renalDialysisSessions',
      payload.dialysisSessionId
    );
    if (!ensureSameScope(session as unknown as Record<string, unknown> | null, payload.patientId, payload.encounterId) || session?.status !== 'IN_PROGRESS') {
      return wave2Failure(commandId, idempotencyKey, 'DIALYSIS_SESSION_NOT_IN_PROGRESS', 'Only the active dialysis session for this patient encounter may be completed.');
    }
    if (payload.status === 'ABORTED' && String(payload.abortReason || '').trim().length < 5) {
      return wave2Failure(commandId, idempotencyKey, 'DIALYSIS_ABORT_REASON_REQUIRED', 'Aborted dialysis requires an explicit reason.');
    }

    const order = await DomainStateRepository.getById<RenalDialysisOrder>(
      context.tenantId,
      'renalDialysisOrders',
      session.dialysisOrderId
    );
    if (!order || order.status !== 'ACTIVE') {
      return wave2Failure(commandId, idempotencyKey, 'DIALYSIS_ORDER_NOT_ACTIVE', 'The source dialysis order is no longer active.');
    }

    const appendedMedicationOrderIds = uniqueWave2Strings(payload.medicationOrderIds);
    const appendedDiagnosticReportIds = uniqueWave2Strings(payload.diagnosticReportIds);
    const referenceError = await validateDialysisClinicalRefs(
      context,
      payload.patientId,
      payload.encounterId,
      appendedMedicationOrderIds,
      appendedDiagnosticReportIds
    );
    if (referenceError) {
      return wave2Failure(commandId, idempotencyKey, referenceError.code, referenceError.message);
    }

    const now = Date.now();
    const nextSession: RenalDialysisSession = {
      ...session,
      status: payload.status,
      postObservation: payload.postObservation,
      ultrafiltrationMl: payload.ultrafiltrationMl,
      complications: uniqueWave2Strings([
        ...(payload.complications || []),
        ...(payload.status === 'ABORTED' ? [payload.abortReason] : []),
      ], 100),
      medicationOrderIds: uniqueWave2Strings([
        ...session.medicationOrderIds,
        ...appendedMedicationOrderIds,
      ]),
      diagnosticReportIds: uniqueWave2Strings([
        ...session.diagnosticReportIds,
        ...appendedDiagnosticReportIds,
      ]),
      completedBy: context.actorId,
      completedAt: now,
      updatedAt: now,
    };
    const nextOrder: RenalDialysisOrder = {
      ...order,
      status: payload.status === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED',
      completedAt: now,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'RENAL_DIALYSIS_SESSION',
      aggregateId: session.dialysisSessionId,
      eventType: payload.status === 'COMPLETED' ? 'RENAL_DIALYSIS_SESSION_COMPLETED' : 'RENAL_DIALYSIS_SESSION_ABORTED',
      eventPayload: {
        dialysisSessionId: session.dialysisSessionId,
        dialysisOrderId: session.dialysisOrderId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        status: payload.status,
        ultrafiltrationMl: payload.ultrafiltrationMl,
        complications: nextSession.complications,
      },
      auditAction: payload.status === 'COMPLETED' ? 'COMPLETE_DIALYSIS_SESSION' : 'ABORT_DIALYSIS_SESSION',
      auditResourceType: 'RENAL_DIALYSIS_SESSION',
      auditResourceId: session.dialysisSessionId,
      auditReason: payload.status === 'COMPLETED' ? 'Dialysis session completed.' : String(payload.abortReason),
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: nextSession,
      expectedPrimaryServerVersion: Number((session as unknown as Record<string, unknown>)._serverVersion || 0),
      additionalStateWrites: [{
        entityType: 'RENAL_DIALYSIS_ORDER',
        entityId: order.dialysisOrderId,
        domainState: nextOrder,
        expectedServerVersion: Number((order as unknown as Record<string, unknown>)._serverVersion || 0),
      }],
    });

    return { success: true, commandId, idempotencyKey, entityId: session.dialysisSessionId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: nextSession };
  }
}
