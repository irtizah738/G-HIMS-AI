export type IpdStageKey =
  | 'ADMISSION'
  | 'BED_ALLOCATION'
  | 'NURSING'
  | 'PHYSICIAN_ORDERS'
  | 'MEDICATION'
  | 'LABS'
  | 'IMAGING'
  | 'DAILY_PROGRESS'
  | 'PROCEDURES'
  | 'CONSULTATIONS'
  | 'DISCHARGE_PLANNING'
  | 'MEDICATION_RECONCILIATION'
  | 'FINANCIAL_RECONCILIATION'
  | 'DISCHARGE'
  | 'FOLLOW_UP';

export interface IpdStageDefinition {
  key: IpdStageKey;
  stepNumber: number;
  label: string;
  shortLabel: string;
  description: string;
  category: 'INTAKE' | 'CARE_DELIVERY' | 'DIAGNOSTICS' | 'PROGRESSION' | 'TRANSITION';
}

export const IPD_STAGE_DEFINITIONS: IpdStageDefinition[] = [
  {
    key: 'ADMISSION',
    stepNumber: 1,
    label: 'Admission',
    shortLabel: 'Admit',
    description: 'Patient identity verification, admission consent, emergency contact & clinical triage',
    category: 'INTAKE',
  },
  {
    key: 'BED_ALLOCATION',
    stepNumber: 2,
    label: 'Bed Allocation',
    shortLabel: 'Bed Alloc',
    description: 'Reconciled ward/room/bed assignment with infection control & nursing acuity match',
    category: 'INTAKE',
  },
  {
    key: 'NURSING',
    stepNumber: 3,
    label: 'Nursing Assessment',
    shortLabel: 'Nursing',
    description: 'Initial head-to-toe evaluation, fall/Braden score, allergy alert & baseline vitals',
    category: 'CARE_DELIVERY',
  },
  {
    key: 'PHYSICIAN_ORDERS',
    stepNumber: 4,
    label: 'Physician Orders',
    shortLabel: 'Orders',
    description: 'CPOE directives: diet, activity, telemetry, DVT prophylaxis & nursing directives',
    category: 'CARE_DELIVERY',
  },
  {
    key: 'MEDICATION',
    stepNumber: 5,
    label: 'Medication (eMAR)',
    shortLabel: 'Meds / eMAR',
    description: 'Unit-dose barcode verified dispensing, IV flow rate & 5-rights medication admin',
    category: 'CARE_DELIVERY',
  },
  {
    key: 'LABS',
    stepNumber: 6,
    label: 'Laboratory',
    shortLabel: 'Labs',
    description: 'LIS order requisition, phlebotomy tracking, hematology, chem-panel & critical value paging',
    category: 'DIAGNOSTICS',
  },
  {
    key: 'IMAGING',
    stepNumber: 7,
    label: 'Imaging & Diagnostics',
    shortLabel: 'Imaging',
    description: 'RIS order routing, PACS DICOM review, Radiologist signed reporting & modality safety',
    category: 'DIAGNOSTICS',
  },
  {
    key: 'DAILY_PROGRESS',
    stepNumber: 8,
    label: 'Daily Progress Notes',
    shortLabel: 'Daily SOAP',
    description: 'Attending multi-disciplinary SOAP notes, NEWS2 trends, fluid balance & round logs',
    category: 'PROGRESSION',
  },
  {
    key: 'PROCEDURES',
    stepNumber: 9,
    label: 'Procedures & Surgeries',
    shortLabel: 'Procedures',
    description: 'Surgical/bedside procedure consent, WHO surgical safety timeout & operative report',
    category: 'CARE_DELIVERY',
  },
  {
    key: 'CONSULTATIONS',
    stepNumber: 10,
    label: 'Specialist Consultations',
    shortLabel: 'Consults',
    description: 'Inter-departmental cardiology, nephrology, neurology or infectious disease opinions',
    category: 'PROGRESSION',
  },
  {
    key: 'DISCHARGE_PLANNING',
    stepNumber: 11,
    label: 'Discharge Planning',
    shortLabel: 'DC Planning',
    description: 'Multidisciplinary discharge checklist, social work evaluation & home health coordination',
    category: 'TRANSITION',
  },
  {
    key: 'MEDICATION_RECONCILIATION',
    stepNumber: 12,
    label: 'Medication Reconciliation',
    shortLabel: 'Med Rec',
    description: 'Clinical pharmacist admission vs home meds vs discharge prescriptions reconciliation',
    category: 'TRANSITION',
  },
  {
    key: 'FINANCIAL_RECONCILIATION',
    stepNumber: 13,
    label: 'Financial Reconciliation',
    shortLabel: 'Fin Rec',
    description: 'Final bill audit, insurance pre-auth/co-pay ledger settlement, zero-balance clearance',
    category: 'TRANSITION',
  },
  {
    key: 'DISCHARGE',
    stepNumber: 14,
    label: 'Discharge Execution',
    shortLabel: 'Discharge',
    description: 'Electronic gate pass generation, patient departure signoff & bed state transition to cleaning',
    category: 'TRANSITION',
  },
  {
    key: 'FOLLOW_UP',
    stepNumber: 15,
    label: 'Follow-up & Continuity',
    shortLabel: 'Follow-up',
    description: 'Post-discharge OPD appointment scheduling, tele-health checkup & 30-day readmission monitoring',
    category: 'TRANSITION',
  },
];

export interface IpdPhysicianOrder {
  id: string;
  orderType: 'DIET' | 'ACTIVITY' | 'MEDICATION' | 'LAB' | 'IMAGING' | 'NURSING';
  description: string;
  prescribedBy: string;
  orderedAt: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'DISCONTINUED';
  priority: 'ROUTINE' | 'URGENT' | 'STAT';
}

export interface IpdMedicationItem {
  id: string;
  name: string;
  dose: string;
  route: 'Oral' | 'IV' | 'IM' | 'SubQ' | 'Topical' | 'Inhaled';
  frequency: string;
  lastAdministered?: string;
  nextDose?: string;
  status: 'SCHEDULED' | 'GIVEN' | 'HELD' | 'DISCONTINUED';
  pharmacistVerified: boolean;
}

export interface IpdLabItem {
  id: string;
  testName: string;
  panel: string;
  orderedAt: string;
  result?: string;
  referenceRange?: string;
  status: 'ORDERED' | 'COLLECTED' | 'IN_ANALYSIS' | 'RESULTED' | 'CRITICAL';
  criticalAlert?: boolean;
}

export interface IpdImagingItem {
  id: string;
  modality: 'XRAY' | 'CT' | 'MRI' | 'ULTRASOUND' | 'ECHO';
  studyName: string;
  orderedAt: string;
  status: 'SCHEDULED' | 'PERFORMED' | 'REPORTED';
  findings?: string;
  radiologist?: string;
}

export interface IpdProgressNote {
  id: string;
  timestamp: string;
  author: string;
  role: string;
  soap: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  };
  news2Score: number;
}

export interface IpdProcedureItem {
  id: string;
  procedureName: string;
  performedBy: string;
  date: string;
  status: 'SCHEDULED' | 'COMPLETED';
  notes: string;
}

export interface IpdConsultationItem {
  id: string;
  specialty: string;
  consultantName: string;
  reason: string;
  requestedAt: string;
  status: 'REQUESTED' | 'IN_REVIEW' | 'COMPLETED';
  recommendation?: string;
}

export interface IpdPathwayData {
  patientId: string;
  patientName: string;
  mrn: string;
  bedId: string;
  bedNumber: string;
  ward: string;
  admissionDate: string;
  attendingPhysician: string;
  primaryNurse: string;
  primaryDiagnosis: string;
  allergies: string[];
  currentStage: IpdStageKey;
  stageStatuses: Record<IpdStageKey, 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'>;
  orders: IpdPhysicianOrder[];
  medications: IpdMedicationItem[];
  labs: IpdLabItem[];
  imaging: IpdImagingItem[];
  progressNotes: IpdProgressNote[];
  procedures: IpdProcedureItem[];
  consultations: IpdConsultationItem[];
  dischargePlanning: {
    estimatedDischargeDate: string;
    transportNeeded: boolean;
    homeCareOrdered: boolean;
    socialWorkCleared: boolean;
    patientEducationDone: boolean;
  };
  medicationReconciliation: {
    pharmacistName: string;
    reconciliationDate: string;
    reconciledCount: number;
    discrepanciesResolved: boolean;
  };
  financialReconciliation: {
    totalEstimatedCharges: number;
    insuranceApprovedAmount: number;
    patientCoPaySettled: boolean;
    billingCleared: boolean;
    clearedBy: string;
  };
  dischargeExecution: {
    dischargedAt?: string;
    dischargingPhysician?: string;
    gatePassId?: string;
    disposition?: string;
  };
  followUp: {
    clinicAppointmentDate?: string;
    telehealthFollowUpDate?: string;
    instructions?: string;
  };
}
