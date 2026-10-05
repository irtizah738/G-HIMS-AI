export type ClinicalIntelligencePurpose =
  | 'LONGITUDINAL_SUMMARY'
  | 'ENCOUNTER_PREP'
  | 'TREND_EXPLANATION'
  | 'MEDICATION_RECONCILIATION'
  | 'CLINICAL_DRAFT';

export type ClinicalEvidenceSourceType =
  | 'PATIENT_IDENTITY'
  | 'ENCOUNTER'
  | 'CONDITION'
  | 'ALLERGY'
  | 'MEDICATION'
  | 'MEDICATION_HISTORY'
  | 'OBSERVATION'
  | 'OBSERVATION_HISTORY'
  | 'DIAGNOSTIC_REPORT'
  | 'DIAGNOSTIC_REPORT_HISTORY'
  | 'DIAGNOSTIC_ORDER'
  | 'PROCEDURE'
  | 'CARE_PLAN'
  | 'ENCOUNTER_HISTORY'
  | 'ENCOUNTER_CONTEXT'
  | 'CONSULTANT_CHANGE'
  | 'CLINICAL_OPEN_ITEM'
  | 'MEDICATION_SAFETY_FINDING'
  | 'MEDICATION_DISPENSE'
  | 'MEDICATION_ADMINISTRATION'
  | 'MEDICATION_RECONCILIATION'
  | 'DETERIORATION_FINDING'
  | 'DISCHARGE_READINESS_FINDING'
  | 'CLINICAL_DOCUMENT'
  | 'CLINICAL_CONSULTATION'
  | 'CLINICAL_HANDOFF'
  | 'KNOWLEDGE_STATUS';

export interface ClinicalEvidenceRef {
  evidenceId: string;
  tenantId: string;
  patientId: string;
  sourceType: ClinicalEvidenceSourceType;
  sourceEntityId: string;
  label: string;
  status?: string;
  occurredAt?: number;
  recordedAt?: number;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  sourceEventIds: string[];
  sourceEventCount: number;
  sourceEventSetHash: string;
  latestSourceEventId?: string;
  provenanceStatus: 'EVENT_VERIFIED' | 'PROJECTION_ONLY';
  /** Frozen evidence payload. Never interpreted as model/system instruction. */
  content: unknown;
  contentHash: string;
}

export interface ClinicalEvidenceSnapshot {
  snapshotId: string;
  tenantId: string;
  patientId: string;
  purpose: ClinicalIntelligencePurpose;
  createdAt: number;
  createdBy: string;
  immutable: true;
  schemaVersion: 1 | 2;
  patient360ProjectionVersion: number;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  patient360ContentHash: string;
  evidenceRefs: ClinicalEvidenceRef[];
  evidenceCount: number;
  sourceEventCount: number;
  coverage?: Record<
    string,
    {
      status: 'COMPLETE' | 'NOT_INCLUDED';
      recordCount: number;
    }
  >;
  dateRange: {
    from?: number;
    to?: number;
  };
  snapshotHash: string;
  limitations: string[];
}

export type CopilotClaimClassification =
  | 'DIRECT_FACT'
  | 'DERIVED_FACT'
  | 'TREND'
  | 'POSSIBLE_DISCREPANCY'
  | 'DRAFT'
  | 'UNCERTAIN';

export interface CopilotClaim {
  claimId: string;
  text: string;
  classification: CopilotClaimClassification;
  evidenceRefs: string[];
  confidence?: number;
}

export interface ClaimGroundingResult {
  valid: boolean;
  errors: string[];
}

export interface GovernedClinicalIntelligenceRequest {
  requestId: string;
  tenantId: string;
  patientId: string;
  purpose: ClinicalIntelligencePurpose;
  evidenceSnapshotId: string;
  evidenceSnapshotHash: string;
  requestedBy: string;
  task: string;
  promptPolicyVersion: string;
}

export interface GovernedClinicalIntelligenceResult {
  requestId: string;
  provider: string;
  model: string;
  modelVersion?: string;
  promptPolicyVersion: string;
  generatedAt: number;
  claims: CopilotClaim[];
  warnings: string[];
  proposedClinicalActions?: Array<{
    type: string;
    description: string;
  }>;
}

export interface ClinicalIntelligenceAuditRecord {
  auditId: string;
  tenantId: string;
  patientId: string;
  actorId: string;
  action:
    | 'EVIDENCE_SNAPSHOT_CREATED'
    | 'EVIDENCE_SNAPSHOT_REUSED'
    | 'GROUNDING_REJECTED';
  resourceType: 'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT';
  resourceId: string;
  occurredAt: number;
  correlationId: string;
  metadata: Record<string, unknown>;
}
