export type DiagnosticOrderType = 'LAB' | 'RADIOLOGY' | 'PROCEDURE';

export type DiagnosticRevenueLockStatus =
  | 'PENDING_PAYMENT_CLEARANCE'
  | 'PAID_SETTLED'
  | 'UNLOCKED_STAT_OVERRIDE';

export type DiagnosticWorklistStatus =
  | 'BLOCKED_BY_REVENUE_GATE'
  | 'READY_FOR_EXECUTION'
  | 'SPECIMEN_COLLECTED'
  | 'IN_PROCESSING'
  | 'FINALIZED';

export interface DiagnosticBillingCatalogRecord {
  id: string;
  serviceCode: string;
  description: string;
  orderType: DiagnosticOrderType;
  category: 'laboratory' | 'radiology' | 'procedure';
  status: 'ACTIVE' | 'INACTIVE';
  currency: string;
  unitPriceMinorUnits: number;
  taxRateBasisPoints: number;
  revenueAccountCode: string;
  deferredRevenueAccountCode: string;
  specimenType?: string;
  requiresProcedureConsent?: boolean;
}

export interface OperationalDiagnosticOrder {
  orderId: string;
  tenantId: string;
  encounterId: string;
  patientId: string;
  orderType: DiagnosticOrderType;
  catalogCode: string;
  serviceCatalogId: string;
  orderName: string;
  priority: 'STAT' | 'URGENT' | 'ROUTINE';
  clinicalIndication: string;
  status: 'PLACED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
  revenueLockStatus: DiagnosticRevenueLockStatus;
  worklistStatus: DiagnosticWorklistStatus;
  costMinorUnits: number;
  currency: string;
  billingInvoiceId: string;
  chargeId: string;
  deferredRevenueJournalId: string;
  deferredRevenueAccountCode: string;
  revenueAccountCode: string;
  netRevenueMinorUnits: number;
  taxMinorUnits: number;
  recognitionJournalId?: string;
  revenueRecognizedAt?: number;
  paymentReceiptId?: string;
  paymentClearedAt?: number;
  statOverrideReason?: string;
  statOverrideBy?: string;
  statOverrideAt?: number;
  specimenType?: string;
  specimenBarcode?: string;
  specimenCollectedAt?: number;
  specimenCollectedBy?: string;
  processingStartedAt?: number;
  processingStartedBy?: string;
  orderedBy: string;
  createdAt: number;
  updatedAt?: number;
  latestDiagnosticReportId?: string;
  resultStatus?: string;
  resultUpdatedAt?: number;
  [key: string]: unknown;
}
