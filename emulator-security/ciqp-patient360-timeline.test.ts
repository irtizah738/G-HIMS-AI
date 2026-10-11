import { describe, expect, test } from 'bun:test';
import { getAdminFirestore } from '@/server/firebase/admin';
import { registerPatientAndEncounter } from '@/server/runtime/registration-orchestrator';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import type { Patient360Projection } from '@/types/patient360-projection';

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

describe('CIQP-05 Patient 360 revision-fenced timeline (Firestore emulator)', () => {
  test('publishes only the latest committed source generation; stale attempts cannot mutate timeline', async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('CIQP_PATIENT360_TEST_REQUIRES_FIRESTORE_EMULATOR');
    }
    const db = getAdminFirestore();
    if (!db) throw new Error('CIQP_PATIENT360_EMULATOR_UNAVAILABLE');

    const tenantId = id('ciqp_tenant');
    const patientId = id('ciqp_patient');
    const registered = await registerPatientAndEncounter({
      tenantId,
      patientId,
      commandId: id('cmd'),
      idempotencyKey: id('idem'),
      fullName: 'Synthetic Timeline Patient',
      gender: 'other',
      dateOfBirth: '1988-01-01',
      identifiers: [{ type: 'CNIC', value: String(Date.now()).slice(-11) }],
      contactPhone: '+920000000000',
      address: 'Synthetic test only',
      encounterType: 'OPD',
      facilityId: 'synthetic-facility',
      departmentId: 'general-medicine',
      actorId: 'synthetic-reception',
      actorRole: 'RECEPTIONIST',
      actorName: 'Synthetic Reception',
    });

    expect(registered.patient.id).toBe(patientId);
    const first = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
    expect(first.timelineGeneration).toBe(first.contentHash);
    expect(first.timelineReady).toBe(true);

    const firstRows = await Patient360ProjectionService.getTimeline(tenantId, patientId);
    expect(firstRows.length).toBeGreaterThan(0);
    expect(firstRows.every(row => row.patientId === patientId)).toBe(true);

    const tenantRef = db.collection('tenants').doc(tenantId);
    const latest = (await tenantRef.collection('events').get()).docs
      .map(doc => doc.data()).reduce((a, b) => Math.max(a, Number(b.recordedAt || 0)), 0);
    const freshEventId = id('ciqp_evt');
    await tenantRef.collection('events').doc(freshEventId).set({
      eventId: freshEventId,
      tenantId,
      eventType: 'SYNTHETIC_CLINICAL_FOLLOWUP',
      aggregateType: 'PATIENT',
      aggregateId: patientId,
      payload: { patientId, encounterId: registered.encounter.id },
      occurredAt: latest + 1,
      recordedAt: latest + 1,
    });

    const second = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
    expect(second.contentHash).not.toBe(first.contentHash);
    expect(second.timelineReady).toBe(true);
    const secondRows = await Patient360ProjectionService.getTimeline(tenantId, patientId);
    expect(secondRows.length).toBeGreaterThan(firstRows.length);
    expect(secondRows.some(row => row.eventId === freshEventId)).toBe(true);

    const service = Patient360ProjectionService as unknown as {
      commitProjectionMonotonically(tenant: string, patient: string, projection: Patient360Projection): Promise<string>;
      writeTimeline(tenant: string, patient: string, timeline: typeof firstRows, projection: Patient360Projection): Promise<number>;
    };

    expect(await service.commitProjectionMonotonically(tenantId, patientId, first)).toBe('STALE');
    // The stale writer is fenced by a transaction on the live projection.
    expect(await service.writeTimeline(tenantId, patientId, firstRows, first)).toBe(0);
    const final = await Patient360ProjectionService.readClinicalView(tenantId, patientId);
    expect(final.projection?.contentHash).toBe(second.contentHash);
    expect(final.timeline.some(row => row.eventId === freshEventId)).toBe(true);
    expect(final.timeline.every(row => row.patientId === patientId)).toBe(true);
    expect(final.timeline.every(row =>
      (row as typeof row & { timelineGeneration: string }).timelineGeneration === second.contentHash
    )).toBe(true);
  });
});
