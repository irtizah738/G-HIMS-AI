import type { ItemType, StandardUOM } from '@/types/scm-domain';

export type InventoryValuationMethod = 'BATCH_ACTUAL_FEFO';

export interface SubmitCycleCountPayload {
  countId: string;
  facilityId: string;
  locationId: string;
  locationName?: string;
  countedAt: string;
  isBlindCount: boolean;
  lines: Array<{
    balanceId: string;
    countedQuantity: number;
  }>;
  notes?: string;
}

export interface ApproveCycleCountPayload {
  countId: string;
  balanceIds: string[];
  decision: 'APPROVE' | 'REJECT';
  reason: string;
}

export interface GovernedCycleCountLine {
  balanceId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  batchId: string;
  batchNumber: string;
  uom: StandardUOM;
  expectedQuantity: number;
  countedQuantity: number;
  varianceQuantity: number;
  unitCostMinorUnits: number;
  varianceValueMinorUnits: number;
  inventoryAccountCode: '1210' | '1220';
  currency: string;
  status: 'MATCH' | 'VARIANCE_FLAGGED' | 'ADJUSTED' | 'REJECTED';
}

export interface GovernedCycleCountRecord {
  countId: string;
  tenantId: string;
  facilityId: string;
  locationId: string;
  locationName: string;
  valuationMethod: InventoryValuationMethod;
  currency: string;
  isBlindCount: boolean;
  countedAt: string;
  submittedAt: string;
  submittedBy: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  reviewReason?: string;
  lines: GovernedCycleCountLine[];
  totalAbsoluteVarianceMinorUnits: number;
  status: 'SUBMITTED_FOR_REVIEW' | 'COMPLETED' | 'REJECTED';
  notes?: string;
}

export interface InventoryAdjustmentPosting {
  adjustmentId: string;
  tenantId: string;
  countId: string;
  facilityId: string;
  locationId: string;
  balanceId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  batchId: string;
  batchNumber: string;
  uom: StandardUOM;
  systemQuantityBefore: number;
  countedQuantity: number;
  varianceQuantity: number;
  unitCostMinorUnits: number;
  varianceValueMinorUnits: number;
  inventoryAccountCode: '1210' | '1220';
  varianceAccountCode: '6040';
  currency: string;
  reasonCode: 'COUNT_VARIANCE';
  approvedBy: string;
  approvedAt: string;
  stockTransactionId: string;
  journalEntryId?: string;
}

export interface StartInventoryPeriodClosePayload {
  closeId: string;
  facilityId: string;
  fiscalYear: number;
  postingPeriod: number;
  periodStart: string;
  periodEnd: string;
  currency: string;
}

export interface FinalizeInventoryPeriodClosePayload {
  closeId: string;
  facilityId: string;
  fiscalYear: number;
  postingPeriod: number;
  periodStart: string;
  periodEnd: string;
  currency: string;
}

export interface InventoryPeriodCloseRecord {
  closeId: string;
  tenantId: string;
  facilityId: string;
  fiscalYear: number;
  postingPeriod: number;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  valuationMethod: InventoryValuationMethod;
  status: 'CLOSING' | 'CLOSED';
  startedAt: string;
  startedBy: string;
  finalizedAt?: string;
  finalizedBy?: string;
  stockMovementMinorUnitsByAccount?: Record<string, number>;
  journalMovementMinorUnitsByAccount?: Record<string, number>;
  endingValuationMinorUnitsByAccount?: Record<string, number>;
  reconciliationDeltaMinorUnitsByAccount?: Record<string, number>;
  stockTransactionCount?: number;
  journalEntryCount?: number;
}

export interface InventoryValuationTransaction {
  transactionType: string;
  itemId: string;
  quantity: number;
  unitCost: number;
  occurredAt: string;
}

export interface InventoryValuationResult {
  movementMinorUnitsByAccount: Record<'1210' | '1220', number>;
  endingValuationMinorUnitsByAccount: Record<'1210' | '1220', number>;
  transactionCount: number;
}
