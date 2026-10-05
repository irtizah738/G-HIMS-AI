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
  invoiceCount: number;
  chargeCount: number;
  totalPatientDueMinorUnits: number;
  totalPaidMinorUnits: number;
  totalOutstandingMinorUnits: number;
  snapshotFingerprint: string;
  reconciledBy: string;
  reconciledAt: number;
  schemaVersion: 1;
}
