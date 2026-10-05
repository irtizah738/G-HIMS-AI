import type { ClinicalCareSetting, ConsultantChangeSeverity } from '@/types/consultant-visibility';
import type {
  ClinicalEvidenceSourceType,
  CopilotClaim,
} from '@/types/clinical-intelligence-evidence';

export type MedicationReconciliationFindingType =
  | 'MEDICATION_HISTORY_INCOMPLETE'
  | 'RECONCILIATION_REQUIRED'
  | 'PRE_ENCOUNTER_ACTIVE_NOT_REPRESENTED_CURRENT'
  | 'CURRENT_ORDER_REAPPEARS_AFTER_STOP'
  | 'CURRENT_ORDER_DOSE_CHANGED'
  | 'DUPLICATE_ACTIVE_MEDICATION'
  | 'MEDICATION_ALLERGY_CONFLICT'
  | 'DISPENSE_WITHOUT_MATCHING_ORDER'
  | 'DISPENSE_QUANTITY_EXCEEDS_ORDER'
  | 'ADMINISTRATION_WITHOUT_MATCHING_ORDER'
  | 'DISPENSE_EVIDENCE_NOT_REPRESENTED'
  | 'ADMINISTRATION_EVIDENCE_NOT_REPRESENTED';

export interface MedicationReconciliationFinding {
  findingId: string;
  type: MedicationReconciliationFindingType;
  severity: ConsultantChangeSeverity;
  title: string;
  description: string;
  classification: CopilotClaim['classification'];
  medicationKey?: string;
  medicationName?: string;
  evidenceRefs: string[];
  caveat?: string;
  requiresClinicianReview: true;
}

export interface MedicationReconciliationEvidenceIndexItem {
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

export interface MedicationReconciliationCopilotArtifact {
  artifactId: string;
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
  policyVersion: 'ci10e-medication-reconciliation-v1';
  generationMode: 'DETERMINISTIC_MEDICATION_RECONCILIATION';
  findings: MedicationReconciliationFinding[];
  counts: {
    total: number;
    critical: number;
    actionRequired: number;
    reviewRequired: number;
    information: number;
  };
  coverage: {
    orders: number;
    dispenses: number;
    administrations: number;
    reconciliationRecords: number;
    allergies: number;
    ci9Findings: number;
  };
  warnings: string[];
  safety: {
    sourceLinked: true;
    clinicianReviewRequired: true;
    canStartMedication: false;
    canStopMedication: false;
    canResumeMedication: false;
    canChangeDose: false;
    canCompleteReconciliation: false;
    canSignMedicationOrder: false;
    directClinicalMutationAllowed: false;
  };
  contentHash: string;
}

export interface MedicationReconciliationCopilotResponse {
  artifact: MedicationReconciliationCopilotArtifact;
  evidenceIndex: MedicationReconciliationEvidenceIndexItem[];
}
