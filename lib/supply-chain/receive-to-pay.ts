import type {
  GoodsReceiptNote,
  POLineItem,
  PurchaseOrderRecord,
} from '@/types/scm-domain';
import type {
  SupplierInvoiceLine,
  SupplierInvoiceMatchException,
  SupplierInvoiceMatchLine,
} from '@/types/scm-payables';

export interface SupplierInvoiceInputLine {
  lineId: string;
  itemId: string;
  billedQuantity: number;
  uom: string;
  unitPriceMinorUnits: number;
  discountMinorUnits?: number;
  taxMinorUnits?: number;
}

export interface SupplierInvoiceMatchEvaluation {
  lines: SupplierInvoiceLine[];
  matchLines: SupplierInvoiceMatchLine[];
  exceptions: SupplierInvoiceMatchException[];
  expectedAccrualMinorUnits: number;
  invoiceNetMinorUnits: number;
  invoiceTaxMinorUnits: number;
  invoiceTotalMinorUnits: number;
  netVarianceMinorUnits: number;
  fullyMatched: boolean;
}

export const moneyToMinorUnits = (value: number): number =>
  Math.round(Number(value || 0) * 100);

export const quantityTimesMinorUnits = (
  quantity: number,
  unitPriceMinorUnits: number
): number => Math.round(quantity * unitPriceMinorUnits);

function allocatedPoDiscountMinorUnits(
  poLine: POLineItem,
  quantity: number
): number {
  const ordered = Number(poLine.quantityOrdered || 0);
  const discountMinor = moneyToMinorUnits(Number(poLine.discount || 0));
  if (ordered <= 0 || discountMinor <= 0) return 0;
  return Math.round((quantity / ordered) * discountMinor);
}

function expectedTaxMinorUnits(
  netMinorUnits: number,
  poLine: POLineItem
): number {
  const rate = Number(poLine.taxPercent ?? poLine.taxRate ?? 0);
  return Math.round(netMinorUnits * (rate / 100));
}

export function evaluateSupplierInvoiceMatch(params: {
  po: PurchaseOrderRecord;
  grns: GoodsReceiptNote[];
  invoiceLines: SupplierInvoiceInputLine[];
  shippingMinorUnits: number;
  priceToleranceBasisPoints: number;
  quantityTolerance: number;
}): SupplierInvoiceMatchEvaluation {
  const {
    po,
    grns,
    invoiceLines,
    shippingMinorUnits,
    priceToleranceBasisPoints,
    quantityTolerance,
  } = params;

  const exceptions: SupplierInvoiceMatchException[] = [];
  const canonicalLines: SupplierInvoiceLine[] = [];
  const matchLines: SupplierInvoiceMatchLine[] = [];

  let expectedAccrualMinorUnits = 0;
  let invoiceNetMinorUnits = 0;
  let invoiceTaxMinorUnits = 0;

  const grnAcceptedByItem = new Map<string, number>();
  for (const grn of grns) {
    for (const line of grn.items) {
      grnAcceptedByItem.set(
        line.itemId,
        (grnAcceptedByItem.get(line.itemId) || 0) +
          Number(line.quantityAccepted || 0)
      );
    }
  }

  for (const input of invoiceLines) {
    const poLine = po.items.find((line) => line.itemId === input.itemId);
    if (!poLine) {
      if (!exceptions.includes('MISSING_PO_LINE')) {
        exceptions.push('MISSING_PO_LINE');
      }
      continue;
    }

    const receivedQuantity = grnAcceptedByItem.get(input.itemId) || 0;
    if (receivedQuantity <= 0 && !exceptions.includes('MISSING_GRN')) {
      exceptions.push('MISSING_GRN');
    }

    const previouslyInvoicedQuantity = Number(poLine.quantityInvoiced || 0);
    const pendingInvoiceQuantity = Number(poLine.quantityPendingInvoice || 0);
    const remainingInvoiceCapacity = Math.max(
      0,
      Number(poLine.quantityReceived || receivedQuantity) -
        previouslyInvoicedQuantity -
        pendingInvoiceQuantity
    );

    if (
      input.billedQuantity >
      remainingInvoiceCapacity + Math.max(0, quantityTolerance)
    ) {
      if (!exceptions.includes('OVER_INVOICED')) {
        exceptions.push('OVER_INVOICED');
      }
    }

    const poUnitPriceMinorUnits = moneyToMinorUnits(poLine.unitPrice);
    const expectedGrossMinorUnits = quantityTimesMinorUnits(
      input.billedQuantity,
      poUnitPriceMinorUnits
    );
    const expectedDiscountMinorUnits = allocatedPoDiscountMinorUnits(
      poLine,
      input.billedQuantity
    );
    const expectedNetMinorUnits = Math.max(
      0,
      expectedGrossMinorUnits - expectedDiscountMinorUnits
    );
    const expectedTax = expectedTaxMinorUnits(expectedNetMinorUnits, poLine);

    const invoiceGrossMinorUnits = quantityTimesMinorUnits(
      input.billedQuantity,
      input.unitPriceMinorUnits
    );
    const discountMinorUnits = Math.max(
      0,
      Math.round(input.discountMinorUnits || 0)
    );
    const taxMinorUnits = Math.max(0, Math.round(input.taxMinorUnits || 0));
    const netAmountMinorUnits = Math.max(
      0,
      invoiceGrossMinorUnits - discountMinorUnits
    );
    const totalAmountMinorUnits = netAmountMinorUnits + taxMinorUnits;

    const priceVarianceBasisPoints =
      poUnitPriceMinorUnits <= 0
        ? input.unitPriceMinorUnits === 0
          ? 0
          : Number.POSITIVE_INFINITY
        : Math.round(
            (Math.abs(input.unitPriceMinorUnits - poUnitPriceMinorUnits) /
              poUnitPriceMinorUnits) *
              10_000
          );
    const quantityVariance = input.billedQuantity - receivedQuantity;

    const discountVariance = Math.abs(
      discountMinorUnits - expectedDiscountMinorUnits
    );
    const taxVariance = Math.abs(taxMinorUnits - expectedTax);

    let status: SupplierInvoiceMatchLine['status'] = 'MATCH';

    if (priceVarianceBasisPoints > priceToleranceBasisPoints) {
      status = 'PRICE_MISMATCH';
      if (!exceptions.includes('PRICE_VARIANCE')) {
        exceptions.push('PRICE_VARIANCE');
      }
    }

    if (Math.abs(quantityVariance) > Math.max(0, quantityTolerance)) {
      status = 'QTY_MISMATCH';
      if (!exceptions.includes('QUANTITY_VARIANCE')) {
        exceptions.push('QUANTITY_VARIANCE');
      }
    }

    const financialToleranceMinorUnits = Math.max(
      1,
      Math.round(
        expectedNetMinorUnits * (Math.max(0, priceToleranceBasisPoints) / 10_000)
      )
    );
    if (discountVariance > financialToleranceMinorUnits) {
      status = 'FINANCIAL_MISMATCH';
      if (!exceptions.includes('DISCOUNT_VARIANCE')) {
        exceptions.push('DISCOUNT_VARIANCE');
      }
    }
    if (taxVariance > financialToleranceMinorUnits) {
      status = 'FINANCIAL_MISMATCH';
      if (!exceptions.includes('TAX_VARIANCE')) {
        exceptions.push('TAX_VARIANCE');
      }
    }

    canonicalLines.push({
      lineId: input.lineId,
      itemId: poLine.itemId,
      itemCode: poLine.itemCode,
      itemName: poLine.itemName || poLine.description || poLine.itemCode,
      billedQuantity: input.billedQuantity,
      uom: poLine.uom,
      unitPriceMinorUnits: input.unitPriceMinorUnits,
      discountMinorUnits,
      taxMinorUnits,
      netAmountMinorUnits,
      totalAmountMinorUnits,
    });

    matchLines.push({
      itemId: poLine.itemId,
      poQuantity: Number(poLine.quantityOrdered || 0),
      receivedQuantity,
      previouslyInvoicedQuantity,
      pendingInvoiceQuantity,
      invoiceQuantity: input.billedQuantity,
      poUnitPriceMinorUnits,
      invoiceUnitPriceMinorUnits: input.unitPriceMinorUnits,
      expectedNetMinorUnits,
      invoiceNetMinorUnits: netAmountMinorUnits,
      expectedTaxMinorUnits: expectedTax,
      invoiceTaxMinorUnits: taxMinorUnits,
      priceVarianceBasisPoints,
      quantityVariance,
      status,
    });

    expectedAccrualMinorUnits += expectedNetMinorUnits;
    invoiceNetMinorUnits += netAmountMinorUnits;
    invoiceTaxMinorUnits += taxMinorUnits;
  }

  const expectedShippingMinorUnits = moneyToMinorUnits(
    Number(po.shippingCharges ?? po.shippingCost ?? 0)
  );
  const shippingVariance = Math.abs(
    Math.max(0, Math.round(shippingMinorUnits)) - expectedShippingMinorUnits
  );
  if (shippingVariance > 1) {
    exceptions.push('SHIPPING_VARIANCE');
  }

  const invoiceTotalMinorUnits =
    invoiceNetMinorUnits +
    invoiceTaxMinorUnits +
    Math.max(0, Math.round(shippingMinorUnits));

  return {
    lines: canonicalLines,
    matchLines,
    exceptions: Array.from(new Set(exceptions)),
    expectedAccrualMinorUnits,
    invoiceNetMinorUnits,
    invoiceTaxMinorUnits,
    invoiceTotalMinorUnits,
    netVarianceMinorUnits: invoiceNetMinorUnits - expectedAccrualMinorUnits,
    fullyMatched: exceptions.length === 0,
  };
}
