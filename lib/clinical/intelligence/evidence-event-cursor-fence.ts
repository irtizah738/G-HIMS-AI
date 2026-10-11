import type { Patient360Projection } from '@/types/patient360-projection';
import { isPatient360ClinicalSourceEvent } from '@/lib/clinical/patient360/clinical-source-event-policy';

/**
 * A concurrently loaded event stream may be newer than the Patient 360
 * projection it accompanies. Do not attribute those future events to the
 * projection's frozen snapshot/provenance.
 *
 * Mirrors Patient360Projector's patient-scope and event-cursor ordering.
 * Missing historical events or invalid cursors fail closed.
 */
export function evidenceEventsAtProjectionCursor<T extends {
  eventId: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  payload: Record<string, unknown>;
  recordedAt?: number;
  occurredAt?: number;
}>(
  projection: Pick<Patient360Projection, 'patientId' | 'revision' | 'eventCheckpoint'>,
  events: T[]
): T[] {
  const patientEvents = events
    .filter(isPatient360ClinicalSourceEvent)
    .filter((event) =>
      String(event.payload?.patientId || '') === projection.patientId ||
      (String(event.aggregateType || '').toUpperCase().includes('PATIENT') &&
        String(event.aggregateId || '') === projection.patientId)
    );
  const checkpoint = projection.eventCheckpoint;
  if (!checkpoint) {
    if (projection.revision !== 0) {
      throw new Error('CI10_EVIDENCE_SOURCE_CURSOR_MISSING');
    }
    return [];
  }
  if (
    !checkpoint.eventId ||
    !Number.isFinite(checkpoint.recordedAt) ||
    !Number.isSafeInteger(projection.revision) ||
    projection.revision < 0
  ) {
    throw new Error('CI10_EVIDENCE_SOURCE_CURSOR_INVALID');
  }

  const scoped = patientEvents.filter((event) => {
    const recordedAt = Number(event.recordedAt || event.occurredAt || 0);
    return recordedAt < checkpoint.recordedAt ||
      (recordedAt === checkpoint.recordedAt &&
        event.eventId.localeCompare(checkpoint.eventId) <= 0);
  });
  const uniqueEventIds = new Set(scoped.map((event) => event.eventId));
  const cursorFound = scoped.some((event) =>
    event.eventId === checkpoint.eventId &&
    Number(event.recordedAt || event.occurredAt || 0) === checkpoint.recordedAt
  );
  if (
    !cursorFound ||
    uniqueEventIds.size !== scoped.length ||
    scoped.length !== projection.revision
  ) {
    throw new Error('CI10_EVIDENCE_SOURCE_REVISION_MISMATCH');
  }
  return scoped;
}
