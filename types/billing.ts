export type TariffPlanType = 'cash' | 'private_insurance' | 'corporate' | 'government';

export type ChargeEntitySource = 'consultation' | 'pharmacy' | 'lab' | 'radiology' | 'bed_day' | 'procedure';

export type InvoicePaymentStatus = 'pending' | 'partially_paid' | 'paid' | 'waived';

export type InvoicePaymentMethod = 'cash' | 'card' | 'pos' | 'mobile_wallet' | 'insurance_claim' | 'split';

export type ClaimStatus = 'draft' | 'submitted' | 'approved' | 'adjudicated' | 'rejected';

export interface PriceOverride {
  code: string;
  description: string;
  category: ChargeEntitySource | 'procedure';
  standardPrice: number;
  overridePrice: number;
}

export interface Tariff {
  id: string;
  tenantId: string;
  name: string;
  planName: TariffPlanType;
  payerCode?: string;
  description?: string;
  defaultDiscountPercent: number;
  copayPercent: number; // e.g. 20 means 20% patient copay, 80% payer coverage
  maxCopayCap?: number; // Maximum patient responsibility cap (e.g., $150 or PKR 15,000)
  priceOverrides: Record<string, number>; // code (CPT/LOINC/DrugID) -> overridden price
  overrideList?: PriceOverride[];
  isDefault?: boolean;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface ChargeItem {
  id: string;
  entitySource: ChargeEntitySource;
  code: string;
  description: string;
  quantity: number;
  unitPrice: number;
  grossAmount: number;
  discountAmount: number;
  tax: number;
  netAmount: number;
  insurancePortion: number;
  patientPortion: number;
  timestamp: string;
  status?: 'pending' | 'billed' | 'waived';
  sourceReferenceId?: string; // encounterId, orderId, rxId, bedStayId
  icd10Code?: string;
  icd10Description?: string;
}

export interface PaymentRecord {
  id: string;
  amount: number;
  method: InvoicePaymentMethod;
  referenceNumber?: string;
  recordedBy: string;
  cashierId?: string;
  stationId?: string;
  timestamp: string;
  notes?: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  patientId: string;
  patientName: string;
  mrn: string;
  encounterId: string;
  tariffId: string;
  tariffName?: string;
  planName?: TariffPlanType;
  payerName?: string;
  policyNumber?: string;
  approvalCode?: string;
  totalGross: number;
  totalDiscount: number;
  totalTax: number;
  totalCoverage: number; // Payer / Insurance responsibility
  totalPatientDue: number; // Patient responsibility
  totalPaid: number;
  balanceDue: number;
  paymentStatus: InvoicePaymentStatus;
  paymentMethod: InvoicePaymentMethod;
  items: ChargeItem[];
  paymentHistory?: PaymentRecord[];
  claimId?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimLineItem {
  id?: string;
  itemId?: string;
  chargeItemId?: string;
  code?: string; // CPT or HCPCS
  cptCode?: string;
  description: string;
  icd10Code: string;
  icd10Description?: string;
  quantity: number;
  unitPrice?: number;
  billedAmount?: number; // Insurance portion claimed
  claimedAmount?: number;
  allowedAmount?: number;
  approvedAmount?: number;
  deniedAmount?: number;
  adjudicatedStatus?: 'approved' | 'partially_approved' | 'rejected' | 'pending' | 'adjudicated';
  status?: 'approved' | 'partially_approved' | 'rejected' | 'pending' | 'adjudicated';
  denialCode?: string;
  adjudicationReasonCode?: string;
}

export interface Claim {
  id: string;
  tenantId: string;
  claimNumber: string;
  invoiceId: string;
  patientId: string;
  patientName: string;
  mrn: string;
  encounterId?: string;
  payerCode?: string;
  payerName?: string;
  insuranceProviderId?: string;
  insuranceProviderName?: string;
  policyNumber?: string;
  approvalCode?: string;
  totalClaimAmount: number;
  approvedAmount?: number;
  deniedAmount?: number;
  patientCopayAmount?: number;
  claimStatus?: ClaimStatus;
  status?: ClaimStatus;
  lineItems: ClaimLineItem[];
  submissionDate?: string;
  adjudicationDate?: string;
  rejectionReason?: string;
  adjudicationNotes?: string;
  ediBatchId?: string;
  edi837Payload?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SplitCalculationResult {
  unitPrice: number;
  grossAmount: number;
  discountAmount: number;
  tax: number;
  netAmount: number;
  insurancePortion: number;
  patientPortion: number;
}
