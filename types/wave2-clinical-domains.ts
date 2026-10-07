export type MedicationAdministrationOutcome =
  | 'GIVEN'
  | 'HELD'
  | 'REFUSED'
  | 'MISSED'
  | 'DELAYED';

export interface NursingCarePlanRecord {
  carePlanId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  title: string;
  problems: string[];
  goals: string[];
  interventions: Array<{
    interventionId: string;
    description: string;
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    scheduledAt?: number;
    completedAt?: number;
  }>;
  status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
  authoredBy: string;
  authoredAt: number;
  updatedAt: number;
}

export interface RenalDialysisOrder {
  dialysisOrderId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  modality: 'HEMODIALYSIS' | 'HEMOFILTRATION' | 'HEMODIAFILTRATION' | 'PERITONEAL';
  prescribedDurationMinutes: number;
  targetUltrafiltrationMl?: number;
  anticoagulationPlan?: string;
  vascularAccessPlan: string;
  medicationOrderIds: string[];
  diagnosticReportIds: string[];
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  orderedBy: string;
  orderedAt: number;
  completedAt?: number;
  updatedAt: number;
}

export interface RenalDialysisSession {
  dialysisSessionId: string;
  dialysisOrderId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'ABORTED';
  machineId: string;
  accessDeviceId?: string;
  dialyzerLot?: string;
  reprocessingCycle?: number;
  preObservation: {
    weightKg?: number;
    systolicBp?: number;
    diastolicBp?: number;
    heartRate?: number;
  };
  postObservation?: {
    weightKg?: number;
    systolicBp?: number;
    diastolicBp?: number;
    heartRate?: number;
  };
  ultrafiltrationMl?: number;
  complications: string[];
  medicationOrderIds: string[];
  diagnosticReportIds: string[];
  startedBy: string;
  startedAt: number;
  completedBy?: string;
  completedAt?: number;
  updatedAt: number;
}

export interface ObstetricEpisode {
  obstetricEpisodeId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  gestationalAgeWeeks: number;
  gravida: number;
  para: number;
  stage: 'ADMISSION' | 'LABOR' | 'DELIVERY' | 'THEATRE' | 'POSTPARTUM' | 'COMPLETED';
  riskFactors: string[];
  escalationState: 'NONE' | 'REVIEW_REQUIRED' | 'URGENT_REVIEW' | 'THEATRE_ACTIVATED';
  createdBy: string;
  createdAt: number;
  deliveryOutcome?: {
    deliveredAt: number;
    mode: 'VAGINAL' | 'ASSISTED' | 'CESAREAN';
    newbornIds: string[];
    maternalOutcome: string;
    neonatalOutcome: string;
  };
  updatedAt: number;
}

export interface ObstetricPartogramEntry {
  partogramEntryId: string;
  obstetricEpisodeId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  observedAt: number;
  cervicalDilationCm?: number;
  fetalHeartRateBpm?: number;
  maternalHeartRateBpm?: number;
  systolicBp?: number;
  diastolicBp?: number;
  contractionsPer10Min?: number;
  membranes?: 'INTACT' | 'RUPTURED' | 'UNKNOWN';
  liquor?: 'CLEAR' | 'MECONIUM' | 'BLOOD_STAINED' | 'UNKNOWN';
  oxytocinMuPerMin?: number;
  escalationState: ObstetricEpisode['escalationState'];
  recordedBy: string;
}

export interface OncologyCase {
  oncologyCaseId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  primaryDiagnosis: string;
  diagnosisCode?: string;
  stagingSystem?: string;
  stage?: string;
  evidenceRefs: string[];
  status: 'OPEN' | 'BOARD_REVIEWED' | 'REGIMEN_APPROVED' | 'ACTIVE_TREATMENT' | 'FOLLOW_UP' | 'CLOSED';
  openedBy: string;
  openedAt: number;
  updatedAt: number;
}

export interface TumorBoardRecommendation {
  recommendationId: string;
  oncologyCaseId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  attendees: string[];
  recommendation: string;
  evidenceRefs: string[];
  recordedBy: string;
  recordedAt: number;
}

export interface OncologyRegimen {
  regimenId: string;
  oncologyCaseId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  name: string;
  cycleCount: number;
  medicationOrderIds: string[];
  recommendationId: string;
  status: 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'STOPPED';
  approvedBy: string;
  approvedAt: number;
  updatedAt: number;
}

export interface OncologyToxicityAssessment {
  toxicityAssessmentId: string;
  oncologyCaseId: string;
  regimenId?: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  grade: 0 | 1 | 2 | 3 | 4 | 5;
  findings: string[];
  action: 'CONTINUE' | 'REVIEW' | 'HOLD' | 'STOP' | 'EMERGENCY';
  assessedBy: string;
  assessedAt: number;
}

export interface RehabilitationPlan {
  rehabilitationPlanId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  disciplines: Array<'PHYSIOTHERAPY' | 'OCCUPATIONAL_THERAPY' | 'SPEECH_THERAPY' | 'CARDIAC_REHAB' | 'OTHER'>;
  goals: Array<{
    goalId: string;
    description: string;
    status: 'ACTIVE' | 'ACHIEVED' | 'NOT_ACHIEVED' | 'CANCELLED';
    targetDate?: number;
  }>;
  baselineScores: Record<string, number>;
  status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
  authoredBy: string;
  authoredAt: number;
  dischargeHandoffId?: string;
  updatedAt: number;
}

export interface RehabilitationSession {
  rehabilitationSessionId: string;
  rehabilitationPlanId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  discipline: RehabilitationPlan['disciplines'][number];
  goalIds: string[];
  performedInterventions: string[];
  functionalScores: Record<string, number>;
  outcome: string;
  status: 'COMPLETED' | 'NOT_DONE';
  notDoneReason?: string;
  therapistId: string;
  occurredAt: number;
}
