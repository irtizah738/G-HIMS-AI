import type { CriticalityClass, StandardUOM } from '@/types/scm-domain';

export type ReplenishmentMode =
  | 'AUTO'
  | 'INTERNAL_TRANSFER_ONLY'
  | 'PURCHASE_ONLY';

export interface UpsertReplenishmentPolicyPayload {
  policyId: string;
  facilityId: string;
  locationId: string;
  itemId: string;
  sourceLocationId?: string;
  preferredSupplierId?: string;
  minQuantity: number;
  maxQuantity: number;
  reorderPoint: number;
  safetyStockQuantity: number;
  safetyStockDays: number;
  leadTimeDays: number;
  mode: ReplenishmentMode;
  active: boolean;
}

export interface ReplenishmentPolicy
  extends UpsertReplenishmentPolicyPayload {
  tenantId: string;
  itemCode: string;
  itemName: string;
  uom: StandardUOM;
  criticality: CriticalityClass;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface GenerateReplenishmentPlanPayload {
  planId: string;
  facilityId: string;
  locationId: string;
  policyIds: string[];
  asOf: string;
  lookbackDays: number;
  currency: string;
}

export interface ReplenishmentPlanLine {
  policyId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  uom: StandardUOM;
  criticality: CriticalityClass;
  currentAvailable: number;
  averageDailyUsage: number;
  leadTimeDemand: number;
  safetyStock: number;
  effectiveReorderPoint: number;
  targetStock: number;
  recommendedQuantity: number;
  projectedStockoutDate?: string;
  sourceLocationId?: string;
  sourceAvailable: number;
  preferredSupplierId?: string;
  action: 'NONE' | 'INTERNAL_TRANSFER' | 'PURCHASE';
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  estimatedUnitCost: number;
  estimatedCostMinorUnits: number;
  explanation: string[];
}

export interface ReplenishmentPlan {
  planId: string;
  tenantId: string;
  facilityId: string;
  locationId: string;
  asOf: string;
  lookbackDays: number;
  currency: string;
  method: 'SIMPLE_MOVING_AVERAGE_LEAD_TIME';
  inputFingerprint: string;
  lines: ReplenishmentPlanLine[];
  totalEstimatedCostMinorUnits: number;
  status: 'DRAFT' | 'APPROVED' | 'REJECTED' | 'EXECUTED';
  generatedBy: string;
  generatedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewComments?: string;
  executedBy?: string;
  executedAt?: string;
  purchaseRequisitionId?: string;
  replenishmentOrderIds?: string[];
}

export interface ReviewReplenishmentPlanPayload {
  planId: string;
  decision: 'APPROVE' | 'REJECT';
  comments: string;
}

export interface ExecuteReplenishmentPlanPayload {
  planId: string;
  purchaseRequisitionId?: string;
  purchaseRequisitionNumber?: string;
  replenishmentOrderId?: string;
  replenishmentOrderNumber?: string;
  requiredByDate: string;
}

export interface InternalReplenishmentOrder {
  orderId: string;
  tenantId: string;
  orderNumber: string;
  planId: string;
  facilityId: string;
  sourceLocationId: string;
  destinationLocationId: string;
  lines: Array<{
    itemId: string;
    itemCode: string;
    itemName: string;
    uom: StandardUOM;
    requestedQuantity: number;
    fulfilledQuantity: number;
  }>;
  status: 'READY_TO_PICK' | 'PARTIALLY_FULFILLED' | 'COMPLETED' | 'CANCELLED';
  createdBy: string;
  createdAt: string;
  completedBy?: string;
  completedAt?: string;
}

export interface CompleteInternalReplenishmentOrderPayload {
  orderId: string;
  stockTransactionIds: string[];
}

export interface DemandPlanningInput {
  policy: ReplenishmentPolicy;
  currentAvailable: number;
  sourceAvailable: number;
  historicalUsage: Array<{
    quantity: number;
    occurredAt: string;
  }>;
  itemUnitCost: number;
  asOf: string;
  lookbackDays: number;
}
