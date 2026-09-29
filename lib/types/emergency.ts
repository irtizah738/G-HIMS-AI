export type EDWorkflowStage =
  | 'ARRIVAL'
  | 'TRIAGE'
  | 'ACUITY'
  | 'VITALS'
  | 'SBAR'
  | 'ORDERS'
  | 'DIAGNOSTICS'
  | 'TREATMENT'
  | 'REASSESSMENT'
  | 'DISPOSITION';

export const ED_WORKFLOW_STAGES: {
  key: EDWorkflowStage;
  step: number;
  label: string;
  shortLabel: string;
  description: string;
  category: 'INTAKE' | 'ASSESSMENT' | 'INTERVENTION' | 'TRANSITION';
}[] = [
  {
    key: 'ARRIVAL',
    step: 1,
    label: 'Patient Arrival & Registration',
    shortLabel: 'Arrival',
    description: 'EMS / Walk-in check-in, identity establishment, trauma notification',
    category: 'INTAKE',
  },
  {
    key: 'TRIAGE',
    step: 2,
    label: 'Nurse Triage & Chief Complaint',
    shortLabel: 'Triage',
    description: 'Rapid symptom scoring, chief complaint categorization, allergy check',
    category: 'INTAKE',
  },
  {
    key: 'ACUITY',
    step: 3,
    label: 'ESI Acuity Stratification',
    shortLabel: 'Acuity',
    description: 'ESI-1 Resuscitation to ESI-5 Non-urgent risk scoring',
    category: 'ASSESSMENT',
  },
  {
    key: 'VITALS',
    step: 4,
    label: 'Continuous Vital Signs Monitoring',
    shortLabel: 'Vitals',
    description: 'Multi-parameter telemetry, Shock Index, MEWS, Glasgow Coma Scale',
    category: 'ASSESSMENT',
  },
  {
    key: 'SBAR',
    step: 5,
    label: 'SBAR Clinical Handoff',
    shortLabel: 'SBAR',
    description: 'Situation, Background, Assessment, Recommendation structured handoff',
    category: 'ASSESSMENT',
  },
  {
    key: 'ORDERS',
    step: 6,
    label: 'STAT Emergency Orders (CPOE)',
    shortLabel: 'Orders',
    description: 'STAT medication, intravenous access, fluids, respiratory therapy',
    category: 'INTERVENTION',
  },
  {
    key: 'DIAGNOSTICS',
    step: 7,
    label: 'Emergency Diagnostics (POCT / LIS / RIS)',
    shortLabel: 'Diagnostics',
    description: 'Point-of-care blood gas, cardiac biomarkers, stat CT / FAST ultrasound',
    category: 'INTERVENTION',
  },
  {
    key: 'TREATMENT',
    step: 8,
    label: 'Acute Treatment & Resuscitation',
    shortLabel: 'Treatment',
    description: 'Airway management, inotrope titration, cardioversion, wound intervention',
    category: 'INTERVENTION',
  },
  {
    key: 'REASSESSMENT',
    step: 9,
    label: 'Clinical Reassessment & Response',
    shortLabel: 'Reassess',
    description: 'Repeat vitals, pain reassessment, therapeutic response tracking',
    category: 'INTERVENTION',
  },
  {
    key: 'DISPOSITION',
    step: 10,
    label: 'Definitive Patient Disposition',
    shortLabel: 'Disposition',
    description: 'Admission to ICU/Ward, external transfer, emergency discharge with safety net',
    category: 'TRANSITION',
  },
];

export interface EDOptimizedCase {
  id: string;
  patientId?: string;
  encounterId?: string;
  mrn: string;
  patientName: string;
  age: number;
  gender: string;
  arrivalTime: string;
  arrivalMode: 'EMS_AMBULANCE' | 'WALK_IN' | 'HELICOPTER' | 'POLICE_ESCORT';
  chiefComplaint: string;
  esiLevel: 1 | 2 | 3 | 4 | 5;
  assignedBay: string;
  attendingPhysician: string;
  primaryNurse: string;
  currentStage: EDWorkflowStage;
  stageStatuses: Record<EDWorkflowStage, 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'>;
  
  // Vitals
  vitals: {
    hr: number;
    bp: string;
    spo2: number;
    rr: number;
    tempC: number;
    gcs: number;
    shockIndex: number;
    mewsScore: number;
  };

  // Critical Alerts & Overrides
  criticalAlerts: {
    stemiAlert: boolean;
    strokeAlert: boolean;
    traumaAlphaAlert: boolean;
    sepsisAlert: boolean;
    codeBlueActive: boolean;
  };

  // Emergency Overrides & Security (with auditable trail)
  breakGlassActive: boolean;
  breakGlassReason?: string;
  breakGlassAuthorizedBy?: string;
  breakGlassTimestamp?: string;
  emergencyBillingBypassed: boolean;
  emergencyBillingBypassReason?: string;
  emergencyBillingBypassAuthorizedBy?: string;
  emergencyBillingBypassTimestamp?: string;
  resuscitationInitiated: boolean;
  resuscitationTimestamp?: string;

  // SBAR
  sbar: {
    situation: string;
    background: string;
    assessment: string;
    recommendation: string;
    handoffFromDoctor?: string;
    handoffToDoctor?: string;
    handoffTimestamp?: string;
    handoffNotes?: string;
  };

  // STAT Orders
  statOrders: {
    id: string;
    type: 'MEDICATION' | 'FLUID' | 'BLOOD' | 'IMAGING' | 'LAB' | 'INTERVENTION';
    description: string;
    orderedAt: string;
    orderedBy: string;
    priority: 'STAT' | 'NOW';
    status: 'ORDERED' | 'DISPENSED' | 'ADMINISTERED';
    administeredAt?: string;
  }[];

  // Diagnostics
  diagnostics: {
    id: string;
    name: string;
    category: 'POCT' | 'LAB' | 'RADIOLOGY';
    orderedAt: string;
    resultedAt?: string;
    status: 'PENDING' | 'CRITICAL' | 'NORMAL';
    resultSummary?: string;
    criticalNotifiedPhysician?: string;
  }[];

  // Treatments
  treatments: {
    id: string;
    action: string;
    timestamp: string;
    performedBy: string;
    outcome: string;
  }[];

  // Reassessments
  reassessments: {
    id: string;
    timestamp: string;
    clinician: string;
    vitalsSummary: string;
    gcs: number;
    painScore: number; // 0-10
    clinicalImpression: string;
  }[];

  // Disposition
  disposition?: {
    type: 'ADMIT_ICU' | 'ADMIT_WARD' | 'TRANSFER_EXTERNAL' | 'DISCHARGE_HOME' | 'EMERGENCY_OR';
    destinationBedOrFacility: string;
    authorizedBy: string;
    decidedAt: string;
    transportMode?: string;
    dischargeInstructions?: string;
    followUpInDays?: number;
  };
}

export interface EDOptimizedAuditOverride {
  id: string;
  caseId: string;
  mrn: string;
  patientName: string;
  overrideType:
    | 'BREAK_GLASS_ACCESS'
    | 'EMERGENCY_BILLING_BYPASS'
    | 'RESUSCITATION_PROTOCOL_OVERRIDE'
    | 'STAT_ORDER_EMERGENCY_OVERRIDE'
    | 'PHYSICIAN_HANDOFF_TRANSFER';
  justification: string;
  authorizedBy: string;
  role: string;
  timestamp: string;
  clientIp: string;
  audited: boolean;
}
