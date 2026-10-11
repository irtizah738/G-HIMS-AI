import { describe, expect, test } from 'bun:test';
import { evidenceEventsAtProjectionCursor } from '@/lib/clinical/intelligence/evidence-event-cursor-fence';

const patientId = 'synthetic-patient';
const event = (eventId: string, recordedAt: number, extra: Record<string, unknown> = {}) => ({
  eventId,
  eventType: 'VITALS_RECORDED',
  aggregateType: 'CLINICAL_OBSERVATION',
  aggregateId: eventId,
  payload: { patientId },
  recordedAt,
  occurredAt: recordedAt,
  ...extra,
});
const projection = {
  patientId,
  revision: 2,
  eventCheckpoint: { eventId: 'evt-b', recordedAt: 200 },
};

describe('CI-10 immutable evidence: source revision fence', () => {
  test('uses exact clinical cursor; concurrent future events never leak into provenance', () => {
    const older = event('evt-a', 100);
    const newest = event('evt-b', 200);
    const future = event('evt-c', 300);
    const audit = event('evt-ai', 150, {
      eventType: 'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT_CREATED',
    });
    const external = event('evt-other', 350, {
      payload: { patientId: 'another-patient' },
    });
    expect(evidenceEventsAtProjectionCursor(projection, [
      future, external, audit, newest, older,
    ])).toEqual([newest, older]);
  });

  test('same-time events newer than the checkpoint are excluded', () => {
    expect(evidenceEventsAtProjectionCursor(projection, [
      event('evt-c', 200), event('evt-b', 200), event('evt-a', 100),
    ]).map((item) => item.eventId)).toEqual(['evt-b', 'evt-a']);
  });

  test('missing checkpoint and missing historical events fail closed', () => {
    expect(() => evidenceEventsAtProjectionCursor(projection, [event('evt-a', 100)]))
      .toThrow('CI10_EVIDENCE_SOURCE_REVISION_MISMATCH');
    expect(() => evidenceEventsAtProjectionCursor(
      { ...projection, eventCheckpoint: undefined },
      [event('evt-a', 100)]
    )).toThrow('CI10_EVIDENCE_SOURCE_CURSOR_MISSING');
    expect(() => evidenceEventsAtProjectionCursor(
      { ...projection, eventCheckpoint: { eventId: 'evt-b', recordedAt: Number.NaN } },
      [event('evt-b', 200), event('evt-a', 100)]
    )).toThrow('CI10_EVIDENCE_SOURCE_CURSOR_INVALID');
  });

  test('duplicate event IDs are rejected rather than inflating clinical revisions', () => {
    expect(() => evidenceEventsAtProjectionCursor(projection, [
      event('evt-a', 100), event('evt-a', 100), event('evt-b', 200),
    ])).toThrow('CI10_EVIDENCE_SOURCE_REVISION_MISMATCH');
  });

  test('patient with no represented events gets an empty, not invented, source set', () => {
    expect(evidenceEventsAtProjectionCursor({
      patientId,
      revision: 0,
      eventCheckpoint: undefined,
    }, [event('evt-a', 100)])).toEqual([]);
  });
});
