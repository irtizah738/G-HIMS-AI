import type { ClinicalLongitudinalSummaryResponse } from '@/types/clinical-longitudinal-summary';
import type { ClinicalEncounterPreparationResponse } from '@/types/clinical-encounter-preparation';
import type { ClinicalTrendIntelligenceResponse } from '@/types/clinical-trend-intelligence';
import type { MedicationReconciliationCopilotResponse } from '@/types/medication-reconciliation-copilot';
import type {
  ClinicalDraftGenerationResponse,
  ClinicalDraftRevision,
  GovernedClinicalDraft,
} from '@/types/clinical-draft';

export type ClinicalCopilotWorkspaceTab =
  | 'OVERVIEW'
  | 'ENCOUNTER_PREP'
  | 'LONGITUDINAL'
  | 'TRENDS'
  | 'MEDICATIONS'
  | 'DRAFTING'
  | 'EVIDENCE';

export type ClinicalCopilotArtifactKey =
  | 'ENCOUNTER_PREP'
  | 'LONGITUDINAL'
  | 'TRENDS'
  | 'MEDICATIONS'
  | 'DRAFT';

export type ClinicalCopilotArtifactState =
  | 'NOT_GENERATED'
  | 'CURRENT'
  | 'STALE'
  | 'UNAVAILABLE_OFFLINE'
  | 'ERROR';

export interface ClinicalCopilotWorkspaceArtifacts {
  longitudinal: ClinicalLongitudinalSummaryResponse | null;
  encounterPreparation: ClinicalEncounterPreparationResponse | null;
  trends: ClinicalTrendIntelligenceResponse | null;
  medicationReconciliation: MedicationReconciliationCopilotResponse | null;
  draft: ClinicalDraftGenerationResponse | null;
}

export interface ClinicalCopilotDraftCommandResponse {
  draft: GovernedClinicalDraft;
  revision?: ClinicalDraftRevision;
  evidenceId?: string;
  clinicalDocumentId?: string;
}

export interface ClinicalCopilotEvidenceDisplayItem {
  evidenceId: string;
  sourceType: string;
  sourceEntityId: string;
  label: string;
  status?: string;
  occurredAt?: number;
  provenanceStatus: string;
  sourceEventIds: string[];
  contentHash: string;
  sourceArtifact: ClinicalCopilotArtifactKey;
}
