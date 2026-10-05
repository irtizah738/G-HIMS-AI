import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { DiagnosticOrder } from '@/types/clinical-canonical';
import type { OperationalDiagnosticOrder } from '@/types/diagnostic-billing';
import type {
  FinanceAccountRecord,
} from '@/types/finance-domain';
import { financePeriodId } from '@/lib/finance/finance-engine';
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

    if (
      !['PAID_SETTLED', 'UNLOCKED_STAT_OVERRIDE'].includes(
        order.revenueLockStatus
      )
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_PAYMENT_REQUIRED',
          message:
            'Diagnostic results cannot be recorded while the authoritative payment gate is locked.',
        },
      };
    }

    if (order.worklistStatus !== 'IN_PROCESSING') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_NOT_IN_PROCESSING',
          message:
            'Diagnostic results require an authoritative IN_PROCESSING worklist state.',
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
    const recognizeRevenue =
      isFinalLike(status) && !Number(order.revenueRecognizedAt || 0);

    let recognitionJournal: Record<string, unknown> | null = null;
    let recognitionState: Record<string, unknown> | null = null;
    let recognitionId: string | undefined;

    if (recognizeRevenue) {
      const deferredCode = String(order.deferredRevenueAccountCode || '').trim();
      const revenueCode = String(order.revenueAccountCode || '').trim();
      const currency = String(order.currency || '').trim().toUpperCase();
      const netRevenueMinorUnits = Number(order.netRevenueMinorUnits || 0);

      if (
        !deferredCode ||
        !revenueCode ||
        !currency ||
        !Number.isSafeInteger(netRevenueMinorUnits) ||
        netRevenueMinorUnits <= 0
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'DIAGNOSTIC_REVENUE_ROUTING_INVALID',
            message:
              'Diagnostic order is missing valid deferred/revenue accounting metadata.',
          },
        };
      }

      const [deferredRows, revenueRows] = await Promise.all([
        DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
          context.tenantId,
          'accounts',
          'accountCode',
          deferredCode,
          { pageSize: 10, maxRows: 10 }
        ),
        DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
          context.tenantId,
          'accounts',
          'accountCode',
          revenueCode,
          { pageSize: 10, maxRows: 10 }
        ),
      ]);
      const deferred = deferredRows[0];
      const revenue = revenueRows[0];

      if (
        deferredRows.length !== 1 ||
        !deferred?.isActive ||
        deferred.category !== 'liability' ||
        deferred.currency.trim().toUpperCase() !== currency
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'DIAGNOSTIC_DEFERRED_REVENUE_ACCOUNT_INVALID',
            message:
              'Diagnostic deferred revenue account is not an active currency-compatible liability.',
          },
        };
      }
      if (
        revenueRows.length !== 1 ||
        !revenue?.isActive ||
        revenue.category !== 'revenue' ||
        revenue.currency.trim().toUpperCase() !== currency
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'DIAGNOSTIC_REVENUE_ACCOUNT_INVALID',
            message:
              'Diagnostic revenue account is not an active currency-compatible revenue account.',
          },
        };
      }

      const postingDate = new Date(issuedAt);
      const fiscalYear = postingDate.getUTCFullYear();
      const postingPeriod = postingDate.getUTCMonth() + 1;
      recognitionId = `revrec_diag_${order.orderId}`;
      const journalId = `je_diag_recognize_${order.orderId}`;

      recognitionJournal = {
        journalId,
        tenantId: context.tenantId,
        fiscalYear,
        postingPeriod,
        documentDate: issuedAt,
        postingDate: issuedAt,
        referenceDocumentId: order.billingInvoiceId,
        documentHeader: `Recognize completed diagnostic service ${order.orderName}`,
        currency,
        totalAmountMinorUnits: netRevenueMinorUnits,
        lines: [
          {
            glAccountId: deferredCode,
            glAccountName: deferred.accountName,
            debitMinorUnits: netRevenueMinorUnits,
            creditMinorUnits: 0,
            lineDescription: `Release deferred revenue for ${order.orderName}`,
          },
          {
            glAccountId: revenueCode,
            glAccountName: revenue.accountName,
            debitMinorUnits: 0,
            creditMinorUnits: netRevenueMinorUnits,
            lineDescription: `Recognize diagnostic revenue for ${order.orderName}`,
          },
        ],
        sourceModule: 'BILLING',
        status: 'POSTED',
        postedBy: context.actorId,
        postedAt: Date.now(),
      };

      recognitionState = {
        recognitionId,
        tenantId: context.tenantId,
        invoiceId: order.billingInvoiceId,
        orderId: order.orderId,
        patientId: order.patientId,
        encounterId: order.encounterId,
        journalId,
        currency,
        recognizedMinorUnits: netRevenueMinorUnits,
        recognizedAt: issuedAt,
        recognizedBy: context.actorId,
      };
    }

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

    const orderState: OperationalDiagnosticOrder = {
      ...order,
      status: isFinalLike(status) ? 'COMPLETED' : 'PROCESSING',
      worklistStatus: isFinalLike(status) ? 'FINALIZED' : 'IN_PROCESSING',
      latestDiagnosticReportId: reportId,
      resultStatus: status,
      resultUpdatedAt: issuedAt,
      ...(recognizeRevenue && recognitionJournal && recognitionId
        ? {
            recognitionJournalId: String(recognitionJournal.journalId),
            revenueRecognizedAt: issuedAt,
          }
        : {}),
      updatedAt: Date.now(),
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
        expectedServerVersion: Number(order._serverVersion || 0),
      },
      ...(recognizeRevenue && recognitionJournal && recognitionState && recognitionId
        ? [
            {
              entityType: 'JOURNAL_ENTRY',
              entityId: String(recognitionJournal.journalId),
              domainState: recognitionJournal,
            },
            {
              entityType: 'REVENUE_RECOGNITION',
              entityId: recognitionId,
              domainState: recognitionState,
            },
          ]
        : []),
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
        revenueRecognitionId: recognitionId,
        recognitionJournalId: recognitionJournal
          ? String(recognitionJournal.journalId)
          : undefined,
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
      requiredPrivilege: 'ACKNOWLEDGE_CRITICAL_RESULT',
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
