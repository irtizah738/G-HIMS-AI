export interface GenerateScmIntelligenceSnapshotPayload {
  snapshotId: string;
  facilityId: string;
  asOf: string;
  lookbackDays: number;
  expiryHorizonDays: number;
  currency: string;
}

export type ScmOperationalAlertCode =
  | 'STOCKOUT_EXPOSURE'
  | 'EXPIRY_EXPOSURE'
  | 'DEAD_STOCK_EXPOSURE'
  | 'SUPPLIER_OTIF_BELOW_TARGET'
  | 'PURCHASE_VARIANCE'
  | 'OPEN_RECALL'
  | 'UNRESOLVED_COLD_CHAIN'
  | 'CONSIGNMENT_ACCRUAL_PENDING';

export interface ScmOperationalAlert {
  code: ScmOperationalAlertCode;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  value: number;
  unit: 'COUNT' | 'PERCENT' | 'MINOR_CURRENCY_UNITS';
  explanation: string;
}

export interface ScmOperationalSnapshot {
  snapshotId: string;
  tenantId: string;
  facilityId: string;
  asOf: string;
  lookbackDays: number;
  expiryHorizonDays: number;
  currency: string;
  generatedAt: string;
  generatedBy: string;
  inputFingerprint: string;
  metrics: {
    distinctStockedItems: number;
    stockoutItemCount: number;
    stockoutRatePercent: number;
    endingInventoryValuationMinorUnits: number;
    expiryExposureMinorUnits: number;
    deadStockExposureMinorUnits: number;
    usageCostMinorUnits: number;
    annualizedInventoryTurns: number;
    supplierOtifPercent: number;
    deliveredPoCount: number;
    purchaseVarianceMinorUnits: number;
    openRecallCount: number;
    unresolvedColdChainExcursionCount: number;
    consignmentAvailableMinorUnits: number;
    consignmentPendingInvoiceMinorUnits: number;
    controlledCustodyEventCount: number;
  };
  alerts: ScmOperationalAlert[];
}
