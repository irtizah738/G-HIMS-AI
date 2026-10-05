import type {
  ClinicalEvidenceSourceType,
  CopilotClaim,
} from '@/types/clinical-intelligence-evidence';

export type ClinicalTrendDirection =
  | 'INCREASING'
  | 'DECREASING'
  | 'STABLE'
  | 'VARIABLE'
  | 'NOT_COMPUTED';

export type ClinicalTrendComputationStatus =
  | 'COMPUTED'
  | 'INSUFFICIENT_DATA'
  | 'MIXED_UNITS'
  | 'MISSING_UNIT'
  | 'CONFLICTING_SAME_TIME'
  | 'INVALID_TEMPORAL_DATA';

export type ClinicalTrendExclusionReason =
  | 'PRELIMINARY'
  | 'CANCELLED'
  | 'ENTERED_IN_ERROR'
  | 'SUPERSEDED'
  | 'NON_QUANTITATIVE'
  | 'MISSING_EFFECTIVE_TIME'
  | 'FUTURE_EFFECTIVE_TIME'
  | 'DUPLICATE_IDENTICAL'
  | 'UNIDENTIFIED_METRIC';

export interface ClinicalTrendPoint {
  observationId: string;
  evidenceId: string;
  effectiveAt: number;
  value: number;
  unit: string;
  unitKey: string;
  status: string;
  interpretation?: string;
  abnormal: boolean;
  abnormalBasis?: 'SOURCE_INTERPRETATION' | 'SOURCE_REFERENCE_RANGE';
}

export interface ClinicalTrendExclusion {
  evidenceId: string;
  sourceEntityId: string;
  reason: ClinicalTrendExclusionReason;
  detail: string;
}

export interface ClinicalTrendMetric {
  metricKey: string;
  codeSystem: string;
  code: string;
  display: string;
  unit?: string;
  unitKey?: string;
  status: ClinicalTrendComputationStatus;
  direction: ClinicalTrendDirection;
  points: ClinicalTrendPoint[];
  pointCount: number;
  abnormalPointCount: number;
  firstValue?: number;
  lastValue?: number;
  minimumValue?: number;
  maximumValue?: number;
  absoluteChange?: number;
  percentChange?: number;
  elapsedMs?: number;
  slopePerDay?: number;
  evidenceRefs: string[];
  exclusions: ClinicalTrendExclusion[];
  explanation?: CopilotClaim;
  caveats: string[];
}

export interface ClinicalTrendEvidenceIndexItem {
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

export interface ClinicalTrendIntelligenceArtifact {
  artifactId: string;
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
  policyVersion: 'ci10d-clinical-trend-v1';
  generationMode: 'DETERMINISTIC_TREND_ENGINE';
  metrics: ClinicalTrendMetric[];
  computedMetricCount: number;
  nonComputableMetricCount: number;
  warnings: string[];
  safety: {
    sourceLinked: true;
    deterministicComputation: true;
    clinicianInterpretationRequired: true;
    autonomousDiagnosisAllowed: false;
    autonomousTreatmentAllowed: false;
    autonomousOrdersAllowed: false;
    directClinicalMutationAllowed: false;
  };
  contentHash: string;
}

export interface ClinicalTrendIntelligenceResponse {
  artifact: ClinicalTrendIntelligenceArtifact;
  evidenceIndex: ClinicalTrendEvidenceIndexItem[];
}
