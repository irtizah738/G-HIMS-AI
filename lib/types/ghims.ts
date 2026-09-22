export type WardType = 'ICU' | 'General' | 'Emergency' | 'Maternity' | 'Pediatrics' | 'Surgery' | 'Cardiology' | 'Oncology';

export type BedStatus = 'available' | 'occupied' | 'maintenance' | 'reserved' | 'cleaning';

export interface Bed {
  id: string;
  bedNumber: string;
  ward: WardType;
  room: string;
  status: BedStatus;
  patientId?: string;
  patientName?: string;
  admissionDate?: string;
  expectedDischarge?: string;
  assignedNurse?: string;
  assignedDoctor?: string;
  attendingDoctor?: string;
  vitalAlert?: boolean;
  notes?: string;
}

export interface Vitals {
  heartRate: number;
  bloodPressure: string;
  temperature: number;
  respiratoryRate: number;
  oxygenSaturation: number;
  timestamp: string;
}

export interface ClinicalNote {
  id: string;
  timestamp: string;
  author: string;
  role: string;
  content: string;
  category: 'SOAP' | 'Progress' | 'Nursing' | 'Discharge' | 'Consultation';
  aiStructuredData?: {
    chiefComplaint?: string;
    diagnoses?: string[];
    medicationsPrescribed?: string[];
    recommendedProcedures?: string[];
    followUpDays?: number;
    billingCodes?: { code: string; description: string; fee: number }[];
  };
}

export interface Medication {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  route: string;
  status: 'active' | 'completed' | 'discontinued';
  prescribedDate: string;
  prescribedBy: string;
  stockRemaining?: number;
  unitPrice?: number;
}

export interface LabOrder {
  id: string;
  testName: string;
  category: 'Hematology' | 'Biochemistry' | 'Microbiology' | 'Radiology' | 'Pathology';
  status: 'ordered' | 'in-progress' | 'completed' | 'critical';
  orderedAt: string;
  completedAt?: string;
  sampleId: string;
  results?: {
    parameter: string;
    value: string;
    unit: string;
    normalRange: string;
    flag?: 'Normal' | 'High' | 'Low' | 'Critical';
  }[];
  notes?: string;
  technician?: string;
  radiologyImageUrl?: string;
  cost?: number;
}

export interface BillItem {
  id: string;
  description: string;
  code: string;
  category: 'Bed Charges' | 'Consultation' | 'Lab & Diagnostics' | 'Pharmacy' | 'Procedure';
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  auditedStatus?: 'verified' | 'unbilled_detected' | 'reconciled';
  sourceNoteId?: string;
}

export interface BillingAuditMismatch {
  id: string;
  patientId: string;
  patientName: string;
  encounterId: string;
  noteId: string;
  date: string;
  documentedItem: string;
  category: 'Procedure' | 'Medication' | 'Lab' | 'Supply / Consumable' | 'Bed Tier';
  suggestedCptCode: string;
  estimatedRecoverableRevenue: number;
  status: 'pending_review' | 'reconciled' | 'dismissed';
  evidenceSnippet: string;
  confidenceScore: number;
}

export interface Encounter {
  id: string;
  type: 'Inpatient' | 'Outpatient' | 'Emergency';
  department: string;
  admitDate: string;
  dischargeDate?: string;
  chiefComplaint: string;
  attendingPhysician: string;
  status: 'active' | 'discharged' | 'transferred';
  vitalsHistory: Vitals[];
  clinicalNotes: ClinicalNote[];
  medications: Medication[];
  labOrders: LabOrder[];
  billing: {
    items: BillItem[];
    subtotal: number;
    tax: number;
    insuranceCoverage: number;
    patientPayable: number;
    paymentStatus: 'pending' | 'partially-paid' | 'settled';
  };
}

export interface Patient {
  id: string;
  mrn: string; // Medical Record Number
  fullName: string;
  dateOfBirth: string;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  bloodGroup: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
  contactNumber: string;
  email: string;
  address: string;
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
  };
  allergies: string[];
  chronicConditions: string[];
  activeBedId?: string;
  activeEncounterId?: string;
  encounters: Encounter[];
  registeredAt: string;
}

export interface StaffMember {
  id: string;
  fullName: string;
  role: 'Physician' | 'Nurse' | 'Surgeon' | 'Lab Technician' | 'Pharmacist' | 'Admin';
  department: string;
  shift: 'Morning' | 'Evening' | 'Night' | 'On-Call';
  phone: string;
  status: 'on-duty' | 'off-duty' | 'in-surgery' | 'on-break';
  assignedPatientsCount: number;
}

export interface OpdQueueToken {
  id: string;
  tokenNumber: string;
  patientId: string;
  patientName: string;
  mrn: string;
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  department: string;
  assignedDoctor: string;
  priority: 'routine' | 'urgent' | 'stat_emergency';
  status: 'waiting' | 'in_consultation' | 'completed' | 'no_show';
  arrivalTime: string;
  chiefComplaint: string;
}

export interface Hl7Message {
  id: string;
  timestamp: string;
  type: 'ADT^A01' | 'ADT^A03' | 'ORM^O01' | 'ORU^R01';
  sendingApp: string;
  receivingApp: string;
  patientMrn: string;
  patientName: string;
  status: 'parsed' | 'dispatched' | 'error';
  rawPayload: string;
  parsedSummary: string;
}

export interface FhirResource {
  resourceType: 'Patient' | 'Encounter' | 'Observation' | 'DiagnosticReport' | 'MedicationRequest';
  id: string;
  status: string;
  subject: { reference: string; display: string };
  date: string;
  code?: { text: string; coding?: { system: string; code: string; display: string }[] };
  value?: string | number;
}

export interface OfflineMutation {
  id: string;
  timestamp: string;
  actionType:
    | 'INSERT_NOTE'
    | 'RECONCILE_BILL'
    | 'UPDATE_VITALS'
    | 'ORDER_LAB'
    | 'ALLOCATE_BED'
    | 'INSERT_TELEHEALTH_SESSION'
    | 'UPDATE_TELEHEALTH_SESSION'
    | 'COMPLETE_TELEHEALTH_SESSION'
    | 'RECORD_DISPENSE'
    | 'DISCHARGE_PATIENT'
    | 'REGISTER_PATIENT';
  entity: string;
  payload: Record<string, any>;
  syncStatus: 'synced' | 'pending' | 'conflict_resolved';
  version: number;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  role: string;
  action: string;
  resource: string;
  ipAddress: string;
  status: 'SUCCESS' | 'WARNING' | 'DENIED' | 'SECURITY_ALERT' | 'INFO' | 'ERROR';
  details: string;
  hash?: string;
  previousHash?: string;
}

export interface HospitalStats {
  totalBeds: number;
  occupiedBeds: number;
  availableBeds: number;
  maintenanceBeds: number;
  occupancyRate: number;
  admissionsToday: number;
  dischargesToday: number;
  emergencyPatients: number;
  pendingLabResults: number;
  revenueToday: number;
  revenueLeakageRecoveredToday: number;
  unbilledChargesPending: number;
  syncQueuePendingCount: number;
  networkMode: 'online' | 'offline' | 'degraded_sync';
}

export interface ExecutiveThesisModel {
  targetMarket: {
    tamSize: string; // "$6.8 Trillion"
    targetBeds: string; // "<200-300 Beds"
    regions: string[];
    corePainPoint: string; // "80% clinical notes vs. final bill mismatch ($40B leakage)"
  };
  unitEconomics: {
    blendedAcv: number; // $38,650
    platformSubscription: number; // $1,200
    moduleLicensing: number; // $2,500
    specialtyUsers: number; // $4,950
    performanceShareAvg: number; // $30,000
    cogsPerHospitalYear: number; // $13,000
    grossMarginPercent: number; // 66%
    ltv: number; // $105,000
    cac: number; // $5,000
    ltvCacRatio: string; // "21 : 1"
    paybackMonths: number; // 2.3
  };
  fundRaise: {
    seedAsk: number; // $1,500,000
    monthlyBurn: number; // $85,000
    runwayMonths: number; // 18
    useOfFunds: { label: string; percentage: number; amount: number }[];
    milestones: {
      period: string;
      targetHospitals: number;
      targetArr: string;
      focus: string;
      status: 'completed' | 'in_progress' | 'planned';
    }[];
  };
  competitiveMoat: {
    pillars: {
      title: string;
      highlight: string;
      description: string;
    }[];
  };
}

export interface TelehealthVitals {
  bp: string;
  hr: number;
  spo2: number;
  temp: number;
  glucose?: number;
  respiratoryRate?: number;
  rhythm?: string;
  connectedDevice?: string;
  lastSync?: string;
}

export interface TelehealthTranscriptEntry {
  id: string;
  timestamp: string;
  speaker: 'DOCTOR' | 'PATIENT' | 'SYSTEM';
  text: string;
}

export interface TelehealthSoapNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  icd10Codes?: { code: string; description: string; confidence?: number }[];
  cptCodes?: { code: string; description: string; fee?: number }[];
  signedAt?: string;
  signedBy?: string;
  clinicianNpi?: string;
}

export interface TelehealthPrescription {
  id: string;
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
  prescribedAt: string;
  pharmacyName: string;
  pharmacyNpi: string;
  status: 'DRAFT' | 'PENDING_TRANSMISSION' | 'TRANSMITTED' | 'DISPENSED';
  transactionRef?: string;
}

export interface TelehealthSession {
  id: string;
  tenantId?: string;
  encounterId: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  age: number;
  gender: string;
  scheduledTime: string;
  status: 'WAITING_ROOM' | 'IN_CONSULTATION' | 'DOCUMENTING' | 'COMPLETED' | 'CANCELLED';
  type: 'Telehealth Consultation' | 'Remote Post-Op Follow-up' | 'RPM Chronic Care Review' | 'Urgent Tele-Triage';
  attendingPhysician: string;
  clinicianNpi: string;
  specialty: string;
  chiefComplaint: string;
  roomToken: string;
  connectionQuality: 'EXCELLENT' | 'GOOD' | 'DEGRADED';
  callDurationSeconds: number;
  vitals: TelehealthVitals;
  transcription: TelehealthTranscriptEntry[];
  soapNote: TelehealthSoapNote;
  prescriptions: TelehealthPrescription[];
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isRecording: boolean;
  patientInvitedEmail?: string;
  createdAt: string;
  updatedAt: string;
}

