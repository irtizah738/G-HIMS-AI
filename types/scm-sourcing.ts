import type { StandardUOM } from '@/types/scm-domain';

export type SupplierContractStatus =
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'TERMINATED'
  | 'EXPIRED';

export interface ReviewSupplierQualificationPayload {
  supplierId: string;
  decision: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED' | 'UNDER_REVIEW';
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  complianceStatus:
    | 'FULLY_COMPLIANT'
    | 'WARNING_RENEWAL_DUE'
    | 'NON_COMPLIANT_BLOCKED';
  notes: string;
  reviewedAt: string;
}

export interface SupplierQualificationReview {
  reviewId: string;
  tenantId: string;
  supplierId: string;
  decision: ReviewSupplierQualificationPayload['decision'];
  riskLevel: ReviewSupplierQualificationPayload['riskLevel'];
  complianceStatus: ReviewSupplierQualificationPayload['complianceStatus'];
  notes: string;
  reviewedAt: string;
  reviewedBy: string;
}

export interface CreateRfqPayload {
  rfqId: string;
  rfqNumber: string;
  requisitionId: string;
  requiredDeliveryDate: string;
  submissionDeadline: string;
  invitedSupplierIds: string[];
  terms: string;
}

export interface RecordSupplierQuotationPayload {
  quotationId: string;
  rfqId: string;
  supplierId: string;
  quotationNumber: string;
  currency: string;
  paymentTerms: string;
  taxMinorUnits?: number;
  shippingMinorUnits?: number;
  warrantyPeriodMonths?: number;
  items: Array<{
    itemId: string;
    uom: StandardUOM;
    unitPriceMinorUnits: number;
    leadTimeDays: number;
    expiryMonthsAtDelivery: number;
    manufacturer: string;
    brand: string;
  }>;
}

export interface GovernedSupplierQuotation {
  quotationId: string;
  tenantId: string;
  rfqId: string;
  supplierId: string;
  supplierName: string;
  quotationNumber: string;
  currency: string;
  paymentTerms: string;
  items: Array<{
    itemId: string;
    uom: StandardUOM;
    unitPriceMinorUnits: number;
    quantity: number;
    lineTotalMinorUnits: number;
    leadTimeDays: number;
    expiryMonthsAtDelivery: number;
    manufacturer: string;
    brand: string;
  }>;
  subtotalMinorUnits: number;
  taxMinorUnits: number;
  shippingMinorUnits: number;
  totalMinorUnits: number;
  warrantyPeriodMonths?: number;
  capturedAt: string;
  capturedBy: string;
  status: 'SUBMITTED' | 'EVALUATED' | 'ACCEPTED' | 'REJECTED';
}

export interface QuotationEvaluationScore {
  quotationId: string;
  supplierId: string;
  priceScore: number;
  qualityScore: number;
  deliveryScore: number;
  supplierRatingScore: number;
  complianceScore: number;
  paymentTermsScore: number;
  weightedTotal: number;
  explainability: string[];
}

export interface AwardSupplierContractPayload {
  contractId: string;
  contractNumber: string;
  rfqId: string;
  selectedQuotationId: string;
  candidateQuotationIds: string[];
  effectiveAt: string;
  expiresAt: string;
  maxSpendMinorUnits?: number;
  selectionJustification: string;
}

export interface ApproveSupplierContractPayload {
  contractId: string;
  decision: 'APPROVE' | 'REJECT';
  comments: string;
}

export interface ChangeSupplierContractStatusPayload {
  contractId: string;
  status: 'SUSPENDED' | 'TERMINATED';
  reason: string;
}

export interface SupplierContract {
  contractId: string;
  tenantId: string;
  contractNumber: string;
  rfqId: string;
  quotationId: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  effectiveAt: string;
  expiresAt: string;
  paymentTerms: string;
  warrantyPeriodMonths?: number;
  maxSpendMinorUnits?: number;
  committedSpendMinorUnits: number;
  lines: Array<{
    itemId: string;
    uom: StandardUOM;
    maxUnitPriceMinorUnits: number;
    contractedQuantity: number;
    manufacturer: string;
    brand: string;
    minimumExpiryMonthsAtDelivery: number;
  }>;
  evaluation: QuotationEvaluationScore;
  selectionJustification: string;
  selectedOutOfPolicy: boolean;
  status: SupplierContractStatus;
  awardedBy: string;
  awardedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  statusReason?: string;
  updatedAt: string;
}

export interface ContractPoValidationInput {
  supplierId: string;
  currency: string;
  paymentTerms: string;
  orderDate: string;
  lines: Array<{
    itemId: string;
    uom: StandardUOM;
    unitPriceMinorUnits: number;
    quantity: number;
  }>;
}
