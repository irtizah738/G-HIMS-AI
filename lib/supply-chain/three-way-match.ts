import {
  PurchaseOrder,
  GoodsReceiptNote,
  VendorInvoice,
  ThreeWayMatchResult,
} from '@/types/scm-advanced';

/**
 * SCM 3-Way Matching Engine
 * Reconciles Purchase Order commitment vs. Physical Goods Receipt Note (GRN) accepted counts
 * vs. Vendor Billed Invoice items to detect quantity inflation, price escalation, or phantom billing.
 */
export function reconcileThreeWayMatch(
  po: PurchaseOrder,
  grn: GoodsReceiptNote,
  invoice: VendorInvoice
): {
  isMatched: boolean;
  quantityDiscrepancies: Array<{
    itemId: string;
    description?: string;
    poQty: number;
    grnQty: number;
    invoiceQty: number;
  }>;
  priceDiscrepancies: Array<{
    itemId: string;
    description?: string;
    poPrice: number;
    invoicePrice: number;
  }>;
  totalVariance: number;
  summary: {
    totalPO: number;
    totalInvoice: number;
    variance: number;
    matchPercentage: number;
  };
  errorNotes: string[];
} {
  const quantityDiscrepancies: Array<{
    itemId: string;
    description?: string;
    poQty: number;
    grnQty: number;
    invoiceQty: number;
  }> = [];

  const priceDiscrepancies: Array<{
    itemId: string;
    description?: string;
    poPrice: number;
    invoicePrice: number;
  }> = [];

  const errorNotes: string[] = [];

  // Build lookup maps for PO items and GRN items
  const poItemMap = new Map<string, { description: string; orderedQty: number; unitPrice: number }>();
  for (const item of po.items || []) {
    poItemMap.set(item.itemId, {
      description: item.description,
      orderedQty: Number(item.orderedQty) || 0,
      unitPrice: Number(item.unitPrice) || 0,
    });
  }

  const grnItemMap = new Map<string, { acceptedQty: number; receivedQty: number; rejectedQty: number }>();
  for (const item of grn.receivedItems || []) {
    grnItemMap.set(item.itemId, {
      acceptedQty: Number(item.acceptedQty) || 0,
      receivedQty: Number(item.receivedQty) || 0,
      rejectedQty: Number(item.rejectedQty) || 0,
    });
  }

  // Check all items in Vendor Invoice
  const billedItems = invoice.billedItems || [];
  const processedItemIds = new Set<string>();

  for (const billed of billedItems) {
    const itemId = billed.itemId;
    processedItemIds.add(itemId);

    const poEntry = poItemMap.get(itemId);
    const grnEntry = grnItemMap.get(itemId);

    const poQty = poEntry ? poEntry.orderedQty : 0;
    const poPrice = poEntry ? poEntry.unitPrice : 0;
    const grnQty = grnEntry ? grnEntry.acceptedQty : 0;
    const invoiceQty = Number(billed.billedQty) || 0;
    const invoicePrice = Number(billed.unitPrice) || 0;

    const description = billed.description || poEntry?.description || itemId;

    // Check if item was not on PO
    if (!poEntry) {
      errorNotes.push(`Item '${description}' (${itemId}) is billed on invoice but was never ordered on PO ${po.poNumber}.`);
    }

    // Check if item was received in GRN
    if (!grnEntry || grnQty === 0) {
      errorNotes.push(`Item '${description}' (${itemId}) was billed for ${invoiceQty} units but 0 units accepted on GRN ${grn.grnNumber}.`);
    }

    // Quantity matching: Invoice billed qty must not exceed GRN accepted qty or PO ordered qty
    if (invoiceQty !== grnQty || invoiceQty > poQty) {
      quantityDiscrepancies.push({
        itemId,
        description,
        poQty,
        grnQty,
        invoiceQty,
      });

      if (invoiceQty > grnQty) {
        errorNotes.push(
          `Quantity mismatch for '${description}': Billed ${invoiceQty} units vs. ${grnQty} accepted on GRN (Overbilled by ${invoiceQty - grnQty} units).`
        );
      } else if (invoiceQty < grnQty) {
        errorNotes.push(
          `Partial billing for '${description}': Billed ${invoiceQty} units vs. ${grnQty} physically received on GRN.`
        );
      }
    }

    // Price matching: Invoice unit price must match PO agreed unit price
    const poPriceCents = Math.round(poPrice * 100);
    const invoicePriceCents = Math.round(invoicePrice * 100);

    if (poPriceCents !== invoicePriceCents) {
      priceDiscrepancies.push({
        itemId,
        description,
        poPrice,
        invoicePrice,
      });

      const diff = invoicePrice - poPrice;
      if (diff > 0) {
        errorNotes.push(
          `Price escalation for '${description}': Billed at $${invoicePrice.toFixed(2)}/unit vs. PO agreed price of $${poPrice.toFixed(2)}/unit (+$${diff.toFixed(2)} inflation).`
        );
      } else {
        errorNotes.push(
          `Vendor discount applied for '${description}': Billed at $${invoicePrice.toFixed(2)}/unit vs. PO price of $${poPrice.toFixed(2)}/unit.`
        );
      }
    }
  }

  // Check if any PO items that were received on GRN are missing from invoice
  for (const [poItemId, poData] of poItemMap.entries()) {
    if (!processedItemIds.has(poItemId)) {
      const grnData = grnItemMap.get(poItemId);
      if (grnData && grnData.acceptedQty > 0) {
        errorNotes.push(
          `PO Item '${poData.description}' (${poItemId}) was received (${grnData.acceptedQty} units) but not included in this invoice.`
        );
      }
    }
  }

  // Calculate totals and financial variance
  const totalPO = Number(po.totalAmount) || 0;
  const totalInvoice = Number(invoice.totalBilled) || 0;
  const varianceCents = Math.round((totalInvoice - totalPO) * 100);
  const totalVariance = varianceCents / 100;

  const isMatched = quantityDiscrepancies.length === 0 && priceDiscrepancies.length === 0 && totalVariance === 0;

  const matchPercentage =
    totalPO > 0
      ? Math.max(0, Math.min(100, Math.round(((totalPO - Math.abs(totalVariance)) / totalPO) * 100)))
      : isMatched
      ? 100
      : 0;

  return {
    isMatched,
    quantityDiscrepancies,
    priceDiscrepancies,
    totalVariance,
    summary: {
      totalPO,
      totalInvoice,
      variance: totalVariance,
      matchPercentage,
    },
    errorNotes,
  };
}
