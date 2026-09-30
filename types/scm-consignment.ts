export type ConsignmentAgreementStatus =
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'CLOSED';

export interface CreateConsignmentAgreementPayload {
  agreementId: string;
  agreementNumber: string;
  supplierId: string;
  facilityId: string;
  currency: string;
  effectiveAt: string;
  expiresAt: string;
  lines: Array<{
    itemId: string;
    uom: string;
    maxUnitCostMinorUnits: number;
    requiresSerial: boolean;
    requiresUdi: boolean;
  }>;
}

export interface ApproveConsignmentAgreementPayload {
  agreementId: string;
  decision: 'APPROVE' | 'REJECT';
  notes?: string;
}

export interface ConsignmentAgreement
  extends CreateConsignmentAgreementPayload {
  tenantId: string;
  status: ConsignmentAgreementStatus;
  createdBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  reviewNotes?: string;
}

export interface ReceiveConsignmentStockPayload {
  lotId: string;
  agreementId: string;
  supplierId: string;
  facilityId: string;
  locationId: string;
  itemId: string;
  quantity: number;
  uom: string;
  unitCostMinorUnits: number;
  currency: string;
  batchNumber?: string;
  serialNumbers?: string[];
  udis?: string[];
  receivedAt: string;
}

export interface ConsignmentLotRecord
  extends ReceiveConsignmentStockPayload {
  tenantId: string;
  quantityAvailable: number;
  quantityConsumed: number;
  status: 'AVAILABLE' | 'DEPLETED' | 'SUSPENDED';
  serialNumbersConsumed: string[];
  udisConsumed: string[];
  receivedBy: string;
  createdAt: string;
}

export interface RecordConsignmentUsagePayload {
  usageId: string;
  lotId: string;
  agreementId: string;
  facilityId: string;
  itemId: string;
  quantity: number;
  patientId?: string;
  encounterId?: string;
  procedureId?: string;
  serialNumbers?: string[];
  udis?: string[];
  usedAt: string;
}

export interface ConsignmentUsageRecord
  extends RecordConsignmentUsagePayload {
  tenantId: string;
  supplierId: string;
  currency: string;
  unitCostMinorUnits: number;
  totalCostMinorUnits: number;
  recordedBy: string;
  recordedAt: string;
  accrualJournalId: string;
  status: 'ACCRUED_AWAITING_SUPPLIER_INVOICE';
}
