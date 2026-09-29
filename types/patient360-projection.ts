import type {
  ClinicalAllergy,
  ClinicalCondition,
  ClinicalDocument,
  ClinicalObservation,
  DiagnosticReport,
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
  status: string;
  department?: string;
  chiefComplaint?: string;
  startedAt?: number | string;
  completedAt?: number | string;
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
  activeEncounter?: Patient360EncounterSummary;
  recentEncounters: Patient360EncounterSummary[];
  activeProblems: Patient360ConditionSummary[];
  resolvedProblems: Patient360ConditionSummary[];
  allergies: Patient360AllergySummary[];
  currentMedications: Patient360MedicationSummary[];
  latestVitals: Patient360ObservationSummary[];
  recentResults: Patient360ResultSummary[];
  recentDocuments: Patient360DocumentSummary[];
  dataQuality: Patient360DataQuality;
  counts: {
    encounters: number;
    conditions: number;
    allergies: number;
    medicationOrders: number;
    observations: number;
    diagnosticReports: number;
    documents: number;
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
  eventId: string;
  eventType: string;
  occurredAt: number;
  summary: string;
}
