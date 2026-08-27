export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export type NormalBalance = 'debit' | 'credit';

export type JournalVoucherStatus = 'draft' | 'posted' | 'reversed';

export type JournalSourceModule = 'billing' | 'pharmacy' | 'scm' | 'payroll' | 'manual';

export interface ChartOfAccount {
  id?: string;
  tenantId?: string;
  accountCode: string; // e.g. '1010', '1020', '2010', '4010', '5010'
  accountName: string; // e.g. 'Cash at Bank', 'Accounts Payable', 'Pharmacy Revenue'
  category: AccountType;
  subCategory: string; // e.g. 'Current Assets', 'Operating Expenses', 'Direct Costs'
  balance: number; // Current ledger balance with 2-decimal precision
  isActive: boolean;
  normalBalance?: NormalBalance;
  currency?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface JournalLine {
  id?: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
  department?: string;
  referenceId?: string;
}

export interface JournalVoucher {
  id: string;
  tenantId: string;
  voucherNumber: string; // e.g. 'JV-2026-0089'
  postingDate: string; // YYYY-MM-DD
  description: string;
  lines: JournalLine[];
  totalDebits: number;
  totalCredits: number;
  status: JournalVoucherStatus;
  postedBy: string;
  postedAt: number; // Unix timestamp in ms
  sourceModule: JournalSourceModule;
  referenceNumber?: string;
  reversedAt?: number;
  reversalReason?: string;
  reversedBy?: string;
  reversalVoucherId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LedgerValidationResult {
  isValid: boolean;
  totalDebits: number;
  totalCredits: number;
  imbalanceAmount: number;
  error?: string;
}

export interface AccountLedgerEntry {
  voucherId: string;
  voucherNumber: string;
  postingDate: string;
  description: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  runningBalance: number;
  sourceModule: JournalSourceModule;
  postedBy: string;
  postedAt: number;
}
