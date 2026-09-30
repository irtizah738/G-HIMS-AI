import type { RecallScope, StandardUOM, ItemType } from '@/types/scm-domain';

export interface InitiateRecallPayload {
  recallId: string;
  recallCaseNumber: string;
  itemId: string;
  scope: RecallScope;
  targetBatchNumbers?: string[];
  targetLotNumbers?: string[];
  targetSerialNumbers?: string[];
  supplierId?: string;
  manufacturerName?: string;
  recallReason: string;
  severity: 'CRITICAL_CLASS_1' | 'URGENT_CLASS_2' | 'ADVISORY_CLASS_3';
  initiatedAt: string;
}

export interface GovernedRecallCase {
  recallId: string;
  tenantId: string;
  recallCaseNumber: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  scope: RecallScope;
  targetBatchNumbers: string[];
  targetLotNumbers: string[];
  targetSerialNumbers: string[];
  supplierId?: string;
  manufacturerName?: string;
  recallReason: string;
  severity: InitiateRecallPayload['severity'];
  status:
    | 'INITIATED'
    | 'QUARANTINE_IN_PROGRESS'
    | 'QUARANTINE_EXECUTED'
    | 'PATIENT_TRACE_IN_PROGRESS'
    | 'PATIENTS_IDENTIFIED'
    | 'RESOLVED_DISPOSED';
  initiatedBy: string;
  initiatedAt: string;
  quarantinedBatchIds: string[];
  quarantinedBalanceIds: string[];
  quarantinedQuantity: number;
  exposureCount: number;
  notifiedExposureCount: number;
  dispositionOrderIds: string[];
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  updatedAt: string;
}

export interface ExecuteRecallQuarantinePayload {
  recallId: string;
  batchIds: string[];
  balanceIds: string[];
  finalChunk: boolean;
}

export interface ProjectRecallExposuresPayload {
  recallId: string;
  consumptionIds: string[];
  finalChunk: boolean;
}

export interface RecallExposureRecord {
  exposureId: string;
  tenantId: string;
  recallId: string;
  consumptionId: string;
  patientId: string;
  patientMRN: string;
  encounterId: string;
  procedureId?: string;
  procedureName?: string;
  itemId: string;
  batchId: string;
  batchNumber: string;
  serialNumber?: string;
  lotNumber?: string;
  udi?: string;
  consumedAt: string;
  notificationStatus: 'PENDING' | 'NOTIFIED';
  notifiedBy?: string;
  notifiedAt?: string;
  notificationNote?: string;
}

export interface RecordRecallNotificationPayload {
  recallId: string;
  exposureId: string;
  note: string;
  notifiedAt: string;
}

export type InventoryDispositionType =
  | 'DESTROY'
  | 'RETURN_TO_SUPPLIER';

export type InventoryDispositionReason =
  | 'EXPIRY'
  | 'DAMAGE'
  | 'RECALL'
  | 'QUALITY_FAILURE';

export interface CreateInventoryDispositionPayload {
  orderId: string;
  orderNumber: string;
  facilityId: string;
  locationId: string;
  balanceId: string;
  batchId: string;
  quantity: number;
  dispositionType: InventoryDispositionType;
  reason: InventoryDispositionReason;
  recallId?: string;
  supplierId?: string;
  justification: string;
  requestedAt: string;
}

export interface ReviewInventoryDispositionPayload {
  orderId: string;
  decision: 'APPROVE' | 'REJECT';
  comments: string;
}

export interface ExecuteInventoryDispositionPayload {
  orderId: string;
  executedAt: string;
  witnessUserId: string;
  destructionCertificateNumber?: string;
  carrierReference?: string;
}

export interface InventoryDispositionOrder {
  orderId: string;
  tenantId: string;
  orderNumber: string;
  facilityId: string;
  locationId: string;
  balanceId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  batchId: string;
  batchNumber: string;
  quantity: number;
  uom: StandardUOM;
  unitCostMinorUnits: number;
  totalValueMinorUnits: number;
  currency: string;
  inventoryAccountCode: '1210' | '1220';
  dispositionType: InventoryDispositionType;
  reason: InventoryDispositionReason;
  recallId?: string;
  supplierId?: string;
  justification: string;
  status:
    | 'PENDING_APPROVAL'
    | 'APPROVED'
    | 'REJECTED'
    | 'EXECUTED';
  requestedBy: string;
  requestedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewComments?: string;
  executedBy?: string;
  executedAt?: string;
  witnessedBy?: string;
  destructionCertificateNumber?: string;
  carrierReference?: string;
  stockTransactionId?: string;
  journalEntryId?: string;
}

export interface ResolveRecallPayload {
  recallId: string;
  dispositionOrderIds: string[];
  resolutionNotes: string;
}
