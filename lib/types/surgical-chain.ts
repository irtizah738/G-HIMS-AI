export type SurgicalChainStage =
  | 'SURGICAL_REQUEST'
  | 'ELIGIBILITY'
  | 'CREDENTIAL_CHECK'
  | 'PRIVILEGE_CHECK'
  | 'STAFFING'
  | 'RESOURCE_CHECK'
  | 'OT_AVAILABILITY'
  | 'SCHEDULING'
  | 'PRE_OP'
  | 'WHO_CHECKLIST'
  | 'PROCEDURE'
  | 'SIGN_OUT'
  | 'PACU_RESERVATION'
  | 'PACU_HANDOFF'
  | 'RECOVERY'
  | 'BED_TRANSFER'
  | 'TURNAROUND';

export interface SurgicalChainStageDefinition {
  stage: SurgicalChainStage;
  stepNumber: number;
  label: string;
  shortLabel: string;
  category: 'PRE_SURGERY' | 'SURGICAL_CHECKS' | 'INTRA_OP' | 'PACU_RECOVERY' | 'POST_OP_LOGISTICS';
  description: string;
}

export const SURGICAL_CHAIN_STAGES: SurgicalChainStageDefinition[] = [
  {
    stage: 'SURGICAL_REQUEST',
    stepNumber: 1,
    label: 'Surgical Request & Booking Order',
    shortLabel: 'Request',
    category: 'PRE_SURGERY',
    description: 'Surgeon case booking, clinical indication, CPT code, requested urgency & duration',
  },
  {
    stage: 'ELIGIBILITY',
    stepNumber: 2,
    label: 'Patient Eligibility & Consent Verification',
    shortLabel: 'Eligibility',
    category: 'PRE_SURGERY',
    description: 'Surgical informed consent, anesthesia consent, pre-anesthetic clearance, cardiac risk score',
  },
  {
    stage: 'CREDENTIAL_CHECK',
    stepNumber: 3,
    label: 'Medical Staff Credential Verification',
    shortLabel: 'Credentials',
    category: 'SURGICAL_CHECKS',
    description: 'State medical license, board certification, malpractice insurance, DEA registration verification',
  },
  {
    stage: 'PRIVILEGE_CHECK',
    stepNumber: 4,
    label: 'Specific Clinical Privilege Delineation',
    shortLabel: 'Privileges',
    category: 'SURGICAL_CHECKS',
    description: 'Verification of surgeon & anesthesiologist privileges for specific procedure / CPT code',
  },
  {
    stage: 'STAFFING',
    stepNumber: 5,
    label: 'Surgical Team Roster & Staffing Ratios',
    shortLabel: 'Staffing',
    category: 'SURGICAL_CHECKS',
    description: 'Lead surgeon, surgical assist, anesthesiologist, scrub nurse, circulating nurse assigned',
  },
  {
    stage: 'RESOURCE_CHECK',
    stepNumber: 6,
    label: 'Sterile Resources & Implant Verification',
    shortLabel: 'Resources',
    category: 'SURGICAL_CHECKS',
    description: 'CSSD sterile trays, prosthetic implants, laparoscopy tower, specialized sutures, blood crossmatch',
  },
  {
    stage: 'OT_AVAILABILITY',
    stepNumber: 7,
    label: 'Operating Theater Availability & Environmental Specs',
    shortLabel: 'OT Room',
    category: 'SURGICAL_CHECKS',
    description: 'OR suite laminar airflow, HEPA filtration, medical gas pressures, autoclave clearance',
  },
  {
    stage: 'SCHEDULING',
    stepNumber: 8,
    label: 'Formal Scheduling & Time Slot Allocation',
    shortLabel: 'Schedule',
    category: 'PRE_SURGERY',
    description: 'Locked OR block time, room allocation, patient arrival timetable, holding area reservation',
  },
  {
    stage: 'PRE_OP',
    stepNumber: 9,
    label: 'Pre-Op Holding & Anesthesia Sign-In',
    shortLabel: 'Pre-Op',
    category: 'INTRA_OP',
    description: 'NPO status verified, IV access, surgical site marking, sedation, baseline vitals check',
  },
  {
    stage: 'WHO_CHECKLIST',
    stepNumber: 10,
    label: 'WHO Surgical Safety Checklist (Sign-In & Time-Out)',
    shortLabel: 'WHO Check',
    category: 'INTRA_OP',
    description: 'Sign-In before induction, Time-Out before skin incision with complete team verbal verification',
  },
  {
    stage: 'PROCEDURE',
    stepNumber: 11,
    label: 'Intra-Operative Procedure Execution',
    shortLabel: 'Procedure',
    category: 'INTRA_OP',
    description: 'Skin-to-skin operative execution, continuous anesthesia monitoring, blood loss tracking',
  },
  {
    stage: 'SIGN_OUT',
    stepNumber: 12,
    label: 'WHO Sign-Out & Instrument Count',
    shortLabel: 'Sign-Out',
    category: 'INTRA_OP',
    description: 'Sponge/needle/instrument count verified, specimen labeling, post-op instructions recorded',
  },
  {
    stage: 'PACU_RESERVATION',
    stepNumber: 13,
    label: 'Atomic PACU Bed Allocation',
    shortLabel: 'PACU Reserve',
    category: 'PACU_RECOVERY',
    description: 'Atomic lock on available PACU bay bed; guarantees no dual allocation race condition',
  },
  {
    stage: 'PACU_HANDOFF',
    stepNumber: 14,
    label: 'Multidisciplinary PACU Handoff',
    shortLabel: 'Handoff',
    category: 'PACU_RECOVERY',
    description: 'Surgeon + Anesthetist + Circulator handoff to PACU RN, airway status, IV lines, fluid balance',
  },
  {
    stage: 'RECOVERY',
    stepNumber: 15,
    label: 'Post-Anesthesia Recovery & Aldrete Scoring',
    shortLabel: 'Recovery',
    category: 'PACU_RECOVERY',
    description: 'Phase I recovery, vital signs q15m, Aldrete score reaching >= 9 for discharge qualification',
  },
  {
    stage: 'BED_TRANSFER',
    stepNumber: 16,
    label: 'Inpatient Bed Transfer / Discharge',
    shortLabel: 'Transfer',
    category: 'POST_OP_LOGISTICS',
    description: 'Transfer to surgical ward/ICU bed or day surgery outpatient discharge',
  },
  {
    stage: 'TURNAROUND',
    stepNumber: 17,
    label: 'OR Room Terminal Cleaning & Turnaround',
    shortLabel: 'Turnaround',
    category: 'POST_OP_LOGISTICS',
    description: 'Terminal disinfection, biohazard disposal, instrument restock, room air exchange cycle',
  },
];

export interface SurgicalChainCase {
  id: string;
  room: string;
  roomId: string;
  procedureName: string;
  cptCode: string;
  patientName: string;
  patientMrn: string;
  patientId: string;
  age: number;
  gender: string;
  leadSurgeon: string;
  surgeonId: string;
  anesthesiologist: string;
  anesthesiologistId: string;
  scrubNurse: string;
  circulatingNurse: string;
  startTime: string;
  durationMinutes: number;
  currentStage: SurgicalChainStage;
  stageStatuses: Record<SurgicalChainStage, 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'>;

  // Gatekeeper Invariant Checks (Mandatory Pre-Conditions)
  safetyGates: {
    eligibilityPassed: boolean;
    credentialsVerified: boolean;
    privilegesVerified: boolean;
    staffingRatioPassed: boolean;
    sterileResourcesPassed: boolean;
    otRoomAvailable: boolean;
    whoSignInCompleted: boolean;
    whoTimeOutCompleted: boolean;
    whoSignOutCompleted: boolean;
    pacuBedReservedAtomic: boolean;
  };

  // Specific check records
  credentialRecord?: {
    licenseActive: boolean;
    boardCertification: string;
    deaRegistrationValid: boolean;
    malpracticeCoverageActive: boolean;
    verifiedAt: string;
  };

  privilegeRecord?: {
    privilegeDelineationCode: string;
    procedureAuthorized: boolean;
    proctoringRequired: boolean;
    proctoringSignedOff: boolean;
    approvedByCredentialsCommittee: string;
  };

  resourceRecord?: {
    cssdSterilityBarcode: string;
    implantsAvailableAndVerified: boolean;
    bloodUnitsCrossmatched: number;
    specialEquipmentReady: boolean;
  };

  pacuReservation?: {
    bedId: string;
    bedNumber: string;
    wardName: string;
    reservedAt: string;
    status: 'RESERVED' | 'OCCUPIED' | 'RELEASED';
    lockToken: string;
  };

  aldreteScore?: {
    activity: number;
    respiration: number;
    circulation: number;
    consciousness: number;
    o2Saturation: number;
    totalScore: number;
  };
}
