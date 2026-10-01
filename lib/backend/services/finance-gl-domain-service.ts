import { createHash } from 'node:crypto';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  FinanceAccountCategory,
  FinanceAccountRecord,
  FinanceNormalBalance,
  FinancePeriodRecord,
  FinanceTrialBalanceSnapshot,
  GovernedJournalLine,
  GovernedJournalRecord,
} from '@/types/finance-domain';
import {
  buildTrialBalance,
  financePeriodId,
  periodKey,
  stableFinanceFingerprint,
  validateGovernedJournal,
} from '@/lib/finance/finance-engine';

export interface CreateFinanceAccountPayload {
  accountCode: string;
  accountName: string;
  category: FinanceAccountCategory;
  subCategory: string;
  normalBalance: FinanceNormalBalance;
  currency: string;
  parentAccountCode?: string;
  costCenterRequired?: boolean;
  profitCenterRequired?: boolean;
  allowManualPosting: boolean;
  allowCashReceipts?: boolean;
  allowSupplierPayments?: boolean;
  isSystemLocked?: boolean;
}

export interface CreateFinancePeriodPayload {
  fiscalYear: number;
  postingPeriod: number;
  periodName: string;
  startAt: number;
  endAt: number;
}

export interface ChangeFinancePeriodStatusPayload {
  fiscalYear: number;
  postingPeriod: number;
  nextStatus: 'SOFT_CLOSE' | 'OPEN';
  reason: string;
}

export interface PostGovernedJournalPayload {
  journalId?: string;
  fiscalYear: number;
  postingPeriod: number;
  documentDate: number;
  postingDate: number;
  referenceDocumentId?: string;
  documentHeader: string;
  currency: string;
  sourceModule?:
    | 'MANUAL'
    | 'BILLING'
    | 'AR'
    | 'AP'
    | 'TREASURY'
    | 'SCM'
    | 'PAYROLL'
    | 'ASSETS'
    | 'COSTING'
    | 'TAX'
    | 'CLOSE';
  lines: GovernedJournalLine[];
}

export interface ReverseGovernedJournalPayload {
  originalJournalId: string;
  fiscalYear: number;
  postingPeriod: number;
  reversalPostingAt: number;
  reversalReason: string;
}

export interface GenerateTrialBalancePayload {
  snapshotId: string;
  fiscalYear: number;
  throughPostingPeriod: number;
  currency: string;
}

function reject(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string,
  details?: unknown
): CommandResult {
  return {
    success: false,
    commandId,
    idempotencyKey,
    error: { code, message, details },
  };
}

function deterministicId(prefix: string, value: string): string {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${prefix}_${digest}`;
}

function assertPostingDateMatchesPeriod(
  fiscalYear: number,
  postingPeriod: number,
  postingAt: number
): void {
  if (!Number.isFinite(postingAt)) {
    throw new AtomicMutationRejectedError(
      'INVALID_FINANCE_POSTING_DATE',
      'Posting date is invalid.'
    );
  }
  const date = new Date(postingAt);
  if (
    date.getUTCFullYear() !== fiscalYear ||
    date.getUTCMonth() + 1 !== postingPeriod
  ) {
    throw new AtomicMutationRejectedError(
      'FINANCE_POSTING_PERIOD_MISMATCH',
      'Posting date does not match fiscal year/posting period.'
    );
  }
}

async function resolveAccounts(
  tenantId: string,
  accountCodes: string[]
): Promise<FinanceAccountRecord[]> {
  const unique = [...new Set(accountCodes.map((value) => value.trim()))];
  const records = await Promise.all(
    unique.map(async (accountCode) => {
      const matches =
        await DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
          tenantId,
          'accounts',
          'accountCode',
          accountCode,
          { pageSize: 10, maxRows: 10 }
        );
      if (matches.length !== 1) {
        throw new AtomicMutationRejectedError(
          matches.length === 0
            ? 'GL_ACCOUNT_NOT_FOUND'
            : 'GL_ACCOUNT_CODE_NOT_UNIQUE',
          `Account code ${accountCode} must resolve to exactly one authoritative GL account.`
        );
      }
      const row = matches[0] as FinanceAccountRecord & { id?: string };
      const accountId = String(row.accountId || row.id || '').trim();
      if (!accountId) {
        throw new AtomicMutationRejectedError(
          'GL_ACCOUNT_DOCUMENT_ID_MISSING',
          `Account code ${accountCode} is missing its stable document identifier.`
        );
      }
      return { ...row, accountId };
    })
  );
  return records;
}

export class FinanceGlDomainService {
  public static async createAccount(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateFinanceAccountPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['FINANCE_MANAGER', 'SYSTEM_ADMIN', 'ADMINISTRATOR'],
    });
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Finance account administration authority required.'
      );
    }

    try {
      const accountCode = payload.accountCode.trim();
      const currency = payload.currency.trim().toUpperCase();
      if (!/^[0-9A-Z._-]{3,20}$/.test(accountCode) || currency.length !== 3) {
        throw new AtomicMutationRejectedError(
          'INVALID_GL_ACCOUNT',
          'GL account code or currency is invalid.'
        );
      }
      const existing =
        await DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
          context.tenantId,
          'accounts',
          'accountCode',
          accountCode,
          { pageSize: 10, maxRows: 10 }
        );
      if (existing.length) {
        throw new AtomicMutationRejectedError(
          'GL_ACCOUNT_CODE_EXISTS',
          'GL account code already exists.'
        );
      }

      const accountId = deterministicId(
        'gl',
        `${context.tenantId}:${accountCode}`
      );
      const now = new Date().toISOString();
      const account: FinanceAccountRecord = {
        accountId,
        id: accountId,
        tenantId: context.tenantId,
        accountCode,
        accountName: payload.accountName.trim(),
        category: payload.category,
        subCategory: payload.subCategory.trim(),
        normalBalance: payload.normalBalance,
        currency,
        parentAccountCode: payload.parentAccountCode?.trim() || undefined,
        costCenterRequired: payload.costCenterRequired === true,
        profitCenterRequired: payload.profitCenterRequired === true,
        allowManualPosting: payload.allowManualPosting === true,
        allowCashReceipts: payload.allowCashReceipts === true,
        allowSupplierPayments: payload.allowSupplierPayments === true,
        isActive: true,
        isSystemLocked: payload.isSystemLocked === true,
        createdAt: now,
        createdBy: context.actorId,
      };

      const tx = await TransactionManager.executeAtomicWrite(
        context,
        commandId,
        idempotencyKey,
        {
          entityType: 'GL_ACCOUNT',
          entityId: accountId,
          eventType: 'FINANCE_GL_ACCOUNT_CREATED',
          domainState: account,
          eventPayload: {
            accountId,
            accountCode,
            category: payload.category,
            currency,
          },
          auditReason: `Created governed GL account ${accountCode} - ${account.accountName}.`,
          outboxTopic: 'g-hims-finance-events',
        }
      );

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: accountId,
        eventId: tx.event.eventId,
        auditId: tx.audit.auditId,
        outboxId: tx.outbox.outboxId,
        data: account,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async createPeriod(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateFinancePeriodPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['FINANCE_MANAGER', 'SYSTEM_ADMIN', 'ADMINISTRATOR'],
    });
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Finance period administration authority required.'
      );
    }

    try {
      const key = periodKey(payload.fiscalYear, payload.postingPeriod);
      if (
        !Number.isFinite(payload.startAt) ||
        !Number.isFinite(payload.endAt) ||
        payload.endAt <= payload.startAt
      ) {
        throw new AtomicMutationRejectedError(
          'INVALID_FINANCE_PERIOD_RANGE',
          'Finance period date range is invalid.'
        );
      }
      const start = new Date(payload.startAt);
      const end = new Date(payload.endAt);
      if (
        start.getUTCFullYear() !== payload.fiscalYear ||
        start.getUTCMonth() + 1 !== payload.postingPeriod ||
        end.getUTCFullYear() !== payload.fiscalYear ||
        end.getUTCMonth() + 1 !== payload.postingPeriod
      ) {
        throw new AtomicMutationRejectedError(
          'FINANCE_PERIOD_CALENDAR_MISMATCH',
          'Finance period boundaries must remain inside the configured fiscal month.'
        );
      }

      const periodId = financePeriodId(
        payload.fiscalYear,
        payload.postingPeriod
      );
      const period: FinancePeriodRecord = {
        periodId,
        tenantId: context.tenantId,
        fiscalYear: payload.fiscalYear,
        postingPeriod: payload.postingPeriod,
        periodKey: key,
        periodName: payload.periodName.trim(),
        startAt: payload.startAt,
        endAt: payload.endAt,
        status: 'OPEN',
        createdAt: new Date().toISOString(),
        createdBy: context.actorId,
      };

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'FINANCE_MANAGER',
        aggregateType: 'FINANCE_PERIOD',
        aggregateId: periodId,
        eventType: 'FINANCE_PERIOD_CREATED',
        auditAction: 'FINANCE_PERIOD_CREATED',
        auditResourceType: 'FINANCE_PERIOD',
        auditResourceId: periodId,
        outboxTopic: 'g-hims-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'existing',
            entityType: 'FINANCE_PERIOD',
            entityId: periodId,
            required: false,
          },
        ],
        prepare: (current) => {
          if (current.existing) {
            throw new AtomicMutationRejectedError(
              'FINANCE_PERIOD_EXISTS',
              'Finance period already exists.'
            );
          }
          return {
            domainState: period,
            eventPayload: {
              periodId,
              periodKey: key,
              status: 'OPEN',
            },
            auditReason: `Created finance period ${key} in OPEN state.`,
            resultData: period,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: periodId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      if (error instanceof Error && error.message === 'INVALID_FINANCE_PERIOD') {
        return reject(
          commandId,
          idempotencyKey,
          'INVALID_FINANCE_PERIOD',
          'Fiscal year/posting period is invalid.'
        );
      }
      throw error;
    }
  }

  public static async changePeriodStatus(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ChangeFinancePeriodStatusPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['FINANCE_MANAGER', 'SYSTEM_ADMIN', 'ADMINISTRATOR'],
    });
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Finance period control authority required.'
      );
    }

    try {
      const periodId = financePeriodId(
        payload.fiscalYear,
        payload.postingPeriod
      );
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'FINANCE_MANAGER',
        aggregateType: 'FINANCE_PERIOD',
        aggregateId: periodId,
        eventType: 'FINANCE_PERIOD_STATUS_CHANGED',
        auditAction: 'FINANCE_PERIOD_STATUS_CHANGED',
        auditResourceType: 'FINANCE_PERIOD',
        auditResourceId: periodId,
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
        ],
        prepare: (current) => {
          const period = current.period as unknown as FinancePeriodRecord;
          const allowed: Record<string, string[]> = {
            OPEN: ['SOFT_CLOSE'],
            SOFT_CLOSE: ['OPEN'],
            CLOSED: [],
            LOCKED: [],
          };
          if (!(allowed[period.status] || []).includes(payload.nextStatus)) {
            throw new AtomicMutationRejectedError(
              'INVALID_FINANCE_PERIOD_TRANSITION',
              `Cannot transition finance period from ${period.status} to ${payload.nextStatus}.`
            );
          }
          const now = new Date().toISOString();
          const next: FinancePeriodRecord = {
            ...period,
            status: payload.nextStatus,

          };
          return {
            domainState: next,
            eventPayload: {
              periodId,
              previousStatus: period.status,
              nextStatus: payload.nextStatus,
            },
            auditReason: `Changed finance period ${period.periodKey} from ${period.status} to ${payload.nextStatus}: ${payload.reason}`,
            resultData: next,
          };
        },
      });
      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: periodId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async postJournal(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: PostGovernedJournalPayload
  ): Promise<CommandResult> {
    const sourceModule = payload.sourceModule || 'MANUAL';
    if (sourceModule !== 'MANUAL') {
      return reject(
        commandId,
        idempotencyKey,
        'GENERIC_JOURNAL_SOURCE_MODULE_FORBIDDEN',
        'The generic journal command is reserved for MANUAL postings. System subledgers must post through their governed domain services.'
      );
    }
    const requestedAuthorityMinorUnits = payload.lines.reduce(
      (sum, line) => sum + Number(line.debitMinorUnits || 0),
      0
    );
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles:
        sourceModule === 'MANUAL'
          ? ['FINANCE_MANAGER', 'ACCOUNTANT', 'SYSTEM_ADMIN', 'ADMINISTRATOR']
          : ['SYSTEM_ADMIN', 'ADMINISTRATOR', 'FINANCE_MANAGER', 'ACCOUNTANT'],
      requiredPermissions: ['ERP_GL:CREATE'],
      financialLimitMinorUnits: requestedAuthorityMinorUnits,
    });
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Finance journal posting authority required.'
      );
    }

    try {
      assertPostingDateMatchesPeriod(
        payload.fiscalYear,
        payload.postingPeriod,
        payload.postingDate
      );
      const periodId = financePeriodId(
        payload.fiscalYear,
        payload.postingPeriod
      );
      const accounts = await resolveAccounts(
        context.tenantId,
        payload.lines.map((line) => line.glAccountId)
      );
      let validation;
      try {
        validation = validateGovernedJournal({
          lines: payload.lines,
          accounts,
          currency: payload.currency,
          manualPosting: sourceModule === 'MANUAL',
        });
      } catch (error) {
        throw new AtomicMutationRejectedError(
          error instanceof Error ? error.message : 'INVALID_JOURNAL',
          'Journal failed governed account/double-entry validation.'
        );
      }

      const journalId =
        payload.journalId?.trim() ||
        deterministicId(
          'je',
          `${context.tenantId}:${idempotencyKey}`
        );
      const now = Date.now();
      const journal: GovernedJournalRecord = {
        journalId,
        tenantId: context.tenantId,
        fiscalYear: payload.fiscalYear,
        postingPeriod: payload.postingPeriod,
        documentDate: payload.documentDate,
        postingDate: payload.postingDate,
        referenceDocumentId: payload.referenceDocumentId,
        documentHeader: payload.documentHeader.trim(),
        currency: payload.currency.trim().toUpperCase(),
        totalAmountMinorUnits: validation.totalDebitMinorUnits,
        lines: payload.lines,
        sourceModule,
        status: 'POSTED',
        postedBy: context.actorId,
        postedAt: now,
      };

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'ACCOUNTANT',
        aggregateType: 'JOURNAL_ENTRY',
        aggregateId: journalId,
        eventType: 'JOURNAL_ENTRY_POSTED',
        auditAction: 'JOURNAL_ENTRY_POSTED',
        auditResourceType: 'JOURNAL_ENTRY',
        auditResourceId: journalId,
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
          ...accounts.map((account, index) => ({
            key: `account:${index}`,
            entityType: 'GL_ACCOUNT',
            entityId: account.accountId,
            required: true,
          })),
        ],
        prepare: (current) => {
          const period = current.period as unknown as FinancePeriodRecord;
          if (!['OPEN', 'SOFT_CLOSE'].includes(period.status)) {
            throw new AtomicMutationRejectedError(
              'FINANCE_PERIOD_NOT_POSTABLE',
              `Finance period ${period.periodKey} is ${period.status}.`
            );
          }
          accounts.forEach((expected, index) => {
            const actual = current[`account:${index}`] as unknown as FinanceAccountRecord;
            if (
              actual.accountCode !== expected.accountCode ||
              actual.isActive !== true ||
              actual.currency.trim().toUpperCase() !== journal.currency
            ) {
              throw new AtomicMutationRejectedError(
                'GL_ACCOUNT_STATE_CHANGED',
                'GL account changed after journal validation; retry required.'
              );
            }
          });
          return {
            domainState: journal,
            eventPayload: {
              journalId,
              fiscalYear: journal.fiscalYear,
              postingPeriod: journal.postingPeriod,
              sourceModule,
              totalAmountMinorUnits: journal.totalAmountMinorUnits,
              lineCount: journal.lines.length,
            },
            auditReason: `Posted governed ${sourceModule} journal ${journalId} for ${journal.totalAmountMinorUnits} minor units.`,
            resultData: journal,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: journalId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async reverseJournal(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ReverseGovernedJournalPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['FINANCE_MANAGER', 'SYSTEM_ADMIN', 'ADMINISTRATOR'],
    });
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Finance journal reversal authority required.'
      );
    }

    try {
      assertPostingDateMatchesPeriod(
        payload.fiscalYear,
        payload.postingPeriod,
        payload.reversalPostingAt
      );
      const original =
        await DomainStateRepository.getById<GovernedJournalRecord>(
          context.tenantId,
          'journalEntries',
          payload.originalJournalId
        );
      if (!original || original.status !== 'POSTED') {
        throw new AtomicMutationRejectedError(
          'JOURNAL_NOT_REVERSIBLE',
          'Original journal does not exist or is not posted.'
        );
      }
      if (original.reversedByJournalId) {
        throw new AtomicMutationRejectedError(
          'JOURNAL_ALREADY_REVERSED',
          'Original journal already has a compensating reversal.'
        );
      }

      const reversalId = deterministicId(
        'je_rev',
        `${context.tenantId}:${payload.originalJournalId}`
      );
      const periodId = financePeriodId(
        payload.fiscalYear,
        payload.postingPeriod
      );
      const reversedLines = original.lines.map((line) => ({
        ...line,
        debitMinorUnits: line.creditMinorUnits,
        creditMinorUnits: line.debitMinorUnits,
        lineDescription: `Reversal of ${payload.originalJournalId}: ${line.lineDescription}`,
      }));
      const reversal: GovernedJournalRecord = {
        journalId: reversalId,
        tenantId: context.tenantId,
        fiscalYear: payload.fiscalYear,
        postingPeriod: payload.postingPeriod,
        documentDate: payload.reversalPostingAt,
        postingDate: payload.reversalPostingAt,
        referenceDocumentId: payload.originalJournalId,
        documentHeader: `Reversal: ${payload.reversalReason}`,
        currency: original.currency,
        totalAmountMinorUnits: original.totalAmountMinorUnits,
        lines: reversedLines,
        sourceModule: 'CLOSE',
        status: 'POSTED',
        postedBy: context.actorId,
        postedAt: Date.now(),
      };

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'FINANCE_MANAGER',
        aggregateType: 'JOURNAL_ENTRY',
        aggregateId: reversalId,
        eventType: 'JOURNAL_ENTRY_REVERSED',
        auditAction: 'JOURNAL_ENTRY_REVERSED',
        auditResourceType: 'JOURNAL_ENTRY',
        auditResourceId: payload.originalJournalId,
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
            key: 'original',
            entityType: 'JOURNAL_ENTRY',
            entityId: payload.originalJournalId,
            required: true,
          },
        ],
        prepare: (current) => {
          const period = current.period as unknown as FinancePeriodRecord;
          const currentOriginal = current.original as unknown as GovernedJournalRecord;
          if (!['OPEN', 'SOFT_CLOSE'].includes(period.status)) {
            throw new AtomicMutationRejectedError(
              'FINANCE_PERIOD_NOT_POSTABLE',
              'Reversal period is not open.'
            );
          }
          if (
            currentOriginal.status !== 'POSTED' ||
            currentOriginal.reversedByJournalId
          ) {
            throw new AtomicMutationRejectedError(
              'JOURNAL_ALREADY_REVERSED',
              'Original journal state changed before reversal.'
            );
          }
          return {
            domainState: reversal,
            additionalStateWrites: [
              {
                entityType: 'JOURNAL_ENTRY',
                entityId: currentOriginal.journalId,
                domainState: {
                  ...currentOriginal,
                  status: 'REVERSED',
                  reversedByJournalId: reversalId,
                },
              },
            ],
            eventPayload: {
              originalJournalId: currentOriginal.journalId,
              reversalJournalId: reversalId,
            },
            auditReason: `Reversed journal ${currentOriginal.journalId}: ${payload.reversalReason}`,
            resultData: reversal,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: reversalId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async generateTrialBalance(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: GenerateTrialBalancePayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'FINANCE_MANAGER',
        'ACCOUNTANT',
        'AUDITOR',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Trial balance authority required.'
      );
    }

    try {
      periodKey(payload.fiscalYear, payload.throughPostingPeriod);
      const [accounts, journals] = await Promise.all([
        DomainStateRepository.list<FinanceAccountRecord>(
          context.tenantId,
          'accounts',
          50000
        ),
        DomainStateRepository.queryAllEqual<GovernedJournalRecord>(
          context.tenantId,
          'journalEntries',
          'fiscalYear',
          payload.fiscalYear,
          { pageSize: 500, maxRows: 500000 }
        ),
      ]);
      const currency = payload.currency.trim().toUpperCase();
      const relevantAccounts = accounts.filter(
        (account) => account.currency.trim().toUpperCase() === currency
      );
      const trial = buildTrialBalance({
        journals,
        accounts: relevantAccounts,
        fiscalYear: payload.fiscalYear,
        throughPostingPeriod: payload.throughPostingPeriod,
        currency,
      });
      if (!trial.balanced) {
        throw new AtomicMutationRejectedError(
          'TRIAL_BALANCE_IMBALANCED',
          'Universal Journal trial balance is not balanced.',
          {
            totalDebitMinorUnits: trial.totalDebitMinorUnits,
            totalCreditMinorUnits: trial.totalCreditMinorUnits,
          }
        );
      }

      const snapshot: FinanceTrialBalanceSnapshot = {
        snapshotId: payload.snapshotId,
        tenantId: context.tenantId,
        fiscalYear: payload.fiscalYear,
        postingPeriod: payload.throughPostingPeriod,
        currency,
        generatedAt: new Date().toISOString(),
        generatedBy: context.actorId,
        lines: trial.lines,
        totalDebitMinorUnits: trial.totalDebitMinorUnits,
        totalCreditMinorUnits: trial.totalCreditMinorUnits,
        balanced: trial.balanced,
        inputFingerprint: stableFinanceFingerprint({
          accounts: relevantAccounts.map((account) => [
            account.accountId,
            account.accountCode,
            account.isActive,
            account.currency,
          ]),
          journals: journals.map((journal) => [
            journal.journalId,
            journal.status,
            journal.fiscalYear,
            journal.postingPeriod,
            journal.totalAmountMinorUnits,
          ]),
        }),
      };

      const tx = await TransactionManager.executeAtomicWrite(
        context,
        commandId,
        idempotencyKey,
        {
          entityType: 'TRIAL_BALANCE_SNAPSHOT',
          entityId: payload.snapshotId,
          eventType: 'FINANCE_TRIAL_BALANCE_GENERATED',
          domainState: snapshot,
          eventPayload: {
            snapshotId: payload.snapshotId,
            fiscalYear: payload.fiscalYear,
            postingPeriod: payload.throughPostingPeriod,
            lineCount: snapshot.lines.length,
            inputFingerprint: snapshot.inputFingerprint,
          },
          auditReason: `Generated balanced trial balance through ${periodKey(
            payload.fiscalYear,
            payload.throughPostingPeriod
          )}.`,
          outboxTopic: 'g-hims-finance-events',
        }
      );

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.snapshotId,
        eventId: tx.event.eventId,
        auditId: tx.audit.auditId,
        outboxId: tx.outbox.outboxId,
        data: snapshot,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      if (error instanceof Error && error.message === 'INVALID_FINANCE_PERIOD') {
        return reject(
          commandId,
          idempotencyKey,
          'INVALID_FINANCE_PERIOD',
          'Trial balance period is invalid.'
        );
      }
      throw error;
    }
  }
}
