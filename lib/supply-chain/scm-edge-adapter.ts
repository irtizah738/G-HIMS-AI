'use client';

import type {
  BatchLotRecord,
  GoodsReceiptNote,
  InventoryBalance,
  InventoryLocation,
  ItemMaster,
  PatientConsumptionRecord,
  PurchaseOrderRecord,
  PurchaseRequisition,
  RecallCase,
  StockTransaction,
  StockTransferRecord,
  SupplierMaster,
  ThreeWayMatchResult,
} from '@/types/scm-domain';
import { hydrateEdgeSnapshot, loadLocalEdgeSnapshot, type EdgeSnapshot } from '@/lib/offline/hydration';
import { executeActiveTenantCommand } from '@/lib/api/command-client';

export interface ScmEdgeData {
  items: ItemMaster[];
  locations: InventoryLocation[];
  batches: BatchLotRecord[];
  balances: InventoryBalance[];
  transactions: StockTransaction[];
  requisitions: PurchaseRequisition[];
  purchaseOrders: PurchaseOrderRecord[];
  goodsReceiptNotes: GoodsReceiptNote[];
  stockTransfers: StockTransferRecord[];
  consumptions: PatientConsumptionRecord[];
  recalls: RecallCase[];
  suppliers: SupplierMaster[];
  threeWayMatches: ThreeWayMatchResult[];
  source: 'LOCAL' | 'SERVER';
}

function rows<T>(snapshot: EdgeSnapshot, collection: string): T[] {
  return (snapshot.collections?.[collection] || []) as unknown as T[];
}

function adapt(snapshot: EdgeSnapshot): ScmEdgeData {
  return {
    items: rows<ItemMaster>(snapshot, 'items'),
    locations: rows<InventoryLocation>(snapshot, 'inventoryLocations'),
    batches: rows<BatchLotRecord>(snapshot, 'batches'),
    balances: rows<InventoryBalance>(snapshot, 'inventoryBalances'),
    transactions: rows<StockTransaction>(snapshot, 'stockTransactions'),
    requisitions: rows<PurchaseRequisition>(snapshot, 'purchaseRequisitions'),
    purchaseOrders: rows<PurchaseOrderRecord>(snapshot, 'scmPurchaseOrders'),
    goodsReceiptNotes: rows<GoodsReceiptNote>(snapshot, 'goodsReceiptNotes'),
    stockTransfers: rows<StockTransferRecord>(snapshot, 'stockTransfers'),
    consumptions: rows<PatientConsumptionRecord>(snapshot, 'patientConsumptions'),
    recalls: rows<RecallCase>(snapshot, 'recallCases'),
    suppliers: rows<SupplierMaster>(snapshot, 'suppliers'),
    threeWayMatches: rows<ThreeWayMatchResult>(snapshot, 'threeWayMatches'),
    source: snapshot.source,
  };
}

export async function loadLocalScmEdgeData(tenantId: string): Promise<ScmEdgeData> {
  return adapt(await loadLocalEdgeSnapshot(tenantId));
}

export async function hydrateScmEdgeData(tenantId: string): Promise<ScmEdgeData> {
  return adapt(await hydrateEdgeSnapshot(tenantId));
}

export async function recordStockTransactionEdge(
  transaction: StockTransaction
): Promise<void> {
  const result = await executeActiveTenantCommand(
    'RecordStockTransactionCommand',
    transaction as unknown as Record<string, unknown>,
    {
      idempotencyKey: transaction.idempotencyKey,
      offlineQueue: {
        enabled: true,
        collection: 'stockTransactions',
        resourceId: transaction.transactionId,
        action: 'CREATE',
        optimisticCache: true,
      },
    }
  );
  if (!result.success) throw new Error(result.error?.message || 'Stock transaction failed.');
}

export async function recordPatientConsumptionEdge(
  consumption: PatientConsumptionRecord
): Promise<void> {
  const result = await executeActiveTenantCommand(
    'RecordPatientConsumptionCommand',
    consumption as unknown as Record<string, unknown>,
    {
      offlineQueue: {
        enabled: true,
        collection: 'patientConsumptions',
        resourceId: consumption.consumptionId,
        action: 'CREATE',
        optimisticCache: true,
      },
    }
  );
  if (!result.success) throw new Error(result.error?.message || 'Patient consumption failed.');
}

export async function submitPurchaseRequisitionEdge(
  requisition: PurchaseRequisition
): Promise<void> {
  const result = await executeActiveTenantCommand(
    'SubmitPurchaseRequisitionCommand',
    requisition as unknown as Record<string, unknown>,
    {
      offlineQueue: {
        enabled: true,
        collection: 'purchaseRequisitions',
        resourceId: requisition.requisitionId,
        action: 'CREATE',
        optimisticCache: true,
      },
    }
  );
  if (!result.success) throw new Error(result.error?.message || 'Purchase requisition failed.');
}


export async function approvePurchaseRequisitionEdge(input: {
  requisitionId: string;
  decision: 'APPROVED' | 'REJECTED';
  comments?: string;
  approvedLines?: Array<{ itemId: string; approvedQuantity: number }>;
}): Promise<PurchaseRequisition> {
  const result = await executeActiveTenantCommand<PurchaseRequisition>(
    'ApprovePurchaseRequisitionCommand',
    input,
    {
      idempotencyKey: `scm-pr-decision:${input.requisitionId}:${input.decision}`,
    }
  );
  if (!result.success) {
    throw new Error(
      result.error?.message || 'Purchase requisition approval failed.'
    );
  }
  if (!result.data) {
    throw new Error('Authoritative requisition response was missing.');
  }
  return result.data;
}

export async function createPurchaseOrderEdge(input: {
  poId: string;
  poNumber: string;
  requisitionId: string;
  supplierId: string;
  currency: string;
  paymentTerms: string;
  expectedDeliveryDate: string;
  destinationLocationId: string;
  destinationLocationName?: string;
  items: Array<{
    lineId: string;
    itemId: string;
    quantityOrdered: number;
    uom: string;
    unitPrice: number;
    discount?: number;
    taxPercent?: number;
  }>;
}): Promise<PurchaseOrderRecord> {
  const result = await executeActiveTenantCommand<PurchaseOrderRecord>(
    'CreatePurchaseOrderCommand',
    input,
    {
      idempotencyKey: `scm-pr-to-po:${input.requisitionId}`,
    }
  );
  if (!result.success) {
    throw new Error(result.error?.message || 'Purchase order creation failed.');
  }
  if (!result.data) {
    throw new Error('Authoritative purchase order response was missing.');
  }
  return result.data;
}

export async function approvePurchaseOrderEdge(input: {
  poId: string;
  decision: 'APPROVED' | 'REJECTED';
  comments?: string;
}): Promise<PurchaseOrderRecord> {
  const result = await executeActiveTenantCommand<PurchaseOrderRecord>(
    'ApprovePurchaseOrderCommand',
    input,
    {
      idempotencyKey: `scm-po-decision:${input.poId}:${input.decision}`,
    }
  );
  if (!result.success) {
    throw new Error(result.error?.message || 'Purchase order approval failed.');
  }
  if (!result.data) {
    throw new Error('Authoritative purchase order response was missing.');
  }
  return result.data;
}

export async function recordGoodsReceiptEdge(input: {
  grnId: string;
  grnNumber: string;
  purchaseOrderId: string;
  facilityId: string;
  deliveryNoteNumber: string;
  supplierInvoiceReference?: string;
  receivedAt: string;
  inspectionStatus: 'PASSED' | 'FAILED' | 'PARTIAL' | 'QUARANTINED';
  destinationLocationId: string;
  destinationLocationName?: string;
  notes?: string;
  items: Array<{
    itemId: string;
    batchId?: string;
    batchNumber?: string;
    lotNumber?: string;
    quantityReceived: number;
    quantityAccepted: number;
    quantityRejected: number;
    quantityDamaged: number;
    uom: string;
    expiryDate?: string;
    manufactureDate?: string;
    manufacturer?: string;
    recordedTemperatureCelsius?: number;
    temperatureExcursion?: boolean;
    inspectionPassed: boolean;
    inspectionNotes?: string;
    unitCost: number;
  }>;
}): Promise<{
  grn: GoodsReceiptNote;
  purchaseOrder: PurchaseOrderRecord;
  receiptTransactionIds: string[];
}> {
  const result = await executeActiveTenantCommand<{
    grn: GoodsReceiptNote;
    purchaseOrder: PurchaseOrderRecord;
    receiptTransactionIds: string[];
  }>(
    'RecordGoodsReceiptCommand',
    input,
    {
      idempotencyKey: `scm-grn:${input.purchaseOrderId}:${input.deliveryNoteNumber}`,
    }
  );
  if (!result.success) {
    throw new Error(result.error?.message || 'Goods receipt failed.');
  }
  if (!result.data?.grn || !result.data?.purchaseOrder) {
    throw new Error('Authoritative goods receipt response was missing.');
  }
  return result.data;
}
