export type CareTransitionEvidenceType =
  | 'OPD_TO_IPD_ADMISSION'
  | 'DIRECT_IPD_ADMISSION'
  | 'IPD_DISCHARGE';

export interface CareTransitionEvidence {
  careTransitionEvidenceId: string;
  tenantId: string;
  patientId: string;
  transitionType: CareTransitionEvidenceType;
  sourceEncounterId?: string;
  targetEncounterId?: string;
  inpatientEncounterId: string;
  sourceAppointmentId?: string;
  admissionHandoffId?: string;
  bedId: string;
  facilityId?: string;
  departmentId?: string;
  admissionTransitionEvidenceId?: string;
  dischargeSummaryEvidenceId?: string;
  medicationReconciliationEvidenceId?: string;
  dischargeReadinessEvaluationId?: string;
  dischargeReadinessReviewId?: string;
  patient360Revision?: number;
  patient360SourceCheckpoint?: string;
  disposition?: string;
  sourceRefs: string[];
  recordedBy: string;
  recordedAt: number;
  schemaVersion: 1;
}
