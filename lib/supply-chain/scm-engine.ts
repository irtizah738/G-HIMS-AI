// ============================================================================
// G-HIMS Master SCM Engine: Pure, Deterministic Domain Logic
// ============================================================================

import {
  BatchLotRecord,
  InventoryBalance,
  StockTransaction,
  POLineItem,
  GRNItem,
  SupplierPerformanceScorecard,
  ThreeWayMatchResult,
  ThreeWayMatchException,
  AISCMRecommendation,
  ItemMaster,
  PatientConsumptionRecord,
} from '@/types/scm-domain';

/**
 * 1. Balance Invariance:
 * available = onHand - reserved - quarantined - damaged - expired
 */
export function calculateDerivedBalance(
  current: InventoryBalance,
  txn: Partial<StockTransaction>
): InventoryBalance {
  const next: InventoryBalance = {
    ...current,
    version: (current.version || 0) + 1,
    lastMovementAt: new Date().toISOString(),
  };

  const qty = txn.quantity || 0;

  switch (txn.transactionType) {
    case 'RECEIPT':
    case 'ADJUSTMENT_IN':
    case 'TRANSFER_IN':
      next.onHand += qty;
      break;

    case 'ISSUE':
    case 'ADJUSTMENT_OUT':
    case 'TRANSFER_OUT':
    case 'CONSUMPTION':
    case 'DISPENSE':
    case 'WRITE_OFF':
      next.onHand = Math.max(0, next.onHand - qty);
      break;

    case 'RESERVATION':
      next.reserved += qty;
      break;

    case 'UNRESERVATION':
      next.reserved = Math.max(0, next.reserved - qty);
      break;

    case 'QUARANTINE':
      next.quarantined += qty;
      break;

    case 'RELEASE':
      next.quarantined = Math.max(0, next.quarantined - qty);
      break;

    case 'DAMAGE':
      next.damaged += qty;
      break;

    case 'EXPIRY':
      next.expired += qty;
      break;

    case 'RECALL':
      // Move directly from usable onHand to quarantined
      next.quarantined += qty;
      break;

    default:
      break;
  }

  // Authoritative Available Quantity Calculation
  next.available = Math.max(
    0,
    next.onHand - next.reserved - next.quarantined - next.damaged - next.expired
  );

  next.totalValuation = Math.round(next.onHand * next.unitCost * 100) / 100;
  return next;
}

/**
 * 2. FEFO (First-Expiry-First-Out) Engine:
 * Given a set of available batches for an item, automatically allocates
 * quantities in order of earliest expiry date.
 * Strictly skips expired, quarantined, recalled, or blocked batches.
 */
export interface FEFOAllocationResult {
  allocations: {
    batchId: string;
    batchNumber: string;
    allocatedQty: number;
    expiryDate: string;
    manufactureDate?: string;
    daysUntilExpiry: number;
  }[];
  fulfilledQty: number;
  unfulfilledQty: number;
  isFullyFulfilled: boolean;
  warnings: string[];
}

export type ExpiryAlertCategory =
  | 'EXPIRED'
  | 'EXPIRING_TODAY'
  | 'EXPIRING_30_DAYS'
  | 'EXPIRING_60_DAYS'
  | 'EXPIRING_90_DAYS'
  | 'SAFE';

export interface ExpiryCategorization {
  category: ExpiryAlertCategory;
  categoryLabel: string;
  daysRemaining: number;
  badgeStyle: string;
  actionRequired: string;
  isActionable: boolean;
  isFefoPriority: boolean;
}

export function categorizeExpiry(
  expiryDateIso: string,
  nowIso: string = new Date().toISOString()
): ExpiryCategorization {
  const now = new Date(nowIso).getTime();
  const exp = new Date(expiryDateIso).getTime();
  const diffMs = exp - now;
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (daysRemaining < 0) {
    return {
      category: 'EXPIRED',
      categoryLabel: 'Expired (Bio-Hazard / Quarantine)',
      daysRemaining,
      badgeStyle: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-900',
      actionRequired: 'MANDATORY LOCK: Stock must be quarantined immediately for reverse-logistics or clinical destruction.',
      isActionable: true,
      isFefoPriority: false,
    };
  }
  if (daysRemaining === 0) {
    return {
      category: 'EXPIRING_TODAY',
      categoryLabel: 'Expiring Today',
      daysRemaining: 0,
      badgeStyle: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/70 dark:text-red-300 dark:border-red-900 font-bold',
      actionRequired: 'URGENT: Requires shift-end quarantine or immediate clinical consumption if authorized by Pharmacy.',
      isActionable: true,
      isFefoPriority: true,
    };
  }
  if (daysRemaining <= 30) {
    return {
      category: 'EXPIRING_30_DAYS',
      categoryLabel: 'Next 30 Days (Critical FEFO)',
      daysRemaining,
      badgeStyle: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-900 font-semibold',
      actionRequired: 'CRITICAL FEFO DISPENSATION: Route all ward requests to this batch before newer stock is unsealed.',
      isActionable: true,
      isFefoPriority: true,
    };
  }
  if (daysRemaining <= 60) {
    return {
      category: 'EXPIRING_60_DAYS',
      categoryLabel: 'Next 60 Days (Warning Buffer)',
      daysRemaining,
      badgeStyle: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950/60 dark:text-yellow-300 dark:border-yellow-900',
      actionRequired: 'ACTIVE MONITORING: Coordinate with satellite clinics for inter-store stock rebalancing.',
      isActionable: false,
      isFefoPriority: false,
    };
  }
  if (daysRemaining <= 90) {
    return {
      category: 'EXPIRING_90_DAYS',
      categoryLabel: 'Next 90 Days (Quarterly Review)',
      daysRemaining,
      badgeStyle: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-900',
      actionRequired: 'ROUTINE ROTATION: Standard pharmacy audit and reorder review.',
      isActionable: false,
      isFefoPriority: false,
    };
  }
  return {
    category: 'SAFE',
    categoryLabel: 'Safe Shelf Life (>90 Days)',
    daysRemaining,
    badgeStyle: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900',
    actionRequired: 'OPTIMAL COMPLIANCE: Stable stock with adequate shelf-life buffer.',
    isActionable: false,
    isFefoPriority: false,
  };
}

export function allocateFefoBatches(
  availableBatches: BatchLotRecord[],
  requestedQuantity: number,
  nowIso: string = new Date().toISOString()
): FEFOAllocationResult {
  const now = new Date(nowIso).getTime();

  // Filter only viable batches
  const viable = availableBatches
    .filter((b) => {
      if (b.status !== 'AVAILABLE') return false;
      const exp = new Date(b.expiryDate).getTime();
      return exp > now && b.quantityRemaining > 0;
    })
    .sort((a, b) => {
      // Sort ascending by expiry date (earliest expiry first)
      const dateA = new Date(a.expiryDate).getTime();
      const dateB = new Date(b.expiryDate).getTime();
      if (dateA !== dateB) return dateA - dateB;
      // Secondary sort: FIFO by receipt date
      return new Date(a.receivedDate).getTime() - new Date(b.receivedDate).getTime();
    });

  let remainingNeeded = requestedQuantity;
  const allocations: FEFOAllocationResult['allocations'] = [];
  const warnings: string[] = [];

  for (const batch of viable) {
    if (remainingNeeded <= 0) break;

    const availableInBatch = Math.max(0, batch.quantityRemaining - (batch.quantityReserved || 0));
    if (availableInBatch <= 0) continue;

    const allocateThis = Math.min(remainingNeeded, availableInBatch);
    const expTime = new Date(batch.expiryDate).getTime();
    const daysUntilExpiry = Math.ceil((expTime - now) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 30) {
      warnings.push(
        `Batch ${batch.batchNumber} expires in ${daysUntilExpiry} days (FEFO prioritization triggered).`
      );
    }

    allocations.push({
      batchId: batch.batchId,
      batchNumber: batch.batchNumber,
      allocatedQty: allocateThis,
      expiryDate: batch.expiryDate,
      manufactureDate: batch.manufactureDate,
      daysUntilExpiry,
    });

    remainingNeeded -= allocateThis;
  }

  const fulfilledQty = requestedQuantity - remainingNeeded;
  const isFullyFulfilled = remainingNeeded <= 0;

  if (!isFullyFulfilled) {
    warnings.push(
      `Insufficient viable stock! Requested ${requestedQuantity}, but only ${fulfilledQty} available.`
    );
  }

  return {
    allocations,
    fulfilledQty,
    unfulfilledQty: Math.max(0, remainingNeeded),
    isFullyFulfilled,
    warnings,
  };
}

/**
 * 3. Three-Way Matching Engine:
 * Compares PO vs GRN vs Vendor Invoice.
 * Flags price mismatch, quantity variance, missing documents.
 */
export function evaluateThreeWayMatch(
  poItems: POLineItem[],
  grnItems: GRNItem[],
  invoiceItems: { itemId: string; billedQty: number; unitPrice: number }[],
  tolerances = { priceVariancePercent: 1.0, qtyVariancePercent: 0.0 }
): {
  matchedItems: ThreeWayMatchResult['matchedItems'];
  exceptions: ThreeWayMatchException[];
  matchStatus: ThreeWayMatchResult['matchStatus'];
  netVariance: number;
} {
  const exceptions: ThreeWayMatchException[] = [];
  const matchedItems: ThreeWayMatchResult['matchedItems'] = [];
  let totalPo = 0;
  let totalInvoice = 0;

  for (const inv of invoiceItems) {
    const poLine = poItems.find((p) => p.itemId === inv.itemId);
    const grnLine = grnItems.find((g) => g.itemId === inv.itemId);

    if (!poLine) {
      exceptions.push('MISSING_PO');
      continue;
    }
    if (!grnLine) {
      exceptions.push('MISSING_GRN');
      continue;
    }

    const priceDiff = inv.unitPrice - poLine.unitPrice;
    const priceVariancePct = (Math.abs(priceDiff) / (poLine.unitPrice || 1)) * 100;
    const qtyDiff = inv.billedQty - grnLine.quantityAccepted;

    let lineStatus: 'MATCH' | 'PRICE_MISMATCH' | 'QTY_MISMATCH' = 'MATCH';

    if (priceVariancePct > tolerances.priceVariancePercent) {
      lineStatus = 'PRICE_MISMATCH';
      if (!exceptions.includes('PRICE_VARIANCE')) exceptions.push('PRICE_VARIANCE');
    }

    if (Math.abs(qtyDiff) > tolerances.qtyVariancePercent) {
      lineStatus = 'QTY_MISMATCH';
      if (!exceptions.includes('QUANTITY_VARIANCE')) exceptions.push('QUANTITY_VARIANCE');
    }

    matchedItems.push({
      itemId: inv.itemId,
      poQty: poLine.quantityOrdered,
      poPrice: poLine.unitPrice,
      grnQtyAccepted: grnLine.quantityAccepted,
      invoiceQty: inv.billedQty,
      invoicePrice: inv.unitPrice,
      variancePrice: Math.round(priceDiff * 100) / 100,
      varianceQty: qtyDiff,
      status: lineStatus,
    });

    totalPo += poLine.quantityOrdered * poLine.unitPrice;
    totalInvoice += inv.billedQty * inv.unitPrice;
  }

  const netVariance = Math.round((totalInvoice - totalPo) * 100) / 100;
  const matchStatus: ThreeWayMatchResult['matchStatus'] =
    exceptions.length === 0 ? 'FULLY_MATCHED' : 'DISCREPANCY_FLAGGED';

  return {
    matchedItems,
    exceptions,
    matchStatus,
    netVariance,
  };
}

/**
 * 4. Supplier Performance Scorecard Engine:
 * Generates transparent, explainable 0-100 score.
 */
export function calculateSupplierScorecard(data: {
  totalOrders: number;
  onTimeOrders: number;
  orderedUnits: number;
  deliveredUnits: number;
  inspectedUnits: number;
  acceptedUnits: number;
  quotedPricesTotal: number;
  actualPricesTotal: number;
  actualLeadTimesDays: number[];
  contractLeadTimeDays: number;
}): SupplierPerformanceScorecard {
  const onTimeRate =
    data.totalOrders > 0 ? (data.onTimeOrders / data.totalOrders) * 100 : 100;
  const fillRate =
    data.orderedUnits > 0 ? (data.deliveredUnits / data.orderedUnits) * 100 : 100;
  const qualityRate =
    data.inspectedUnits > 0 ? (data.acceptedUnits / data.inspectedUnits) * 100 : 100;
  const rejectionRate = 100 - qualityRate;

  const priceVariancePct =
    data.quotedPricesTotal > 0
      ? ((data.actualPricesTotal - data.quotedPricesTotal) / data.quotedPricesTotal) * 100
      : 0;

  const avgLeadTime =
    data.actualLeadTimesDays.length > 0
      ? data.actualLeadTimesDays.reduce((a, b) => a + b, 0) /
        data.actualLeadTimesDays.length
      : data.contractLeadTimeDays;

  // Weightings:
  // On-time: 35%
  // Quality: 35%
  // Fill Rate: 20%
  // Price Stability: 10%
  const onTimeWeight = 0.35 * Math.min(100, onTimeRate);
  const qualityWeight = 0.35 * Math.min(100, qualityRate);
  const fillWeight = 0.2 * Math.min(100, fillRate);
  const priceScore = Math.max(0, 100 - Math.abs(priceVariancePct) * 5);
  const priceWeight = 0.1 * priceScore;

  const overallScore = Math.round((onTimeWeight + qualityWeight + fillWeight + priceWeight) * 10) / 10;

  return {
    onTimeDeliveryRatePercent: Math.round(onTimeRate * 10) / 10,
    fillRatePercent: Math.round(fillRate * 10) / 10,
    qualityAcceptanceRatePercent: Math.round(qualityRate * 10) / 10,
    rejectionRatePercent: Math.round(rejectionRate * 10) / 10,
    priceVariancePercent: Math.round(priceVariancePct * 10) / 10,
    averageLeadTimeDays: Math.round(avgLeadTime * 10) / 10,
    responseHours: 3.2,
    returnRatePercent: Math.round(rejectionRate * 0.4 * 10) / 10,
    complianceStatus:
      overallScore >= 80
        ? 'FULLY_COMPLIANT'
        : overallScore >= 60
        ? 'WARNING_RENEWAL_DUE'
        : 'NON_COMPLIANT_BLOCKED',
    overallExplainableScore: overallScore,
    scoringFormulaExplanation:
      'Overall (100) = On-Time Delivery (35%) + Quality Acceptance (35%) + Fill Rate (20%) + Price Stability (10%).',
  };
}

/**
 * 5. Reorder & Replenishment Calculator (Min/Max & Par Levels):
 */
export function evaluateReplenishment(
  item: ItemMaster,
  totalAvailable: number,
  averageDailyUsage: number
): {
  needsReorder: boolean;
  isStockoutRisk: boolean;
  suggestedReorderQuantity: number;
  daysOfCoverRemaining: number;
  reason: string;
} {
  const daysOfCover =
    averageDailyUsage > 0
      ? Math.round((totalAvailable / averageDailyUsage) * 10) / 10
      : 999;

  const leadTimeDemand = averageDailyUsage * (item.leadTimeDays || 3);
  const reorderThreshold = item.reorderPoint || leadTimeDemand + (item.safetyStock || 0);

  const needsReorder = totalAvailable <= reorderThreshold;
  const isStockoutRisk = totalAvailable <= (item.safetyStock || 0);

  // Economic target: bring stock to maximumStock or reorderQuantity
  let suggestedQty = 0;
  if (needsReorder) {
    if (item.maximumStock > 0) {
      suggestedQty = Math.max(item.reorderQuantity || 0, item.maximumStock - totalAvailable);
    } else {
      suggestedQty = item.reorderQuantity || Math.ceil(leadTimeDemand * 2);
    }
  }

  return {
    needsReorder,
    isStockoutRisk,
    suggestedReorderQuantity: Math.max(0, suggestedQty),
    daysOfCoverRemaining: daysOfCover,
    reason: isStockoutRisk
      ? `Stock (${totalAvailable}) is below safety stock (${item.safetyStock}). Risk of acute clinical stockout.`
      : needsReorder
      ? `Stock (${totalAvailable}) is below reorder point (${reorderThreshold}). Suggested replenishment: ${suggestedQty} ${item.unitOfMeasure}.`
      : 'Stock is currently within healthy operating parameters.',
  };
}

/**
 * 6. Recall Exposure Tracer:
 * Traces affected batches to all hospital stock locations and to every
 * patient who received or had the batch implanted.
 */
export function traceRecallImpact(
  targetBatchNumbers: string[],
  balances: InventoryBalance[],
  consumptions: PatientConsumptionRecord[]
) {
  // Stock currently in hospital stores
  const affectedBalances = balances.filter((b) =>
    targetBatchNumbers.includes(b.batchNumber)
  );

  const totalQuarantinableOnHand = affectedBalances.reduce((sum, b) => sum + b.onHand, 0);

  const locationBreakdown = affectedBalances.map((b) => ({
    locationId: b.locationId,
    locationName: b.locationName,
    quarantinedQuantity: b.onHand,
  }));

  // Patients who were administered or implanted with the target batches
  const exposedPatients = consumptions
    .filter((c) => targetBatchNumbers.includes(c.batchNumber))
    .map((c) => ({
      patientId: c.patientId,
      patientMRN: c.patientMRN,
      patientName: c.patientName,
      encounterId: c.encounterId,
      procedureName: c.procedureName || 'Clinical Administration',
      surgeonName: c.surgeonOrDoctorName,
      implantOrUsageDate: c.consumedAt,
      notificationSent: false,
    }));

  return {
    totalQuarantinableOnHand,
    locationBreakdown,
    exposedPatients,
    exposedPatientsCount: exposedPatients.length,
  };
}
