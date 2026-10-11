/**
 * Patient 360 is a clinical read model, not an audit log of its own consumers.
 *
 * Creating an evidence snapshot is an immutable administrative/audit event,
 * but not a new clinical observation or change in the patient's chart.
 * If included in the projection/event provenance, each AI read would create
 * an event that changes its own next source hash and revision.
 *
 * Keep actual signed clinical draft/document events in the source stream.
 * Only this exact metadata event is excluded; it remains in the event store.
 */
export function isPatient360ClinicalSourceEvent(event: {
  eventType?: string;
}): boolean {
  return event.eventType !== 'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT_CREATED';
}
