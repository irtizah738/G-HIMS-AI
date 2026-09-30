export type FinanceAccountCategory =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'expense';

export type FinanceNormalBalance = 'debit' | 'credit';

export type FinancePeriodStatus =
  | 'OPEN'
  | 'SOFT_CLOSE'
  | 'CLOSING'
  | 'CLOSED'
  | 'LOCKED';

export interface FinanceAccountRecord {
  accountId: string;
  /** Legacy ERP account document ID, retained during finance migration. */
  id?: string;
  tenantId: string;
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
  isActive: boolean;
  isSystemLocked: boolean;
  createdAt: string;
  createdBy: string;
}

export interface FinancePeriodRecord {
  periodId: string;
  tenantId: string;
  fiscalYear: number;
  postingPeriod: number;
  periodKey: string;
  periodName: string;
  startAt: number;
  endAt: number;
  status: FinancePeriodStatus;
  closeChecklist?: Record<string, boolean>;
  startedClosingAt?: string;
  startedClosingBy?: string;
  closedAt?: string;
  closedBy?: string;
  lockedAt?: string;
  lockedBy?: string;
  createdAt: string;
  createdBy: string;
}

export interface GovernedJournalLine {
  glAccountId: string;
  glAccountName: string;
  costCenterId?: string;
  profitCenterId?: string;
  debitMinorUnits: number;
  creditMinorUnits: number;
  lineDescription: string;
}

export interface GovernedJournalRecord {
  journalId: string;
  tenantId: string;
  fiscalYear: number;
  postingPeriod: number;
  documentDate: number;
  postingDate: number;
  referenceDocumentId?: string;
  documentHeader: string;
  currency: string;
  totalAmountMinorUnits: number;
  lines: GovernedJournalLine[];
  sourceModule:
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
  status: 'POSTED' | 'REVERSED';
  postedBy: string;
  postedAt: number;
  reversedByJournalId?: string;
}

export interface TrialBalanceLine {
  accountCode: string;
  accountName: string;
  category: FinanceAccountCategory;
  normalBalance: FinanceNormalBalance;
  debitMinorUnits: number;
  creditMinorUnits: number;
  endingBalanceMinorUnits: number;
}

export interface FinanceTrialBalanceSnapshot {
  snapshotId: string;
  tenantId: string;
  fiscalYear: number;
  postingPeriod: number;
  currency: string;
  generatedAt: string;
  generatedBy: string;
  lines: TrialBalanceLine[];
  totalDebitMinorUnits: number;
  totalCreditMinorUnits: number;
  balanced: boolean;
  inputFingerprint: string;
}

export interface RecognizePatientInvoicePayload {
  invoiceId: string;
  patientId: string;
  encounterId?: string;
  payerId?: string;
  issueAt: number;
  dueAt: number;
  currency: string;
  patientResponsibilityMinorUnits: number;
  payerResponsibilityMinorUnits: number;
  lines: Array<{
    lineId: string;
    description: string;
    revenueAccountCode: string;
    amountMinorUnits: number;
    costCenterId?: string;
    profitCenterId?: string;
  }>;
}

export interface FinanceArOpenItem {
  openItemId: string;
  tenantId: string;
  invoiceId: string;
  debtorType: 'PATIENT' | 'PAYER';
  debtorId: string;
  patientId: string;
  encounterId?: string;
  issueAt: number;
  dueAt: number;
  currency: string;
  originalMinorUnits: number;
  allocatedMinorUnits: number;
  writtenOffMinorUnits: number;
  refundedMinorUnits: number;
  outstandingMinorUnits: number;
  status: 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED' | 'WRITTEN_OFF';
  createdAt: string;
  updatedAt: string;
}

export interface AdjustArPayload {
  adjustmentId: string;
  openItemId: string;
  type: 'CREDIT_NOTE' | 'WRITE_OFF' | 'REFUND';
  amountMinorUnits: number;
  reason: string;
  postingAt: number;
}

export interface FinanceArAdjustment {
  adjustmentId: string;
  tenantId: string;
  openItemId: string;
  type: 'CREDIT_NOTE' | 'WRITE_OFF' | 'REFUND';
  amountMinorUnits: number;
  reason: string;
  postingAt: number;
  journalId: string;
  postedBy: string;
  postedAt: string;
}

export interface TreasuryAccountRecord {
  treasuryAccountId: string;
  tenantId: string;
  accountCode: string;
  accountName: string;
  currency: string;
  kind: 'CASH_DRAWER' | 'BANK';
  bankName?: string;
  maskedAccountNumber?: string;
  facilityId?: string;
  isActive: boolean;
  allowReceipts: boolean;
  allowPayments: boolean;
  createdAt: string;
  createdBy: string;
}

export interface CashShiftRecord {
  shiftId: string;
  tenantId: string;
  facilityId: string;
  registerId: string;
  treasuryAccountId: string;
  cashierId: string;
  openedAt: number;
  openingFloatMinorUnits: number;
  expectedClosingMinorUnits: number;
  countedClosingMinorUnits?: number;
  varianceMinorUnits?: number;
  status: 'OPEN' | 'AWAITING_REVIEW' | 'CLOSED';
  openedBy: string;
  closedBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface TreasuryTransferPayload {
  transferId: string;
  fromTreasuryAccountId: string;
  toTreasuryAccountId: string;
  amountMinorUnits: number;
  currency: string;
  transferredAt: number;
  reference: string;
}

export interface BankReconciliationRecord {
  reconciliationId: string;
  tenantId: string;
  treasuryAccountId: string;
  statementDate: number;
  currency: string;
  statementEndingMinorUnits: number;
  glEndingMinorUnits: number;
  depositsInTransitMinorUnits: number;
  outstandingPaymentsMinorUnits: number;
  adjustedStatementMinorUnits: number;
  adjustedGlMinorUnits: number;
  varianceMinorUnits: number;
  status: 'DRAFT' | 'BALANCED' | 'APPROVED';
  preparedBy: string;
  preparedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface FinanceApAgingSnapshot {
  snapshotId: string;
  tenantId: string;
  asOf: number;
  currency: string;
  currentMinorUnits: number;
  days1to30MinorUnits: number;
  days31to60MinorUnits: number;
  days61to90MinorUnits: number;
  over90MinorUnits: number;
  totalOutstandingMinorUnits: number;
  invoiceCount: number;
  generatedAt: string;
  generatedBy: string;
}

export interface CostCenterRecord {
  costCenterId: string;
  tenantId: string;
  code: string;
  name: string;
  department: string;
  facilityId?: string;
  managerUserId?: string;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
}

export interface CostAllocationRule {
  ruleId: string;
  tenantId: string;
  sourceCostCenterId: string;
  expenseAccountCode: string;
  allocationBasis: 'PERCENT' | 'HEADCOUNT' | 'AREA' | 'ENCOUNTERS';
  targets: Array<{
    costCenterId: string;
    percentBasisPoints?: number;
  }>;
  effectiveFrom: number;
  effectiveTo?: number;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
}

export interface CostAllocationRunRecord {
  runId: string;
  tenantId: string;
  fiscalYear: number;
  postingPeriod: number;
  currency: string;
  ruleIds: string[];
  journalIds: string[];
  allocatedMinorUnits: number;
  status: 'POSTED';
  postedAt: string;
  postedBy: string;
}

export interface BudgetEnvelopeRecord {
  budgetId: string;
  tenantId: string;
  fiscalYear: number;
  costCenterId: string;
  accountCode: string;
  currency: string;
  approvedMinorUnits: number;
  committedMinorUnits: number;
  actualMinorUnits: number;
  availableMinorUnits: number;
  status: 'DRAFT' | 'APPROVED' | 'CLOSED';
  createdAt: string;
  createdBy: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface BudgetCommitmentPayload {
  commitmentId: string;
  budgetId: string;
  referenceType: 'PURCHASE_REQUISITION' | 'PURCHASE_ORDER' | 'CONTRACT' | 'MANUAL';
  referenceId: string;
  amountMinorUnits: number;
  committedAt: number;
}

export interface BudgetCommitmentRecord extends BudgetCommitmentPayload {
  tenantId: string;
  status: 'ACTIVE' | 'RELEASED' | 'CONSUMED';
  createdBy: string;
  createdAt: string;
  releasedAt?: string;
  consumedAt?: string;
}

export interface CapitalizeAssetPayload {
  assetId: string;
  assetTag: string;
  serialNumber?: string;
  assetName: string;
  assetCategory: 'MEDICAL_EQUIPMENT' | 'IT_HARDWARE' | 'FACILITY' | 'VEHICLE' | 'OTHER';
  facilityId: string;
  costCenterId: string;
  acquisitionAt: number;
  inServiceAt: number;
  acquisitionCostMinorUnits: number;
  salvageValueMinorUnits: number;
  usefulLifeMonths: number;
  assetAccountCode: string;
  accumulatedDepreciationAccountCode: string;
  depreciationExpenseAccountCode: string;
  currency: string;
  sourceReferenceId: string;
}

export interface FinanceFixedAssetRecord extends CapitalizeAssetPayload {
  tenantId: string;
  accumulatedDepreciationMinorUnits: number;
  bookValueMinorUnits: number;
  monthsDepreciated: number;
  status: 'ACTIVE' | 'FULLY_DEPRECIATED' | 'DISPOSED';
  capitalizationJournalId: string;
  createdAt: string;
  createdBy: string;
  disposedAt?: number;
  disposalJournalId?: string;
}

export interface DepreciationRunRecord {
  runId: string;
  tenantId: string;
  fiscalYear: number;
  postingPeriod: number;
  currency: string;
  assetIds: string[];
  totalDepreciationMinorUnits: number;
  journalIds: string[];
  postedBy: string;
  postedAt: string;
}

export interface FinanceCloseRecord {
  closeId: string;
  tenantId: string;
  fiscalYear: number;
  postingPeriod: number;
  periodId: string;
  currency: string;
  status: 'CLOSING' | 'CLOSED' | 'LOCKED';
  startedAt: string;
  startedBy: string;
  checklist: {
    trialBalanceBalanced: boolean;
    inventoryClosed: boolean;
    apReconciled: boolean;
    arReconciled: boolean;
    cashReconciled: boolean;
    depreciationPosted: boolean;
  };
  trialBalanceSnapshotId?: string;
  statementSnapshotId?: string;
  closedAt?: string;
  closedBy?: string;
  lockedAt?: string;
  lockedBy?: string;
}

export interface FinancialStatementSnapshot {
  snapshotId: string;
  tenantId: string;
  fiscalYear: number;
  postingPeriod: number;
  currency: string;
  generatedAt: string;
  generatedBy: string;
  balanceSheet: {
    assetsMinorUnits: number;
    liabilitiesMinorUnits: number;
    equityMinorUnits: number;
    balanced: boolean;
  };
  incomeStatement: {
    revenueMinorUnits: number;
    expenseMinorUnits: number;
    surplusMinorUnits: number;
  };
  cashFlow: {
    operatingMinorUnits: number;
    investingMinorUnits: number;
    financingMinorUnits: number;
    netChangeMinorUnits: number;
  };
  inputFingerprint: string;
}

export interface TaxCodeRecord {
  taxCodeId: string;
  tenantId: string;
  code: string;
  description: string;
  jurisdiction: string;
  taxType: 'OUTPUT' | 'INPUT' | 'WITHHOLDING';
  rateBasisPoints: number;
  recoverablePercentBasisPoints?: number;
  payableAccountCode: string;
  recoverableAccountCode?: string;
  expenseAccountCode?: string;
  effectiveFrom: number;
  effectiveTo?: number;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
}

export interface TaxLedgerItem {
  taxLedgerItemId: string;
  tenantId: string;
  taxCodeId: string;
  sourceType: string;
  sourceId: string;
  taxableMinorUnits: number;
  taxMinorUnits: number;
  recoverableMinorUnits: number;
  payableMinorUnits: number;
  currency: string;
  postingAt: number;
  journalId: string;
  createdAt: string;
}

export interface FinanceIntelligenceSnapshot {
  snapshotId: string;
  tenantId: string;
  asOf: number;
  currency: string;
  generatedAt: string;
  generatedBy: string;
  inputFingerprint: string;
  metrics: {
    cashMinorUnits: number;
    arOutstandingMinorUnits: number;
    apOutstandingMinorUnits: number;
    revenueMinorUnits: number;
    expenseMinorUnits: number;
    operatingSurplusMinorUnits: number;
    currentAssetsMinorUnits: number;
    currentLiabilitiesMinorUnits: number;
    workingCapitalMinorUnits: number;
    budgetAvailableMinorUnits: number;
    overdueArMinorUnits: number;
    overdueApMinorUnits: number;
    unreconciledBankMinorUnits: number;
  };
  anomalies: Array<{
    code:
      | 'TRIAL_BALANCE_IMBALANCE'
      | 'NEGATIVE_WORKING_CAPITAL'
      | 'OVERDUE_AR'
      | 'OVERDUE_AP'
      | 'BANK_RECONCILIATION_VARIANCE'
      | 'BUDGET_EXHAUSTED';
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    amountMinorUnits: number;
    explanation: string;
  }>;
}
