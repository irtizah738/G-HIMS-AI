export type OpdBillingReconciliationStatus = 'CLEARED';

export interface OpdBillingReconciliation {
  reconciliationId: string;
  tenantId: string;
  encounterId: string;
  patientId: string;
  status: OpdBillingReconciliationStatus;
  currency: string;
  invoiceIds: string[];
  chargeIds: string[];
  arOpenItemIds: string[];
  journalIds: string[];
  diagnosticOrderIds: string[];
  prescriptionIds: string[];
  revenueIntegrityFindingIds: string[];
  invoiceCount: number;
  chargeCount: number;
  totalPatientDueMinorUnits: number;
  totalPaidMinorUnits: number;
  totalOutstandingMinorUnits: number;
  billingMutationSequence: number;
  snapshotFingerprint: string;
  reconciledBy: string;
  reconciledAt: number;
  schemaVersion: 1;
}
