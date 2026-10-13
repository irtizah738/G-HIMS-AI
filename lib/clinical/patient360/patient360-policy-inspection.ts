import { isPatient360ClinicalSourceEvent } from './clinical-source-event-policy';
import type { Patient360Projection, Patient360TimelineItem } from '@/types/patient360-projection';

export type Patient360PolicyInspectionStatus =
  | 'CURRENT_POLICY_MATCH'
  | 'TIMELINE_UNVERIFIED'
  | 'TIMELINE_PARITY_MISMATCH'
  | 'LEGACY_NONAUTHORITATIVE_EVENT_CANDIDATE'
  | 'MISMATCH_REQUIRES_CLINICAL_REVIEW'
  | 'INCOMPLETE_GENERATION'
  | 'RAW_EVENT_LIMIT_EXCEEDED';

export interface Patient360PolicyInspectionInput {
  stored: Patient360Projection;
  canonical: Patient360Projection;
  rawEventTypes: readonly string[];
  exceededEventLimit?: boolean;
  /** Explicit evidence from a bounded timeline comparison; omission is not a pass. */
  timelineMatches?: boolean;
}

/**
 * Compare the actual patient-scoped published rows with the canonical
 * read-model generation. Order is deliberately ignored because publication
 * queries by occurredAt while the projector limits by recordedAt. The
 * canonical row content and cardinality must still match exactly.
 * This is inspection evidence, never a migration authorization.
 */
export function patient360TimelineParity(
  published: readonly Patient360TimelineItem[],
  canonical: readonly Patient360TimelineItem[]
): boolean {
  if (published.length !== canonical.length) return false;
  const keys = (items: readonly Patient360TimelineItem[]) => items
    .map((item) => JSON.stringify([
      item.tenantId, item.patientId, item.eventId, item.eventType,
      item.occurredAt, item.recordedAt ?? null,
      item.encounterId ?? null, item.episodeId ?? null,
      item.careSetting ?? null, item.summary,
    ]))
    .sort();
  const actual = keys(published);
  const expected = keys(canonical);
  return actual.every((value, index) => value === expected[index]);
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
    input.stored.sourceFingerprint === input.canonical.sourceFingerprint &&
    input.stored.sourceCheckpoint === input.canonical.sourceCheckpoint &&
    input.stored.revision === input.canonical.revision
  ) {
    if (input.timelineMatches === undefined) return 'TIMELINE_UNVERIFIED';
    return input.timelineMatches
      ? 'CURRENT_POLICY_MATCH'
      : 'TIMELINE_PARITY_MISMATCH';
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
