import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
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
    if (debit !== credit) {
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
          key: 'settlement',
          entityType: 'INVOICE_SETTLEMENT',
          entityId: payload.invoiceId,
          required: false,
        },
      ],
      prepare: (current) => {
        const previousSettlement = current.settlement || {};
        const previousReceived = Number(
          previousSettlement.cashReceivedMinorUnits || 0
        );
        if (!Number.isSafeInteger(previousReceived) || previousReceived < 0) {
          throw new Error('INVALID_INVOICE_SETTLEMENT_STATE');
        }

        const priorReceiptIds = Array.isArray(previousSettlement.receiptIds)
          ? previousSettlement.receiptIds.map(String)
          : [];
        const settlementState = {
          invoiceId: payload.invoiceId,
          tenantId: context.tenantId,
          encounterId: payload.encounterId,
          patientId: payload.patientId,
          currency,
          cashReceivedMinorUnits: previousReceived + payload.amountMinorUnits,
          receiptIds: Array.from(
            new Set([...priorReceiptIds, payload.receiptId])
          ),
          paymentStatus: 'PAYMENT_RECORDED',
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
          ],
          eventPayload: {
            receiptId: payload.receiptId,
            invoiceId: payload.invoiceId,
            encounterId: payload.encounterId,
            patientId: payload.patientId,
            amountMinorUnits: payload.amountMinorUnits,
            cumulativeCashReceivedMinorUnits:
              settlementState.cashReceivedMinorUnits,
            currency,
            journalId,
          },
          auditReason: `Captured cash receipt ${payload.referenceNumber} for ${payload.amountMinorUnits / 100} ${currency}`,
          resultData: {
            receipt: receiptState,
            journal: journalState,
            settlement: settlementState,
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
      },
    };
  }
}
