import type { StandardUOM } from '@/types/scm-domain';

export type SupplierInvoiceStatus =
  | 'MATCH_EXCEPTION'
  | 'MATCHED'
  | 'PAYABLE_RECOGNIZED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'VOID';

export type SupplierInvoiceMatchStatus =
  | 'FULLY_MATCHED'
  | 'DISCREPANCY_FLAGGED'
  | 'RESOLVED_APPROVED'
  | 'REJECTED';

export type SupplierInvoiceMatchException =
  | 'PRICE_VARIANCE'
  | 'QUANTITY_VARIANCE'
  | 'DISCOUNT_VARIANCE'
  | 'TAX_VARIANCE'
  | 'SHIPPING_VARIANCE'
  | 'MISSING_GRN'
  | 'MISSING_PO_LINE'
  | 'SUPPLIER_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'OVER_INVOICED';

export interface SupplierInvoiceLine {
  lineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  billedQuantity: number;
  uom: StandardUOM;
  unitPriceMinorUnits: number;
  discountMinorUnits: number;
  taxMinorUnits: number;
  netAmountMinorUnits: number;
  totalAmountMinorUnits: number;
}

export interface SupplierInvoiceRecord {
  invoiceId: string;
  tenantId: string;
  facilityId: string;
  invoiceNumber: string;
  supplierId: string;
  supplierName: string;
  poId: string;
  poNumber: string;
  grnIds: string[];
  currency: string;
  issueDate: string;
  dueDate: string;
  lines: SupplierInvoiceLine[];
  subtotalMinorUnits: number;
  discountMinorUnits: number;
  taxMinorUnits: number;
  shippingMinorUnits: number;
  totalAmountMinorUnits: number;
  amountPaidMinorUnits: number;
  balanceMinorUnits: number;
  matchId: string;
  matchStatus: SupplierInvoiceMatchStatus;
  status: SupplierInvoiceStatus;
  capturedBy: string;
  capturedAt: string;
  recognizedBy?: string;
  recognizedAt?: string;
  journalEntryId?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInvoiceMatchLine {
  itemId: string;
  poQuantity: number;
  receivedQuantity: number;
  previouslyInvoicedQuantity: number;
  pendingInvoiceQuantity: number;
  invoiceQuantity: number;
  poUnitPriceMinorUnits: number;
  invoiceUnitPriceMinorUnits: number;
  expectedNetMinorUnits: number;
  invoiceNetMinorUnits: number;
  expectedTaxMinorUnits: number;
  invoiceTaxMinorUnits: number;
  priceVarianceBasisPoints: number;
  quantityVariance: number;
  status: 'MATCH' | 'PRICE_MISMATCH' | 'QTY_MISMATCH' | 'FINANCIAL_MISMATCH';
}

export interface SupplierInvoiceMatchRecord {
  matchId: string;
  tenantId: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierId: string;
  poId: string;
  poNumber: string;
  grnIds: string[];
  lines: SupplierInvoiceMatchLine[];
  exceptions: SupplierInvoiceMatchException[];
  matchStatus: SupplierInvoiceMatchStatus;
  expectedAccrualMinorUnits: number;
  invoiceNetMinorUnits: number;
  invoiceTaxMinorUnits: number;
  invoiceShippingMinorUnits: number;
  invoiceTotalMinorUnits: number;
  netVarianceMinorUnits: number;
  priceToleranceBasisPoints: number;
  quantityTolerance: number;
  createdAt: string;
  updatedAt: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
}

export type PaymentAuthorizationStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CONSUMED'
  | 'CANCELLED';

export interface SupplierPaymentAuthorization {
  authorizationId: string;
  tenantId: string;
  invoiceId: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  amountMinorUnits: number;
  reason: string;
  status: PaymentAuthorizationStatus;
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalComments?: string;
  consumedByPaymentId?: string;
  updatedAt: string;
}

export interface SupplierPaymentRecord {
  paymentId: string;
  tenantId: string;
  invoiceId: string;
  invoiceNumber: string;
  authorizationId: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  amountMinorUnits: number;
  paymentMethod: 'BANK_TRANSFER' | 'CHECK' | 'ACH' | 'CASH';
  sourceAccountId: string;
  sourceAccountName: string;
  paymentReference: string;
  settledAt: string;
  recordedBy: string;
  journalEntryId: string;
  createdAt: string;
}

export interface RecordSupplierInvoicePayload {
  facilityId: string;
  supplierId: string;
  invoiceNumber: string;
  poId: string;
  grnIds: string[];
  issueDate: string;
  dueDate: string;
  currency: string;
  shippingMinorUnits?: number;
  priceToleranceBasisPoints?: number;
  quantityTolerance?: number;
  lines: Array<{
    lineId: string;
    itemId: string;
    billedQuantity: number;
    uom: StandardUOM;
    unitPriceMinorUnits: number;
    discountMinorUnits?: number;
    taxMinorUnits?: number;
  }>;
}

export interface ResolveSupplierInvoiceMatchPayload {
  invoiceId: string;
  poId: string;
  decision: 'APPROVE' | 'REJECT';
  notes: string;
}

export interface RecognizeSupplierInvoicePayablePayload {
  invoiceId: string;
  poId: string;
  fiscalYear: number;
  postingPeriod: number;
  documentDate: number;
  postingDate: number;
}

export interface RequestSupplierPaymentAuthorizationPayload {
  authorizationId: string;
  invoiceId: string;
  amountMinorUnits: number;
  reason: string;
}

export interface ApproveSupplierPaymentAuthorizationPayload {
  authorizationId: string;
  decision: 'APPROVE' | 'REJECT';
  comments?: string;
}

export interface RecordSupplierPaymentPayload {
  authorizationId: string;
  invoiceId: string;
  paymentReference: string;
  paymentMethod: SupplierPaymentRecord['paymentMethod'];
  sourceAccountId: string;
  sourceAccountName: string;
  settledAt: string;
  fiscalYear: number;
  postingPeriod: number;
}
