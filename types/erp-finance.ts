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
