/**
 * CIQP clinical validation workspace: independent human review of curated
 * synthetic cases only. This is not patient care, a clinical diagnosis, or an
 * approval of the numerical renal screen.
 */
export type ValidationJudgment = 'YES' | 'NO' | 'INSUFFICIENT_EVIDENCE';
export type ValidationReviewStatus = 'PENDING' | 'SUBMITTED' | 'ADJUDICATED';

export interface ValidationEvidenceItem {
  evidenceId: string;
  label: string;
  fact: string;
}

export interface ValidationSyntheticCase {
  caseId: string;
  studyId: 'renal-ciqp-synthetic-v1';
  classification: 'SYNTHETIC_ONLY';
  caseVersion: 1;
  evidence: ValidationEvidenceItem[];
  question: string;
  sourceHash: string;
  reviewerUids: [string, string];
  adjudicatorUid: string | null;
  createdAt: number;
  assignedAt?: number;
}

export interface ValidationAssessment {
  caseId: string;
  studyId: ValidationSyntheticCase['studyId'];
  actorId: string;
  kind: 'PRIMARY' | 'ADJUDICATION';
  judgment: ValidationJudgment;
  evidenceRefs: string[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  rationale: string;
  attestedQualified: true;
  attestation: string;
  createdAt: number;
  schemaVersion: 1;
}

export type ValidationBlindedAssessment = Pick<
  ValidationAssessment,
  'judgment' | 'confidence' | 'evidenceRefs' | 'rationale'
>;

export interface ValidationCaseView {
  caseId: string;
  studyId: string;
  classification: 'SYNTHETIC_ONLY';
  evidence: ValidationEvidenceItem[];
  question: string;
  role: 'REVIEWER' | 'ADJUDICATOR' | 'COORDINATOR';
  status: ValidationReviewStatus;
  myAssessment: ValidationAssessment | null;
  primaryAssessments?: ValidationBlindedAssessment[];
}

export const CIQP_VALIDATION_ROLES = [
  'DOCTOR', 'CONSULTANT', 'ATTENDING_PHYSICIAN',
] as const;
// Canonical tenant membership uses ADMINISTRATOR for the hospital admin.
// The explicit CLINICAL_VALIDATION_ADMIN permission is still mandatory;
// the user's title, email, or claimed founder status alone is not authority.
export const CIQP_VALIDATION_ADMIN_ROLES = [
  'SYSTEM_ADMIN', 'HOSPITAL_ADMIN', 'ADMINISTRATOR',
] as const;

export const CIQP_VALIDATION_STUDY_ID = 'renal-ciqp-synthetic-v1' as const;
