import type { Patient360Projection } from '@/types/patient360-projection';

export type DeteriorationState =
  | 'NOT_APPLICABLE'
  | 'STABLE'
  | 'WATCH'
  | 'ESCALATION_REQUIRED'
  | 'CRITICAL_REVIEW_REQUIRED';

export type DeteriorationSeverity =
  | 'INFORMATION'
  | 'WARNING'
  | 'ESCALATION'
  | 'CRITICAL';

export type DeteriorationDomain =
  | 'PHYSIOLOGY'
  | 'DIAGNOSTICS'
  | 'TRAJECTORY'
  | 'DATA_QUALITY';

export interface DeteriorationEvidenceReference {
  source:
    | 'PATIENT360'
    | 'ENCOUNTER'
    | 'ENCOUNTER_EVIDENCE'
    | 'DIAGNOSTIC_RESULT'
    | 'CLINICAL_OBSERVATION'
    | 'DIAGNOSTIC_ACKNOWLEDGEMENT';
  entityType: string;
  entityId: string;
  eventId?: string;
  occurredAt?: number;
  label?: string;
}

export interface DeteriorationFinding {
  findingId: string;
  severity: DeteriorationSeverity;
  domain: DeteriorationDomain;
  code: string;
  title: string;
  explanation: string;
  ruleId: string;
  ruleVersion: string;
  evidence: DeteriorationEvidenceReference[];
}

export interface DeteriorationSnapshot {
  tenantId: string;
  patientId: string;
  encounterId: string;
  patient360: Pick<
    Patient360Projection,
    | 'revision'
    | 'sourceCheckpoint'
    | 'lastEventId'
    | 'lastEventRecordedAt'
    | 'activeEncounter'
    | 'dataQuality'
  >;
  encounter: Record<string, unknown>;
  encounterEvidence: Array<Record<string, unknown>>;
  diagnosticResults: Array<Record<string, unknown>>;
  clinicalObservations: Array<Record<string, unknown>>;
  diagnosticAcknowledgements: Array<Record<string, unknown>>;
}

export interface DeteriorationProjection {
  evaluationId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  state: DeteriorationState;
  critical: DeteriorationFinding[];
  escalations: DeteriorationFinding[];
  warnings: DeteriorationFinding[];
  information: DeteriorationFinding[];
  evaluatedAt: number;
  evaluatedThroughEventId?: string;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  rulesetVersion: string;
  engineVersion: number;
}

export interface DeteriorationEvaluation extends DeteriorationProjection {
  triggerEventId?: string;
  triggerEventType?: string;
  immutable: true;
}
