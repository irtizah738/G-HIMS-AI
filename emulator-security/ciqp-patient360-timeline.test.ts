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

    // A CI-10 evidence-snapshot event must remain durably auditable without
    // recursively changing Patient 360's clinical event cursor or evidence.
    const auditEventId = id('ciqp_snapshot_audit');
    const auditEvent = {
      eventId: auditEventId,
      tenantId,
      eventType: 'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT_CREATED',
      aggregateType: 'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT',
      aggregateId: id('cisnap'),
      payload: { patientId, snapshotHash: id('hash') },
      occurredAt: Date.now() + 10_000,
      recordedAt: Date.now() + 10_000,
    };
    await tenantRef.collection('events').doc(auditEventId).set(auditEvent);
    const ignored = await Patient360ProjectionService.refreshFromEvent(auditEvent);
    expect(ignored.status).toBe('IGNORED');
    expect(ignored.updatedPatientIds).toEqual([]);
    const auditCheckpoint = await tenantRef
      .collection('patient360ProjectionCheckpoints').doc(auditEventId).get();
    expect(auditCheckpoint.data()?.status).toBe('IGNORED');
    const afterAudit = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
    expect(afterAudit.contentHash).toBe(first.contentHash);
    expect(afterAudit.revision).toBe(first.revision);
    const filteredEvents = await Patient360ProjectionService.loadPatientEvents(tenantId, patientId);
    expect(filteredEvents.some((item) => item.eventId === auditEventId)).toBe(false);
    expect((await Patient360ProjectionService.getTimeline(tenantId, patientId)).map(x => x.eventId))
      .toEqual(firstRows.map(x => x.eventId));

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

    // Simulate an interrupted timeline publication. Readers must not see
    // partially published clinical history, and replay must restore readiness.
    const projectionRef = tenantRef.collection('patient360Projections').doc(patientId);
    await projectionRef.update({ timelineReady: false });
    await expect(Patient360ProjectionService.getProjection(tenantId, patientId))
      .rejects.toThrow('PATIENT360_TIMELINE_NOT_READY');
    await expect(Patient360ProjectionService.getTimeline(tenantId, patientId))
      .rejects.toThrow('PATIENT360_TIMELINE_NOT_READY');
    await expect(Patient360ProjectionService.readClinicalView(tenantId, patientId))
      .rejects.toThrow('PATIENT360_TIMELINE_NOT_READY');
    const healedView = await Patient360ProjectionService.readOrRebuildClinicalView(
      tenantId, patientId
    );
    expect(healedView.repairedMissingProjection).toBe(true);
    expect(healedView.projection.timelineReady).toBe(true);
    expect(healedView.projection.contentHash).toBe(second.contentHash);
    expect(healedView.timeline.map(row => row.eventId))
      .toEqual(secondRows.map(row => row.eventId));
    await projectionRef.update({ timelineReady: false });
    const repaired = await Patient360ProjectionService.getOrRebuildProjection(tenantId, patientId);
    expect(repaired?.timelineReady).toBe(true);
    expect(secondRows.some(row => row.eventId === freshEventId)).toBe(true);

    // A backlog of obsolete timeline versions must not require a new Firestore
    // composite index or truncate current events at the first page boundary.
    const obsolete = tenantRef.collection('patient360Timeline');
    for (let offset = 0; offset < 550; offset += 250) {
      const batch = db.batch();
      for (let i = offset; i < Math.min(offset + 250, 550); i++) {
        const obsoleteId = `obsolete-${i}`;
        batch.set(obsolete.doc(obsoleteId), {
          timelineItemId: obsoleteId,
          tenantId,
          patientId,
          eventId: obsoleteId,
          eventType: 'SYNTHETIC_OBSOLETE',
          occurredAt: Number.MAX_SAFE_INTEGER - i,
          summary: 'Synthetic superseded generation',
          timelineGeneration: 'obsolete-content-hash',
        });
      }
      await batch.commit();
    }
    const acrossPages = await Patient360ProjectionService.getTimeline(tenantId, patientId);
    expect(acrossPages.map(row => row.eventId)).toEqual(secondRows.map(row => row.eventId));
    expect(acrossPages.some(row => row.eventType === 'SYNTHETIC_OBSOLETE')).toBe(false);

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
