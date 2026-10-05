import type {
  ClinicalCareSetting,
  ConsultantChangeSeverity,
} from '@/types/consultant-visibility';
import type {
  CopilotClaimClassification,
  ClinicalEvidenceSourceType,
} from '@/types/clinical-intelligence-evidence';

export type EncounterPreparationSectionId =
  | 'REASON_FOR_VISIT'
  | 'MAJOR_ACTIVE_PROBLEMS'
  | 'CHANGES_SINCE_REVIEW'
  | 'NEW_ABNORMAL_INVESTIGATIONS'
  | 'MEDICATION_CHANGES'
  | 'MEDICATION_DISCREPANCIES'
  | 'OUTSTANDING_WORK'
  | 'RECENT_ADMISSIONS_DISCHARGES'
  | 'SAFETY_SIGNALS'
  | 'CONTRADICTIONS'
  | 'MISSING_INFORMATION';

export type EncounterPreparationSectionState =
  | 'SUPPORTED'
  | 'PARTIAL'
  | 'NO_REPRESENTED_DATA'
  | 'REVIEW_REQUIRED';

export interface EncounterPreparationClaim {
  claimId: string;
  sectionId: EncounterPreparationSectionId;
  text: string;
  classification: CopilotClaimClassification;
  severity: ConsultantChangeSeverity;
  evidenceRefs: string[];
  confidence: number;
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
  careSetting: ClinicalCareSetting;
  evidenceSnapshotId: string;
  evidenceSnapshotHash: string;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  generatedAt: number;
  generatedBy: string;
  immutable: true;
  schemaVersion: 1;
  policyVersion: 'ci10c-encounter-preparation-v1';
  generationMode: 'DETERMINISTIC_EVIDENCE_SYNTHESIS';
  lastConsultantReviewAt?: number;
  lastConsultantReviewRevision?: number;
  sections: EncounterPreparationSection[];
  warnings: string[];
  claimCount: number;
  attention: {
    critical: number;
    actionRequired: number;
    reviewRequired: number;
    information: number;
  };
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
  };
  contentHash: string;
}

export interface ClinicalEncounterPreparationResponse {
  brief: ClinicalEncounterPreparationBrief;
  evidenceIndex: EncounterPreparationEvidenceIndexItem[];
}
