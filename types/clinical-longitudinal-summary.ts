import type {
  ClinicalEvidenceSourceType,
  CopilotClaimClassification,
} from '@/types/clinical-intelligence-evidence';

export type LongitudinalSummarySectionId =
  | 'ACTIVE_PROBLEMS'
  | 'PAST_PROBLEMS'
  | 'ALLERGIES'
  | 'CURRENT_MEDICATIONS'
  | 'MEDICATION_CHANGES'
  | 'PROCEDURES'
  | 'DIAGNOSTICS'
  | 'ABNORMAL_TRENDS'
  | 'ENCOUNTERS_ADMISSIONS'
  | 'OUTSTANDING_INVESTIGATIONS'
  | 'FOLLOW_UP'
  | 'DATA_QUALITY';

export type LongitudinalSummarySectionState =
  | 'SUPPORTED'
  | 'PARTIAL'
  | 'NO_REPRESENTED_DATA'
  | 'REVIEW_REQUIRED';

export interface LongitudinalSummaryClaim {
  claimId: string;
  sectionId: LongitudinalSummarySectionId;
  text: string;
  classification: CopilotClaimClassification;
  evidenceRefs: string[];
  confidence: number;
  caveat?: string;
  occurredAt?: number;
}

export interface LongitudinalSummarySection {
  sectionId: LongitudinalSummarySectionId;
  title: string;
  state: LongitudinalSummarySectionState;
  claims: LongitudinalSummaryClaim[];
  caveats: string[];
}

export interface LongitudinalEvidenceIndexItem {
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

export interface ClinicalLongitudinalSummary {
  summaryId: string;
  tenantId: string;
  patientId: string;
  evidenceSnapshotId: string;
  evidenceSnapshotHash: string;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  generatedAt: number;
  generatedBy: string;
  immutable: true;
  schemaVersion: 1;
  policyVersion: 'ci10b-longitudinal-summary-v1';
  generationMode: 'DETERMINISTIC_EVIDENCE_SYNTHESIS';
  sections: LongitudinalSummarySection[];
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
  };
  contentHash: string;
}

export interface ClinicalLongitudinalSummaryResponse {
  summary: ClinicalLongitudinalSummary;
  evidenceIndex: LongitudinalEvidenceIndexItem[];
}
