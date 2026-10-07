import type { ClinicalCareSetting } from '@/types/consultant-visibility';
import type { DiseaseIntakeRiskSeverity } from '@/types/disease-intake-artifact';
import type {
  ClinicalAllergy,
  ClinicalCondition,
  ClinicalDocument,
  ClinicalObservation,
  DiagnosticOrder,
  DiagnosticReport,
  ClinicalProcedure,
  CarePlan,
  MedicationOrder,
  KnownStatus,
} from '@/types/clinical-canonical';

export interface Patient360IdentitySummary {
  patientId: string;
  mrn: string;
  fullName: string;
  dateOfBirth?: string;
  gender?: string;
  bloodGroup?: string;
  status?: string;
}

export interface Patient360EncounterSummary {
  encounterId: string;
  encounterType: string;
  careSetting: ClinicalCareSetting;
  episodeId?: string;
  sourceEncounterId?: string;
  assignedProviderId?: string;
  status: string;
  department?: string;
  facilityId?: string;
  chiefComplaint?: string;
  startedAt?: number | string;
  completedAt?: number | string;
}

export interface Patient360CareContexts {
  activeOpdEncounters: Patient360EncounterSummary[];
  activeIpdEncounter?: Patient360EncounterSummary;
  activeEmergencyEncounter?: Patient360EncounterSummary;
  activeTelehealthEncounters: Patient360EncounterSummary[];
  latestOpdEncounter?: Patient360EncounterSummary;
  latestIpdEncounter?: Patient360EncounterSummary;
  latestEmergencyEncounter?: Patient360EncounterSummary;
  latestTelehealthEncounter?: Patient360EncounterSummary;
}

export interface Patient360ConditionSummary {
  conditionId: string;
  display: string;
  code?: string;
  system?: string;
  category: ClinicalCondition['category'];
  clinicalStatus: ClinicalCondition['clinicalStatus'];
  verificationStatus: ClinicalCondition['verificationStatus'];
  onsetAt?: number;
}

export interface Patient360AllergySummary {
  allergyId: string;
  substance: string;
  code?: string;
  system?: string;
  category: ClinicalAllergy['category'];
  criticality: ClinicalAllergy['criticality'];
  verificationStatus: ClinicalAllergy['verificationStatus'];
}

export interface Patient360MedicationSummary {
  medicationOrderId: string;
  medication: string;
  code?: string;
  system?: string;
  status: MedicationOrder['status'];
  dosageText: string;
  frequency?: string;
  prescribedBy: string;
  authoredAt: number;
}

export interface Patient360ObservationSummary {
  observationId: string;
  display: string;
  code?: string;
  system?: string;
  category: ClinicalObservation['category'];
  value: ClinicalObservation['value'];
  effectiveAt: number;
  status: ClinicalObservation['status'];
  interpretation?: string;
}

export interface Patient360DiagnosticOrderSummary {
  diagnosticOrderId: string;
  display: string;
  code?: string;
  system?: string;
  orderType: DiagnosticOrder['orderType'];
  priority: DiagnosticOrder['priority'];
  status: DiagnosticOrder['status'];
  orderedBy: string;
  orderedAt: number;
}

export interface Patient360ProcedureSummary {
  procedureId: string;
  display: string;
  code?: string;
  system?: string;
  status: ClinicalProcedure['status'];
  performedAt?: number;
  performerIds: string[];
  outcome?: string;
}

export interface Patient360CarePlanSummary {
  carePlanId: string;
  title: string;
  status: CarePlan['status'];
  description?: string;
  addressesConditionIds: string[];
  activityCount: number;
  openActivityCount: number;
  authoredBy: string;
  authoredAt: number;
}

export interface Patient360ResultSummary {
  diagnosticReportId: string;
  orderId?: string;
  display: string;
  category: DiagnosticReport['category'];
  status: DiagnosticReport['status'];
  issuedAt?: number;
  conclusion?: string;
  observationIds: string[];
}

export interface Patient360DocumentSummary {
  clinicalDocumentId: string;
  documentType: ClinicalDocument['documentType'];
  status: ClinicalDocument['status'];
  title?: string;
  signedBy: string;
  signedAt: number;
}

export interface Patient360DiseaseIntakeSummary {
  intakeArtifactId: string;
  encounterId: string;
  templateId: string;
  templateName: string;
  riskSeverity: DiseaseIntakeRiskSeverity;
  riskScore: number;
  specialistTargets: string[];
  authoredBy: string;
  authoredAt: number;
  sourceRefs: string[];
}

export interface Patient360MedicationAdministrationSummary {
  administrationId: string;
  encounterId?: string;
  medicationOrderId?: string;
  medicationName: string;
  dose?: string;
  route?: string;
  outcome: string;
  scheduledFor?: number;
  administeredAt: number;
  sourceEventId: string;
}

export interface Patient360SpecialtyActivitySummary {
  activityId: string;
  domain: 'NURSING' | 'RENAL' | 'OBSTETRICS' | 'ONCOLOGY' | 'REHABILITATION';
  eventType: string;
  encounterId?: string;
  occurredAt: number;
  summary: string;
  sourceRefs: string[];
}

export interface Patient360DataQuality {
  allergyKnowledge: KnownStatus;
  problemListKnowledge: KnownStatus;
  medicationKnowledge: KnownStatus;
  lastAllergyReviewAt?: number;
  lastProblemListReviewAt?: number;
  lastMedicationReconciliationAt?: number;
  hasUnverifiedAllergies: boolean;
  hasUnverifiedProblems: boolean;
  hasPreliminaryResults: boolean;
  missingCanonicalFacts: string[];
}

export interface Patient360Projection {
  tenantId: string;
  patientId: string;
  identity: Patient360IdentitySummary;
  /**
   * Compatibility context only. New consumers must select from careContexts.
   * Preference order is IPD -> emergency -> OPD -> telehealth.
   */
  activeEncounter?: Patient360EncounterSummary;
  careContexts: Patient360CareContexts;
  recentEncounters: Patient360EncounterSummary[];
  activeProblems: Patient360ConditionSummary[];
  resolvedProblems: Patient360ConditionSummary[];
  allergies: Patient360AllergySummary[];
  currentMedications: Patient360MedicationSummary[];
  latestVitals: Patient360ObservationSummary[];
  recentDiagnosticOrders: Patient360DiagnosticOrderSummary[];
  recentResults: Patient360ResultSummary[];
  recentProcedures: Patient360ProcedureSummary[];
  activeCarePlans: Patient360CarePlanSummary[];
  recentDocuments: Patient360DocumentSummary[];
  recentDiseaseIntakes: Patient360DiseaseIntakeSummary[];
  recentMedicationAdministrations: Patient360MedicationAdministrationSummary[];
  recentSpecialtyActivities: Patient360SpecialtyActivitySummary[];
  dataQuality: Patient360DataQuality;
  counts: {
    encounters: number;
    conditions: number;
    allergies: number;
    medicationOrders: number;
    observations: number;
    diagnosticOrders: number;
    diagnosticReports: number;
    procedures: number;
    carePlans: number;
    documents: number;
    diseaseIntakes: number;
    medicationAdministrations: number;
    specialtyActivities: number;
  };
  /** Projection schema version. Increment only for a read-model contract change. */
  projectionVersion: number;
  /** Deterministic monotonic revision derived from patient-scoped authoritative events. */
  revision: number;
  /** Durable event cursor used for incremental replay/recovery. */
  eventCheckpoint?: {
    eventId: string;
    recordedAt: number;
  };
  /** Stable fingerprint of the canonical source records used to build this projection. */
  sourceFingerprint: string;
  /** Human/debug-friendly checkpoint cursor: <recordedAt>:<eventId>. */
  sourceCheckpoint: string;
  contentHash: string;
  projectedAt: number;
  lastEventId?: string;
  lastEventRecordedAt?: number;
}

export interface Patient360TimelineItem {
  timelineItemId: string;
  tenantId: string;
  patientId: string;
  encounterId?: string;
  careSetting?: ClinicalCareSetting;
  episodeId?: string;
  eventId: string;
  eventType: string;
  occurredAt: number;
  recordedAt?: number;
  summary: string;
}
