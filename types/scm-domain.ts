// ============================================================================
// G-HIMS Master Architecture: Supply Chain Management, Procurement & Inventory
// Authoritative Domain Type Definitions
// ============================================================================

export type ItemType =
  | 'MEDICATION'
  | 'MEDICAL_CONSUMABLE'
  | 'SURGICAL_CONSUMABLE'
  | 'IMPLANT'
  | 'PROSTHESIS'
  | 'LAB_REAGENT'
  | 'RADIOLOGY_CONSUMABLE'
  | 'PPE'
  | 'GENERAL_SUPPLY'
  | 'CLEANING_SUPPLY'
  | 'BLOOD_BANK_SUPPLY'
  | 'CSSD_SUPPLY'
  | 'BIOMEDICAL_PART'
  | 'EQUIPMENT'
  | 'OFFICE_SUPPLY'
  | 'FOOD_SERVICE_SUPPLY'
  | 'MAINTENANCE_SUPPLY';

export type StandardUOM =
  | 'BOX'
  | 'PACK'
  | 'CARTON'
  | 'STRIP'
  | 'TABLET'
  | 'CAPSULE'
  | 'VIAL'
  | 'AMPOULE'
  | 'BOTTLE'
  | 'TUBE'
  | 'PIECE'
  | 'PAIR'
  | 'SET'
  | 'KIT'
  | 'ML'
  | 'LITER'
  | 'GRAM'
  | 'KG'
  | 'METER'
  | 'ROLL';

export type CriticalityClass = 'VITAL' | 'ESSENTIAL' | 'DESIRABLE'; // VED
export type ValueClass = 'A' | 'B' | 'C'; // ABC Analysis

export type HazardClass = 'NONE' | 'BIOHAZARD' | 'FLAMMABLE' | 'CYTOTOXIC' | 'RADIOACTIVE' | 'CORROSIVE';

export interface UOMConversionRule {
  fromUOM: string;
  toUOM: string;
  factor: number; // e.g., 1 CARTON = 10 BOXES (factor: 10)
}

export interface ItemMaster {
  itemId: string;
  tenantId: string;
  organizationId: string;
  itemCode: string; // e.g., "MED-AMX-500"
  internalSKU: string;
  barcode: string; // EAN/UPC or internal
  gtin?: string; // GS1 GTIN-14
  name: string;
  genericName: string;
  brandName?: string;
  description: string;
  categoryId: string;
  subCategoryId?: string;
  itemType: ItemType;
  unitOfMeasure: StandardUOM;
  purchaseUOM: StandardUOM;
  stockUOM: StandardUOM;
  issueUOM: StandardUOM;
  conversionRules: UOMConversionRule[];
  manufacturerId?: string;
  manufacturerName?: string;
  preferredVendorIds: string[];
  controlledItem: boolean; // Narcotics, scheduled drugs, radioactive
  requiresBatchTracking: boolean;
  requiresExpiryTracking: boolean;
  requiresSerialTracking: boolean;
  requiresTemperatureTracking: boolean;
  requiresColdChain?: boolean;
  requiresQualityInspection: boolean;
  requiresPatientTraceability: boolean; // Implants, blood products, high-risk biologicals
  requiresPrescription: boolean;
  minimumStock: number;
  maximumStock: number;
  reorderPoint: number;
  reorderQuantity: number;
  safetyStock: number;
  leadTimeDays: number;
  criticality: CriticalityClass;
  abcClass: ValueClass;
  vedClass: CriticalityClass;
  storageRequirements: string;
  temperatureRange?: {
    minCelsius: number;
    maxCelsius: number;
  };
  hazardClass: HazardClass;
  unitCost: number;
  sellingPrice?: number;
  currency: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ----------------------------------------------------------------------------
// Location & Hierarchy
// ----------------------------------------------------------------------------

export type LocationType =
  | 'CENTRAL_STORE'
  | 'MAIN_PHARMACY'
  | 'SATELLITE_PHARMACY'
  | 'EMERGENCY_PHARMACY'
  | 'OT_STORE'
  | 'ICU_STORE'
  | 'WARD_STORE'
  | 'LAB_STORE'
  | 'RADIOLOGY_STORE'
  | 'BLOOD_BANK_STORE'
  | 'CSSD_STORE'
  | 'BIOMEDICAL_STORE'
  | 'GENERAL_STORE'
  | 'QUARANTINE_STORE'
  | 'DAMAGED_STORE'
  | 'RETURNS_STORE';

export interface InventoryLocation {
  locationId: string;
  tenantId: string;
  facilityId: string;
  parentLocationId?: string;
  locationType: LocationType;
  name: string;
  code: string; // e.g., "LOC-CS-01"
  campus?: string;
  building?: string;
  floor?: string;
  departmentId?: string;
  departmentName?: string;
  temperatureControlled: boolean;
  targetTempMin?: number;
  targetTempMax?: number;
  restricted: boolean;
  authorizedRoles?: string[];
  active: boolean;
  racksCount?: number;
  shelvesCount?: number;
}

// ----------------------------------------------------------------------------
// Batch, Lot & Cold-Chain
// ----------------------------------------------------------------------------

export type BatchStatus =
  | 'AVAILABLE'
  | 'QUARANTINED'
  | 'RECALLED'
  | 'EXPIRED'
  | 'DAMAGED'
  | 'BLOCKED'
  | 'DEPLETED';

export interface BatchLotRecord {
  batchId: string;
  tenantId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  batchNumber: string;
  lotNumber?: string;
  manufacturer: string;
  manufactureDate: string; // ISO string
  expiryDate: string; // ISO string
  receivedDate: string;
  supplierId: string;
  supplierName?: string;
  purchaseOrderId?: string;
  grnId?: string;
  unitCost: number;
  currency: string;
  quantityReceived: number;
  quantityRemaining: number;
  quantityReserved: number;
  storageCondition: string;
  status: BatchStatus;
  temperatureExcursionDetected?: boolean;
  excursionDetails?: {
    recordedTemp: number;
    durationHours: number;
    flaggedAt: string;
  };
  quarantineReason?: string;
  recallReason?: string;
  createdAt: string;
  updatedAt: string;
}

// ----------------------------------------------------------------------------
// Immutable Stock Transaction Ledger
// ----------------------------------------------------------------------------

export type StockTransactionType =
  | 'RECEIPT'
  | 'ISSUE'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'RETURN'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'DAMAGE'
  | 'EXPIRY'
  | 'QUARANTINE'
  | 'RELEASE'
  | 'RESERVATION'
  | 'UNRESERVATION'
  | 'CONSUMPTION'
  | 'DISPENSE'
  | 'RECALL'
  | 'WRITE_OFF';

export type ReferenceType =
  | 'PURCHASE_ORDER'
  | 'GOODS_RECEIPT_NOTE'
  | 'INTERNAL_REQUEST'
  | 'STOCK_TRANSFER'
  | 'PRESCRIPTION'
  | 'PATIENT_ENCOUNTER'
  | 'SURGICAL_PROCEDURE'
  | 'CYCLE_COUNT'
  | 'DISPOSAL_ORDER'
  | 'RECALL_CASE'
  | 'MANUAL_OVERRIDE';

export interface StockTransaction {
  transactionId: string;
  tenantId: string;
  facilityId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  batchId?: string;
  batchNumber?: string;
  manufactureDate?: string;
  expirationDate?: string;
  serialId?: string;
  fromLocationId?: string;
  fromLocationName?: string;
  toLocationId?: string;
  toLocationName?: string;
  quantity: number; // positive delta
  uom: StandardUOM;
  normalizedQuantity: number;
  unitCost: number;
  totalCost: number;
  currency: string;
  transactionType: StockTransactionType;
  referenceType: ReferenceType;
  referenceId: string;
  reasonCode?: string;
  patientId?: string;
  encounterId?: string;
  procedureId?: string;
  performedBy: {
    userId: string;
    userName: string;
    role: string;
  };
  authorizedBy?: {
    userId: string;
    userName: string;
    role: string;
  };
  witnessedBy?: {
    userId: string;
    userName: string;
  };
  occurredAt: string;
  recordedAt: string;
  deviceId?: string;
  clientTransactionId?: string;
  idempotencyKey: string;
  source: 'ONLINE' | 'OFFLINE_SYNC' | 'SYSTEM';
  metadata?: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Derived Stock Balance
// ----------------------------------------------------------------------------

export interface InventoryBalance {
  balanceId: string; // {tenantId}_{facilityId}_{locationId}_{itemId}_{batchId}
  tenantId: string;
  facilityId: string;
  locationId: string;
  locationName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  onHand: number;
  reserved: number;
  quarantined: number;
  damaged: number;
  expired: number;
  inTransit: number;
  available: number; // onHand - reserved - quarantined - damaged - expired
  uom: StandardUOM;
  minimumStock: number;
  maximumStock: number;
  reorderPoint: number;
  unitCost: number;
  totalValuation: number;
  lastMovementAt: string;
  lastCountAt?: string;
  version: number;
}

// ----------------------------------------------------------------------------
// Procurement Lifecycle: Requisitions, RFQs, POs, GRN, 3-Way Match
// ----------------------------------------------------------------------------

export type RequisitionPriority = 'EMERGENCY' | 'URGENT' | 'NORMAL' | 'PLANNED';

export type RequisitionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PARTIALLY_APPROVED'
  | 'REJECTED'
  | 'CONVERTED_TO_PO'
  | 'CANCELLED';

export interface RequisitionItem {
  itemId: string;
  itemCode: string;
  itemName: string;
  requestedQuantity: number;
  approvedQuantity?: number;
  uom: StandardUOM;
  currentStock: number;
  reorderPoint: number;
  suggestedQuantity: number;
  estimatedUnitCost: number;
  estimatedTotal: number;
  justification?: string;
}

export interface PurchaseRequisition {
  requisitionId: string;
  tenantId: string;
  facilityId: string;
  requisitionNumber: string; // e.g. "PR-2026-0045"
  requestingDepartment: string;
  requestingLocationId: string;
  requestedBy: {
    userId: string;
    userName: string;
    role: string;
  };
  priority: RequisitionPriority;
  items: RequisitionItem[];
  justification: string;
  requiredByDate: string;
  estimatedTotalCost: number;
  currency: string;
  budgetCode?: string;
  clinicalCriticality: CriticalityClass;
  status: RequisitionStatus;
  approvalHistory: {
    level: string;
    approverName: string;
    decision: 'APPROVED' | 'REJECTED' | 'MODIFIED';
    comments?: string;
    timestamp: string;
  }[];
  convertedPOId?: string;
  createdAt: string;
  updatedAt: string;
}

export type POExecutionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT'
  | 'SENT_TO_SUPPLIER'
  | 'ACKNOWLEDGED'
  | 'PARTIALLY_RECEIVED'
  | 'FULLY_RECEIVED'
  | 'CLOSED'
  | 'CANCELLED';

export interface POLineItem {
  lineId: string;
  itemId: string;
  itemCode: string;
  description?: string;
  itemName?: string;
  quantityOrdered: number;
  quantityReceived?: number;
  quantityRemaining?: number;
  uom: StandardUOM;
  unitPrice: number;
  unitCost?: number;
  discount?: number;
  taxRate?: number;
  taxPercent?: number;
  lineTotal: number;
  deliveryStatus?: string;
}

export interface PurchaseOrderRecord {
  poId: string;
  tenantId: string;
  facilityId: string;
  poNumber: string; // e.g., "PO-2026-0812"
  requisitionId?: string;
  requisitionNumber?: string;
  supplierId: string;
  supplierName: string;
  items: POLineItem[];
  currency: string;
  subtotal?: number;
  discountTotal?: number;
  taxTotal?: number;
  taxAmount?: number;
  shippingCost?: number;
  shippingCharges?: number;
  totalAmount: number;
  paymentTerms: string;
  deliveryTerms?: string;
  expectedDeliveryDate: string;
  orderDate?: string;
  status: POExecutionStatus;
  isEmergency?: boolean;
  emergencyJustification?: string;
  createdBy?: {
    userId: string;
    userName: string;
    role?: string;
  };
  approvedBy?: {
    userId: string;
    userName: string;
    approvalTier?: string;
    approvedAt?: string;
  };
  approvalSignatures?: {
    role: string;
    signedBy: string;
    signerEmail?: string;
    signedAt: string;
    signatureHash: string;
    approved: boolean;
    tier?: string;
    comments?: string;
  }[];
  approverId?: string;
  approvedAt?: string;
  deliveryStatus?: string;
  invoiceMatchStatus?: string;
  version?: number;
  shippingAddress?: {
    facilityName: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };
  billingAddress?: {
    facilityName: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };
  destinationLocationId?: string;
  destinationLocationName?: string;
  grnIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export type InspectionStatus = 'PASSED' | 'FAILED' | 'PARTIAL' | 'QUARANTINED';

export interface GRNItem {
  itemId: string;
  itemCode: string;
  itemName: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityAccepted: number;
  quantityRejected: number;
  quantityDamaged: number;
  rejectionReason?: string;
  uom: StandardUOM;
  batchNumber: string;
  lotNumber?: string;
  expiryDate: string;
  manufactureDate: string;
  manufacturer: string;
  serialNumbers?: string[];
  recordedTemperatureCelsius?: number;
  temperatureExcursion: boolean;
  inspectionPassed: boolean;
  inspectionNotes?: string;
  putawayLocationId?: string;
  unitCost: number;
}

export interface GoodsReceiptNote {
  grnId: string;
  tenantId: string;
  facilityId: string;
  grnNumber: string; // e.g., "GRN-2026-0198"
  purchaseOrderId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  receivedBy: {
    userId: string;
    userName: string;
  };
  receivedAt: string;
  deliveryNoteNumber: string;
  carrier?: string;
  supplierInvoiceReference?: string;
  items: GRNItem[];
  inspectionStatus: InspectionStatus;
  inspectorName?: string;
  inspectedAt?: string;
  status: 'DRAFT' | 'PENDING_INSPECTION' | 'INSPECTED' | 'PUTAWAY_COMPLETED' | 'CLOSED';
  attachments?: string[];
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ----------------------------------------------------------------------------
// RFQ & Quotation Comparison
// ----------------------------------------------------------------------------

export interface RFQItem {
  itemId: string;
  itemCode: string;
  itemName: string;
  quantity: number;
  uom: StandardUOM;
  specifications: string;
}

export interface RFQRecord {
  rfqId: string;
  tenantId: string;
  rfqNumber: string; // "RFQ-2026-003"
  items: RFQItem[];
  requiredDeliveryDate: string;
  submissionDeadline: string;
  invitedSupplierIds: string[];
  terms: string;
  status: 'OPEN' | 'SUBMISSIONS_RECEIVED' | 'EVALUATED' | 'AWARDED' | 'CANCELLED';
  createdAt: string;
}

export interface SupplierQuotation {
  quotationId: string;
  rfqId: string;
  supplierId: string;
  supplierName: string;
  quotationNumber: string;
  items: {
    itemId: string;
    unitPrice: number;
    totalPrice: number;
    leadTimeDays: number;
    expiryMonthsAtDelivery: number;
    manufacturer: string;
    brand: string;
  }[];
  subtotal: number;
  tax: number;
  shipping: number;
  totalCost: number;
  paymentTerms: string;
  warrantyPeriodMonths?: number;
  evaluationScore?: {
    priceScore: number; // 40%
    qualityScore: number; // 20%
    deliveryScore: number; // 15%
    supplierRatingScore: number; // 10%
    complianceScore: number; // 10%
    paymentTermsScore: number; // 5%
    weightedTotal: number; // 0-100
  };
  status: 'SUBMITTED' | 'UNDER_EVALUATION' | 'ACCEPTED' | 'REJECTED';
}

// ----------------------------------------------------------------------------
// Three-Way Matching
// ----------------------------------------------------------------------------

export type ThreeWayMatchException =
  | 'PRICE_VARIANCE'
  | 'QUANTITY_VARIANCE'
  | 'MISSING_GRN'
  | 'MISSING_PO'
  | 'DUPLICATE_INVOICE'
  | 'EXPIRED_BATCH_RECEIVED';

export interface ThreeWayMatchResult {
  matchId: string;
  tenantId: string;
  invoiceId: string;
  invoiceNumber: string;
  poId: string;
  poNumber: string;
  grnId: string;
  grnNumber: string;
  supplierId: string;
  supplierName: string;
  matchedItems: {
    itemId: string;
    poQty: number;
    poPrice: number;
    grnQtyAccepted: number;
    invoiceQty: number;
    invoicePrice: number;
    variancePrice: number;
    varianceQty: number;
    status: 'MATCH' | 'PRICE_MISMATCH' | 'QTY_MISMATCH';
  }[];
  totalPoAmount: number;
  totalGrnAmount: number;
  totalInvoiceAmount: number;
  netVariance: number;
  exceptions: ThreeWayMatchException[];
  matchStatus: 'FULLY_MATCHED' | 'DISCREPANCY_FLAGGED' | 'RESOLVED_APPROVED';
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
}

// ----------------------------------------------------------------------------
// Stock Movements: Transfers, Issues, Reservations, Patient Consumption
// ----------------------------------------------------------------------------

export type TransferWorkflowState =
  | 'TRANSFER_CREATED'
  | 'TRANSFER_DISPATCHED'
  | 'TRANSFER_IN_TRANSIT'
  | 'TRANSFER_RECEIVED'
  | 'TRANSFER_DISCREPANCY'
  | 'CANCELLED';

export interface TransferLineItem {
  itemId: string;
  itemCode: string;
  itemName: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  sentQuantity: number;
  receivedQuantity?: number;
  discrepancyQuantity?: number;
  uom: StandardUOM;
  unitCost: number;
}

export interface StockTransferRecord {
  transferId: string;
  tenantId: string;
  transferNumber: string; // "TRF-2026-012"
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  items: TransferLineItem[];
  status: TransferWorkflowState;
  initiatedBy: string;
  dispatchedBy?: string;
  receivedBy?: string;
  dispatchedAt?: string;
  receivedAt?: string;
  discrepancyReported?: boolean;
  discrepancyReason?: string;
  notes?: string;
}

export interface StockReservation {
  reservationId: string;
  tenantId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  batchId?: string;
  batchNumber?: string;
  quantity: number;
  uom: StandardUOM;
  locationId: string;
  locationName: string;
  patientId?: string;
  patientName?: string;
  encounterId?: string;
  procedureId?: string;
  procedureName?: string;
  departmentId?: string;
  reservedBy: string;
  reservedAt: string;
  expiresAt: string; // Automated unreservation if procedure cancelled/elapsed
  status: 'ACTIVE' | 'FULFILLED_CONSUMED' | 'RELEASED_CANCELLED' | 'EXPIRED';
}

// ----------------------------------------------------------------------------
// Patient & Implant Traceability
// ----------------------------------------------------------------------------

export interface PatientConsumptionRecord {
  consumptionId: string;
  tenantId: string;
  patientId: string;
  patientMRN: string;
  patientName: string;
  encounterId: string;
  procedureId?: string;
  procedureName?: string;
  departmentId: string;
  departmentName: string;
  surgeonOrDoctorName?: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: ItemType;
  batchId: string;
  batchNumber: string;
  serialNumber?: string;
  lotNumber?: string;
  udi?: string; // Unique Device Identifier
  quantity: number;
  uom: StandardUOM;
  consumedAt: string;
  documentedBy: string;
  witnessedBy?: string;
  supplierId?: string;
  supplierName?: string;
  purchaseOrderId?: string;
  grnId?: string;
  isImplant: boolean;
  implantDetails?: {
    anatomicalSite: string; // e.g. "Right Knee Medial"
    lateralization?: 'LEFT' | 'RIGHT' | 'BILATERAL';
    model: string;
    catalogNumber: string;
    warrantyExpiryDate?: string;
  };
}

// ----------------------------------------------------------------------------
// Recall Management
// ----------------------------------------------------------------------------

export type RecallScope =
  | 'ITEM_WIDE'
  | 'BATCH_WIDE'
  | 'LOT_WIDE'
  | 'SERIAL_SPECIFIC'
  | 'SUPPLIER_SPECIFIC'
  | 'MANUFACTURER_SPECIFIC';

export interface RecallCase {
  recallId: string;
  tenantId: string;
  recallCaseNumber: string; // "REC-2026-001"
  itemId: string;
  itemCode: string;
  itemName: string;
  scope: RecallScope;
  targetBatchNumbers: string[];
  targetLotNumbers?: string[];
  targetSerialNumbers?: string[];
  manufacturerName: string;
  supplierName?: string;
  recallReason: string;
  severity: 'CRITICAL_CLASS_1' | 'URGENT_CLASS_2' | 'ADVISORY_CLASS_3';
  triggeredBy: string;
  triggeredAt: string;
  quarantinedQuantityAcrossStores: number;
  quarantinedLocationBreakdown: {
    locationId: string;
    locationName: string;
    quarantinedQuantity: number;
  }[];
  identifiedPatientExposuresCount: number;
  affectedPatients: {
    patientId: string;
    patientMRN: string;
    patientName: string;
    encounterId: string;
    procedureName?: string;
    surgeonName?: string;
    implantOrUsageDate: string;
    notificationSent: boolean;
  }[];
  status: 'INITIATED' | 'QUARANTINE_EXECUTED' | 'PATIENTS_NOTIFIED' | 'RESOLVED_DISPOSED';
  resolutionNotes?: string;
}

// ----------------------------------------------------------------------------
// Stock Adjustments & Cycle Counts
// ----------------------------------------------------------------------------

export type AdjustmentReasonCode =
  | 'COUNT_VARIANCE'
  | 'DAMAGE'
  | 'EXPIRY'
  | 'THEFT'
  | 'LOSS'
  | 'DATA_CORRECTION'
  | 'PACKAGING_VARIANCE'
  | 'UOM_CORRECTION'
  | 'OTHER';

export interface StockAdjustmentRecord {
  adjustmentId: string;
  tenantId: string;
  facilityId: string;
  adjustmentNumber: string; // "ADJ-2026-089"
  locationId: string;
  locationName: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  batchId: string;
  batchNumber: string;
  systemQuantityBefore: number;
  countedQuantity: number;
  varianceQuantity: number; // positive = gain, negative = loss
  adjustmentType: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
  uom: StandardUOM;
  unitCost: number;
  totalVarianceValuation: number;
  reasonCode: AdjustmentReasonCode;
  justification: string;
  reportedBy: string;
  authorizedBy: string;
  requiresDualAuthorization: boolean;
  secondAuthorizedBy?: string;
  timestamp: string;
  status: 'PENDING_APPROVAL' | 'APPROVED_POSTED' | 'REJECTED';
}

export interface CycleCountRecord {
  countId: string;
  tenantId: string;
  locationId: string;
  locationName: string;
  scheduledDate: string;
  completedDate?: string;
  conductedBy: string;
  isBlindCount: boolean; // if true, expected quantity hidden from counter
  countedItems: {
    itemId: string;
    itemCode: string;
    itemName: string;
    batchNumber: string;
    expectedQuantity?: number; // populated after blind count submitted
    countedQuantity: number;
    variance: number;
    status: 'MATCH' | 'VARIANCE_FLAGGED' | 'ADJUSTED';
  }[];
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'SUBMITTED_FOR_REVIEW' | 'COMPLETED';
}

// ----------------------------------------------------------------------------
// Supplier Master & Scorecard
// ----------------------------------------------------------------------------

export interface SupplierPerformanceScorecard {
  onTimeDeliveryRatePercent: number; // e.g. 94.2%
  fillRatePercent: number; // 98.1%
  qualityAcceptanceRatePercent: number; // 99.4%
  rejectionRatePercent: number; // 0.6%
  priceVariancePercent: number; // +1.2%
  averageLeadTimeDays: number; // 3.8 days
  responseHours: number; // 4.5 hours
  returnRatePercent: number; // 0.2%
  complianceStatus: 'FULLY_COMPLIANT' | 'WARNING_RENEWAL_DUE' | 'NON_COMPLIANT_BLOCKED';
  overallExplainableScore: number; // 0 - 100
  scoringFormulaExplanation: string;
}

export interface SupplierMaster {
  supplierId: string;
  tenantId: string;
  legalName: string;
  displayName: string;
  registrationNumber: string;
  taxNumber: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: {
    street: string;
    city: string;
    state?: string;
    postalCode: string;
    country: string;
  };
  paymentTerms: string;
  creditLimit: number;
  currency: string;
  categories: string[];
  certifications: {
    name: string;
    issuedBy: string;
    validUntil: string;
    isExpired: boolean;
  }[];
  drugLicenseNumber?: string;
  drugLicenseExpiry?: string;
  bankingReference?: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED' | 'UNDER_REVIEW' | 'INACTIVE';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  scorecard: SupplierPerformanceScorecard;
  activeContractsCount: number;
  createdAt: string;
  updatedAt: string;
}

// ----------------------------------------------------------------------------
// AI Recommendations & Explainability
// ----------------------------------------------------------------------------

export interface AISCMRecommendation {
  id: string;
  type: 'DEMAND_FORECAST' | 'REORDER_SUGGESTION' | 'ANOMALY_DETECTION' | 'EXPIRY_RISK';
  itemId: string;
  itemCode: string;
  itemName: string;
  recommendation: string;
  whyExplanation: string;
  dataUsed: string[];
  confidenceScorePercent: number; // e.g. 88%
  assumptions: string[];
  projectedStockoutDate?: string;
  recommendedOrderQuantity?: number;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: string;
}

// ----------------------------------------------------------------------------
// Immutable SCM Domain Events & Administrative Audit Log
// ----------------------------------------------------------------------------

export type ScmDomainEventType =
  | 'PR_SUBMITTED'
  | 'PR_APPROVED'
  | 'PR_REJECTED'
  | 'PR_CONVERTED_TO_PO'
  | 'PO_GENERATED'
  | 'GRN_INSPECTED_ACCEPTED'
  | 'STOCK_ISSUED'
  | 'STOCK_RECEIVED'
  | 'STOCK_ADJUSTED'
  | 'BATCH_REGISTERED'
  | 'BATCH_QUARANTINED'
  | 'BATCH_RECALLED';

export interface ScmDomainEvent {
  eventId: string;
  tenantId: string;
  eventType: ScmDomainEventType;
  aggregateId: string;
  aggregateType:
    | 'REQUISITION'
    | 'PURCHASE_ORDER'
    | 'STOCK_TRANSACTION'
    | 'BATCH'
    | 'STOCK_ADJUSTMENT'
    | 'GRN';
  actor: {
    userId: string;
    userName: string;
    role: string;
  };
  description: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  recordedAt: string;
  idempotencyKey: string;
  hash?: string;
}
