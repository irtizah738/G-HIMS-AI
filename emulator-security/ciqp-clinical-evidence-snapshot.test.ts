import { describe, expect, test } from 'bun:test';
import { getAdminFirestore } from '@/server/firebase/admin';
import { registerPatientAndEncounter } from '@/server/runtime/registration-orchestrator';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import type { CommandContext } from '@/lib/backend/types';

const unique = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

describe('CI-10A Patient 360 to immutable evidence (isolated Firestore emulator)', () => {
  test('freezes actual clinical events, writes one audited snapshot, and preserves historical snapshots across revisions', async () => {
    if (
      process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS
    ) {
      throw new Error('CI_EVIDENCE_TEST_REQUIRES_ISOLATED_LOCAL_EMULATOR');
    }
    const db = getAdminFirestore();
    if (!db) throw new Error('CI_EVIDENCE_EMULATOR_UNAVAILABLE');

    const tenantId = unique('ci_evidence_tenant');
    const patientId = unique('ci_evidence_patient');
    const registered = await registerPatientAndEncounter({
      tenantId,
      patientId,
      commandId: unique('register'),
      idempotencyKey: unique('idem'),
      fullName: 'Synthetic Evidence Boundary Patient',
      gender: 'other',
      dateOfBirth: '1985-01-01',
      identifiers: [{ type: 'CNIC', value: String(Date.now()).slice(-11) }],
      contactPhone: '+920000000000',
      address: 'Synthetic emulator-only test',
      encounterType: 'OPD',
      facilityId: 'synthetic-facility',
      departmentId: 'general-medicine',
      actorId: 'synthetic-reception',
      actorRole: 'RECEPTIONIST',
      actorName: 'Synthetic Reception',
    });

    expect(registered.patient.id).toBe(patientId);
    const before = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
    expect(before.timelineReady).toBe(true);

    const context: CommandContext = {
      tenantId,
      actorId: 'synthetic-clinician',
      roles: ['DOCTOR'],
      permissions: ['PATIENT360:READ'],
      clinicalPrivileges: ['SIGN_CLINICAL_NOTES'],
      facilityIds: ['synthetic-facility'],
      departmentIds: ['general-medicine'],
      correlationId: unique('corr'),
      requestId: unique('request'),
    };
    const tenant = db.collection('tenants').doc(tenantId);
    const initial = await ClinicalEvidenceService.createAuthoritativeSnapshot(
      context, patientId, 'LONGITUDINAL_SUMMARY'
    );

    expect(initial.tenantId).toBe(tenantId);
    expect(initial.patientId).toBe(patientId);
    expect(initial.immutable).toBe(true);
    expect(initial.patient360Revision).toBe(before.revision);
    expect(initial.patient360SourceCheckpoint).toBe(before.sourceCheckpoint);
    expect(initial.patient360ContentHash).toBe(before.contentHash);
    expect(initial.evidenceCount).toBeGreaterThan(0);

    const originalSnapshotRef = tenant
      .collection('clinicalIntelligenceEvidenceSnapshots').doc(initial.snapshotId);
    expect((await originalSnapshotRef.get()).exists).toBe(true);

    // A second generation from the unchanged chart is a replay, not a second mutation.
    const replay = await ClinicalEvidenceService.createAuthoritativeSnapshot(
      context, patientId, 'LONGITUDINAL_SUMMARY'
    );
    expect(replay.snapshotId).toBe(initial.snapshotId);
    expect(replay.snapshotHash).toBe(initial.snapshotHash);

    const auditRows = (await tenant.collection('events').get()).docs
      .map((doc) => doc.data())
      .filter((event) =>
        event.eventType === 'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT_CREATED' &&
        event.aggregateId === initial.snapshotId
      );
    expect(auditRows).toHaveLength(1);
    const [auditEvent] = auditRows;
    expect(auditEvent?.payload?.patient360Revision).toBe(before.revision);
    expect(auditEvent?.payload?.snapshotHash).toBe(initial.snapshotHash);

    const outboxes = (await tenant.collection('outbox').get()).docs
      .map((doc) => doc.data())
      .filter((row) => row.eventId === auditEvent?.eventId);
    expect(outboxes).toHaveLength(1);
    expect(outboxes[0]?.status).toBe('PENDING');
    expect(outboxes[0]?.topic).toBe('g-hims-clinical-intelligence-events');

    // Immutable AI audit must never create a clinical fact or advance the patient cursor.
    const afterAuditOnly = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
    expect(afterAuditOnly.revision).toBe(before.revision);
    expect(afterAuditOnly.contentHash).toBe(before.contentHash);
    expect(afterAuditOnly.sourceCheckpoint).toBe(before.sourceCheckpoint);
    const clinicalEvents = await Patient360ProjectionService.loadPatientEvents(tenantId, patientId);
    expect(clinicalEvents.some((event) => event.eventId === auditEvent?.eventId)).toBe(false);

    // Commit a later synthetic clinical source event; the new chart must get a new frozen snapshot.
    const sourceEventId = unique('ci_evidence_followup');
    const occurredAt = Date.now() + 20_000;
    await tenant.collection('events').doc(sourceEventId).create({
      eventId: sourceEventId,
      tenantId,
      eventType: 'SYNTHETIC_CLINICAL_FOLLOWUP',
      aggregateType: 'PATIENT',
      aggregateId: patientId,
      payload: { patientId, encounterId: registered.encounter.id },
      occurredAt,
      recordedAt: occurredAt,
    });
    const afterClinicalEvent = await Patient360ProjectionService.rebuildPatient(
      tenantId, patientId
    );
    expect(afterClinicalEvent.contentHash).not.toBe(before.contentHash);
    expect(afterClinicalEvent.timelineReady).toBe(true);

    const fresh = await ClinicalEvidenceService.createAuthoritativeSnapshot(
      context, patientId, 'LONGITUDINAL_SUMMARY'
    );
    expect(fresh.snapshotId).not.toBe(initial.snapshotId);
    expect(fresh.patient360ContentHash).toBe(afterClinicalEvent.contentHash);
    expect(fresh.patient360SourceCheckpoint).toBe(afterClinicalEvent.sourceCheckpoint);
    expect((await originalSnapshotRef.get()).data()?.snapshotHash).toBe(initial.snapshotHash);
    expect((await ClinicalEvidenceService.getSnapshot(tenantId, initial.snapshotId))?.snapshotHash)
      .toBe(initial.snapshotHash);

    // Tenant-bound evidence must never be discoverable through a different tenant's path.
    expect(await ClinicalEvidenceService.getSnapshot(unique('foreign_tenant'), initial.snapshotId))
      .toBeNull();
  });
});
