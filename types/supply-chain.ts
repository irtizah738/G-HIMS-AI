export type PaymentTerms = 'Immediate' | 'Net15' | 'Net30' | 'Net60' | 'Net90' | 'Custom';

export type VendorCategory =
  | 'pharmaceuticals'
  | 'surgical_implants'
  | 'medical_consumables'
  | 'dme_equipment'
  | 'laboratory_reagents'
  | 'cssd_sterilization'
  | 'biomedical_devices'
  | 'ppe_sanitation';

export type VendorStatus = 'active' | 'under_review' | 'preferred' | 'suspended' | 'inactive';

export interface Vendor {
  id: string;
  tenantId: string;
  name: string;
  legalBusinessName?: string;
  taxId: string; // e.g. NTN / EIN / VAT
  paymentTerms: PaymentTerms;
  performanceScore: number; // 0 - 100
  reliabilityRating?: number; // 1 - 5 stars
  contractNumbers: string[];
  contactPerson: string;
  email: string;
  phone: string;
  category: VendorCategory;
  status: VendorStatus;
  leadTimeDays: number;
  address: {
    street: string;
    city: string;
    state?: string;
    postalCode: string;
    country: string;
  };
  bankAccountDetails?: {
    bankName: string;
    accountNumber: string;
    routingNumber?: string;
    iban?: string;
  };
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type POStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'partially_received'
  | 'received'
  | 'cancelled';

export type ItemInspectionStatus = 'pending' | 'accepted' | 'rejected' | 'quarantined';

export interface PurchaseOrderLineItem {
  id: string;
  itemId: string;
  itemName: string;
  sku: string;
  category: string;
  orderedQuantity: number;
  receivedQuantity: number;
  unitOfMeasure: string; // 'Pack', 'Vial', 'Box', 'Unit', 'Set', 'Carton'
  unitPrice: number;
  taxRate: number; // e.g. 0.05 for 5%
  discount: number; // e.g. flat amount or percentage discount
  lineTotal: number;
  batchNumber?: string;
  expirationDate?: string;
  inspectionStatus: ItemInspectionStatus;
  inspectionNotes?: string;
}

export type ApproverRole =
  | 'procurement_officer'
  | 'department_head'
  | 'cfo'
  | 'medical_director'
  | 'supply_chain_manager';

export interface POApprovalSignature {
  role: ApproverRole;
  signedBy: string;
  signerEmail?: string;
  signedAt: string;
  signatureHash: string;
  approved: boolean;
  comments?: string;
}

export interface ItemReceivingRecord {
  itemId: string;
  itemName: string;
  sku: string;
  quantityReceived: number;
  batchLot: string;
  expirationDate: string;
  unitCost: number;
  passedInspection: boolean;
  inspectionNotes?: string;
}

export interface ReceivingLog {
  id: string;
  poId: string;
  grnNumber: string; // Goods Received Note Number (e.g. GRN-2026-00412)
  receivedAt: string;
  receivedBy: string;
  items: ItemReceivingRecord[];
  vendorInvoiceNumber?: string;
  waybillNumber?: string;
  storageBinLocation?: string;
  notes?: string;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  poNumber: string; // e.g. PO-2026-00891
  vendorId: string;
  vendorName: string;
  vendorEmail?: string;
  status: POStatus;
  departmentDestination: string; // e.g. 'Central Pharmacy', 'OR Supply Hub', 'Central Warehouse'
  lineItems: PurchaseOrderLineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  totalCost: number;
  currency: string; // 'USD', 'PKR', 'EUR', etc.
  paymentTerms: PaymentTerms;
  approvalSignatures: POApprovalSignature[];
  receivingLogs?: ReceivingLog[];
  shippingAddress: string;
  deliveryDueDate: string;
  requestedBy: string;
  createdDate: string;
  updatedAt: string;
  notes?: string;
}

export type PARStockStatus = 'critical' | 'warning' | 'optimal' | 'overstocked';

export interface PARItem {
  itemId: string;
  itemName: string;
  sku: string;
  category: string;
  unitOfMeasure: string;
  minQuantity: number;
  maxQuantity: number;
  currentQuantity: number;
  reorderPoint: number;
  unitCost: number;
  criticalItem: boolean; // Flag for life-saving or zero-tolerance out-of-stock items (e.g. Epinephrine, Cardiac Catheters)
  lastCountDate: string;
  lastReplenishedAt?: string;
  storageBin?: string;
}

export interface PARLocation {
  id: string;
  tenantId: string;
  name: string; // e.g. 'ICU 3rd Floor Supply Hub'
  department: string; // e.g. 'ICU-3rd-Floor', 'OR-Suite-B', 'ER-Trauma-Bay', 'Ward-3A-Cardiology', 'Central-Warehouse'
  floor: string;
  building: string;
  managerName: string;
  contactExtension: string;
  items: PARItem[];
  status: 'active' | 'inactive';
  lastFullAuditDate?: string;
  updatedAt: string;
}

export interface PARAlert {
  locationId: string;
  locationName: string;
  department: string;
  itemId: string;
  itemName: string;
  sku: string;
  currentQuantity: number;
  minQuantity: number;
  maxQuantity: number;
  reorderPoint: number;
  deficit: number;
  status: PARStockStatus;
  suggestedReorderQuantity: number;
  unitCost: number;
  estimatedReplenishmentCost: number;
  criticalItem: boolean;
}

export type TransferStatus = 'draft' | 'pending_approval' | 'dispatched' | 'received' | 'cancelled';

export interface StockTransferItem {
  itemId: string;
  itemName: string;
  sku: string;
  quantity: number;
  unitOfMeasure: string;
  unitCost?: number;
  batchLot?: string;
  expirationDate?: string;
}

export interface StockTransferRequest {
  id: string;
  tenantId: string;
  requisitionNumber: string; // e.g. TR-2026-0912
  sourceLocationId: string; // Usually 'loc-central-warehouse'
  sourceLocationName: string;
  destinationLocationId: string;
  destinationLocationName: string;
  destinationDepartment: string;
  status: TransferStatus;
  items: StockTransferItem[];
  requestedBy: string;
  approvedBy?: string;
  dispatchedBy?: string;
  receivedBy?: string;
  createdAt: string;
  dispatchedAt?: string;
  receivedAt?: string;
  notes?: string;
}

export type SterilizationCycleType = 'Steam' | 'Plasma' | 'Ethylene_Oxide' | 'Dry_Heat';
export type CSSDCycleType = SterilizationCycleType;

export type BiologicalIndicatorResult = 'pass' | 'fail' | 'pending';
export type ChemicalIndicatorResult = 'pass' | 'fail';
export type SterilizationCycleStatus = 'in_progress' | 'completed' | 'failed' | 'quarantined';

export type CSSDTrayStatus =
  | 'clean_packed'
  | 'in_sterilizer'
  | 'sterile_validated'
  | 'quarantined'
  | 'dispatched_to_or'
  | 'used_returned';

export interface CSSDBatchItem {
  traySetId: string;
  traySetName: string; // e.g. 'Major Laparotomy Set #04', 'Orthopedic Trauma Kit A'
  barcode: string; // e.g. 'CSSD-TRAY-88219'
  itemCount: number;
  department: string;
  surgeryType?: string;
  instrumentsList: string[];
  status: CSSDTrayStatus;
  dispatchedTo?: string; // e.g. 'OR Suite 2'
  dispatchedAt?: string;
  packedBy: string;
}

export type SterileBatchItem = CSSDBatchItem;

export interface SterilizationCycle {
  id: string;
  tenantId: string;
  cycleNumber: string; // e.g. 'CSSD-CYC-2026-0492'
  autoclaveMachineId: string; // e.g. 'AUTOCLAVE-STEAM-01', 'PLASMA-VAPOR-02', 'ETO-CHAMBER-03'
  autoclaveMachineName: string;
  operatorId: string;
  operatorName: string;
  cycleType: SterilizationCycleType;
  temperatureCelsius: number; // e.g. 134.0
  pressureBar: number; // e.g. 2.15
  durationMinutes: number; // e.g. 45
  vacuumPulses?: number;
  biologicalIndicatorResult: BiologicalIndicatorResult; // 'pass' | 'fail' | 'pending'
  chemicalIndicatorResult: ChemicalIndicatorResult;
  status: SterilizationCycleStatus;
  cycleStartTime: string;
  cycleEndTime?: string;
  expirationDate: string; // Sterility shelf life (e.g. +30 to 180 days)
  batchItems: CSSDBatchItem[];
  testStripPhotoUrl?: string;
  biologicalIncubatorHours?: number; // e.g. 24 or 3-hour rapid readout
  biLotNumber?: string;
  biTestSpecies?: string; // 'Geobacillus stearothermophilus' | 'Bacillus atrophaeus'
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SCMDashboardStats {
  totalOpenPOSpend: number;
  pendingDeliveriesCount: number;
  activeVendorsCount: number;
  avgLeadTimeDays: number;
  parLocationsCount: number;
  criticalStockDeficitsCount: number;
  cssdCyclesTodayCount: number;
  sterileTraysReadyCount: number;
  quarantinedBatchesCount: number;
}
