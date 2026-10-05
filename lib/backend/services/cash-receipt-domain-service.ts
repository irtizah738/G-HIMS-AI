import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { AtomicMutationRejectedError, TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  FinanceAccountRecord,
  FinanceArOpenItem,
  FinancePeriodRecord,
} from '@/types/finance-domain';
import { financePeriodId } from '@/lib/finance/finance-engine';

export interface RecordCashReceiptPayload {
  receiptId: string;
  invoiceId: string;
  encounterId: string;
  patientId: string;
  amountMinorUnits: number;
  currency?: string;
  referenceNumber: string;
  collectedAt: number;
  cashierName?: string;
}

export class CashReceiptDomainService {
  public static async record(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordCashReceiptPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'BILLING_CLERK',
        'BILLING_ADMIN',
        'CASHIER',
        'FINANCE_MANAGER',
        'ACCOUNTANT',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Cash collection authority required.',
        },
      };
    }

    if (
      !payload.receiptId ||
      !payload.invoiceId ||
      !payload.patientId ||
      !Number.isInteger(payload.amountMinorUnits) ||
      payload.amountMinorUnits <= 0
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_CASH_RECEIPT',
          message: 'Receipt, invoice, patient and a positive minor-unit cash amount are required.',
        },
      };
    }

    const currency = String(payload.currency || 'PKR').toUpperCase();
    const invoiceLink = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'invoices',
      payload.invoiceId
    );
    const diagnosticOrderId =
      String(invoiceLink?.billingPurpose || '').toUpperCase() === 'OPD_DIAGNOSTIC'
        ? String(invoiceLink?.sourceOrderId || '')
        : '';
    if (
      String(invoiceLink?.billingPurpose || '').toUpperCase() === 'OPD_DIAGNOSTIC' &&
      !diagnosticOrderId
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_INVOICE_ORDER_LINK_MISSING',
          message: 'Diagnostic invoice is missing its authoritative source order linkage.',
        },
      };
    }

    const patientOpenItemId = `ar_patient_${payload.invoiceId}`;
    const postingDate = new Date(payload.collectedAt);
    const fiscalYear = postingDate.getUTCFullYear();
    const postingPeriod = postingDate.getUTCMonth() + 1;
    const periodId = financePeriodId(fiscalYear, postingPeriod);

    const cashAccounts =
      await DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
        context.tenantId,
        'accounts',
        'accountCode',
        '1010',
        { pageSize: 10, maxRows: 10 }
      );
    if (
      cashAccounts.length !== 1 ||
      cashAccounts[0].isActive !== true ||
      cashAccounts[0].currency.trim().toUpperCase() !== currency ||
      cashAccounts[0].allowCashReceipts !== true
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'CASH_CONTROL_ACCOUNT_INVALID',
          message:
            'Cash control account 1010 must be uniquely active, currency-compatible, and receipt-enabled.',
        },
      };
    }

    const arAccounts =
      await DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
        context.tenantId,
        'accounts',
        'accountCode',
        '1110',
        { pageSize: 10, maxRows: 10 }
      );
    if (
      arAccounts.length !== 1 ||
      arAccounts[0].isActive !== true ||
      arAccounts[0].currency.trim().toUpperCase() !== currency
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'AR_CONTROL_ACCOUNT_INVALID',
          message:
            'Accounts Receivable control account 1110 must be uniquely active and currency-compatible.',
        },
      };
    }

    const journalId = `je_cash_${payload.receiptId}`;
    const receiptState = {
      receiptId: payload.receiptId,
      tenantId: context.tenantId,
      invoiceId: payload.invoiceId,
      encounterId: payload.encounterId,
      patientId: payload.patientId,
      amountMinorUnits: payload.amountMinorUnits,
      currency,
      mode: 'CASH',
      referenceNumber: payload.referenceNumber,
      status: 'CAPTURED',
      collectedAt: payload.collectedAt,
      recordedAt: Date.now(),
      collectedBy: context.actorId,
      cashierName: payload.cashierName,
      journalId,
    };

    const journalState = {
      journalId,
      tenantId: context.tenantId,
      fiscalYear,
      postingPeriod,
      documentDate: payload.collectedAt,
      postingDate: payload.collectedAt,
      referenceDocumentId: payload.receiptId,
      documentHeader: `Cash receipt ${payload.referenceNumber} for invoice ${payload.invoiceId}`,
      currency,
      totalAmountMinorUnits: payload.amountMinorUnits,
      lines: [
        {
          glAccountId: '1010',
          glAccountName: cashAccounts[0].accountName,
          debitMinorUnits: payload.amountMinorUnits,
          creditMinorUnits: 0,
          lineDescription: `Cash received for invoice ${payload.invoiceId}`,
        },
        {
          glAccountId: '1110',
          glAccountName: arAccounts[0].accountName,
          debitMinorUnits: 0,
          creditMinorUnits: payload.amountMinorUnits,
          lineDescription: `Clear patient receivable for invoice ${payload.invoiceId}`,
        },
      ],
      status: 'POSTED',
      postedBy: context.actorId,
      postedAt: Date.now(),
    };

    const debit = journalState.lines.reduce((sum, line) => sum + line.debitMinorUnits, 0);
    const credit = journalState.lines.reduce((sum, line) => sum + line.creditMinorUnits, 0);
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit <= 0 || debit !== credit) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'UNBALANCED_CASH_RECEIPT',
          message: 'Cash receipt journal violates the double-entry invariant.',
        },
      };
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'BILLING_CLERK',
        aggregateType: 'CASH_RECEIPT',
        aggregateId: payload.receiptId,
        eventType: 'CASH_RECEIPT_CAPTURED',
        auditAction: 'CASH_RECEIPT_CAPTURED',
        auditResourceType: 'CASH_RECEIPT',
        auditResourceId: payload.receiptId,
        outboxTopic: 'g-hims-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'period',
            entityType: 'FINANCE_PERIOD',
            entityId: periodId,
            required: true,
          },
          {
            key: 'arOpenItem',
            entityType: 'AR_OPEN_ITEM',
            entityId: patientOpenItemId,
            required: true,
          },
          {
            key: 'invoice',
            entityType: 'INVOICE',
            entityId: payload.invoiceId,
            required: true,
          },
          {
            key: 'settlement',
            entityType: 'INVOICE_SETTLEMENT',
            entityId: payload.invoiceId,
            required: false,
          },
          {
            key: 'encounter',
            entityType: 'ENCOUNTER',
            entityId: payload.encounterId,
            required: true,
          },
          {
            key: 'opdQueueToken',
            entityType: 'OPD_QUEUE_TOKEN',
            entityId: `opd_${payload.encounterId}`,
            required: false,
          },
          ...(diagnosticOrderId
            ? [
                {
                  key: 'diagnosticOrder',
                  entityType: 'DIAGNOSTIC_ORDER',
                  entityId: diagnosticOrderId,
                  required: true,
                },
              ]
            : []),
        ],
        prepare: (current) => {
          const period = current.period as unknown as FinancePeriodRecord;
          if (!['OPEN', 'SOFT_CLOSE'].includes(period.status)) {
            throw new AtomicMutationRejectedError(
              'FINANCE_PERIOD_NOT_POSTABLE',
              `Finance period ${period.periodKey} is ${period.status}.`
            );
          }
          const arOpenItem = current.arOpenItem as unknown as FinanceArOpenItem;
          if (
            arOpenItem.invoiceId !== payload.invoiceId ||
            arOpenItem.debtorType !== 'PATIENT' ||
            arOpenItem.patientId !== payload.patientId ||
            arOpenItem.currency !== currency
          ) {
            throw new AtomicMutationRejectedError(
              'AR_OPEN_ITEM_SCOPE_MISMATCH',
              'Cash receipt does not match the recognized patient AR open item.'
            );
          }
          if (payload.amountMinorUnits > arOpenItem.outstandingMinorUnits) {
            throw new AtomicMutationRejectedError(
              'PAYMENT_EXCEEDS_AR_OPEN_ITEM',
              'Cash receipt exceeds the authoritative patient AR open item.',
              { outstandingMinorUnits: arOpenItem.outstandingMinorUnits }
            );
          }

          const invoice = current.invoice || {};
          const encounter = current.encounter || {};
          const invoicePatientId = String(invoice.patientId || '');
          const invoiceEncounterId = String(invoice.encounterId || '');
          const invoiceCurrency = String(invoice.currency || currency).toUpperCase();
          const paymentStatus = String(invoice.paymentStatus || '').toLowerCase();

          if (invoicePatientId !== payload.patientId) {
            throw new AtomicMutationRejectedError(
              'INVOICE_PATIENT_MISMATCH',
              'Invoice does not belong to the supplied patient.'
            );
          }
          if (payload.encounterId && invoiceEncounterId && invoiceEncounterId !== payload.encounterId) {
            throw new AtomicMutationRejectedError(
              'INVOICE_ENCOUNTER_MISMATCH',
              'Invoice does not belong to the supplied encounter.'
            );
          }
          if (invoiceCurrency !== currency) {
            throw new AtomicMutationRejectedError(
              'INVOICE_CURRENCY_MISMATCH',
              'Receipt currency does not match the authoritative invoice currency.'
            );
          }
          if (paymentStatus === 'paid' || paymentStatus === 'waived') {
            throw new AtomicMutationRejectedError(
              'INVOICE_NOT_OPEN',
              `Invoice is already ${paymentStatus}.`
            );
          }

          const previousSettlement = current.settlement || {};
          const previousReceived = Number(previousSettlement.cashReceivedMinorUnits || 0);
          if (!Number.isSafeInteger(previousReceived) || previousReceived < 0) {
            throw new AtomicMutationRejectedError(
              'INVALID_INVOICE_SETTLEMENT_STATE',
              'Existing invoice settlement state is invalid.'
            );
          }

          const authoritativeBalanceMajor = Number(invoice.balanceDue);
          const authoritativePatientDueMajor = Number(invoice.totalPatientDue);
          const authoritativePaidMajor = Number(invoice.totalPaid || 0);
          if (
            !Number.isFinite(authoritativeBalanceMajor) ||
            !Number.isFinite(authoritativePatientDueMajor) ||
            !Number.isFinite(authoritativePaidMajor) ||
            authoritativeBalanceMajor < 0 ||
            authoritativePatientDueMajor < 0 ||
            authoritativePaidMajor < 0
          ) {
            throw new AtomicMutationRejectedError(
              'INVALID_INVOICE_BALANCE',
              'Authoritative invoice monetary state is invalid.'
            );
          }

          const outstandingMinorUnits = Math.round(authoritativeBalanceMajor * 100);
          if (!Number.isSafeInteger(outstandingMinorUnits) || outstandingMinorUnits <= 0) {
            throw new AtomicMutationRejectedError(
              'INVOICE_NOT_OPEN',
              'Invoice has no outstanding patient balance.'
            );
          }
          if (payload.amountMinorUnits > outstandingMinorUnits) {
            throw new AtomicMutationRejectedError(
              'PAYMENT_EXCEEDS_OUTSTANDING_BALANCE',
              'Cash receipt exceeds the authoritative outstanding patient balance.',
              { outstandingMinorUnits }
            );
          }

          const newBalanceMinorUnits = outstandingMinorUnits - payload.amountMinorUnits;
          const newPaidMinorUnits = Math.round(authoritativePaidMajor * 100) + payload.amountMinorUnits;
          const nextArOutstanding =
            arOpenItem.outstandingMinorUnits - payload.amountMinorUnits;
          const nextArOpenItem: FinanceArOpenItem = {
            ...arOpenItem,
            allocatedMinorUnits:
              arOpenItem.allocatedMinorUnits + payload.amountMinorUnits,
            outstandingMinorUnits: nextArOutstanding,
            status:
              nextArOutstanding === 0 ? 'SETTLED' : 'PARTIALLY_SETTLED',
            updatedAt: new Date().toISOString(),
          };
          const nextInvoice = {
            ...invoice,
            totalPaid: newPaidMinorUnits / 100,
            balanceDue: newBalanceMinorUnits / 100,
            paymentStatus: newBalanceMinorUnits === 0 ? 'paid' : 'partially_paid',
            paymentMethod: 'cash',
            updatedAt: new Date().toISOString(),
          };
          const isConsultationInvoice =
            String(invoice.billingPurpose || '').toUpperCase() === 'OPD_CONSULTATION';
          const isDiagnosticInvoice =
            String(invoice.billingPurpose || '').toUpperCase() === 'OPD_DIAGNOSTIC';
          const queueToken = current.opdQueueToken || null;
          const diagnosticOrder = current.diagnosticOrder || null;

          if (diagnosticOrderId && !isDiagnosticInvoice) {
            throw new AtomicMutationRejectedError(
              'DIAGNOSTIC_INVOICE_PURPOSE_CHANGED',
              'Diagnostic invoice purpose changed before cash settlement could commit.'
            );
          }

          if (isDiagnosticInvoice) {
            if (
              String(invoice.sourceOrderId || '') !== diagnosticOrderId ||
              !diagnosticOrder ||
              String(diagnosticOrder.orderId || '') !== diagnosticOrderId ||
              String(diagnosticOrder.billingInvoiceId || '') !== payload.invoiceId ||
              String(diagnosticOrder.patientId || '') !== payload.patientId ||
              String(diagnosticOrder.encounterId || '') !== payload.encounterId
            ) {
              throw new AtomicMutationRejectedError(
                'DIAGNOSTIC_PAYMENT_SCOPE_MISMATCH',
                'Diagnostic cash settlement does not match the authoritative order/invoice lineage.'
              );
            }
          }

          if (
            isConsultationInvoice &&
            newBalanceMinorUnits === 0 &&
            (!queueToken || String(queueToken.status || '').toLowerCase() !== 'payment_pending')
          ) {
            throw new AtomicMutationRejectedError(
              'OPD_QUEUE_PAYMENT_STATE_INVALID',
              'Consultation settlement cannot release an OPD queue token unless it is in payment_pending state.'
            );
          }

          const nextEncounter =
            isConsultationInvoice && newBalanceMinorUnits === 0
              ? {
                  ...encounter,
                  financialClearanceState: 'CONSULTATION_CLEARED',
                  consultationClearedByReceiptId: payload.receiptId,
                  consultationClearedAt: payload.collectedAt,
                  operationalState: 'QUEUED',
                  updatedAt: Date.now(),
                }
              : encounter;

          const nextQueueToken =
            isConsultationInvoice && newBalanceMinorUnits === 0 && queueToken
              ? {
                  ...queueToken,
                  status: 'waiting',
                  paymentClearedAt: payload.collectedAt,
                  paymentReceiptId: payload.receiptId,
                  updatedAt: Date.now(),
                }
              : queueToken;

          const nextDiagnosticOrder =
            isDiagnosticInvoice && newBalanceMinorUnits === 0 && diagnosticOrder
              ? {
                  ...diagnosticOrder,
                  revenueLockStatus: 'PAID_SETTLED',
                  worklistStatus:
                    String(diagnosticOrder.worklistStatus || '') ===
                    'BLOCKED_BY_REVENUE_GATE'
                      ? 'READY_FOR_EXECUTION'
                      : diagnosticOrder.worklistStatus,
                  paymentReceiptId: payload.receiptId,
                  paymentClearedAt: payload.collectedAt,
                  updatedAt: Date.now(),
                }
              : diagnosticOrder;

          const priorReceiptIds = Array.isArray(previousSettlement.receiptIds)
            ? previousSettlement.receiptIds.map(String)
            : [];
          const settlementState = {
            invoiceId: payload.invoiceId,
            tenantId: context.tenantId,
            encounterId: invoiceEncounterId || payload.encounterId,
            patientId: invoicePatientId,
            currency,
            cashReceivedMinorUnits: previousReceived + payload.amountMinorUnits,
            outstandingMinorUnits: newBalanceMinorUnits,
            receiptIds: Array.from(new Set([...priorReceiptIds, payload.receiptId])),
            paymentStatus: newBalanceMinorUnits === 0 ? 'SETTLED' : 'PARTIALLY_SETTLED',
            lastReceiptId: payload.receiptId,
            lastPaymentAt: payload.collectedAt,
            updatedAt: Date.now(),
            createdAt: Number(previousSettlement.createdAt || Date.now()),
          };

          return {
            domainState: receiptState,
            additionalStateWrites: [
              {
                entityType: 'JOURNAL_ENTRY',
                entityId: journalId,
                domainState: journalState,
              },
              {
                entityType: 'AR_OPEN_ITEM',
                entityId: patientOpenItemId,
                domainState: nextArOpenItem,
              },
              {
                entityType: 'INVOICE_SETTLEMENT',
                entityId: payload.invoiceId,
                domainState: settlementState,
              },
              {
                entityType: 'INVOICE',
                entityId: payload.invoiceId,
                domainState: nextInvoice,
              },
              ...(isConsultationInvoice && newBalanceMinorUnits === 0
                ? [
                    {
                      entityType: 'ENCOUNTER',
                      entityId: payload.encounterId,
                      domainState: nextEncounter,
                    },
                    {
                      entityType: 'OPD_QUEUE_TOKEN',
                      entityId: `opd_${payload.encounterId}`,
                      domainState: nextQueueToken,
                    },
                  ]
                : []),
              ...(isDiagnosticInvoice && newBalanceMinorUnits === 0
                ? [
                    {
                      entityType: 'DIAGNOSTIC_ORDER',
                      entityId: diagnosticOrderId,
                      domainState: nextDiagnosticOrder,
                    },
                  ]
                : []),
            ],
            eventPayload: {
              receiptId: payload.receiptId,
              invoiceId: payload.invoiceId,
              encounterId: invoiceEncounterId || payload.encounterId,
              patientId: invoicePatientId,
              amountMinorUnits: payload.amountMinorUnits,
              outstandingMinorUnits: newBalanceMinorUnits,
              cumulativeCashReceivedMinorUnits: settlementState.cashReceivedMinorUnits,
              currency,
              journalId,
              arOpenItemId: patientOpenItemId,
              arOutstandingMinorUnits: nextArOutstanding,
              consultationClearanceGranted:
                isConsultationInvoice && newBalanceMinorUnits === 0,
              queueReleased:
                isConsultationInvoice && newBalanceMinorUnits === 0,
              diagnosticClearanceGranted:
                isDiagnosticInvoice && newBalanceMinorUnits === 0,
              diagnosticOrderId: isDiagnosticInvoice ? diagnosticOrderId : undefined,
            },
            auditReason: `Captured cash receipt ${payload.referenceNumber} for ${payload.amountMinorUnits / 100} ${currency}`,
            resultData: {
              receipt: receiptState,
              journal: journalState,
              settlement: settlementState,
              invoice: nextInvoice,
              arOpenItem: nextArOpenItem,
              ...(isConsultationInvoice && newBalanceMinorUnits === 0
                ? { encounter: nextEncounter }
                : {}),
              ...(isDiagnosticInvoice && newBalanceMinorUnits === 0
                ? { diagnosticOrder: nextDiagnosticOrder }
                : {}),
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.receiptId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData as {
          receipt: typeof receiptState;
          journal: typeof journalState;
          settlement: Record<string, unknown>;
          invoice: Record<string, unknown>;
        },
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
