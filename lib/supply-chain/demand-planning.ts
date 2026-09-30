import { createHash } from 'node:crypto';
import type {
  DemandPlanningInput,
  ReplenishmentPlanLine,
} from '@/types/scm-planning';

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundMoneyMinor(value: number): number {
  return Math.round(value);
}

export function buildDemandInputFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

export function calculateDemandPlanLine(
  input: DemandPlanningInput
): ReplenishmentPlanLine {
  const asOfMs = Date.parse(input.asOf);
  if (
    !Number.isFinite(asOfMs) ||
    !Number.isInteger(input.lookbackDays) ||
    input.lookbackDays < 7 ||
    input.lookbackDays > 365
  ) {
    throw new Error('INVALID_DEMAND_PLANNING_WINDOW');
  }

  const cutoff = asOfMs - input.lookbackDays * 24 * 60 * 60 * 1000;
  const usage = input.historicalUsage.filter((record) => {
    const occurred = Date.parse(record.occurredAt);
    return (
      Number.isFinite(occurred) &&
      occurred >= cutoff &&
      occurred <= asOfMs &&
      Number.isFinite(record.quantity) &&
      record.quantity > 0
    );
  });
  const totalUsage = usage.reduce((sum, record) => sum + record.quantity, 0);
  const averageDailyUsage = roundQuantity(totalUsage / input.lookbackDays);
  const leadTimeDemand = roundQuantity(
    averageDailyUsage * input.policy.leadTimeDays
  );
  const dynamicSafety = roundQuantity(
    averageDailyUsage * input.policy.safetyStockDays
  );
  const safetyStock = Math.max(
    input.policy.safetyStockQuantity,
    dynamicSafety
  );
  const effectiveReorderPoint = Math.max(
    input.policy.reorderPoint,
    roundQuantity(leadTimeDemand + safetyStock)
  );
  const targetStock = Math.max(
    input.policy.maxQuantity,
    roundQuantity(leadTimeDemand + safetyStock)
  );

  const shouldReplenish = input.currentAvailable <= effectiveReorderPoint;
  const recommendedQuantity = shouldReplenish
    ? roundQuantity(Math.max(0, targetStock - input.currentAvailable))
    : 0;

  let action: ReplenishmentPlanLine['action'] = 'NONE';
  if (recommendedQuantity > 0) {
    if (input.policy.mode === 'PURCHASE_ONLY') {
      action = 'PURCHASE';
    } else if (input.policy.mode === 'INTERNAL_TRANSFER_ONLY') {
      action = 'INTERNAL_TRANSFER';
    } else {
      action =
        input.policy.sourceLocationId &&
        input.sourceAvailable >= recommendedQuantity
          ? 'INTERNAL_TRANSFER'
          : 'PURCHASE';
    }
  }

  if (
    action === 'INTERNAL_TRANSFER' &&
    (!input.policy.sourceLocationId ||
      input.sourceAvailable < recommendedQuantity)
  ) {
    throw new Error('INTERNAL_REPLENISHMENT_SOURCE_INSUFFICIENT');
  }

  let projectedStockoutDate: string | undefined;
  if (averageDailyUsage > 0) {
    projectedStockoutDate = new Date(
      asOfMs +
        Math.max(0, input.currentAvailable / averageDailyUsage) *
          24 *
          60 *
          60 *
          1000
    ).toISOString();
  }

  const daysCover =
    averageDailyUsage > 0
      ? input.currentAvailable / averageDailyUsage
      : Number.POSITIVE_INFINITY;
  const urgency: ReplenishmentPlanLine['urgency'] =
    input.policy.criticality === 'VITAL' &&
    recommendedQuantity > 0 &&
    daysCover <= input.policy.leadTimeDays
      ? 'CRITICAL'
      : recommendedQuantity > 0 && daysCover <= input.policy.leadTimeDays
        ? 'HIGH'
        : recommendedQuantity > 0
          ? 'MEDIUM'
          : 'LOW';

  return {
    policyId: input.policy.policyId,
    itemId: input.policy.itemId,
    itemCode: input.policy.itemCode,
    itemName: input.policy.itemName,
    uom: input.policy.uom,
    criticality: input.policy.criticality,
    currentAvailable: roundQuantity(input.currentAvailable),
    averageDailyUsage,
    leadTimeDemand,
    safetyStock: roundQuantity(safetyStock),
    effectiveReorderPoint: roundQuantity(effectiveReorderPoint),
    targetStock: roundQuantity(targetStock),
    recommendedQuantity,
    projectedStockoutDate,
    sourceLocationId: input.policy.sourceLocationId,
    sourceAvailable: roundQuantity(input.sourceAvailable),
    preferredSupplierId: input.policy.preferredSupplierId,
    action,
    urgency,
    estimatedUnitCost: input.itemUnitCost,
    estimatedCostMinorUnits: roundMoneyMinor(
      recommendedQuantity * input.itemUnitCost * 100
    ),
    explanation: [
      `Observed ${roundQuantity(totalUsage)} units of governed usage over ${input.lookbackDays} days.`,
      `Average daily usage = ${averageDailyUsage}.`,
      `Lead-time demand = ${leadTimeDemand} for ${input.policy.leadTimeDays} lead-time days.`,
      `Safety stock = ${roundQuantity(safetyStock)}.`,
      `Effective reorder point = ${roundQuantity(effectiveReorderPoint)}; available = ${roundQuantity(input.currentAvailable)}.`,
      recommendedQuantity > 0
        ? `Recommend ${recommendedQuantity} units via ${action}.`
        : 'No replenishment is required at this snapshot.',
    ],
  };
}
