import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { DiagnosticOrder } from '@/types/clinical-canonical';
import {
  buildDiagnosticResultFacts,
  type DiagnosticResultItemInput,
} from '@/lib/clinical/diagnostics/diagnostic-result-builder';
import {
  criticalObservationIds,
  isCriticalDiagnosticResult,
  isFinalDiagnosticStatus,
} from '@/lib/clinical/diagnostics/critical-result';

export interface RecordDiagnosticResultPayload {
  orderId: string;
  patientId: string;
  encounterId?: string;
  reportCode: string;
  reportDisplay: string;
  category: 'LAB' | 'RADIOLOGY' | 'PATHOLOGY' | 'OTHER';
  results: DiagnosticResultItemInput[];
  reportStatus?: 'PARTIAL' | 'PRELIMINARY' | 'FINAL' | 'AMENDED' | 'CORRECTED';
  conclusion?: string;
  issuedAt?: number;
  verifiedBy?: string;
  verifiedAt?: number;
  sourceType?: 'LAB_SYSTEM' | 'RADIOLOGY_SYSTEM' | 'CLINICIAN' | 'EXTERNAL_HL7';
  sourceSystem?: string;
  sourceMessageControlId?: string;
}

export interface AcknowledgeCriticalDiagnosticResultPayload {
  reportId: string;
  patientId: string;
  encounterId: string;
  note?: string;
}

interface OperationalDiagnosticOrder {
  orderId: string;
  tenantId: string;
  encounterId: string;
  patientId: string;
  orderType: 'LAB' | 'RADIOLOGY' | 'PROCEDURE';
  catalogCode: string;
  orderName: string;
  priority: 'STAT' | 'URGENT' | 'ROUTINE';
  status: string;
  createdAt: number;
  [key: string]: unknown;
}

function reportStatus(
  status?: RecordDiagnosticResultPayload['reportStatus']
): 'PARTIAL' | 'PRELIMINARY' | 'FINAL' | 'AMENDED' | 'CORRECTED' {
  return status || 'FINAL';
}

function isFinalLike(status: string): boolean {
  return ['FINAL', 'AMENDED', 'CORRECTED'].includes(status);
}

export class DiagnosticResultDomainService {
  public static async record(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordDiagnosticResultPayload
  ): Promise<CommandResult> {
    const integrationService = context.roles.some(
      (role) => String(role).toUpperCase() === 'INTEGRATION_SERVICE'
    );
    const resultPrivilege =
      payload.category === 'RADIOLOGY'
        ? 'INTERPRET_IMAGING'
        : 'VERIFY_LAB_RESULT';
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'LAB_TECH',
        'LAB_TECHNICIAN',
        'PATHOLOGIST',
        'RADIOLOGIST',
        'DOCTOR',
        'CONSULTANT',
        'INTEGRATION_SERVICE',
        'SYSTEM_ADMIN',
      ],
      ...(integrationService ? {} : { requiredPrivilege: resultPrivilege }),
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Diagnostic result authority required.',
        },
      };
    }

    if (
      !payload.orderId ||
      !payload.patientId ||
      !payload.reportCode?.trim() ||
      !payload.reportDisplay?.trim() ||
      !Array.isArray(payload.results) ||
      payload.results.length === 0
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_DIAGNOSTIC_RESULT',
          message: 'Order, patient, report identity and at least one result are required.',
        },
      };
    }

    const order = await DomainStateRepository.getById<OperationalDiagnosticOrder>(
      context.tenantId,
      'orders',
      payload.orderId
    );
    if (!order) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_ORDER_NOT_FOUND',
          message: 'Results cannot be recorded without an authoritative diagnostic order.',
        },
      };
    }

    if (order.patientId !== payload.patientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_RESULT_PATIENT_MISMATCH',
          message: 'Diagnostic result patient does not match the ordered patient.',
        },
      };
    }

    if (payload.encounterId && order.encounterId !== payload.encounterId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_RESULT_ENCOUNTER_MISMATCH',
          message: 'Diagnostic result encounter does not match the source order.',
        },
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
        error: {
          code: 'PATIENT_NOT_FOUND',
          message: 'Ordered patient could not be resolved.',
        },
      };
    }

    const canonicalOrder =
      await DomainStateRepository.getById<DiagnosticOrder>(
        context.tenantId,
        'canonicalDiagnosticOrders',
        payload.orderId
      );

    const status = reportStatus(payload.reportStatus);
    const issuedAt = payload.issuedAt || Date.now();
    const reportId = `diagrep_${crypto.randomUUID()}`;
    const sourceEvidenceId =
      payload.sourceMessageControlId
        ? `hl7_${payload.sourceMessageControlId}`
        : reportId;

    const { observations, report } = buildDiagnosticResultFacts({
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: order.encounterId,
      orderId: payload.orderId,
      reportId,
      actorId: context.actorId,
      sourceType: payload.sourceType || 'CLINICIAN',
      sourceSystem: payload.sourceSystem,
      reportCode: payload.reportCode.trim(),
      reportDisplay: payload.reportDisplay.trim(),
      category: payload.category,
      reportStatus: status,
      results: payload.results,
      issuedAt,
      conclusion: payload.conclusion,
      verifiedBy: payload.verifiedBy || (isFinalLike(status) ? context.actorId : undefined),
      verifiedAt: payload.verifiedAt || (isFinalLike(status) ? issuedAt : undefined),
      sourceEvidenceId,
    });

    const criticalIds = criticalObservationIds(
      observations as unknown as Array<Record<string, unknown>>
    );

    const resultState = {
      diagnosticResultId: reportId,
      reportId,
      tenantId: context.tenantId,
      orderId: payload.orderId,
      patientId: payload.patientId,
      encounterId: order.encounterId,
      reportCode: payload.reportCode.trim(),
      reportDisplay: payload.reportDisplay.trim(),
      category: payload.category,
      status,
      resultObservationIds: observations.map((item) => item.observationId),
      hasCriticalResult: criticalIds.size > 0,
      criticalObservationIds: Array.from(criticalIds),
      conclusion: payload.conclusion,
      sourceType: payload.sourceType || 'CLINICIAN',
      sourceSystem: payload.sourceSystem,
      sourceMessageControlId: payload.sourceMessageControlId,
      issuedAt,
      recordedBy: context.actorId,
      recordedAt: Date.now(),
    };

    const orderState = {
      ...order,
      status: isFinalLike(status) ? 'COMPLETED' : 'PROCESSING',
      latestDiagnosticReportId: reportId,
      resultStatus: status,
      resultUpdatedAt: issuedAt,
    };

    const canonicalOrderState = canonicalOrder
      ? {
          ...canonicalOrder,
          status: isFinalLike(status) ? 'COMPLETED' as const : 'ACTIVE' as const,
          updatedAt: Date.now(),
          version: Number(canonicalOrder.version || 1) + 1,
        }
      : null;

    const additionalStateWrites = [
      ...observations.map((observation) => ({
        entityType: 'CLINICAL_OBSERVATION',
        entityId: observation.observationId,
        domainState: observation,
      })),
      {
        entityType: 'DIAGNOSTIC_REPORT',
        entityId: report.diagnosticReportId,
        domainState: report,
      },
      {
        entityType: 'DIAGNOSTIC_ORDER',
        entityId: payload.orderId,
        domainState: orderState,
      },
      ...(canonicalOrderState
        ? [{
            entityType: 'CANONICAL_DIAGNOSTIC_ORDER',
            entityId: payload.orderId,
            domainState: canonicalOrderState,
          }]
        : []),
    ];

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'DIAGNOSTIC_RESULT',
      aggregateId: reportId,
      eventType: isFinalLike(status)
        ? 'DIAGNOSTIC_RESULT_VERIFIED'
        : 'DIAGNOSTIC_RESULT_RECORDED',
      eventPayload: {
        reportId,
        orderId: payload.orderId,
        patientId: payload.patientId,
        encounterId: order.encounterId,
        status,
        observationIds: observations.map((item) => item.observationId),
        hasCriticalResult: criticalIds.size > 0,
        criticalObservationIds: Array.from(criticalIds),
        sourceMessageControlId: payload.sourceMessageControlId,
      },
      auditAction: isFinalLike(status)
        ? 'VERIFY_DIAGNOSTIC_RESULT'
        : 'RECORD_DIAGNOSTIC_RESULT',
      auditResourceType: 'DIAGNOSTIC_REPORT',
      auditResourceId: reportId,
      auditReason: `${status} diagnostic report ${payload.reportDisplay.trim()} for order ${payload.orderId}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: resultState,
      additionalStateWrites,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: reportId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        result: resultState,
        report,
        observations,
        order: orderState,
      },
    };
  }

  public static async acknowledgeCriticalResult(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AcknowledgeCriticalDiagnosticResultPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
      requiredPrivilege: 'DISCHARGE_INPATIENT',
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Clinician authority is required to acknowledge a critical diagnostic result.',
        },
      };
    }

    if (
      !payload.reportId?.trim() ||
      !payload.patientId?.trim() ||
      !payload.encounterId?.trim()
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_CRITICAL_RESULT_ACKNOWLEDGEMENT',
          message: 'Report, patient, and encounter are required.',
        },
      };
    }

    const reportId = payload.reportId.trim();
    const result =
      await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'diagnosticResults',
        reportId
      );

    if (!result) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_RESULT_NOT_FOUND',
          message: 'The diagnostic result to acknowledge was not found.',
        },
      };
    }

    if (
      String(result.patientId || '') !== payload.patientId ||
      String(result.encounterId || '') !== payload.encounterId
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_RESULT_SCOPE_MISMATCH',
          message: 'The diagnostic result does not belong to the supplied patient and encounter.',
        },
      };
    }

    if (!isFinalDiagnosticStatus(result.status)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_RESULT_NOT_FINAL',
          message: 'Only a final, amended, or corrected diagnostic result can be acknowledged.',
        },
      };
    }

    const observationIds = Array.isArray(result.resultObservationIds)
      ? result.resultObservationIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const observations = (
      await Promise.all(
        observationIds.map((observationId) =>
          DomainStateRepository.getById<Record<string, unknown>>(
            context.tenantId,
            'clinicalObservations',
            observationId
          )
        )
      )
    ).filter(
      (item): item is Record<string, unknown> => Boolean(item)
    );
    const criticalIds = criticalObservationIds(observations);

    if (!isCriticalDiagnosticResult(result, criticalIds)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_RESULT_NOT_CRITICAL',
          message: 'The selected final diagnostic result is not marked critical.',
        },
      };
    }

    const acknowledgementId = `diagack_${reportId}`;
    const existing =
      await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'diagnosticResultAcknowledgements',
        acknowledgementId
      );
    if (existing) {
      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: acknowledgementId,
        data: existing,
      };
    }

    const acknowledgedAt = Date.now();
    const acknowledgement = {
      acknowledgementId,
      tenantId: context.tenantId,
      reportId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      acknowledgedBy: context.actorId,
      acknowledgedAt,
      note: String(payload.note || '').trim() || undefined,
      immutable: true,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'DIAGNOSTIC_RESULT_ACKNOWLEDGEMENT',
      aggregateId: acknowledgementId,
      eventType: 'CRITICAL_DIAGNOSTIC_RESULT_ACKNOWLEDGED',
      eventPayload: {
        acknowledgementId,
        reportId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        acknowledgedAt,
      },
      auditAction: 'ACKNOWLEDGE_CRITICAL_DIAGNOSTIC_RESULT',
      auditResourceType: 'DIAGNOSTIC_REPORT',
      auditResourceId: reportId,
      auditReason: `Acknowledged critical diagnostic report ${reportId} for encounter ${payload.encounterId}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: acknowledgement,
      expectedPrimaryServerVersion: 0,
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: acknowledgementId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: acknowledgement,
    };
  }

}
