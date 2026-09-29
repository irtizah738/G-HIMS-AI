export type DischargeReadinessState =
  | 'NOT_APPLICABLE'
  | 'BLOCKED'
  | 'REQUIRES_REVIEW'
  | 'READY_FOR_CLINICIAN_REVIEW';

export type DischargeReadinessSeverity = 'BLOCKER' | 'WARNING' | 'INFORMATION';

export type DischargeReadinessDomain =
  | 'CLINICAL_STABILITY'
  | 'DIAGNOSTICS'
  | 'MEDICATION'
  | 'CARE_PLAN'
  | 'DOCUMENTATION'
  | 'DATA_QUALITY'
  | 'OPERATIONAL';

export interface DischargeEvidenceReference {
  source: 'PATIENT360' | 'ENCOUNTER' | 'ENCOUNTER_EVIDENCE' | 'ORDER' | 'INPATIENT_ORDER';
  entityType: string;
  entityId: string;
  eventId?: string;
  occurredAt?: number;
  label?: string;
}

export interface DischargeReadinessFinding {
  findingId: string;
  severity: DischargeReadinessSeverity;
  domain: DischargeReadinessDomain;
  code: string;
  title: string;
  explanation: string;
  ruleId: string;
  ruleVersion: string;
  evidence: DischargeEvidenceReference[];
}

export interface DischargeReadinessProjection {
  tenantId: string;
  patientId: string;
  encounterId: string;
  state: DischargeReadinessState;
  blockers: DischargeReadinessFinding[];
  warnings: DischargeReadinessFinding[];
  information: DischargeReadinessFinding[];
  evaluatedAt: number;
  evaluatedThroughEventId?: string;
  patient360Revision: number;
  patient360SourceCheckpoint: string;
  rulesetVersion: string;
  engineVersion: number;
  evaluationId: string;
}

export interface DischargeReadinessEvaluation extends DischargeReadinessProjection {
  triggerEventId?: string;
  triggerEventType?: string;
  immutable: true;
}

export interface DischargeReadinessSnapshot {
  tenantId: string;
  patientId: string;
  encounterId: string;
  patient360: {
    revision: number;
    sourceCheckpoint: string;
    lastEventId?: string;
    activeEncounter?: {
      encounterId: string;
      encounterType: string;
      status: string;
    };
    currentMedicationCount: number;
    dataQuality: {
      allergyKnowledge: string;
      medicationKnowledge: string;
      problemListKnowledge: string;
      hasPreliminaryResults: boolean;
    };
  };
  encounter: Record<string, unknown>;
  encounterEvidence: Array<Record<string, unknown>>;
  diagnosticOrders: Array<Record<string, unknown>>;
  inpatientOrders: Array<Record<string, unknown>>;
}
