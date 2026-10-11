import { isPatient360ClinicalSourceEvent } from './clinical-source-event-policy';
import type { Patient360Projection } from '@/types/patient360-projection';

export type Patient360PolicyInspectionStatus =
  | 'CURRENT_POLICY_MATCH'
  | 'LEGACY_NONAUTHORITATIVE_EVENT_CANDIDATE'
  | 'MISMATCH_REQUIRES_CLINICAL_REVIEW'
  | 'INCOMPLETE_GENERATION'
  | 'RAW_EVENT_LIMIT_EXCEEDED';

export interface Patient360PolicyInspectionInput {
  stored: Patient360Projection;
  canonical: Patient360Projection;
  rawEventTypes: readonly string[];
  exceededEventLimit?: boolean;
}

/**
 * Non-mutating classification only. Never return an automatic overwrite
 * authorization from this inspection; old cursors may be causally newer
 * than the clinical-only projection and require versioned CAS migration.
 */
export function classifyPatient360PolicyInspection(
  input: Patient360PolicyInspectionInput
): Patient360PolicyInspectionStatus {
  if (input.exceededEventLimit) return 'RAW_EVENT_LIMIT_EXCEEDED';
  if (input.stored.timelineGeneration && !input.stored.timelineReady) {
    return 'INCOMPLETE_GENERATION';
  }
  if (
    input.stored.tenantId !== input.canonical.tenantId ||
    input.stored.patientId !== input.canonical.patientId
  ) {
    return 'MISMATCH_REQUIRES_CLINICAL_REVIEW';
  }
  if (
    input.stored.contentHash === input.canonical.contentHash &&
    input.stored.sourceCheckpoint === input.canonical.sourceCheckpoint &&
    input.stored.revision === input.canonical.revision
  ) {
    return 'CURRENT_POLICY_MATCH';
  }
  if (
    input.rawEventTypes.some((eventType) =>
      !isPatient360ClinicalSourceEvent({ eventType })
    ) &&
    // A matching revision with different content is ambiguous; AI event
    // presence elsewhere in the record is not evidence of contamination.
    input.stored.revision > input.canonical.revision
  ) {
    return 'LEGACY_NONAUTHORITATIVE_EVENT_CANDIDATE';
  }
  return 'MISMATCH_REQUIRES_CLINICAL_REVIEW';
}
