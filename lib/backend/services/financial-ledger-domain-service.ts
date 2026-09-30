/**
 * Financial Ledger Domain Service
 * Enforces SAP-style Universal Journal Postings, Strict Double-Entry Invariance, and Period Closures.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';

export interface JournalLineItem {
  glAccountId: string;
  glAccountName: string;
  costCenterId?: string;
  profitCenterId?: string;
  debitMinorUnits: number;
  creditMinorUnits: number;
  lineDescription: string;
}

export interface PostJournalPayload {
  fiscalYear: number;
  postingPeriod: number;
  documentDate: number;
  postingDate: number;
  referenceDocumentId?: string;
  documentHeader: string;
  currency: string;
  lines: JournalLineItem[];
}

export interface ReverseJournalPayload {
  originalJournalId: string;
  reversalReason: string;
  reversalPostingPeriod: number;
}

export class FinancialLedgerDomainService {
  /**
   * Posts an immutable Universal Journal Voucher with double-entry validation.
   */
  public static async postUniversalJournal(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: PostJournalPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['FINANCE_MANAGER', 'ACCOUNTANT', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Not authorized to post financial journals.' },
      };
    }

    // 1. Double-Entry Validation (§19, §87)
    if (!payload.lines || payload.lines.length < 2) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'INVALID_JOURNAL_STRUCTURE', message: 'Journal must contain at least two line items.' },
      };
    }

    const supportedCurrencies = new Set(['PKR', 'USD', 'AED', 'EUR', 'GBP']);
    const currency = String(payload.currency || '').trim().toUpperCase();
    if (!supportedCurrencies.has(currency)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'UNSUPPORTED_JOURNAL_CURRENCY', message: 'Journal currency is not supported.' },
      };
    }

    if (
      !Number.isInteger(payload.fiscalYear) ||
      payload.fiscalYear < 2000 ||
      !Number.isInteger(payload.postingPeriod) ||
      payload.postingPeriod < 1 ||
      payload.postingPeriod > 12 ||
      !Number.isFinite(payload.documentDate) ||
      !Number.isFinite(payload.postingDate)
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'INVALID_JOURNAL_PERIOD', message: 'Fiscal year, posting period and dates are invalid.' },
      };
    }

    for (const line of payload.lines) {
      const debit = line.debitMinorUnits;
      const credit = line.creditMinorUnits;
      if (
        !String(line.glAccountId || '').trim() ||
        !String(line.glAccountName || '').trim() ||
        !Number.isSafeInteger(debit) ||
        !Number.isSafeInteger(credit) ||
        debit < 0 ||
        credit < 0 ||
        (debit === 0 && credit === 0) ||
        (debit > 0 && credit > 0)
      ) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: 'INVALID_JOURNAL_LINE',
            message: 'Each journal line requires an account and exactly one positive debit or credit in integer minor units.',
          },
        };
      }
    }

    const totalDebits = payload.lines.reduce((sum, line) => sum + line.debitMinorUnits, 0);
    const totalCredits = payload.lines.reduce((sum, line) => sum + line.creditMinorUnits, 0);

    if (!Number.isSafeInteger(totalDebits) || totalDebits <= 0 || totalDebits !== totalCredits) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'UNBALANCED_JOURNAL_POSTING',
          message: `Double-entry invariant violated: Total Debits (${totalDebits}) !== Total Credits (${totalCredits}).`,
        },
      };
    }

    const journalId = `je_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const domainState = {
      journalId,
      tenantId: context.tenantId,
      fiscalYear: payload.fiscalYear,
      postingPeriod: payload.postingPeriod,
      documentDate: payload.documentDate,
      postingDate: payload.postingDate,
      referenceDocumentId: payload.referenceDocumentId,
      documentHeader: payload.documentHeader,
      currency,
      totalAmountMinorUnits: totalDebits,
      lines: payload.lines,
      status: 'POSTED',
      postedBy: context.actorId,
      postedAt: Date.now(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'JOURNAL_ENTRY',
      entityId: journalId,
      eventType: 'JOURNAL_ENTRY_POSTED',
      domainState,
      eventPayload: {
        journalId,
        fiscalYear: payload.fiscalYear,
        postingPeriod: payload.postingPeriod,
        totalAmountMinorUnits: totalDebits,
        lineCount: payload.lines.length,
      },
      auditReason: `Posted journal voucher ${journalId} for amount ${totalDebits / 100} ${currency}`,
      outboxTopic: 'g-hims-finance-events',
    });

    const result: CommandResult = {
      success: true,
      commandId,
      idempotencyKey,
      entityId: journalId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: domainState,
    };
    return result;
  }

  /**
   * Reverses an existing posted journal by generating an inverted compensating voucher (§20).
   */
  public static async reverseJournal(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ReverseJournalPayload,
    originalJournal: PostJournalPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['FINANCE_MANAGER', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Not authorized to reverse financial journals.' },
      };
    }

    // Invert lines: Debits become Credits, Credits become Debits
    const invertedLines: JournalLineItem[] = originalJournal.lines.map((l) => ({
      glAccountId: l.glAccountId,
      glAccountName: l.glAccountName,
      costCenterId: l.costCenterId,
      profitCenterId: l.profitCenterId,
      debitMinorUnits: l.creditMinorUnits,
      creditMinorUnits: l.debitMinorUnits,
      lineDescription: `Reversal of ${payload.originalJournalId}: ${l.lineDescription}`,
    }));

    const reversalJournalId = `je_rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const domainState = {
      journalId: reversalJournalId,
      tenantId: context.tenantId,
      originalJournalId: payload.originalJournalId,
      reversalReason: payload.reversalReason,
      fiscalYear: originalJournal.fiscalYear,
      postingPeriod: payload.reversalPostingPeriod,
      documentHeader: `REVERSAL of ${payload.originalJournalId}: ${payload.reversalReason}`,
      currency: originalJournal.currency,
      lines: invertedLines,
      status: 'POSTED',
      postedBy: context.actorId,
      postedAt: Date.now(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'JOURNAL_ENTRY',
      entityId: reversalJournalId,
      eventType: 'JOURNAL_ENTRY_REVERSED',
      domainState,
      eventPayload: {
        reversalJournalId,
        originalJournalId: payload.originalJournalId,
        reversalReason: payload.reversalReason,
      },
      auditReason: `Reversed voucher ${payload.originalJournalId}. Created compensating voucher ${reversalJournalId}`,
      outboxTopic: 'g-hims-finance-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: reversalJournalId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: domainState,
    };
  }
}
