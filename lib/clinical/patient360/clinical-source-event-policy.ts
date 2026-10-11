/**
 * Canonical event classification for patient-facing clinical facts.
 *
 * Immutable AI workflow audit events remain in the canonical event store and
 * outbox, but must not recursively alter clinical revision, timelines or
 * provenance. In particular, reviewed/approved drafts are non-authoritative
 * until an appropriately privileged clinician explicitly signs them.
 *
 * Do NOT exclude CLINICAL_DRAFT_SIGNED or clinical document/observation/order
 * events: signed clinical records must still advance Patient 360.
 */
const NON_AUTHORITATIVE_INTELLIGENCE_EVENTS: ReadonlySet<string> = new Set([
  'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT_CREATED',
  'CLINICAL_INTELLIGENCE_SAFETY_BLOCKED',
  'CLINICAL_DRAFT_GENERATED',
  'CLINICAL_DRAFT_REVIEWED_AND_EDITED',
  'CLINICAL_DRAFT_APPROVED_FOR_SIGNATURE',
  'CLINICAL_DRAFT_REJECTED',
]);

export function isPatient360ClinicalSourceEvent(event: {
  eventType?: string;
}): boolean {
  return !NON_AUTHORITATIVE_INTELLIGENCE_EVENTS.has(event.eventType || '');
}
