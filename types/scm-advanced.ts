export type POStatus = 'issued' | 'partially_received' | 'received' | 'closed';

export type SterilizationType = 'Steam' | 'Plasma' | 'ETO';

export type BISporeResult = 'passed' | 'failed' | 'pending';

export type ThreeWayMatchStatus = 'pending' | 'matched' | 'discrepancy';

export interface PurchaseOrderItem {
  itemId: string;
  description: string;
  orderedQty: number;
  unitPrice: number;
  total: number;
  sku?: string;
  category?: string;
  unitOfMeasure?: string;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  poNumber: string; // e.g. "PO-2026-0810"
  vendorId: string;
  vendorName?: string;
  items: PurchaseOrderItem[];
  totalAmount: number;
  status: POStatus;
  orderDate?: string;
  expectedDeliveryDate?: string;
  approvedBy?: string;
  departmentId?: string;
  paymentTerms?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GRNReceivedItem {
  itemId: string;
  description?: string;
  receivedQty: number;
  acceptedQty: number;
  rejectedQty: number;
  rejectionReason?: string;
  batchNumber?: string;
  expiryDate?: string;
}

export interface GoodsReceiptNote {
  id: string;
  tenantId: string;
  grnNumber: string; // e.g. "GRN-2026-0421"
  poId: string;
  poNumber?: string;
  vendorId?: string;
  receivedItems: GRNReceivedItem[];
  receivedDate: string; // YYYY-MM-DD
  receivedBy: string;
  deliveryNoteNumber?: string;
  carrier?: string;
  inspectionPassed?: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface VendorInvoiceItem {
  itemId: string;
  description?: string;
  billedQty: number;
  unitPrice: number;
  total: number;
}

export interface VendorInvoice {
  id: string;
  tenantId: string;
  invoiceNumber: string; // Vendor's invoice number
  poId: string;
  grnId: string;
  poNumber?: string;
  grnNumber?: string;
  vendorId?: string;
  vendorName?: string;
  billedItems: VendorInvoiceItem[];
  totalBilled: number;
  matchStatus: ThreeWayMatchStatus;
  invoiceDate?: string;
  dueDate?: string;
  apVoucherId?: string; // Linked GL voucher ID when approved for AP ledger post
  varianceAmount?: number;
  varianceReason?: string;
  approvedForPayment?: boolean;
  approvedBy?: string;
  approvedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CSSDCycle {
  id: string;
  tenantId: string;
  cycleNumber: string; // e.g. "AUT-2026-118"
  autoclaveMachineId: string;
  machineName?: string;
  sterilizationType: SterilizationType;
  temperatureCelsius: number;
  pressurePSI: number;
  exposureTimeMinutes: number;
  biSporeLotNumber: string;
  biSporeResult: BISporeResult;
  operatorId: string;
  operatorName?: string;
  trayBarcodes: string[];
  releasedForOR: boolean;
  startTime?: string;
  endTime?: string;
  validationErrors?: string[];
  releasedBy?: string;
  releasedAt?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ThreeWayMatchResult {
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
}

export interface CSSDValidationResult {
  canRelease: boolean;
  validationErrors: string[];
  physicalParametersMet: boolean;
  biSporeCompliant: boolean;
  standardsChecked: string[];
}
