import type {
  ClinicalCareSetting,
  ConsultantChangeSeverity,
} from '@/types/consultant-visibility';
import type {
  Patient360AllergySummary,
  Patient360MedicationSummary,
  Patient360Projection,
} from '@/types/patient360-projection';

export type MedicationSafetyFindingType =
  | 'MEDICATION_ALLERGY_CONFLICT'
  | 'DUPLICATE_ACTIVE_MEDICATION'
  | 'ALLERGY_STATUS_INCOMPLETE'
  | 'MEDICATION_HISTORY_INCOMPLETE'
  | 'MEDICATION_RECONCILIATION_REQUIRED';

export type MedicationSafetyState =
  | 'CLEAR_FOR_CURRENT_EVIDENCE'
  | 'REVIEW_REQUIRED'
  | 'CRITICAL_REVIEW_REQUIRED'
  | 'DATA_INSUFFICIENT';

export interface MedicationSafetyEvidenceRef {
  source:
    | 'PATIENT360_ALLERGY'
    | 'PATIENT360_MEDICATION'
    | 'PATIENT360_KNOWLEDGE_STATUS'
    | 'PATIENT360_CARE_CONTEXT'
    | 'PRESCRIPTION_CANDIDATE';
  entityId: string;
  label: string;
  code?: string;
  system?: string;
  occurredAt?: number;
}

export interface MedicationSafetyFinding {
  findingId: string;
  tenantId: string;
  patientId: string;
  encounterId?: string;
  careSetting: ClinicalCareSetting;
  type: MedicationSafetyFindingType;
  severity: ConsultantChangeSeverity;
  title: string;
  description: string;
  medicationOrderIds: string[];
  allergyIds: string[];
  evidence: MedicationSafetyEvidenceRef[];
  ruleId: string;
  ruleVersion: number;
  requiresAcknowledgement: boolean;
  requiresOverride: boolean;
  detectedAt: number;
}

export interface MedicationSafetyProjection {
  projectionId: string;
  tenantId: string;
  patientId: string;
  encounterId?: string;
  careSetting: ClinicalCareSetting;
  state: MedicationSafetyState;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  patient360ContentHash: string;
  evaluatedAt: number;
  findings: MedicationSafetyFinding[];
  counts: {
    total: number;
    critical: number;
    actionRequired: number;
    reviewRequired: number;
  };
  limitations: string[];
}

export interface MedicationSafetyCandidate {
  drugCode: string;
  drugName: string;
  system?: string;
}

export interface MedicationSafetyCandidateEvaluation {
  patientId: string;
  encounterId: string;
  candidate: MedicationSafetyCandidate;
  findings: MedicationSafetyFinding[];
  blockingFindingIds: string[];
  acknowledgementFindingIds: string[];
  evaluatedAt: number;
}

export interface MedicationSafetyEvaluationInput {
  projection: Patient360Projection;
  candidate?: MedicationSafetyCandidate;
}

export type MedicationSafetyAllergy = Patient360AllergySummary;
export type MedicationSafetyMedication = Patient360MedicationSummary;
