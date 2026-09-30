export type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export type NormalBalance = 'debit' | 'credit';

export type JournalEntryStatus = 'draft' | 'posted' | 'void';

export type VendorInvoiceStatus = 'unpaid' | 'partially_paid' | 'paid' | 'void';

export type AssetCategory = 'medical_equipment' | 'it_hardware' | 'facility' | 'vehicles';

export type DepreciationMethod = 'straight_line' | 'declining_balance';

export type FixedAssetStatus = 'active' | 'disposed' | 'under_maintenance' | 'fully_depreciated';

export interface Account {
  id: string;
  accountCode: string; // e.g., '1010', '1020', '2010', '4010'
  accountName: string; // e.g., 'Cash and Cash Equivalents'
  category: AccountCategory;
  subCategory: string; // e.g., 'Current Assets', 'Fixed Assets', 'Current Liabilities', 'Operating Revenue'
  normalBalance: NormalBalance;
  balance: number; // Stored in currency units (e.g. 125000.50)
  currency: string; // e.g., 'USD'
  description?: string;
  isActive: boolean;
  isSystemLocked?: boolean; // Prevents accidental deletion of core GL accounts
  /** Explicit treasury capability; supplier settlement cannot use arbitrary asset accounts. */
  allowSupplierPayments?: boolean;
  /** Explicit receipt capability; cash/bank collections cannot use arbitrary asset accounts. */
  allowCashReceipts?: boolean;
  /** Manual journals are blocked unless the account explicitly permits them. */
  allowManualPosting?: boolean;
  costCenterRequired?: boolean;
  profitCenterRequired?: boolean;
  parentAccountCode?: string | null;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface JournalLine {
  id: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
  department?: string;
  referenceId?: string;
}

export interface JournalEntry {
  id: string;
  entryNumber: string; // e.g., 'JE-2026-0042'
  postingDate: string; // YYYY-MM-DD
  referenceNumber: string; // e.g., 'INV-8891' or 'DEP-2026-08'
  description: string;
  sourceModule: 'manual' | 'ap_invoice' | 'ap_payment' | 'depreciation' | 'patient_billing' | 'payroll';
  lines: JournalLine[];
  totalDebits: number;
  totalCredits: number;
  status: JournalEntryStatus;
  postedBy: string;
  postedAt?: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface APInvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  expenseAccountCode: string;
  expenseAccountName: string;
}

export interface APPaymentRecord {
  id: string;
  paymentNumber: string;
  paymentDate: string;
  amount: number;
  paymentMethod: 'bank_transfer' | 'check' | 'ach' | 'credit_card' | 'cash';
  paidFromAccountCode: string;
  paidFromAccountName: string;
  referenceNumber: string;
  notes?: string;
  journalEntryId?: string;
  recordedBy: string;
  recordedAt: string;
}

export interface VendorInvoice {
  id: string;
  invoiceNumber: string; // Vendor's invoice number
  internalRef: string; // e.g., 'AP-2026-104'
  vendorId: string;
  vendorName: string;
  poId?: string; // Purchase Order Reference
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  remainingBalance: number;
  status: VendorInvoiceStatus;
  apAccountCode: string; // Usually '2010' - Accounts Payable
  lines: APInvoiceLine[];
  payments: APPaymentRecord[];
  journalEntryId?: string; // Links to the initial AP Recognition Journal Entry
  notes?: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface FixedAsset {
  id: string;
  assetTag: string; // e.g., 'MED-RAD-001'
  serialNumber: string;
  assetName: string;
  assetCategory: AssetCategory;
  department: string;
  location: string;
  manufacturer?: string;
  model?: string;
  purchaseDate: string; // YYYY-MM-DD
  inServiceDate: string; // YYYY-MM-DD
  acquisitionCost: number;
  salvageValue: number;
  usefulLifeYears: number;
  depreciationMethod: DepreciationMethod;
  accumulatedDepreciation: number;
  currentBookValue: number;
  assetAccountCode: string; // e.g. '1510' - Medical Equipment Asset
  accumulatedDepreciationAccountCode: string; // e.g. '1519' - Accum Depr: Medical Equipment
  depreciationExpenseAccountCode: string; // e.g. '6210' - Depreciation Expense: Medical Equip
  lastDepreciationDate?: string; // YYYY-MM-DD of latest monthly run
  status: FixedAssetStatus;
  warrantyExpiration?: string;
  maintenanceVendor?: string;
  notes?: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DepreciationScheduleItem {
  periodIndex: number;
  periodLabel: string; // e.g., 'Year 1' or '2026-08'
  openingBookValue: number;
  depreciationExpense: number;
  accumulatedDepreciation: number;
  closingBookValue: number;
}

export interface DepreciationRunLog {
  id: string;
  runNumber: string; // e.g., 'DEP-RUN-2026-08'
  runDate: string;
  fiscalPeriod: string; // YYYY-MM
  totalDepreciationPosted: number;
  assetsProcessedCount: number;
  journalEntryId: string;
  assetBreakdown: {
    assetId: string;
    assetTag: string;
    assetName: string;
    depreciationAmount: number;
    newBookValue: number;
  }[];
  postedBy: string;
  status: 'posted' | 'failed';
  tenantId: string;
  createdAt: string;
}

// ============================================================================
// FISCAL GOVERNANCE & GENERAL LEDGER EXTENSIONS
// ============================================================================

export type AccountingPeriodStatus = 'open' | 'soft_close' | 'closed' | 'locked';

export interface AccountingPeriod {
  id: string;
  tenantId: string;
  periodName: string; // e.g., 'January 2026'
  fiscalYear: number; // e.g., 2026
  periodNumber: number; // 1 to 12
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: AccountingPeriodStatus;
  closedAt?: string;
  closedBy?: string;
  lockedAt?: string;
  lockedBy?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntry {
  id: string;
  tenantId: string;
  journalEntryId: string;
  entryNumber: string;
  accountCode: string;
  accountName: string;
  postingDate: string;
  debit: number;
  credit: number;
  runningBalance: number;
  department?: string;
  costCenterId?: string;
  sourceModule: string;
  referenceNumber?: string;
  postedBy: string;
  createdAt: string;
}

export interface FinancialAuditLog {
  id: string;
  tenantId: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: string;
  action: 'create_journal' | 'reverse_journal' | 'close_period' | 'lock_period' | 'create_account' | 'reconcile_shift' | 'approve_refund' | 'write_off';
  resourceType: 'journal_entry' | 'account' | 'accounting_period' | 'cash_shift' | 'invoice';
  resourceId: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  hash: string;
  previousHash?: string;
  ipAddress?: string;
  auditNote: string;
}

export interface FinancialIdempotencyRecord {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  commandName: string;
  requestHash: string;
  status: 'processing' | 'completed' | 'failed';
  responsePayload?: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

export interface CashRegisterShift {
  id: string;
  tenantId: string;
  cashierId: string;
  cashierName: string;
  registerId: string;
  shiftStart: string;
  shiftEnd?: string;
  openingBalance: number;
  closingBalance?: number;
  cashCollected: number;
  cardCollected: number;
  systemExpectedCash: number;
  variance: number;
  status: 'open' | 'reconciled' | 'discrepancy' | 'closed';
  reconciledBy?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BankReconciliation {
  id: string;
  tenantId: string;
  bankAccountId: string;
  bankAccountName: string;
  statementDate: string;
  statementBalance: number;
  glBalance: number;
  unreconciledDeposits: number;
  unreconciledWithdrawals: number;
  adjustedBankBalance: number;
  adjustedGlBalance: number;
  variance: number;
  status: 'draft' | 'balanced' | 'approved';
  reconciledBy: string;
  reconciledAt: string;
  notes?: string;
}

export interface CostCenter {
  id: string;
  tenantId: string;
  code: string; // e.g. 'CC-ICU-101'
  name: string;
  department: string;
  managerName: string;
  annualBudget: number;
  ytdActual: number;
  ytdCommitted: number;
  isActive: boolean;
}

export interface FinancialAnomaly {
  id: string;
  tenantId: string;
  type: 'unbalanced_voucher' | 'duplicate_payment' | 'period_lock_violation' | 'unusual_variance' | 'revenue_leakage';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  detectedAt: string;
  status: 'open' | 'investigating' | 'resolved';
  impactAmount: number;
}

