export type WardDepartment =
  | 'ICU'
  | 'General_Medicine'
  | 'General_Surgery'
  | 'Cardiology'
  | 'Orthopedics'
  | 'Maternity'
  | 'Pediatrics'
  | 'Oncology'
  | 'Emergency'
  | 'Neurology';

export interface Ward {
  id: string;
  tenantId: string;
  name: string;
  floor: string;
  building?: string;
  department: WardDepartment;
  totalBeds: number;
  nurseStationPhone?: string;
  headNurse?: string;
  attendingPhysician?: string;
  specialtyFocus?: string;
}

export type BedClass = 'general' | 'semi_private' | 'private' | 'icu';

export type BedStatus = 'available' | 'occupied' | 'cleaning' | 'maintenance' | 'reserved';

export type IsolationType = 'none' | 'contact' | 'droplet' | 'airborne';

export interface Bed {
  id: string;
  tenantId: string;
  wardId: string;
  wardName: string;
  bedNumber: string;
  roomNumber: string;
  class: BedClass;
  status: BedStatus;
  currentPatientId?: string;
  patientName?: string;
  patientMRN?: string;
  patientAge?: number;
  patientGender?: 'Male' | 'Female' | 'Other';
  currentEncounterId?: string;
  admissionDate?: string;
  expectedDischargeDate?: string;
  assignedDoctor?: string;
  assignedNurse?: string;
  primaryDiagnosis?: string;
  acuityScore?: number;
  acuityLevel?: string;
  dailyRate?: number;
  oxygenPort: boolean;
  telemetryEnabled: boolean;
  isolationType: IsolationType;
  vitalAlert?: boolean;
  notes?: string;
  lastCleanedAt?: string;
  updatedAt: string;
}

export type TransferStatus = 'pending' | 'completed' | 'cancelled';

export interface BedTransfer {
  id: string;
  tenantId: string;
  patientId: string;
  patientName: string;
  patientMRN: string;
  sourceBedId: string;
  sourceBedNumber: string;
  sourceWardId: string;
  sourceWardName: string;
  targetBedId: string;
  targetBedNumber: string;
  targetWardId: string;
  targetWardName: string;
  requestedBy: string;
  approvedBy?: string;
  reason: string;
  clinicalIndication?: string;
  status: TransferStatus;
  timestamp: string;
  completedAt?: string;
}

export type SurgicalUrgency = 'elective' | 'urgent' | 'emergency';

export type AnesthesiaType = 'general' | 'regional' | 'local' | 'mac' | 'sedation';

export type SurgicalCaseStatus =
  | 'scheduled'
  | 'pre_op'
  | 'intra_op'
  | 'post_op_pacu'
  | 'completed'
  | 'cancelled';

export interface MedicalCodeItem {
  code: string;
  description: string;
}

export interface CSSDTrayItem {
  trayId: string;
  trayName: string;
  isSterile: boolean;
  barcode: string;
}

export interface WHOChecklistStatusSummary {
  signInComplete: boolean;
  timeOutComplete: boolean;
  signOutComplete: boolean;
}

export interface SurgicalCase {
  id: string;
  tenantId: string;
  patientId: string;
  patientName: string;
  patientMRN: string;
  patientAge?: number;
  patientGender?: 'Male' | 'Female' | 'Other';
  patientBloodType?: string;
  patientAllergies?: string[];
  caseNumber?: string;
  procedureName?: string;
  cptCode?: string;
  icd10Diagnosis?: string;
  suiteId?: string;
  suiteName?: string;
  leadSurgeon?: string;
  anesthesiologist?: string;
  scrubNurse?: string;
  circulatingNurse?: string;
  stage?: string;
  whoChecklist?: WHOChecklistStatusSummary;
  whoChecklistStatus?: {
    signIn: boolean;
    timeOut: boolean;
    signOut: boolean;
  };
  cssdTrays?: CSSDTrayItem[];
  sterileTrayCount?: number;
  bloodCrossMatchedUnits?: number;
  bloodProductsCrossmatched?: number;
  priority?: string;
  pacuBedReserved?: string;
  surgeonId?: string;
  surgeonName?: string;
  anesthesiologistId?: string;
  anesthesiologistName?: string;
  scrubNurseName?: string;
  circulatingNurseName?: string;
  orRoomId?: string;
  orRoomName?: string;
  scheduledStartTime: string; // ISO String: "YYYY-MM-DDTHH:mm" or "HH:mm"
  scheduledEndTime?: string;  // ISO String: "YYYY-MM-DDTHH:mm"
  actualStartTime?: string;
  actualEndTime?: string;
  surgicalProcedureName?: string;
  procedureCategory?: string;
  icd10Codes?: MedicalCodeItem[];
  cptCodes?: MedicalCodeItem[];
  urgency?: SurgicalUrgency;
  anesthesiaType?: AnesthesiaType | string;
  status?: SurgicalCaseStatus;
  preOpDiagnosis?: string;
  postOpDiagnosis?: string;
  estimatedDurationMinutes: number;
  pacuBedAssigned?: string;
  notes?: string;
  bloodUnitsReserved?: number;
  implantRequired?: boolean;
  implantDetails?: string;
  createdAt?: string;
  updatedAt?: string;
}

// WHO Surgical Safety Checklist Structure
export interface WHOSignInRecord {
  patientConfirmedIdentitySite?: boolean;
  patientIdentityConfirmed?: boolean;
  siteMarked: boolean;
  anesthesiaSafetyCheckCompleted?: boolean;
  anesthesiaMachineCheckComplete?: boolean;
  pulseOximeterFunctioning: boolean;
  allergyKnown?: boolean;
  knownAllergy?: boolean;
  allergyDetails?: string;
  difficultAirwayRisk: boolean;
  aspirationRisk?: boolean;
  bloodLossRiskAssessed?: boolean;
  bloodLossEstimatedMl?: number;
  ivAccessAdequate?: boolean;
  verifiedByAnesthetist?: string;
  verifiedByNurse?: string;
  verifiedAt?: string;
  completed?: boolean;
}

export interface WHOTimeOutRecord {
  allTeamMembersIntroduced?: boolean;
  teamIntroductions?: boolean;
  confirmPatientNameProcedureSite?: boolean;
  verbalConfirmation?: boolean;
  anticipatedCriticalEvents?:
    | boolean
    | {
        surgeonReviewOperatingTimeSteps?: boolean;
        anesthesiaReviewPatientRisks?: boolean;
        nursingReviewSterilityEquipment?: boolean;
      };
  criticalEventsDetails?: {
    surgeonReviewOperatingTimeSteps: boolean;
    anesthesiaReviewPatientRisks: boolean;
    nursingReviewSterilityEquipment: boolean;
  };
  antibioticProphylaxisGivenWithin60Min?: boolean;
  antibioticProphylaxisGiven?: boolean;
  antibioticNameTime?: string;
  essentialImagingDisplayed?: boolean;
  imagingDisplayed?: boolean;
  sterilizationConfirmed?: boolean;
  specialEquipmentVerified?: boolean;
  verifiedBySurgeon?: string;
  verifiedByCirculator?: string;
  verifiedAt?: string;
  completed?: boolean;
}

export interface WHOSignOutRecord {
  procedureNameRecorded?: boolean;
  procedureRecorded?: boolean;
  actualProcedureName?: string;
  instrumentSpongeNeedleCountsCorrect?: boolean;
  instrumentCountCorrect?: boolean;
  specimenLabeledCorrectly?: boolean;
  specimensLabeledCorrectly?: boolean;
  specimenDetails?: string;
  equipmentProblemsAddressed?: boolean;
  keyRecoveryConcernsReviewed?: boolean;
  recoveryPlanReviewed?: boolean;
  pacuTransferPlanConfirmed?: boolean;
  verifiedByTeam?: string[];
  verifiedAt?: string;
  completed?: boolean;
}

export interface SurgicalCountItem {
  id: string;
  itemType: 'Sponge' | 'Lap_Pad' | 'Needle' | 'Blade' | 'Instrument' | 'Clip';
  initialCount: number;
  addedCount: number;
  finalCount: number;
  status: 'correct' | 'discrepancy' | 'pending';
  notes?: string;
}

export interface SurgicalImplantRecord {
  id: string;
  itemDescription: string;
  manufacturer: string;
  lotNumber: string;
  serialNumber: string;
  expiryDate: string;
  anatomicalSite: string;
  placedBy?: string;
  timestamp: string;
}

export interface AnesthesiaVitalLog {
  id: string;
  timestamp: string;
  heartRate: number;
  systolicBP: number;
  diastolicBP: number;
  spo2: number;
  etCO2: number;
  tempCelsius: number;
  gasAgentPercentage: number;
  gasAgentType: 'Sevoflurane' | 'Desflurane' | 'Isoflurane' | 'Propofol_TIVA' | 'None';
  ivFluidGivenMl: number;
  bloodLossEstimateMl: number;
  urineOutputMl: number;
  notes?: string;
}

export interface WHOChecklist {
  id: string;
  caseId: string;
  tenantId: string;
  signIn: WHOSignInRecord;
  timeOut: WHOTimeOutRecord;
  signOut: WHOSignOutRecord;
  surgicalCounts: SurgicalCountItem[];
  implants: SurgicalImplantRecord[];
  anesthesiaLogs: AnesthesiaVitalLog[];
  completedBy: string;
  completedAt?: string;
  status: 'in_progress' | 'completed' | 'signed_off';
  updatedAt: string;
}

export interface ORRoom {
  id: string;
  tenantId: string;
  name: string;
  suiteNumber: string;
  floor: string;
  status: 'available' | 'in_use' | 'turnaround' | 'maintenance';
  currentCaseId?: string;
  features: string[]; // e.g. ["HEPA Filtration", "Laminar Flow", "Robotic DaVinci Xi", "C-Arm Fluoroscopy", "Cardiopulmonary Bypass Console"]
}

export interface SurgicalStaff {
  id: string;
  name: string;
  role: 'Surgeon' | 'Anesthesiologist' | 'Scrub_Nurse' | 'Circulating_Nurse';
  specialty: string;
  licenseNumber: string;
  status: 'available' | 'in_surgery' | 'on_call' | 'off_duty';
}

export type ORConflictType =
  | 'room_overlap'
  | 'surgeon_double_booking'
  | 'anesthesiologist_double_booking'
  | 'room_turnaround_violation';

export interface ORConflict {
  id: string;
  type: ORConflictType;
  severity: 'critical' | 'warning';
  title: string;
  description: string;
  conflictingCaseId?: string;
  conflictingCaseName?: string;
  conflictingTimeRange?: string;
  resourceName: string;
}

// Aliases for compatibility
export type ORCase = SurgicalCase;
export type ORSuite = ORRoom;
export type SurgicalStage = SurgicalCaseStatus | 'pre_op_holding' | 'anesthesia_induction' | 'incision_active' | 'pacu_recovery' | 'completed' | 'turnaround';

export interface AldreteScoreRecord {
  activity: number; // 0: unable to move, 1: moves 2 extremities, 2: moves 4 extremities
  respiration: number; // 0: apneic, 1: dyspnea/shallow, 2: deep breaths/coughs
  circulation: number; // 0: BP +/- 50% baseline, 1: BP +/- 20-49%, 2: BP +/- 20%
  consciousness: number; // 0: unresponsive, 1: arousable to voice, 2: fully awake
  o2Saturation: number; // 0: <90% on O2, 1: >90% on O2, 2: >92% on room air
  totalScore: number; // 0-10
}

export interface PACUHandoff {
  id: string;
  caseId: string;
  tenantId: string;
  patientId: string;
  patientName: string;
  patientMRN: string;
  procedureName: string;
  orRoomName: string;
  pacuBedId: string;
  pacuBedNumber: string;
  pacuWardName: string;
  surgeonSignoff: string;
  anesthetistSignoff: string;
  nurseSignoff: string;
  aldreteScore: AldreteScoreRecord;
  bloodLossMl: number;
  fluidsGivenMl: number;
  postOpOrders: string[];
  recoveryNotes: string;
  airwayStatus: string;
  transferredAt: string;
  status: 'active_recovery' | 'discharged_to_ward' | 'escalated_to_icu';
}

