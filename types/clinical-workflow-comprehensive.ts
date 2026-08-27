/**
 * Comprehensive Clinical Workflow & Health System Domain Models
 * Supporting G-HIMS OS Master Architecture
 */

import { PatientIdentifier } from '@/types/mpi';
import { EncounterType } from '@/types/encounter-runtime';

export type ExtendedOpdStageId =
  | 'REGISTRATION'
  | 'BILLING_AUTHORIZATION'
  | 'QUEUE_ASSIGNMENT'
  | 'NURSING_INTAKE'
  | 'MO_ASSESSMENT'
  | 'SPECIALTY_PRE_CONSULT'
  | 'CONSULTANT_REVIEW'
  | 'INVESTIGATIONS'
  | 'TREATMENT'
  | 'FOLLOW_UP'
  | 'LONGITUDINAL_CARE'
  | 'DISCHARGE_SETTLEMENT';

export interface VitalsMeasurement {
  heartRate: number; // bpm
  systolicBp: number; // mmHg
  diastolicBp: number; // mmHg
  respiratoryRate: number; // breaths/min
  temperatureCelsius: number; // °C
  spo2Percent: number; // %
  onSupplementalOxygen: boolean;
  consciousnessAvpu: 'ALERT' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE';
  news2Score: number;
  triageCategory: 'RED_IMMEDIATE' | 'ORANGE_VERY_URGENT' | 'YELLOW_URGENT' | 'GREEN_STANDARD' | 'BLUE_NON_URGENT';
  measuredAt: number;
  measuredBy: string;
}

export interface NursingAssessment {
  vitals: VitalsMeasurement;
  chiefComplaint: string;
  symptomDuration: string;
  painScale: number; // 0-10
  fallRiskScore: number;
  knownAllergies: string[];
  currentMedications: string[];
  intakeNotes: string;
  assessedAt: number;
  nurseId: string;
  nurseName: string;
}

export interface MedicalOfficerAssessment {
  triageCategory: 'RESUSCITATION' | 'EMERGENT' | 'URGENT' | 'LESS_URGENT' | 'NON_URGENT';
  preliminaryDiagnosis: string;
  icd10ProvisionalCodes: string[];
  physicalExamSummary: string;
  systemReview: {
    cardiovascular: string;
    respiratory: string;
    gastrointestinal: string;
    neurological: string;
    musculoskeletal: string;
  };
  recommendedSpecialty: string;
  recommendedConsultantId?: string;
  statOrders: string[];
  assessedAt: number;
  moId: string;
  moName: string;
}

export interface ConsultantSoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  primaryDiagnosis: string;
  secondaryDiagnoses: string[];
  icd10Codes: string[];
  cptCodes: { code: string; description: string; fee: number }[];
  signedAt: number;
  consultantId: string;
  consultantName: string;
  consultantRole: string;
  isSigned: boolean;
}

export interface DiagnosticOrderItem {
  id: string;
  encounterId: string;
  patientId: string;
  type: 'LABORATORY' | 'RADIOLOGY';
  code: string;
  testName: string;
  department: string;
  price: number;
  orderedBy: string;
  orderedAt: number;
  paymentStatus: 'UNBILLED' | 'LOCKED_PENDING_PAYMENT' | 'PAID_SETTLED' | 'INSURANCE_PREAUTH';
  worklistStatus: 'BLOCKED_BY_REVENUE_GATE' | 'READY_FOR_COLLECTION' | 'IN_PROCESSING' | 'FINALIZED';
  results?: {
    resultValue: string;
    referenceRange: string;
    unit: string;
    isAbnormal: boolean;
    criticalAlert: boolean;
    reportedBy: string;
    reportedAt: number;
    hl7MessageRef?: string;
  };
}

export interface MedicationBatch {
  batchNumber: string;
  expiryDate: string; // YYYY-MM-DD
  quantityInStock: number;
  unitCost: number;
  location: string;
}

export interface PharmacyPrescriptionItem {
  id: string;
  encounterId: string;
  drugName: string;
  genericName: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  route: 'ORAL' | 'IV' | 'IM' | 'SC' | 'TOPICAL' | 'INHALED';
  quantityPrescribed: number;
  quantityDispensed: number;
  prescribedBy: string;
  allocatedBatch?: {
    batchNumber: string;
    expiryDate: string;
    unitPrice: number;
  };
  dispenseStatus: 'PRESCRIBED' | 'BATCH_RESERVED_FEFO' | 'DISPENSED' | 'CANCELLED';
  dispensedBy?: string;
  dispensedAt?: number;
  allergyWarning?: string;
}

export interface LedgerJournalVoucher {
  voucherId: string;
  tenantId: string;
  encounterId: string;
  patientId: string;
  voucherNumber: string;
  postingDate: number;
  description: string;
  debitEntries: {
    accountCode: string;
    accountName: string;
    amount: number;
  }[];
  creditEntries: {
    accountCode: string;
    accountName: string;
    amount: number;
  }[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean; // Must be true: totalDebit === totalCredit
  postedBy: string;
}

export interface ComprehensiveOpdEncounter {
  id: string;
  tenantId: string;
  patientId: string;
  mrn: string;
  patientName: string;
  gender: string;
  age: number;
  tokenNumber: string;
  encounterType: EncounterType;
  currentStage: ExtendedOpdStageId;
  stageProgress: Record<ExtendedOpdStageId, {
    status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'SKIPPED';
    enteredAt?: number;
    completedAt?: number;
    completedBy?: string;
  }>;
  tariffPlan: 'OUT_OF_POCKET' | 'CORPORATE_PPO' | 'SEHAT_CARD_UNIVERSAL' | 'STATE_INSURANCE';
  copayRatio: { insurancePercent: number; patientPercent: number };
  financialClearance: {
    ingressFeePaid: boolean;
    ingressReceiptNumber?: string;
    amountPaid: number;
  };
  nursingAssessment?: NursingAssessment;
  moAssessment?: MedicalOfficerAssessment;
  consultantSoap?: ConsultantSoapNote;
  diagnosticOrders: DiagnosticOrderItem[];
  prescriptions: PharmacyPrescriptionItem[];
  ledgerVouchers: LedgerJournalVoucher[];
  finalBill?: {
    totalGrossAmount: number;
    insuranceCoverage: number;
    patientPayable: number;
    patientPaid: number;
    balanceDue: number;
    isSettled: boolean;
    settledAt?: number;
    settledBy?: string;
  };
  startedAt: number;
  completedAt?: number;
  status: 'REGISTERED' | 'IN_TRIAGE' | 'IN_CONSULTATION' | 'IN_ANCILLARY' | 'IN_BILLING' | 'COMPLETED';
}
