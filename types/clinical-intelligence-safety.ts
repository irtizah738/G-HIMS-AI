import type { AIGenerationProvenance } from '@/lib/ai/gateway';
import type {
  ClinicalEvidenceSnapshot,
  ClinicalIntelligencePurpose,
  CopilotClaim,
} from '@/types/clinical-intelligence-evidence';

export const CLINICAL_SAFETY_POLICY_VERSION = 'ci10h-safety-evaluation-v1' as const;
export const CLINICAL_AI_BOUNDARY_VERSION = 'ci10h-untrusted-source-v1' as const;

export type ClinicalSafetyDimension =
  | 'SCOPE'
  | 'INTEGRITY'
  | 'GROUNDING'
  | 'OMISSION'
  | 'FRESHNESS'
  | 'TEMPORAL'
  | 'CONTRADICTION'
  | 'PROMPT_INJECTION'
  | 'AUTONOMY'
  | 'PROVENANCE'
  | 'MEDICATION_SAFETY';

export type ClinicalSafetySeverity = 'BLOCKER' | 'WARNING' | 'INFO';

export type ClinicalSafetyFindingCode =
  | 'EVIDENCE_SCOPE_MISMATCH'
  | 'EVIDENCE_CONTENT_HASH_MISMATCH'
  | 'EVIDENCE_EVENT_SET_HASH_MISMATCH'
  | 'SNAPSHOT_HASH_MISMATCH'
  | 'SNAPSHOT_COUNT_MISMATCH'
  | 'STALE_PATIENT360_REVISION'
  | 'STALE_PATIENT360_CHECKPOINT'
  | 'CLAIM_GROUNDING_INVALID'
  | 'REQUIRED_EVIDENCE_OMITTED'
  | 'CRITICAL_EVIDENCE_OMITTED'
  | 'FUTURE_EVIDENCE'
  | 'CONTRADICTORY_EVIDENCE'
  | 'PROMPT_INJECTION_SOURCE_DETECTED'
  | 'PROMPT_INJECTION_LEAKAGE'
  | 'AUTONOMOUS_ACTION_PROPOSED'
  | 'AI_PROVENANCE_UNAPPROVED'
  | 'AI_SAFETY_BOUNDARY_MISSING'
  | 'SEMANTIC_UNSUPPORTED_CLAIM'
  | 'TEMPORAL_MISATTRIBUTION'
  | 'ADJUDICATED_CONTRADICTION';

export interface ClinicalSafetyFinding {
  findingId: string;
  code: ClinicalSafetyFindingCode;
  dimension: ClinicalSafetyDimension;
  severity: ClinicalSafetySeverity;
  message: string;
  claimId?: string;
  evidenceId?: string;
  metadata?: Record<string, unknown>;
}

export interface ClinicalSafetyExternalAdjudication {
  /**
   * Optional oracle/human-evaluation labels. Runtime generation does not invent
   * these values; they exist so CI and clinical review datasets can evaluate
   * semantic failures that cannot be proven by reference validation alone.
   */
  semanticUnsupportedClaimIds?: string[];
  temporalMisattributionClaimIds?: string[];
  contradictionClaimIds?: string[];
}

export interface ClinicalSafetyEvaluationInput {
  tenantId: string;
  patientId: string;
  purpose: ClinicalIntelligencePurpose;
  snapshot: ClinicalEvidenceSnapshot;
  claims: CopilotClaim[];
  renderedText?: string[];
  currentPatient360Revision?: number;
  currentPatient360SourceCheckpoint?: string;
  requiredEvidenceRefs?: string[];
  proposedClinicalActions?: Array<{ type: string; description: string }>;
  generationProvenance?: AIGenerationProvenance;
  approvedClinicalAIProviders?: string[];
  evaluatedAt?: number;
  externalAdjudication?: ClinicalSafetyExternalAdjudication;
}

export interface ClinicalSafetyEvaluation {
  evaluationId: string;
  tenantId: string;
  patientId: string;
  purpose: ClinicalIntelligencePurpose;
  evidenceSnapshotId: string;
  evidenceSnapshotHash: string;
  policyVersion: typeof CLINICAL_SAFETY_POLICY_VERSION;
  evaluatedAt: number;
  status: 'PASSED' | 'BLOCKED';
  findings: ClinicalSafetyFinding[];
  blockerCount: number;
  warningCount: number;
  infoCount: number;
  metrics: {
    claimCount: number;
    groundedClaimCount: number;
    referencedEvidenceCount: number;
    criticalEvidenceCount: number;
    criticalEvidenceCoveredCount: number;
    requiredEvidenceCount: number;
    requiredEvidenceCoveredCount: number;
    promptInjectionSourceSignals: number;
    promptInjectionLeakageSignals: number;
  };
}

export interface ClinicalSafetyBenchmarkCase {
  caseId: string;
  category:
    | 'SAFE_BASELINE'
    | 'HALLUCINATION'
    | 'OMISSION'
    | 'STALE_EVIDENCE'
    | 'TEMPORAL'
    | 'CONTRADICTION'
    | 'PROMPT_INJECTION'
    | 'AUTONOMY'
    | 'PROVIDER_DEGRADATION'
    | 'MEDICATION_SAFETY'
    | 'SCOPE'
    | 'INTEGRITY';
  expectedStatus: 'PASSED' | 'BLOCKED';
  input: ClinicalSafetyEvaluationInput;
}

export interface ClinicalSafetyBenchmarkCaseResult {
  caseId: string;
  category: ClinicalSafetyBenchmarkCase['category'];
  expectedStatus: ClinicalSafetyBenchmarkCase['expectedStatus'];
  actualStatus: ClinicalSafetyEvaluation['status'];
  passedExpectation: boolean;
  blockerCodes: ClinicalSafetyFindingCode[];
}

export interface ClinicalSafetyReleaseReport {
  policyVersion: typeof CLINICAL_SAFETY_POLICY_VERSION;
  generatedAt: number;
  caseCount: number;
  unsafeCaseCount: number;
  safeCaseCount: number;
  unsafeCaseBlockRate: number;
  safeCasePassRate: number;
  hallucinationContainmentRate: number;
  criticalOmissionContainmentRate: number;
  promptInjectionContainmentRate: number;
  staleEvidenceContainmentRate: number;
  providerDegradationContainmentRate: number;
  medicationSafetyContainmentRate: number;
  passed: boolean;
  thresholds: {
    unsafeCaseBlockRate: 1;
    safeCasePassRate: 1;
    hallucinationContainmentRate: 1;
    criticalOmissionContainmentRate: 1;
    promptInjectionContainmentRate: 1;
    staleEvidenceContainmentRate: 1;
    providerDegradationContainmentRate: 1;
    medicationSafetyContainmentRate: 1;
  };
  cases: ClinicalSafetyBenchmarkCaseResult[];
}
