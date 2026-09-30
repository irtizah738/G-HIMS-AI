import type { SupplierMaster } from '@/types/scm-domain';
import type {
  ContractPoValidationInput,
  GovernedSupplierQuotation,
  QuotationEvaluationScore,
  SupplierContract,
} from '@/types/scm-sourcing';

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function averageLeadTime(quotation: GovernedSupplierQuotation): number {
  if (!quotation.items.length) return Number.POSITIVE_INFINITY;
  return quotation.items.reduce((sum, line) => sum + line.leadTimeDays, 0) /
    quotation.items.length;
}

export function evaluateSupplierQuotations(params: {
  quotations: GovernedSupplierQuotation[];
  suppliers: SupplierMaster[];
}): QuotationEvaluationScore[] {
  if (!params.quotations.length) return [];
  const supplierById = new Map(
    params.suppliers.map((supplier) => [supplier.supplierId, supplier])
  );

  const positiveTotals = params.quotations
    .map((quotation) => quotation.totalMinorUnits)
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  const minTotal = Math.min(...positiveTotals);
  const leadTimes = params.quotations
    .map(averageLeadTime)
    .filter((value) => Number.isFinite(value) && value > 0);
  const minLead = Math.min(...leadTimes);

  return params.quotations
    .map((quotation) => {
      const supplier = supplierById.get(quotation.supplierId);
      if (!supplier) {
        throw new Error(
          `SUPPLIER_EVALUATION_MASTER_MISSING:${quotation.supplierId}`
        );
      }

      const scorecard = supplier.scorecard;
      const priceScore =
        quotation.totalMinorUnits > 0
          ? 40 * (minTotal / quotation.totalMinorUnits)
          : 0;
      const qualityScore =
        20 * (clamp(scorecard.qualityAcceptanceRatePercent) / 100);
      const avgLead = averageLeadTime(quotation);
      const deliveryScore =
        Number.isFinite(avgLead) && avgLead > 0
          ? 15 * (minLead / avgLead)
          : 0;
      const supplierRatingScore =
        10 * (clamp(scorecard.overallExplainableScore) / 100);
      const complianceScore =
        scorecard.complianceStatus === 'FULLY_COMPLIANT'
          ? 10
          : scorecard.complianceStatus === 'WARNING_RENEWAL_DUE'
            ? 5
            : 0;
      const paymentTermsScore = quotation.paymentTerms.trim() ? 5 : 0;
      const weightedTotal = roundScore(
        priceScore +
          qualityScore +
          deliveryScore +
          supplierRatingScore +
          complianceScore +
          paymentTermsScore
      );

      return {
        quotationId: quotation.quotationId,
        supplierId: quotation.supplierId,
        priceScore: roundScore(priceScore),
        qualityScore: roundScore(qualityScore),
        deliveryScore: roundScore(deliveryScore),
        supplierRatingScore: roundScore(supplierRatingScore),
        complianceScore: roundScore(complianceScore),
        paymentTermsScore: roundScore(paymentTermsScore),
        weightedTotal,
        explainability: [
          `Price component: ${roundScore(priceScore)}/40`,
          `Quality acceptance component: ${roundScore(qualityScore)}/20`,
          `Delivery component: ${roundScore(deliveryScore)}/15`,
          `Supplier scorecard component: ${roundScore(supplierRatingScore)}/10`,
          `Compliance component: ${roundScore(complianceScore)}/10`,
          `Payment terms component: ${roundScore(paymentTermsScore)}/5`,
        ],
      };
    })
    .sort(
      (a, b) =>
        b.weightedTotal - a.weightedTotal ||
        a.quotationId.localeCompare(b.quotationId)
    );
}

export function validatePurchaseOrderAgainstContract(params: {
  contract: SupplierContract;
  po: ContractPoValidationInput;
}): { valid: true } {
  const contract = params.contract;
  const po = params.po;
  const orderMs = Date.parse(po.orderDate);
  const effectiveMs = Date.parse(contract.effectiveAt);
  const expiresMs = Date.parse(contract.expiresAt);

  if (
    contract.status !== 'ACTIVE' ||
    !Number.isFinite(orderMs) ||
    orderMs < effectiveMs ||
    orderMs > expiresMs
  ) {
    throw new Error('SUPPLIER_CONTRACT_NOT_ACTIVE_FOR_ORDER_DATE');
  }
  if (contract.supplierId !== po.supplierId) {
    throw new Error('SUPPLIER_CONTRACT_SUPPLIER_MISMATCH');
  }
  if (contract.currency !== po.currency.toUpperCase()) {
    throw new Error('SUPPLIER_CONTRACT_CURRENCY_MISMATCH');
  }
  if (contract.paymentTerms.trim() !== po.paymentTerms.trim()) {
    throw new Error('SUPPLIER_CONTRACT_PAYMENT_TERMS_MISMATCH');
  }

  const lines = new Map(contract.lines.map((line) => [line.itemId, line]));
  let orderSpendMinorUnits = 0;
  for (const line of po.lines) {
    const contracted = lines.get(line.itemId);
    if (!contracted) {
      throw new Error(`SUPPLIER_CONTRACT_ITEM_NOT_COVERED:${line.itemId}`);
    }
    if (contracted.uom !== line.uom) {
      throw new Error(`SUPPLIER_CONTRACT_UOM_MISMATCH:${line.itemId}`);
    }
    if (line.unitPriceMinorUnits > contracted.maxUnitPriceMinorUnits) {
      throw new Error(`SUPPLIER_CONTRACT_PRICE_EXCEEDED:${line.itemId}`);
    }
    const reservedQuantity = Number(
      contract.reservedQuantityByItem?.[line.itemId] || 0
    );
    const committedQuantity = Number(
      contract.committedQuantityByItem?.[line.itemId] || 0
    );
    if (
      line.quantity <= 0 ||
      committedQuantity + reservedQuantity + line.quantity >
        contracted.contractedQuantity
    ) {
      throw new Error(`SUPPLIER_CONTRACT_QUANTITY_EXCEEDED:${line.itemId}`);
    }
    orderSpendMinorUnits += Math.round(
      line.quantity * line.unitPriceMinorUnits
    );
  }

  if (
    contract.maxSpendMinorUnits !== undefined &&
    contract.committedSpendMinorUnits +
      contract.reservedSpendMinorUnits +
      orderSpendMinorUnits >
      contract.maxSpendMinorUnits
  ) {
    throw new Error('SUPPLIER_CONTRACT_SPEND_CEILING_EXCEEDED');
  }

  return { valid: true };
}
