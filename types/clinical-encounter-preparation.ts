import type {
  ClinicalEvidenceSourceType,
  CopilotClaimClassification,
} from '@/types/clinical-intelligence-evidence';
import type { ConsultantChangeSeverity } from '@/types/consultant-visibility';

export type EncounterPreparationSectionId =
  | 'REASON_FOR_VISIT'
  | 'ACTIVE_PROBLEMS'
  | 'CHANGES_SINCE_LAST_ENCOUNTER'
  | 'NEW_ABNORMAL_INVESTIGATIONS'
  | 'MEDICATION_CHANGES'
  | 'OUTSTANDING_WORK'
  | 'RECENT_ADMISSION_DISCHARGE'
  | 'CONTRADICTIONS'
  | 'MEDICATION_DISCREPANCIES'
  | 'MISSING_INFORMATION';

export type EncounterPreparationSectionState =
  | 'SUPPORTED'
  | 'NO_REPRESENTED_DATA'
  | 'REVIEW_REQUIRED'
  | 'PARTIAL';

export type EncounterPreparationAttention =
  | 'INFORMATION'
  | ConsultantChangeSeverity;

export interface EncounterPreparationClaim {
  claimId: string;
  sectionId: EncounterPreparationSectionId;
  text: string;
  classification: CopilotClaimClassification;
  evidenceRefs: string[];
  confidence: number;
  attention: EncounterPreparationAttention;
  caveat?: string;
  occurredAt?: number;
}

export interface EncounterPreparationSection {
  sectionId: EncounterPreparationSectionId;
  title: string;
  state: EncounterPreparationSectionState;
  claims: EncounterPreparationClaim[];
  caveats: string[];
}

export interface EncounterPreparationEvidenceIndexItem {
  evidenceId: string;
  sourceType: ClinicalEvidenceSourceType;
  sourceEntityId: string;
  label: string;
  status?: string;
  occurredAt?: number;
  provenanceStatus: 'EVENT_VERIFIED' | 'PROJECTION_ONLY';
  sourceEventIds: string[];
  contentHash: string;
  content: unknown;
}

export interface ClinicalEncounterPreparationBrief {
  briefId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  careSetting: string;
  evidenceSnapshotId: string;
  evidenceSnapshotHash: string;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  previousEncounterId?: string;
  previousEncounterAt?: number;
  lastReviewedAt?: number;
  lastReviewedRevision?: number;
  generatedAt: number;
  generatedBy: string;
  immutable: true;
  schemaVersion: 1;
  policyVersion: 'ci10c-encounter-preparation-v1';
  generationMode: 'DETERMINISTIC_EVIDENCE_SYNTHESIS';
  attentionLevel: EncounterPreparationAttention;
  sections: EncounterPreparationSection[];
  warnings: string[];
  claimCount: number;
  evidenceCoverage: {
    totalEvidenceRefs: number;
    eventVerifiedRefs: number;
    projectionOnlyRefs: number;
    sourceTypes: ClinicalEvidenceSourceType[];
  };
  safety: {
    sourceLinked: true;
    clinicianReviewRequired: true;
    autonomousDiagnosisAllowed: false;
    autonomousTreatmentAllowed: false;
    autonomousOrdersAllowed: false;
    directClinicalMutationAllowed: false;
    notePrefillAllowed: false;
  };
  contentHash: string;
}

export interface ClinicalEncounterPreparationResponse {
  brief: ClinicalEncounterPreparationBrief;
  evidenceIndex: EncounterPreparationEvidenceIndexItem[];
}
