/**
 * Clinical Workflow Runtime Engine & Master Patient Index (MPI) Type Definitions
 * G-HIMS (Global Health Information Management System)
 */

export type ClinicalStageType =
  | 'REGISTRATION'
  | 'TRIAGE'
  | 'CONSULTATION'
  | 'DIAGNOSTICS_LAB_RAD'
  | 'PHARMACY_DISPENSARY'
  | 'BILLING_SETTLEMENT'
  | 'DISCHARGE_OR_REFERRAL';

export type StageExecutionStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'SKIPPED' | 'FAILED' | 'BLOCKED';

export type EncounterType =
  | 'OPD_GENERAL'
  | 'OPD_SPECIALIST'
  | 'EMERGENCY_AMBULATORY'
  | 'DAY_SURGERY'
  | 'TELEHEALTH';

export type EncounterPriority = 'ROUTINE' | 'URGENT' | 'EMERGENCY' | 'STAT';

export type ConfidentialityLevel = 'NORMAL' | 'RESTRICTED' | 'VERY_RESTRICTED';

export type MpiReconciliationStatus =
  | 'ACTIVE'
  | 'SUSPECTED_DUPLICATE'
  | 'CONFIRMED_MATCH'
  | 'MERGED_CHILD'
  | 'ARCHIVED';

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'DISPATCHED' | 'FAILED' | 'DEAD_LETTER';

export type OutboxDestinationQueue =
  | 'HL7_V2_BROKER'
  | 'FHIR_SERVER'
  | 'BILLING_SYSTEM'
  | 'NOTIFICATIONS'
  | 'AUDIT_INTEGRATION'
  | 'CLINICAL_ANALYTICS';

// ==========================================
// 1. Clinical Event Envelope Model
// ==========================================

export type ClinicalEventType =
  | 'clinical.patient.registered'
  | 'clinical.patient.mpi_updated'
  | 'clinical.patient.merged'
  | 'clinical.encounter.created'
  | 'clinical.encounter.stage_started'
  | 'clinical.encounter.stage_transitioned'
  | 'clinical.encounter.stage_completed'
  | 'clinical.vitals.recorded'
  | 'clinical.news2.alert'
  | 'clinical.consultation.soap_signed'
  | 'clinical.diagnostics.ordered'
  | 'clinical.diagnostics.result_received'
  | 'clinical.medication.prescribed'
  | 'clinical.medication.dispensed'
  | 'clinical.billing.tariff_applied'
  | 'clinical.billing.settled'
  | 'clinical.encounter.discharged'
  | 'clinical.encounter.transferred';

export interface EventProducer {
  service: string;
  userId: string;
  userName: string;
  userRole: string;
  ipAddress: string;
  facilityCode: string;
}

export interface EventMetadata {
  tenantId: string;
  confidentiality: ConfidentialityLevel;
  checksum: string;
  environment: string;
  sourceModule: string;
  retries?: number;
}

export interface ClinicalEventEnvelope<T = Record<string, any>> {
  id: string;
  specVersion: '1.0';
  tenantId: string;
  eventType: ClinicalEventType;
  aggregateType: 'PATIENT' | 'ENCOUNTER' | 'WORKFLOW_STAGE' | 'ORDER' | 'INVOICE';
  aggregateId: string;
  timestamp: string;
  producer: EventProducer;
  correlationId: string;
  causationId?: string;
  schemaVersion: string;
  payload: T;
  metadata: EventMetadata;
}

// ==========================================
// 2. Patient MPI Domain Model
// ==========================================

export interface DeterministicMatchKey {
  nationalIdHash?: string;
  dobNameHash: string;
  normalizedPhone?: string;
  soundexLastName: string;
}

export interface PatientMpiRecord {
  id: string;
  tenantId: string;
  mrn: string; // Institutional Master Record Number (e.g. MRN-METRO-2026-004812)
  nationalId?: string;
  passportNumber?: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  fullName: string;
  dateOfBirth: string; // YYYY-MM-DD
  age: number;
  gender: 'Male' | 'Female' | 'Other';
  bloodGroup: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
  phone: string;
  email?: string;
  address: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  emergencyContact: {
    name: string;
    relationship: string;
    phone: string;
  };
  allergies: string[];
  chronicConditions: string[];
  primaryPayerId?: string;
  primaryPayerName?: string;
  policyNumber?: string;
  status: MpiReconciliationStatus;
  matchKeys: DeterministicMatchKey;
  mergedIntoMrn?: string;
  mergeHistory?: {
    mergedAt: string;
    mergedBy: string;
    sourceMrn: string;
    reason: string;
  }[];
  activeEncounterId?: string;
  activeBedId?: string;
  registeredAt: string;
  updatedAt: string;
}

export interface MpiMatchScore {
  candidateId: string;
  candidateMrn: string;
  candidateName: string;
  matchScore: number; // 0 - 100
  matchedFields: string[];
  isDeterministicExact: boolean;
  confidence: 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW';
}

// ==========================================
// 3. Workflow Definition & Compilation
// ==========================================

export interface StagePrerequisite {
  field: string;
  type: 'STRING' | 'NUMBER' | 'ARRAY' | 'BOOLEAN' | 'OBJECT';
  required: boolean;
  description: string;
  validationFnName?: string;
}

export interface WorkflowGuard {
  id: string;
  name: string;
  description: string;
  guardType: 'NEWS2_CHECK' | 'VITALS_REQUIRED' | 'SOAP_COMPLETED' | 'BILLING_CLEARED' | 'ROLE_PERMISSION' | 'CUSTOM';
  evaluatorFnName: string;
  blockingMessage: string;
}

export interface WorkflowStageDef {
  id: ClinicalStageType;
  title: string;
  description: string;
  sequenceOrder: number;
  targetSlaMinutes: number;
  requiredRoles: string[];
  allowedNextStages: ClinicalStageType[];
  prerequisites: StagePrerequisite[];
  guards: WorkflowGuard[];
  autoTransitions?: {
    conditionFnName: string;
    targetStage: ClinicalStageType;
  }[];
  isTerminal?: boolean;
}

export interface WorkflowDefinition {
  id: string;
  version: string;
  name: string;
  department: string;
  encounterType: EncounterType;
  description: string;
  initialStage: ClinicalStageType;
  stages: Record<ClinicalStageType, WorkflowStageDef>;
  globalGuards: WorkflowGuard[];
  metadata: {
    author: string;
    approvedAt: string;
    clinicalProtocolCode: string;
  };
}

export interface CompiledStageNode {
  id: ClinicalStageType;
  title: string;
  sequenceOrder: number;
  targetSlaMinutes: number;
  requiredRoles: string[];
  nextStageTransitions: {
    targetStage: ClinicalStageType;
    requiredGuards: string[];
    isAutoTrigger: boolean;
  }[];
  prerequisiteFieldList: string[];
  guardList: WorkflowGuard[];
  isTerminal: boolean;
}

export interface CompiledWorkflowGraph {
  workflowId: string;
  version: string;
  initialStage: ClinicalStageType;
  stageNodes: Record<ClinicalStageType, CompiledStageNode>;
  transitionMatrix: Record<ClinicalStageType, ClinicalStageType[]>;
  totalEstimatedSlaMinutes: number;
  compiledAt: string;
}

// ==========================================
// 4. Stage Transition Resolver
// ==========================================

export interface StageTransitionRequest {
  tenantId: string;
  encounterId: string;
  currentStage: ClinicalStageType;
  targetStage: ClinicalStageType;
  initiatorUserId: string;
  initiatorUserRole: string;
  transitionData?: Record<string, any>;
  vitals?: {
    heartRate?: number;
    bloodPressure?: string;
    respiratoryRate?: number;
    temperature?: number;
    oxygenSaturation?: number;
    news2Score?: number;
  };
  billingCleared?: boolean;
  soapSigned?: boolean;
  overrideEmergency?: boolean;
}

export interface StageTransitionResult {
  allowed: boolean;
  currentStage: ClinicalStageType;
  targetStage: ClinicalStageType;
  timestamp: string;
  unmetPrerequisites: string[];
  failedGuards: {
    guardId: string;
    name: string;
    message: string;
  }[];
  warnings: string[];
  autoTriggeredNext?: ClinicalStageType;
  error?: string;
}

// ==========================================
// 5. Encounter Runtime Planning & Execution
// ==========================================

export interface CareTeamAssignment {
  attendingPhysicianId: string;
  attendingPhysicianName: string;
  triageNurseId?: string;
  triageNurseName?: string;
  careCoordinatorId?: string;
}

export interface EncounterSlaConfig {
  overallTargetDurationMinutes: number;
  stageTargets: Partial<Record<ClinicalStageType, number>>;
  alertThresholdPercent: number; // e.g. 80% SLA elapsed
}

export interface TariffPackageBinding {
  tariffId: string;
  planName: string;
  copayPercent: number;
  maxCopayCap?: number;
  authorizationCode?: string;
  verifiedBy: string;
}

export interface EncounterRuntimePlan {
  id: string;
  tenantId: string;
  patientId: string;
  patientMrn: string;
  encounterType: EncounterType;
  department: string;
  priority: EncounterPriority;
  chiefComplaint: string;
  careTeam: CareTeamAssignment;
  workflowDefinitionId: string;
  workflowVersion: string;
  slaConfig: EncounterSlaConfig;
  tariffBinding?: TariffPackageBinding;
  plannedAt: string;
}

export interface WorkflowRuntimeStage {
  id: string;
  stageType: ClinicalStageType;
  sequenceOrder: number;
  status: StageExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
  slaTargetMinutes: number;
  slaExceeded: boolean;
  performedByUserId?: string;
  performedByUserName?: string;
  stageData: Record<string, any>;
  notes?: string;
}

export interface WorkflowSnapshot {
  id: string;
  tenantId: string;
  encounterId: string;
  patientId: string;
  patientMrn: string;
  workflowDefinitionId: string;
  workflowVersion: string;
  currentStage: ClinicalStageType;
  currentStageStatus: StageExecutionStatus;
  currentStageStartedAt: string;
  completedStages: ClinicalStageType[];
  totalDwellMinutes: number;
  slaBreached: boolean;
  careTeam: CareTeamAssignment;
  transitionHistory: {
    fromStage: ClinicalStageType;
    toStage: ClinicalStageType;
    transitionedAt: string;
    userId: string;
    userName: string;
    reason?: string;
  }[];
  updatedAt: string;
}

// ==========================================
// 6. Patient Timeline Projection Model
// ==========================================

export type TimelineCategory =
  | 'REGISTRATION'
  | 'TRIAGE'
  | 'CLINICAL_NOTE'
  | 'DIAGNOSTIC'
  | 'MEDICATION'
  | 'BILLING'
  | 'ALERT'
  | 'DISCHARGE';

export interface TimelineMilestone {
  id: string;
  timestamp: string;
  category: TimelineCategory;
  title: string;
  summary: string;
  severity: 'NORMAL' | 'WARNING' | 'CRITICAL';
  stage?: ClinicalStageType;
  authorName: string;
  authorRole: string;
  dataPayload?: Record<string, any>;
  rawEventId?: string;
}

export interface TimelineStageDwellMetric {
  stage: ClinicalStageType;
  startedAt: string;
  completedAt?: string;
  durationMinutes: number;
  slaTargetMinutes: number;
  withinSla: boolean;
}

export interface PatientTimelineProjection {
  patientId: string;
  patientMrn: string;
  patientName: string;
  encounterId: string;
  encounterType: EncounterType;
  admitDate: string;
  currentStage: ClinicalStageType;
  totalDurationMinutes: number;
  milestones: TimelineMilestone[];
  dwellMetrics: TimelineStageDwellMetric[];
  criticalAlertCount: number;
  lastUpdated: string;
}

// ==========================================
// 7. Outbox Pattern Model
// ==========================================

export interface OutboxEventRecord {
  id: string;
  tenantId: string;
  destinationQueue: OutboxDestinationQueue;
  eventType: ClinicalEventType;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, any>;
  status: OutboxStatus;
  retryCount: number;
  maxRetries: number;
  scheduledFor: string;
  createdAt: string;
  processedAt?: string;
  lastError?: string;
}

// ==========================================
// 8. Atomic Transaction Bundle
// ==========================================

export interface EncounterCreationBundle {
  patientRecord: PatientMpiRecord;
  encounterPlan: EncounterRuntimePlan;
  initialSnapshot: WorkflowSnapshot;
  initialStage: WorkflowRuntimeStage;
  tokenQueueItem: {
    id: string;
    tokenNumber: string;
    patientId: string;
    patientName: string;
    mrn: string;
    department: string;
    assignedDoctor: string;
    priority: EncounterPriority;
    status: 'waiting' | 'in_consultation' | 'completed';
    arrivalTime: string;
    chiefComplaint: string;
  };
  auditEntry: Record<string, any>;
  outboxEvents: OutboxEventRecord[];
}
