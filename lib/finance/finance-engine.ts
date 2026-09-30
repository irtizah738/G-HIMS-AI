import { createHash } from 'node:crypto';
import type {
  FinanceAccountRecord,
  FinanceArOpenItem,
  FinanceIntelligenceSnapshot,
  GovernedJournalLine,
  GovernedJournalRecord,
  TrialBalanceLine,
} from '@/types/finance-domain';

export function stableFinanceFingerprint(value: unknown): string {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, stable(child)])
      );
    }
    return input;
  };
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function assertMinorUnits(value: number, code = 'INVALID_MINOR_UNITS'): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(code);
  }
}

export function periodKey(fiscalYear: number, postingPeriod: number): string {
  if (
    !Number.isInteger(fiscalYear) ||
    fiscalYear < 2000 ||
    fiscalYear > 2200 ||
    !Number.isInteger(postingPeriod) ||
    postingPeriod < 1 ||
    postingPeriod > 12
  ) {
    throw new Error('INVALID_FINANCE_PERIOD');
  }
  return `${fiscalYear}-${String(postingPeriod).padStart(2, '0')}`;
}

export function financePeriodId(fiscalYear: number, postingPeriod: number): string {
  return `fin_period_${periodKey(fiscalYear, postingPeriod)}`;
}

export function validateGovernedJournal(params: {
  lines: GovernedJournalLine[];
  accounts: FinanceAccountRecord[];
  currency: string;
  manualPosting?: boolean;
}): { totalDebitMinorUnits: number; totalCreditMinorUnits: number } {
  if (!params.lines?.length || params.lines.length < 2 || params.lines.length > 500) {
    throw new Error('INVALID_JOURNAL_LINE_COUNT');
  }
  const currency = params.currency.trim().toUpperCase();
  const accounts = new Map(params.accounts.map((account) => [account.accountCode, account]));
  let debit = 0;
  let credit = 0;

  for (const line of params.lines) {
    assertMinorUnits(line.debitMinorUnits, 'INVALID_JOURNAL_DEBIT');
    assertMinorUnits(line.creditMinorUnits, 'INVALID_JOURNAL_CREDIT');
    if (
      (line.debitMinorUnits === 0 && line.creditMinorUnits === 0) ||
      (line.debitMinorUnits > 0 && line.creditMinorUnits > 0)
    ) {
      throw new Error('INVALID_JOURNAL_LINE_SIDEDNESS');
    }
    const account = accounts.get(line.glAccountId);
    if (!account || !account.isActive) throw new Error('GL_ACCOUNT_NOT_ACTIVE');
    if (account.currency.trim().toUpperCase() !== currency) {
      throw new Error('GL_ACCOUNT_CURRENCY_MISMATCH');
    }
    if (params.manualPosting && !account.allowManualPosting) {
      throw new Error('GL_ACCOUNT_MANUAL_POSTING_BLOCKED');
    }
    if (account.costCenterRequired && !line.costCenterId) {
      throw new Error('GL_COST_CENTER_REQUIRED');
    }
    if (account.profitCenterRequired && !line.profitCenterId) {
      throw new Error('GL_PROFIT_CENTER_REQUIRED');
    }
    debit += line.debitMinorUnits;
    credit += line.creditMinorUnits;
  }

  if (!Number.isSafeInteger(debit) || debit <= 0 || debit !== credit) {
    throw new Error('UNBALANCED_JOURNAL_POSTING');
  }
  return { totalDebitMinorUnits: debit, totalCreditMinorUnits: credit };
}

export function buildTrialBalance(params: {
  journals: GovernedJournalRecord[];
  accounts: FinanceAccountRecord[];
  fiscalYear: number;
  throughPostingPeriod: number;
  currency: string;
}): {
  lines: TrialBalanceLine[];
  totalDebitMinorUnits: number;
  totalCreditMinorUnits: number;
  balanced: boolean;
} {
  const currency = params.currency.trim().toUpperCase();
  const accounts = new Map(params.accounts.map((a) => [a.accountCode, a]));
  const movement = new Map<string, { debit: number; credit: number }>();

  for (const journal of params.journals) {
    if (
      journal.status !== 'POSTED' ||
      journal.fiscalYear !== params.fiscalYear ||
      journal.postingPeriod > params.throughPostingPeriod ||
      journal.currency.trim().toUpperCase() !== currency
    ) continue;
    for (const line of journal.lines) {
      const current = movement.get(line.glAccountId) || { debit: 0, credit: 0 };
      current.debit += line.debitMinorUnits;
      current.credit += line.creditMinorUnits;
      movement.set(line.glAccountId, current);
    }
  }

  const lines: TrialBalanceLine[] = [];
  let totalDebitMinorUnits = 0;
  let totalCreditMinorUnits = 0;
  for (const [accountCode, values] of movement.entries()) {
    const account = accounts.get(accountCode);
    if (!account) throw new Error(`TRIAL_BALANCE_ACCOUNT_MISSING:${accountCode}`);
    const net = values.debit - values.credit;
    const debitMinorUnits = Math.max(0, net);
    const creditMinorUnits = Math.max(0, -net);
    lines.push({
      accountCode,
      accountName: account.accountName,
      category: account.category,
      normalBalance: account.normalBalance,
      debitMinorUnits,
      creditMinorUnits,
      endingBalanceMinorUnits:
        account.normalBalance === 'debit' ? net : -net,
    });
    totalDebitMinorUnits += debitMinorUnits;
    totalCreditMinorUnits += creditMinorUnits;
  }

  lines.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  return {
    lines,
    totalDebitMinorUnits,
    totalCreditMinorUnits,
    balanced: totalDebitMinorUnits === totalCreditMinorUnits,
  };
}

export function arAgingBucket(item: FinanceArOpenItem, asOf: number):
  | 'CURRENT'
  | '1_30'
  | '31_60'
  | '61_90'
  | 'OVER_90' {
  const daysPastDue = Math.floor((asOf - item.dueAt) / 86400000);
  if (daysPastDue <= 0) return 'CURRENT';
  if (daysPastDue <= 30) return '1_30';
  if (daysPastDue <= 60) return '31_60';
  if (daysPastDue <= 90) return '61_90';
  return 'OVER_90';
}

export function straightLineMonthlyDepreciationMinorUnits(params: {
  acquisitionCostMinorUnits: number;
  salvageValueMinorUnits: number;
  usefulLifeMonths: number;
  monthsDepreciated: number;
}): number {
  assertMinorUnits(params.acquisitionCostMinorUnits);
  assertMinorUnits(params.salvageValueMinorUnits);
  if (
    params.salvageValueMinorUnits > params.acquisitionCostMinorUnits ||
    !Number.isInteger(params.usefulLifeMonths) ||
    params.usefulLifeMonths <= 0 ||
    !Number.isInteger(params.monthsDepreciated) ||
    params.monthsDepreciated < 0
  ) throw new Error('INVALID_DEPRECIATION_INPUT');
  if (params.monthsDepreciated >= params.usefulLifeMonths) return 0;
  const depreciable =
    params.acquisitionCostMinorUnits - params.salvageValueMinorUnits;
  const base = Math.floor(depreciable / params.usefulLifeMonths);
  const remainder = depreciable % params.usefulLifeMonths;
  return base + (params.monthsDepreciated < remainder ? 1 : 0);
}

export function buildFinanceAnomalies(
  metrics: FinanceIntelligenceSnapshot['metrics'],
  trialBalanceBalanced: boolean
): FinanceIntelligenceSnapshot['anomalies'] {
  const anomalies: FinanceIntelligenceSnapshot['anomalies'] = [];
  if (!trialBalanceBalanced) {
    anomalies.push({
      code: 'TRIAL_BALANCE_IMBALANCE',
      severity: 'CRITICAL',
      amountMinorUnits: 0,
      explanation: 'Universal Journal trial balance is not balanced.',
    });
  }
  if (metrics.workingCapitalMinorUnits < 0) {
    anomalies.push({
      code: 'NEGATIVE_WORKING_CAPITAL',
      severity: 'CRITICAL',
      amountMinorUnits: Math.abs(metrics.workingCapitalMinorUnits),
      explanation: 'Current liabilities exceed current assets.',
    });
  }
  if (metrics.overdueArMinorUnits > 0) {
    anomalies.push({
      code: 'OVERDUE_AR',
      severity: 'WARNING',
      amountMinorUnits: metrics.overdueArMinorUnits,
      explanation: 'Accounts receivable contains overdue open items.',
    });
  }
  if (metrics.overdueApMinorUnits > 0) {
    anomalies.push({
      code: 'OVERDUE_AP',
      severity: 'WARNING',
      amountMinorUnits: metrics.overdueApMinorUnits,
      explanation: 'Accounts payable contains overdue supplier liabilities.',
    });
  }
  if (metrics.unreconciledBankMinorUnits !== 0) {
    anomalies.push({
      code: 'BANK_RECONCILIATION_VARIANCE',
      severity: 'CRITICAL',
      amountMinorUnits: Math.abs(metrics.unreconciledBankMinorUnits),
      explanation: 'Approved bank reconciliation still contains a variance.',
    });
  }
  if (metrics.budgetAvailableMinorUnits < 0) {
    anomalies.push({
      code: 'BUDGET_EXHAUSTED',
      severity: 'WARNING',
      amountMinorUnits: Math.abs(metrics.budgetAvailableMinorUnits),
      explanation: 'Approved budget envelopes are overcommitted or overspent.',
    });
  }
  return anomalies;
}
