import {
  PARLocation,
  PARItem,
  PARAlert,
  PARStockStatus,
  StockTransferRequest,
  PurchaseOrder,
  PurchaseOrderLineItem,
} from '@/types/supply-chain';

export interface PAREvaluationResult {
  locationId: string;
  locationName: string;
  department: string;
  totalItems: number;
  criticalCount: number;
  warningCount: number;
  optimalCount: number;
  overstockedCount: number;
  totalInventoryValuation: number;
  estimatedDeficitCost: number;
  healthScorePercent: number; // 0 - 100%
  alerts: PARAlert[];
}

export interface PARGlobalStats {
  totalLocations: number;
  totalSKUsMonitored: number;
  totalStockValue: number;
  totalDeficitValue: number;
  criticalDeficitAlertsCount: number;
  warningAlertsCount: number;
  systemWideHealthScore: number;
}

/**
 * Determines stock state based on current inventory vs min/max thresholds.
 */
export function determineItemHealthStatus(
  current: number,
  min: number,
  max: number,
  reorderPoint?: number
): PARStockStatus {
  if (current <= min) {
    return 'critical';
  }
  const threshold = reorderPoint ?? min + Math.ceil((max - min) * 0.25);
  if (current <= threshold) {
    return 'warning';
  }
  if (current > max) {
    return 'overstocked';
  }
  return 'optimal';
}

/**
 * Calculates optimal reorder quantity to bring inventory back up to Max PAR level with safety buffers.
 */
export function calculateReorderQuantity(item: PARItem): number {
  if (item.currentQuantity >= item.maxQuantity) {
    return 0;
  }
  const deficit = item.maxQuantity - item.currentQuantity;
  return Math.max(0, deficit);
}

/**
 * Queries stock levels across all clinical PAR locations against min/max thresholds.
 */
export function evaluateParLevels(locations: PARLocation[]): {
  evaluations: PAREvaluationResult[];
  globalStats: PARGlobalStats;
  allAlerts: PARAlert[];
} {
  const evaluations: PAREvaluationResult[] = [];
  const allAlerts: PARAlert[] = [];

  let totalSKUsMonitored = 0;
  let totalStockValue = 0;
  let totalDeficitValue = 0;
  let criticalDeficitAlertsCount = 0;
  let warningAlertsCount = 0;

  for (const loc of locations) {
    let locCritical = 0;
    let locWarning = 0;
    let locOptimal = 0;
    let locOverstocked = 0;
    let locValuation = 0;
    let locDeficitValuation = 0;
    const locAlerts: PARAlert[] = [];

    for (const item of loc.items) {
      totalSKUsMonitored += 1;
      const itemValuation = (item.currentQuantity || 0) * (item.unitCost || 0);
      locValuation += itemValuation;
      totalStockValue += itemValuation;

      const status = determineItemHealthStatus(
        item.currentQuantity,
        item.minQuantity,
        item.maxQuantity,
        item.reorderPoint
      );

      if (status === 'critical') {
        locCritical += 1;
        criticalDeficitAlertsCount += 1;
      } else if (status === 'warning') {
        locWarning += 1;
        warningAlertsCount += 1;
      } else if (status === 'overstocked') {
        locOverstocked += 1;
      } else {
        locOptimal += 1;
      }

      // If item is in deficit (below reorder threshold or minQuantity)
      if (status === 'critical' || status === 'warning') {
        const reorderQty = calculateReorderQuantity(item);
        const deficitCost = reorderQty * (item.unitCost || 0);
        locDeficitValuation += deficitCost;
        totalDeficitValue += deficitCost;

        const alert: PARAlert = {
          locationId: loc.id,
          locationName: loc.name,
          department: loc.department,
          itemId: item.itemId,
          itemName: item.itemName,
          sku: item.sku,
          currentQuantity: item.currentQuantity,
          minQuantity: item.minQuantity,
          maxQuantity: item.maxQuantity,
          reorderPoint: item.reorderPoint || item.minQuantity,
          deficit: Math.max(0, item.minQuantity - item.currentQuantity),
          status,
          suggestedReorderQuantity: reorderQty,
          unitCost: item.unitCost || 0,
          estimatedReplenishmentCost: deficitCost,
          criticalItem: Boolean(item.criticalItem),
        };

        locAlerts.push(alert);
        allAlerts.push(alert);
      }
    }

    const totalLocItems = loc.items.length || 1;
    // Health score: 100% minus penalties for critical (10%) and warning (4%) items
    const healthScorePercent = Math.max(
      0,
      Math.min(
        100,
        Math.round(100 - (locCritical * 12 + locWarning * 5) / totalLocItems * 10)
      )
    );

    evaluations.push({
      locationId: loc.id,
      locationName: loc.name,
      department: loc.department,
      totalItems: loc.items.length,
      criticalCount: locCritical,
      warningCount: locWarning,
      optimalCount: locOptimal,
      overstockedCount: locOverstocked,
      totalInventoryValuation: Math.round(locValuation * 100) / 100,
      estimatedDeficitCost: Math.round(locDeficitValuation * 100) / 100,
      healthScorePercent,
      alerts: locAlerts,
    });
  }

  const systemWideHealthScore =
    evaluations.length > 0
      ? Math.round(
          evaluations.reduce((acc, e) => acc + e.healthScorePercent, 0) /
            evaluations.length
        )
      : 100;

  const globalStats: PARGlobalStats = {
    totalLocations: locations.length,
    totalSKUsMonitored,
    totalStockValue: Math.round(totalStockValue * 100) / 100,
    totalDeficitValue: Math.round(totalDeficitValue * 100) / 100,
    criticalDeficitAlertsCount,
    warningAlertsCount,
    systemWideHealthScore,
  };

  return {
    evaluations,
    globalStats,
    allAlerts,
  };
}

/**
 * Automated Replenishment Generator:
 * Auto-creates internal transfer requisitions (from Central Warehouse to Floor PAR)
 * for all locations that have items below their reorder threshold.
 */
export function generateAutomatedRequisitions(
  locations: PARLocation[],
  tenantId: string,
  centralLocationId: string = 'loc-central-warehouse',
  centralLocationName: string = 'Central Hospital Warehouse & Depository'
): StockTransferRequest[] {
  const requisitions: StockTransferRequest[] = [];
  const timestamp = new Date().toISOString();

  for (const loc of locations) {
    // Skip central warehouse replenishing itself
    if (loc.id === centralLocationId || loc.department.toLowerCase().includes('central-warehouse')) {
      continue;
    }

    const deficitItems = loc.items.filter((item) => {
      const status = determineItemHealthStatus(
        item.currentQuantity,
        item.minQuantity,
        item.maxQuantity,
        item.reorderPoint
      );
      return status === 'critical' || status === 'warning';
    });

    if (deficitItems.length === 0) {
      continue;
    }

    const requisitionNumber = `TR-${new Date().getFullYear()}-${Math.floor(
      10000 + Math.random() * 90000
    )}`;

    const transferRequest: StockTransferRequest = {
      id: `tr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      tenantId,
      requisitionNumber,
      sourceLocationId: centralLocationId,
      sourceLocationName: centralLocationName,
      destinationLocationId: loc.id,
      destinationLocationName: loc.name,
      destinationDepartment: loc.department,
      status: 'pending_approval',
      requestedBy: 'PAR Autonomous Replenishment Engine (G-HIMS SCM)',
      createdAt: timestamp,
      items: deficitItems.map((d) => ({
        itemId: d.itemId,
        itemName: d.itemName,
        sku: d.sku,
        quantity: calculateReorderQuantity(d),
        unitOfMeasure: d.unitOfMeasure,
        unitCost: d.unitCost,
      })),
      notes: `Automated PAR replenishment for ${loc.name} (${deficitItems.length} items evaluated below replenishment point).`,
    };

    requisitions.push(transferRequest);
  }

  return requisitions;
}

/**
 * Generates a draft Purchase Order for Central Store warehouse stock depletion or vendor backorders.
 */
export function generateDeficitPurchaseOrderDraft(
  tenantId: string,
  criticalAlerts: PARAlert[],
  vendorId: string = 'vnd-medline-01',
  vendorName: string = 'Medline Industries Global Healthcare'
): PurchaseOrder {
  const timestamp = new Date().toISOString();
  const poNumber = `PO-${new Date().getFullYear()}-${Math.floor(
    100000 + Math.random() * 900000
  )}`;

  const lineItems: PurchaseOrderLineItem[] = criticalAlerts.map((alert, idx) => {
    const qty = Math.max(alert.suggestedReorderQuantity, alert.deficit * 2 || 10);
    const unitPrice = alert.unitCost || 15.0;
    const lineTotal = Math.round(qty * unitPrice * 100) / 100;

    return {
      id: `line-${idx + 1}-${Date.now().toString().slice(-4)}`,
      itemId: alert.itemId,
      itemName: alert.itemName,
      sku: alert.sku,
      category: 'Medical Consumables',
      orderedQuantity: qty,
      receivedQuantity: 0,
      unitOfMeasure: 'Pack',
      unitPrice,
      taxRate: 0.05,
      discount: 0,
      lineTotal,
      inspectionStatus: 'pending',
      notes: `Deficit replenishment for department: ${alert.department}`,
    };
  });

  const subtotal = Math.round(lineItems.reduce((acc, l) => acc + l.lineTotal, 0) * 100) / 100;
  const taxTotal = Math.round(subtotal * 0.05 * 100) / 100;
  const totalCost = Math.round((subtotal + taxTotal) * 100) / 100;

  // Delivery due in 5 days
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 5);

  return {
    id: `po-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    tenantId,
    poNumber,
    vendorId,
    vendorName,
    vendorEmail: 'procurement-orders@medline-health.com',
    status: 'draft',
    departmentDestination: 'Central Hospital Warehouse & Depository',
    lineItems,
    subtotal,
    taxTotal,
    discountTotal: 0,
    totalCost,
    currency: 'USD',
    paymentTerms: 'Net30',
    approvalSignatures: [],
    shippingAddress: 'Metropolitan Memorial Hospital, Loading Dock B, Gate 4',
    deliveryDueDate: dueDate.toISOString().split('T')[0],
    requestedBy: 'PAR Autonomous Replenishment Engine',
    createdDate: timestamp,
    updatedAt: timestamp,
    notes: `Autonomous PO draft generated for ${criticalAlerts.length} high-priority clinical stock deficits.`,
  };
}

export interface AutomatedParNotification {
  id: string;
  locationId: string;
  locationName: string;
  department: string;
  itemId: string;
  itemName: string;
  currentQuantity: number;
  minQuantity: number;
  reorderPoint: number;
  shortfall: number;
  urgency: 'CRITICAL' | 'WARNING';
  message: string;
  timestamp: string;
}

export interface AutomatedParCheckResult {
  timestamp: string;
  totalLocationsChecked: number;
  totalItemsChecked: number;
  flaggedItems: PARAlert[];
  criticalItems: PARAlert[];
  warningItems: PARAlert[];
  belowMinCount: number;
  totalShortfallUnits: number;
  totalDeficitCost: number;
  notifications: AutomatedParNotification[];
}

/**
 * Automated check against all location-based PAR items:
 * Flags items falling below their 'minQuantity' reorder point,
 * computes deficits, and compiles visual notifications.
 */
export function runAutomatedParCheck(locations: PARLocation[]): AutomatedParCheckResult {
  const timestamp = new Date().toISOString();
  const flaggedItems: PARAlert[] = [];
  const criticalItems: PARAlert[] = [];
  const warningItems: PARAlert[] = [];
  let totalItemsChecked = 0;
  let totalShortfallUnits = 0;
  let totalDeficitCost = 0;

  for (const loc of locations) {
    for (const item of loc.items) {
      totalItemsChecked++;
      const currentQty = Number(item.currentQuantity) || 0;
      const minQty = Number(item.minQuantity) || 0;
      const reorderPt = Number(item.reorderPoint) || minQty;

      // Check if item falls strictly below minQuantity or reorder threshold
      const isBelowMin = currentQty < minQty;
      const isAtOrBelowReorder = currentQty <= reorderPt;

      if (isBelowMin || isAtOrBelowReorder) {
        const shortfall = Math.max(0, minQty - currentQty);
        const unitCost = Number(item.unitCost) || 0;
        const deficitCost = Math.round(shortfall * unitCost * 100) / 100;
        totalShortfallUnits += shortfall;
        totalDeficitCost += deficitCost;

        const isCritical = isBelowMin || (!!item.criticalItem && isAtOrBelowReorder);
        const alert: PARAlert = {
          locationId: loc.id,
          locationName: loc.name,
          department: loc.department,
          itemId: item.itemId,
          itemName: item.itemName,
          sku: item.sku,
          currentQuantity: currentQty,
          minQuantity: minQty,
          maxQuantity: Number(item.maxQuantity) || minQty * 2,
          reorderPoint: reorderPt,
          deficit: shortfall,
          status: isCritical ? 'critical' : 'warning',
          suggestedReorderQuantity: Math.max(shortfall * 2, calculateReorderQuantity(item)),
          unitCost,
          estimatedReplenishmentCost: deficitCost,
          criticalItem: !!item.criticalItem,
        };

        flaggedItems.push(alert);
        if (isCritical) {
          criticalItems.push(alert);
        } else {
          warningItems.push(alert);
        }
      }
    }
  }

  // Generate structured notification items
  const notifications: AutomatedParNotification[] = flaggedItems.map((alert) => ({
    id: `notif-${alert.locationId}-${alert.itemId}-${Date.now()}`,
    locationId: alert.locationId,
    locationName: alert.locationName,
    department: alert.department,
    itemId: alert.itemId,
    itemName: alert.itemName,
    currentQuantity: alert.currentQuantity,
    minQuantity: alert.minQuantity,
    reorderPoint: alert.reorderPoint,
    shortfall: alert.deficit,
    urgency: alert.status === 'critical' ? 'CRITICAL' : 'WARNING',
    message: `PAR Deficit Alert: ${alert.itemName} at ${alert.locationName} is ${alert.currentQuantity} units (Min threshold: ${alert.minQuantity}, Deficit: ${alert.deficit} units).`,
    timestamp,
  }));

  return {
    timestamp,
    totalLocationsChecked: locations.length,
    totalItemsChecked,
    flaggedItems,
    criticalItems,
    warningItems,
    belowMinCount: flaggedItems.length,
    totalShortfallUnits,
    totalDeficitCost: Math.round(totalDeficitCost * 100) / 100,
    notifications,
  };
}
