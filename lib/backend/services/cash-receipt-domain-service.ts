import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { AtomicMutationRejectedError, TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';

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
      fiscalYear: new Date(payload.collectedAt).getUTCFullYear(),
      postingPeriod: new Date(payload.collectedAt).getUTCMonth() + 1,
      documentDate: payload.collectedAt,
      postingDate: payload.collectedAt,
      referenceDocumentId: payload.receiptId,
      documentHeader: `Cash receipt ${payload.referenceNumber} for invoice ${payload.invoiceId}`,
      currency,
      totalAmountMinorUnits: payload.amountMinorUnits,
      lines: [
        {
          glAccountId: '1001',
          glAccountName: 'Cash on Hand',
          debitMinorUnits: payload.amountMinorUnits,
          creditMinorUnits: 0,
          lineDescription: `Cash received for invoice ${payload.invoiceId}`,
        },
        {
          glAccountId: '4001',
          glAccountName: 'Patient Service Revenue',
          debitMinorUnits: 0,
          creditMinorUnits: payload.amountMinorUnits,
          lineDescription: `Patient service settlement for invoice ${payload.invoiceId}`,
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
        ],
        prepare: (current) => {
          const invoice = current.invoice || {};
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
          const nextInvoice = {
            ...invoice,
            totalPaid: newPaidMinorUnits / 100,
            balanceDue: newBalanceMinorUnits / 100,
            paymentStatus: newBalanceMinorUnits === 0 ? 'paid' : 'partially_paid',
            paymentMethod: 'cash',
            updatedAt: new Date().toISOString(),
          };

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
                entityType: 'INVOICE_SETTLEMENT',
                entityId: payload.invoiceId,
                domainState: settlementState,
              },
              {
                entityType: 'INVOICE',
                entityId: payload.invoiceId,
                domainState: nextInvoice,
              },
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
            },
            auditReason: `Captured cash receipt ${payload.referenceNumber} for ${payload.amountMinorUnits / 100} ${currency}`,
            resultData: {
              receipt: receiptState,
              journal: journalState,
              settlement: settlementState,
              invoice: nextInvoice,
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
