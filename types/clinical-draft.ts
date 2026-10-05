import type { AIGenerationProvenance } from '@/lib/ai/gateway';
import type { CopilotClaim } from '@/types/clinical-intelligence-evidence';
import type { ClinicalCareSetting } from '@/types/consultant-visibility';

export const CLINICAL_DRAFT_TYPES = [
  'SOAP',
  'ENCOUNTER_SUMMARY',
  'HANDOVER',
  'DISCHARGE_SUMMARY',
  'REFERRAL',
  'PATIENT_INSTRUCTIONS',
] as const;

export type ClinicalDraftType = (typeof CLINICAL_DRAFT_TYPES)[number];

export type ClinicalDraftStatus =
  | 'GENERATED_REQUIRES_REVIEW'
  | 'REVIEWED_EDITED'
  | 'APPROVED_FOR_SIGNATURE'
  | 'SIGNED'
  | 'REJECTED';

export interface ClinicalDraftSection {
  sectionId: string;
  heading: string;
  text: string;
  claims: CopilotClaim[];
}

export interface ClinicalDraftRevision {
  revisionId: string;
  draftId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  revisionNumber: number;
  source: 'AI_GENERATED' | 'CLINICIAN_EDITED';
  title: string;
  content: string;
  contentHash: string;
  sections?: ClinicalDraftSection[];
  claims: CopilotClaim[];
  createdBy: string;
  createdAt: number;
  immutable: true;
  evidenceSnapshotId: string;
  evidenceSnapshotHash: string;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
}

export interface GovernedClinicalDraft {
  draftId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  careSetting: ClinicalCareSetting;
  draftType: ClinicalDraftType;
  status: ClinicalDraftStatus;
  evidenceSnapshotId: string;
  evidenceSnapshotHash: string;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  generationPolicyVersion: string;
  generationProvenance: AIGenerationProvenance;
  generatedBy: string;
  generatedAt: number;
  currentRevisionId: string;
  currentRevisionNumber: number;
  currentTitle: string;
  currentContent: string;
  currentContentHash: string;
  generatedContentHash: string;
  warnings: string[];
  claimCount: number;
  reviewedBy?: string;
  reviewedAt?: number;
  reviewNote?: string;
  approvedBy?: string;
  approvedAt?: number;
  approvedRevisionNumber?: number;
  approvedContentHash?: string;
  signedBy?: string;
  signedAt?: number;
  signedEvidenceId?: string;
  signedClinicalDocumentId?: string;
  rejectedBy?: string;
  rejectedAt?: number;
  rejectionReason?: string;
  createdAt: number;
  updatedAt: number;
  safety: {
    nonAuthoritativeUntilSigned: true;
    qualifiedClinicianReviewRequired: true;
    clinicianEditRequiredBeforeApproval: true;
    explicitApprovalRequired: true;
    signatureRequiredForAuthority: true;
    directClinicalMutationAllowed: false;
  };
}

export interface ClinicalDraftGenerationResponse {
  draft: GovernedClinicalDraft;
  revision: ClinicalDraftRevision;
  evidenceIndex: Array<{
    evidenceId: string;
    sourceType: string;
    sourceEntityId: string;
    label: string;
    status?: string;
    occurredAt?: number;
    provenanceStatus: string;
    sourceEventIds: string[];
    contentHash: string;
    content: unknown;
  }>;
}
