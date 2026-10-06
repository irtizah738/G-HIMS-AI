/**
 * Comprehensive Outpatient Department (OPD) Domain Models
 * G-HIMS Master Architecture
 */

export type OpdRole = 
  | 'DOCTOR' 
  | 'NURSE' 
  | 'RECEPTIONIST' 
  | 'PHARMACIST' 
  | 'LAB_TECH' 
  | 'BILLING_OFFICER' 
  | 'BILLING_CASHIER'
  | 'CLINICAL_AUDITOR' 
  | 'ADMINISTRATOR'
  | 'SPECIALIST_CONSULTANT'
  | 'TRIAGE_NURSE'
  | 'MEDICAL_OFFICER'
  | string;

export type ExtendedOpdStageId =
  | 'SEARCH_MPI'
  | 'REGISTRATION'
  | 'APPOINTMENTS'
  | 'BILLING_AUTHORIZATION'
  | 'QUEUE_ASSIGNMENT'
  | 'NURSING_INTAKE'
  | 'MO_ASSESSMENT'
  | 'SPECIALTY_CONSULTATION'
  | 'DIAGNOSTIC_ORDERS'
  | 'PHARMACY_FEFO'
  | 'BILLING_SETTLEMENT'
  | 'DISPOSITION_REFERRAL'
  | 'TIMELINE_AUDIT';

export type AppointmentType =
  | 'NEW_CONSULTATION'
  | 'FOLLOW_UP'
  | 'ROUTINE_REVIEW'
  | 'OUTPATIENT_PROCEDURE'
  | 'EXECUTIVE_HEALTH_CHECK'
  | 'SPECIALIST_CONSULTATION'
  | 'TELECONSULTATION'
  | 'POST_DISCHARGE_REVIEW';

export type AppointmentStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'RESCHEDULED'
  | 'CHECKED_IN'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'WAITLISTED';

export type WaitlistPriority = 'LOW' | 'NORMAL' | 'URGENT' | 'CRITICAL';
export type WaitlistStatus = 'WAITING' | 'OFFERED' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';

export interface WaitlistEntry {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  preferredDoctorId?: string;
  facilityId?: string;
  preferredDepartmentId?: string;
  preferredDepartment: string;
  priority: WaitlistPriority;
  notificationPreference: 'SMS' | 'WHATSAPP' | 'PHONE' | 'EMAIL';
  contactPhone: string;
  contactEmail?: string;
  status: WaitlistStatus;
  requestedDate: string;
  offeredProviderEmployeeId?: string;
  offeredProviderName?: string;
  offeredStartAt?: number;
  offeredEndAt?: number;
  offeredTimeZone?: string;
  offerExpiresAt?: number;
  acceptedAppointmentId?: string;
  notes?: string;
  createdAt: number;
}

export interface ConsentCaptureDecision {
  consentType: 'GENERAL_OUTPATIENT' | 'DATA_SHARING_HIE';
  status: 'GRANTED' | 'WITHHELD';
  method: 'DIGITAL_ATTESTATION';
}

export interface ConsentRecord {
  id: string;
  consentType: 'GENERAL_OUTPATIENT' | 'DATA_SHARING_HIE' | 'INVASIVE_PROCEDURE' | 'BLOOD_TRANSFUSION' | 'RESEARCH_TELEMETRY';
  title: string;
  status: 'GRANTED' | 'WITHHELD' | 'REVOKED';
  version: string;
  effectiveDate: string;
  expiryDate: string;
  method: 'DIGITAL_SIGNATURE' | 'PAPER_SCANNED' | 'VERBAL_WITNESSED';
  actorName: string;
  actorRole: string;
  witnessName?: string;
  documentHash?: string;
}

export interface PatientDemographics {
  id: string;
  mrn: string;
  fullName: string;
  preferredName?: string;
  gender: 'Male' | 'Female' | 'Other' | 'Unknown';
  dob: string;
  age: number;
  nationalId: string; // CNIC / SSN
  passportNumber?: string;
  maritalStatus: 'Single' | 'Married' | 'Divorced' | 'Widowed' | 'Unknown';
  nationality: string;
  primaryLanguage: string;
  occupation?: string;
  phone: string;
  secondaryPhone?: string;
  email?: string;
  residentialAddress: string;
  emergencyContact?: {
    name: string;
    relation: string;
    phone: string;
  };
  tariffPlan: 'OUT_OF_POCKET' | 'CORPORATE_PPO' | 'SEHAT_CARD_UNIVERSAL' | 'STATE_INSURANCE' | 'UNASSIGNED';
  insuranceDetails?: {
    payerName?: string;
    policyNumber?: string;
    groupNumber?: string;
    memberId?: string;
    preAuthCode?: string;
    coveragePercent?: number;
    copayPercent?: number;
    expiryDate?: string;
  };
  consents?: ConsentRecord[];
  registrationConsentDecisions?: ConsentCaptureDecision[];
  bloodGroup: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'Unknown';
  knownAllergies?: string[];
  chronicConditions?: string[];
  createdAt: number;
  registeredBy?: string;
}

export interface MpiMatchResult {
  candidatePatient: PatientDemographics;
  matchScore: number; // 0 - 100%
  matchReasons: string[];
  isDefiniteDuplicate: boolean;
}

export interface AppointmentRecord {
  id: string;
  patientId: string;
  patientName: string;
  mrn: string;
  doctorId: string;
  doctorName: string;
  department: string;
  appointmentType: AppointmentType;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTimeSlot: string; // HH:MM
  scheduledStartAt?: number;
  scheduledEndAt?: number;
  timeZone?: string;
  facilityId?: string;
  departmentId?: string;
  durationMinutes: number;
  status: AppointmentStatus;
  chiefComplaint: string;
  cancellationReason?: string;
  cancelledBy?: string;
  cancelledAt?: number;
  rescheduleHistory?: { fromDate: string; fromTime: string; reason: string; changedAt: number }[];
  sourceWaitlistId?: string;
  encounterId?: string;
  queueTokenId?: string;
  bookingChannel: 'FRONT_DESK' | 'PATIENT_PORTAL' | 'CALL_CENTER' | 'PHYSICIAN_REFERRAL' | 'ONLINE_PORTAL' | string;
  createdAt: number;
}

export type QueueStatus =
  | 'PAYMENT_PENDING'
  | 'WAITING'
  | 'CALLED'
  | 'IN_SERVICE'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'TRANSFERRED';

export interface QueueEntry {
  id: string;
  tokenNumber: string;
  encounterId: string;
  patientId?: string;
  patientName: string;
  mrn: string;
  age?: number;
  gender?: string;
  department: string;
  assignedDoctorId?: string;
  assignedDoctorName?: string;
  assignedRoomOrBay: string;
  triagePriority: 'RED_IMMEDIATE' | 'ORANGE_VERY_URGENT' | 'YELLOW_URGENT' | 'GREEN_STANDARD' | 'BLUE_NON_URGENT' | string;
  priorityOverrideReason?: string;
  priorityOverriddenBy?: string;
  status: QueueStatus;
  estimatedWaitMinutes?: number;
  calledAt?: number;
  serviceStartedAt?: number;
  completedAt?: number;
  issuedAt?: number;
  createdAt?: number;
}

export interface PediatricGrowthMetrics {
  isPediatric: boolean;
  weightForAgePercentile?: number;
  heightForAgePercentile?: number;
  headCircumferenceCm?: number;
  immunizationStatus: 'UP_TO_DATE' | 'DELAYED' | 'EXEMPT' | 'UNKNOWN';
  developmentalMilestones: 'APPROPRIATE' | 'DELAY_OBSERVED' | 'UNDER_EVALUATION';
  guardianName?: string;
  guardianRelation?: string;
}

export interface ComprehensiveVitals {
  heartRate: number; // bpm
  systolicBp: number; // mmHg
  diastolicBp: number; // mmHg
  respiratoryRate: number; // breaths/min
  temperatureCelsius: number; // °C
  spo2Percent: number; // %
  spO2Scale?: 1 | 2; // NEWS2 oxygen saturation scale explicitly selected at triage
  onSupplementalOxygen: boolean;
  oxygenFlowRateLpm?: number;
  bloodGlucoseMgDl?: number;
  heightCm: number;
  weightKg: number;
  bmi: number;
  painScale?: number; // 0-10 VAS
  fallRiskScore?: number; // Morse Fall Scale
  infectionScreening?: {
    feverTravelExposure: boolean;
    activeCoughOrRash: boolean;
    isolationRequired: boolean;
  };
  pregnancyScreening?: {
    isPregnant: boolean;
    gestationalWeeks?: number;
    lmpDate?: string;
  };
  gcsScore?: number; // 3 - 15
  gcsEye?: number; // 1 - 4
  gcsVerbal?: number; // 1 - 5
  gcsMotor?: number; // 1 - 6
  consciousnessAvpu?: 'ALERT' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE';
  news2Score?: number;
  news2Risk?: 'LOW' | 'LOW_MEDIUM' | 'MEDIUM' | 'HIGH';
  pediatricGrowth?: PediatricGrowthMetrics;
  measuredAt: number;
  measuredBy?: string;
  triageNotes?: string;
}

export type SpecialtyDepartment =
  | 'GENERAL_MEDICINE'
  | 'CARDIOLOGY'
  | 'PEDIATRICS'
  | 'OBSTETRICS_GYNECOLOGY'
  | 'ORTHOPEDICS'
  | 'ENT'
  | 'OPHTHALMOLOGY'
  | 'NEUROLOGY'
  | 'PSYCHIATRY'
  | 'GENERAL_SURGERY'
  | 'DERMATOLOGY';

export interface SpecialtyAssessmentData {
  specialty: SpecialtyDepartment;
  cardiology?: {
    nyhaClass: 'I' | 'II' | 'III' | 'IV';
    chestPainCharacteristics: string;
    ecgInterpretation: string;
    echoFindings?: string;
    cardiacRiskFactors: string[];
  };
  pediatrics?: {
    feedingPattern: string;
    immunizationReview: string;
    growthPercentileCommentary: string;
    pediatricMilestones: string;
  };
  obGyn?: {
    gravidaPara: string;
    lmpDate: string;
    eddDate: string;
    fundalHeightCm?: number;
    fetalHeartRateBpm?: number;
    cervicalExam?: string;
  };
  orthopedics?: {
    affectedJoint: string;
    rangeOfMotion: string;
    jointStability: string;
    neurovascularDistalStatus: string;
    radiographReview: string;
  };
  ent?: {
    otoscopyRight: string;
    otoscopyLeft: string;
    rhinoscopy: string;
    pharynxTonsils: string;
    audiometryReview?: string;
  };
  ophthalmology?: {
    visualAcuityOd: string;
    visualAcuityOs: string;
    intraocularPressureOd: number;
    intraocularPressureOs: number;
    slitLampAnterior: string;
    fundoscopy: string;
  };
  neurology?: {
    cranialNervesSummary: string;
    motorPowerGrade: string;
    reflexes: string;
    sensoryExam: string;
    cerebellarCoordination: string;
  };
  psychiatry?: {
    appearanceBehavior: string;
    moodAffect: string;
    thoughtProcessContent: string;
    perceptualDisturbances: string;
    phq9Score?: number;
    gad7Score?: number;
    suicideRiskAssessment: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH';
  };
  generalSurgery?: {
    surgicalIndication: string;
    asaScore: 'ASA_I' | 'ASA_II' | 'ASA_III' | 'ASA_IV' | 'ASA_V';
    lumpWoundDescription: string;
    preOpClearanceStatus: string;
  };
  dermatology?: {
    lesionMorphology: string;
    anatomicalDistribution: string;
    dermoscopyFindings: string;
    pasiScore?: number;
  };
}

export type OpdSpecialtyTemplate = 
  | 'GENERAL_MEDICINE'
  | 'CARDIOLOGY'
  | 'PEDIATRICS'
  | 'OB_GYN'
  | 'ORTHOPEDICS'
  | 'OPHTHALMOLOGY'
  | 'ENT'
  | 'DERMATOLOGY'
  | 'NEUROLOGY'
  | 'PSYCHIATRY'
  | 'GENERAL_SURGERY'
  | 'PULMONOLOGY'
  | 'GASTROENTEROLOGY'
  | 'NEPHROLOGY'
  | 'UROLOGY'
  | 'ONCOLOGY'
  | 'EMERGENCY_MEDICINE'
  | string;

export interface Icd10Diagnosis {
  code: string;
  description: string;
  isPrincipal?: boolean;
  category?: string;
  type?: 'PRINCIPAL' | 'SECONDARY' | 'PROVISIONAL' | 'DIFFERENTIAL';
  verificationStatus?: 'CONFIRMED' | 'SUSPECTED' | 'REFUTED';
}

export interface Icd10DiagnosisItem {
  code: string;
  description: string;
  type: 'PRINCIPAL' | 'SECONDARY' | 'PROVISIONAL' | 'DIFFERENTIAL';
  verificationStatus: 'CONFIRMED' | 'SUSPECTED' | 'REFUTED';
  isPrincipal?: boolean;
  category?: string;
}

export interface ClinicalDecisionAlert {
  id: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL_BLOCK';
  title: string;
  message?: string;
  description?: string;
  suggestedAction: string;
  type?: 'DRUG_ALLERGY' | 'DRUG_DRUG_INTERACTION' | 'DUPLICATE_THERAPY' | 'ABNORMAL_VITAL' | 'CONTRAINDICATION';
  isOverridden?: boolean;
  overrideReason?: string;
  overriddenBy?: string;
  overriddenAt?: number;
}

export interface ClinicalDecisionSupportAlert {
  id: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL_BLOCK';
  type: 'DRUG_ALLERGY' | 'DRUG_DRUG_INTERACTION' | 'DUPLICATE_THERAPY' | 'ABNORMAL_VITAL' | 'CONTRAINDICATION';
  title: string;
  description: string;
  suggestedAction: string;
  message?: string;
  isOverridden?: boolean;
  overrideReason?: string;
  overriddenBy?: string;
  overriddenAt?: number;
}

export interface SoapDocumentation {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  historyOfPresentIllness?: string;
  reviewOfSystems?: string;
  physicalExamination?: string;
  specialtyTemplate?: OpdSpecialtyTemplate;
  specialtyData?: SpecialtyAssessmentData | Record<string, any>;
  specialtySpecificData?: Record<string, any>;
  diagnoses?: (Icd10DiagnosisItem | Icd10Diagnosis)[];
  cdsAlerts?: (ClinicalDecisionSupportAlert | ClinicalDecisionAlert)[];
  aiAssistantAudit?: {
    model: string;
    structuredDraftUsed: boolean;
    clinicianModified: boolean;
    acceptedAt: number;
  };
  completedAt?: number;
  completedBy?: string;
  signedByDoctorId?: string;
  signedByDoctorName?: string;
  signedAt?: number;
  digitalSignatureHash?: string;
  isSigned?: boolean;
}

export type DiagnosticCategory = 'LABORATORY' | 'RADIOLOGY' | 'PROCEDURE' | string;

export type OpdWorkflowStage = 
  | 'DASHBOARD'
  | 'SEARCH_MPI'
  | 'REGISTRATION'
  | 'APPOINTMENTS'
  | 'QUEUE'
  | 'TRIAGE'
  | 'CONSULTATION'
  | 'DIAGNOSTICS'
  | 'PHARMACY'
  | 'BILLING'
  | 'DISPOSITION'
  | 'TIMELINE_AUDIT'
  | string;

export type OpdDispositionType = 
  | 'DISCHARGED_HOME'
  | 'FOLLOW_UP_SCHEDULED'
  | 'INTERNAL_REFERRAL'
  | 'EXTERNAL_REFERRAL'
  | 'INPATIENT_ADMISSION_RECOMMENDED'
  | 'LEFT_AGAINST_MEDICAL_ADVICE'
  | string;

export interface InternalReferral {
  id?: string;
  targetDepartment: string;
  targetDoctor?: string;
  priority: 'ROUTINE' | 'URGENT' | 'STAT' | string;
  clinicalReason: string;
  status?: 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED' | string;
}

export interface ExternalReferral {
  id?: string;
  receivingHospitalName: string;
  receivingDoctorName?: string;
  sbarHandover: {
    situation: string;
    background: string;
    assessment: string;
    recommendation: string;
  };
  status?: 'PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED' | string;
}

export interface EncounterDisposition {
  type: OpdDispositionType;
  patientInstructions: string;
  warningSignsRedFlags: string;
  followUpScheduledDate?: string;
  followUpDepartment?: string;
  internalReferral?: InternalReferral;
  externalReferral?: ExternalReferral;
  inpatientAdmissionRequest?: {
    targetWard?: string;
    targetBedId?: string;
    clinicalIndication: string;
    admittingService?: string;
  };
  completedAt?: number;
  completedBy?: string;
}

export interface DiagnosticOrderItem {
  id: string;
  encounterId?: string;
  patientId?: string;
  type?: 'LABORATORY' | 'RADIOLOGY' | 'PROCEDURE';
  category?: DiagnosticCategory;
  code?: string;
  testCode?: string;
  testName: string;
  department?: string;
  clinicalIndication?: string;
  reasonForOrder?: string;
  price?: number;
  costAmountMinorUnits?: number;
  currency?: string;
  billingInvoiceId?: string;
  chargeId?: string;
  revenueLockStatus?:
    | 'PENDING_PAYMENT_CLEARANCE'
    | 'PAID_SETTLED'
    | 'UNLOCKED_STAT_OVERRIDE'
    | string;
  statOverrideReason?: string;
  orderedBy?: string;
  orderingDoctor?: string;
  orderedAt: number;
  urgency?: 'ROUTINE' | 'URGENT' | 'STAT_EMERGENCY' | string;
  status?: 'ORDERED' | 'COLLECTED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED' | string;
  paymentStatus?: 'UNBILLED' | 'LOCKED_PENDING_PAYMENT' | 'PAID_SETTLED' | 'INSURANCE_PREAUTH' | string;
  worklistStatus?:
    | 'BLOCKED_BY_REVENUE_GATE'
    | 'READY_FOR_EXECUTION'
    | 'READY_FOR_COLLECTION'
    | 'SPECIMEN_COLLECTED'
    | 'IN_PROCESSING'
    | 'FINALIZED'
    | string;
  specimenType?: string;
  specimenBarcode?: string;
  requiresConsent?: boolean;
  consentVerified?: boolean;
  resultsSummary?: string;
  specimenDetails?: {
    specimenType: 'WHOLE_BLOOD' | 'SERUM' | 'URINE' | 'SWAB' | 'TISSUE_BIOPSY' | 'SPUTUM' | string;
    barcode: string;
    collectedAt?: number;
    collectedBy?: string;
  };
  results?: {
    resultValue: string;
    referenceRange?: string;
    unit?: string;
    isAbnormal?: boolean;
    criticalPanicAlert?: boolean;
    reportedBy?: string;
    reportedAt?: number;
    verifiedBy?: string;
  };
  radiologyImaging?: {
    modality?: 'XRAY' | 'CT' | 'MRI' | 'ULTRASOUND' | 'ECHO' | string;
    accessionNumber?: string;
    studyDate?: string;
    dicomInstanceCount?: number;
    simulatedImageUrl?: string;
    radiologistReport?: string;
    reportedBy?: string;
  };
  procedureRecord?: {
    procedureName: string;
    performerDoctor: string;
    assistantStaff?: string;
    locationRoom?: string;
    signedConsentVerified?: boolean;
    findingsSummary?: string;
    complications?: string;
    suppliesUsed?: string[];
    completedAt?: number;
  };
}

export interface PharmacyPrescriptionItem {
  id: string;
  encounterId?: string;
  medicationCode?: string;
  drugName: string;
  genericName?: string;
  formulation?: string;
  dosage: string;
  route: 'ORAL' | 'IV' | 'IM' | 'SC' | 'TOPICAL' | 'INHALED' | 'OPHTHALMIC' | string;
  frequency: 'QD' | 'BID' | 'TID' | 'QID' | 'QHS' | 'PRN' | 'STAT' | string;
  durationDays: number;
  quantity?: number;
  quantityPrescribed?: number;
  quantityDispensed?: number;
  unitPriceMinorUnits?: number;
  totalAmountMinorUnits?: number;
  instructions?: string;
  specialInstructions?: string;
  substitutionAllowed?: boolean;
  prescribedBy: string;
  prescribedAt: number;
  allocatedBatch?: {
    batchNumber: string;
    expiryDate: string;
    unitPrice?: number;
    locationRack?: string;
  };
  batchAllocation?: {
    batchNumber: string;
    expiryDate: string;
    locationBin?: string;
    quantityAllocated?: number;
    fefoVerified?: boolean;
  };
  status?: 'PRESCRIBED' | 'DISPENSED' | 'CANCELLED' | string;
  dispenseStatus?: 'PRESCRIBED' | 'BATCH_RESERVED_FEFO' | 'DISPENSED' | 'CANCELLED' | string;
  dispensedBy?: string;
  dispensedAt?: number;
  allergyScreenPassed?: boolean;
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
  isBalanced: boolean;
  postedBy: string;
}

export type DispositionType =
  | 'DISCHARGED_HOME'
  | 'ROUTINE_FOLLOW_UP'
  | 'INTERNAL_SPECIALIST_REFERRAL'
  | 'EXTERNAL_HOSPITAL_TRANSFER'
  | 'INPATIENT_ADMISSION'
  | 'OBSERVATION_HOLD'
  | 'LEFT_WITHOUT_BEING_SEEN'
  | 'AGAINST_MEDICAL_ADVICE'
  | 'EXPIRED_DECEASED';

export interface DispositionAndAdmission {
  disposition: DispositionType;
  dispositionNotes: string;
  decidedAt: number;
  decidedBy: string;
  followUpPlan?: {
    recommendedDate: string;
    intervalDays: number;
    department: string;
    targetDoctorId?: string;
    preVisitLabOrders?: string[];
  };
  internalReferral?: {
    targetDepartment: SpecialtyDepartment;
    targetDoctorId?: string;
    reasonForReferral: string;
    priority: 'ROUTINE' | 'URGENT' | 'STAT';
    queuedTokenCreated?: string;
  };
  externalTransfer?: {
    receivingFacility: string;
    transportType: 'BASIC_AMBULANCE' | 'ALS_MOBILE_ICU' | 'AIR_AMBULANCE' | 'PRIVATE_VEHICLE';
    sbarHandoffNote: {
      situation: string;
      background: string;
      assessment: string;
      recommendation: string;
    };
    transferringDoctor: string;
  };
  inpatientAdmissionRequest?: {
    targetWardOrIcu: 'MEDICAL_WARD' | 'SURGICAL_WARD' | 'CCU' | 'ICU' | 'PEDIATRIC_WARD' | 'OB_GYN_WARD';
    admittingDiagnosis: string;
    isolationRequired: boolean;
    isolationReason?: string;
    admittingPhysician: string;
    bedManagementAckStatus: 'PENDING_BED_ASSIGNMENT' | 'BED_RESERVED' | 'TRANSFERRED_TO_WARD';
    requestedAt: number;
  };
}

export interface OpdTimelineEvent {
  id: string;
  encounterId: string;
  patientId?: string;
  eventType: 
    | 'PATIENT_REGISTERED'
    | 'APPOINTMENT_SCHEDULED'
    | 'PATIENT_CHECKED_IN'
    | 'QUEUE_TOKEN_ISSUED'
    | 'INGRESS_FEE_SETTLED'
    | 'TRIAGE_VITALS_RECORDED'
    | 'NEWS2_ALERT_TRIGGERED'
    | 'MO_ASSESSMENT_COMPLETED'
    | 'CONSULTATION_STARTED'
    | 'SOAP_NOTE_SIGNED'
    | 'DIAGNOSTIC_ORDER_PLACED'
    | 'DIAGNOSTIC_FEE_SETTLED'
    | 'LAB_RESULT_VERIFIED'
    | 'RADIOLOGY_REPORT_AUTHORIZED'
    | 'PROCEDURE_COMPLETED'
    | 'PRESCRIPTION_ISSUED'
    | 'PHARMACY_FEFO_DISPENSED'
    | 'DISPOSITION_DECIDED'
    | 'INPATIENT_ADMISSION_REQUESTED'
    | 'FINAL_BILL_SETTLED'
    | 'ENCOUNTER_COMPLETED'
    | string;
  description: string;
  actor?: string;
  actorName?: string;
  actorRole: string;
  timestamp: number;
  hash?: string;
  payload?: any;
  metadata?: Record<string, any>;
}

export interface ComprehensiveOpdEncounter {
  id: string;
  tenantId: string;
  patientId: string;
  mrn: string;
  patientName: string;
  gender: 'Male' | 'Female' | 'Other' | 'Unknown';
  age: number;
  tokenNumber?: string;
  chiefComplaint?: string;
  encounterType: 'OPD' | 'EMERGENCY' | 'TELEHEALTH' | 'DAY_CARE' | 'OPD_SPECIALIST' | string;
  currentStage: ExtendedOpdStageId | string;
  offlineStagePendingSync?: boolean;
  offlinePendingTargetStage?: string;
  department?: SpecialtyDepartment | string;
  attendingDoctorId?: string;
  attendingDoctorName?: string;
  tariffPlan: 'OUT_OF_POCKET' | 'CORPORATE_PPO' | 'SEHAT_CARD_UNIVERSAL' | 'STATE_INSURANCE' | 'UNASSIGNED';
  copayRatio?: { insurancePercent: number; patientPercent: number };
  financialClearance?: {
    ingressFeePaid: boolean;
    ingressReceiptNumber?: string;
    amountPaid: number;
  };
  insuranceDetails?: {
    payerName?: string;
    policyNumber?: string;
    groupNumber?: string;
    memberId?: string;
    preAuthCode?: string;
    coveragePercent?: number;
    copayPercent?: number;
  };
  knownAllergies?: string[];
  stageProgress?: Record<string, any>;
  vitalsAssessment?: ComprehensiveVitals;
  soap?: SoapDocumentation;
  soapDocumentation?: SoapDocumentation;
  diagnosticOrders: DiagnosticOrderItem[];
  prescriptions: PharmacyPrescriptionItem[];
  consultationInvoice?: OpdInvoice;
  diagnosticInvoices?: OpdInvoice[];
  pharmacyInvoices?: OpdInvoice[];
  supplementalInvoices?: OpdInvoice[];
  billingMutationSequence?: number;
  billingReconciliationId?: string;
  billingReconciliationState?: 'CLEARED' | string;
  billingClosedAt?: number;
  invoice?: OpdInvoice | any;
  ledgerVouchers?: LedgerJournalVoucher[];
  dispositionData?: DispositionAndAdmission | EncounterDisposition;
  disposition?: EncounterDisposition;
  timelineEvents?: OpdTimelineEvent[];
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
  startedAt?: number;
  completedAt?: number;
  status?: 'REGISTERED' | 'IN_QUEUE' | 'IN_TRIAGE' | 'IN_CONSULTATION' | 'IN_ANCILLARY' | 'IN_BILLING' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | string;
}

export type PaymentMode = 
  | 'CASH' 
  | 'DEBIT_CREDIT_CARD' 
  | 'BANK_TRANSFER' 
  | 'RAAST_INSTANT_QR' 
  | 'INSURANCE_TP_DIRECT' 
  | 'DIGITAL_WALLET';

export type PaymentStatus = 'PENDING' | 'CAPTURED' | 'REFUNDED' | 'FAILED' | 'REVERSED';

export interface PaymentTransaction {
  id: string;
  invoiceId: string;
  amountMinorUnits: number;
  mode: PaymentMode;
  referenceNumber: string;
  status: PaymentStatus;
  processedAt: number;
  processedBy: string;
  glJournalEntryId: string;
}

export interface OpdInvoiceLineItem {
  id: string;
  serviceCode: string;
  description: string;
  category: 'REGISTRATION' | 'CONSULTATION' | 'LABORATORY' | 'RADIOLOGY' | 'PROCEDURE' | 'PHARMACY' | 'NURSING' | string;
  quantity: number;
  unitPriceMinorUnits: number;
  totalMinorUnits: number;
}

export interface OpdInvoice {
  id: string;
  tenantId: string;
  encounterId: string;
  patientId: string;
  invoiceNumber: string;
  payerTariffPlan: string;
  currency?: string;
  billingPurpose?:
    | 'OPD_CONSULTATION'
    | 'OPD_DIAGNOSTIC'
    | 'OPD_PHARMACY'
    | 'OPD_REVENUE_INTEGRITY'
    | 'FINAL_ENCOUNTER';
  sourceOrderId?: string;
  sourcePrescriptionId?: string;
  sourceFindingId?: string;
  totalAmountMinorUnits: number;
  payerCoverageAmountMinorUnits: number;
  patientCopayAmountMinorUnits: number;
  balanceDueMinorUnits: number;
  settlementStatus: 'PENDING' | 'PARTIALLY_PAID' | 'SETTLED' | 'VOIDED';
  lineItems: OpdInvoiceLineItem[];
  payments: PaymentTransaction[];
  issuedAt: number;
  issuedBy: string;
  settledAt?: number;
}

