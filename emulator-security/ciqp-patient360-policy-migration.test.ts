import { describe, expect, test } from 'bun:test';
import { getAdminFirestore } from '@/server/firebase/admin';
import { registerPatientAndEncounter } from '@/server/runtime/registration-orchestrator';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import {
  migratePatient360LegacyPolicyEmulator, assertEmulatorPolicyMigrationScope,
  PATIENT360_CLINICAL_POLICY_EPOCH,
} from '@/lib/clinical/patient360/ciqp-policy-migration';
import type { Patient360Projection } from '@/types/patient360-projection';

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function scoped(tenantId: string) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('CIQP_MIGRATION_TEST_REQUIRES_FIRESTORE_EMULATOR');
  process.env.GHIMS_RUNTIME_MODE = 'TEST';
  process.env.NODE_ENV = 'test';
  process.env.GHIMS_CIQP_MIGRATION_ACK = 'SYNTHETIC_EMULATOR_POLICY_MIGRATION_ONLY';
  process.env.GHIMS_CIQP_MIGRATION_TENANT_ID = tenantId;
  assertEmulatorPolicyMigrationScope(process.env, tenantId);
}

async function seededLegacy(
  tenantId: string, patientId: string,
  unsignedRoute: 'patientId' | 'primaryPatientId' | 'secondaryPatientId' | 'aggregateId' = 'patientId'
) {
  scoped(tenantId);
  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP_TEST_FIRESTORE_MISSING');
  await registerPatientAndEncounter({
    tenantId, patientId, commandId: id('cmd'), idempotencyKey: id('idem'),
    fullName: 'Synthetic Legacy Patient', gender: 'other', dateOfBirth: '1981-01-01',
    identifiers: [{ type: 'CNIC', value: (Math.floor(Math.random() * 90000000000) + 10000000000).toString() }],
    contactPhone: '+920000000000', address: 'Synthetic, never hosted',
    encounterType: 'OPD', facilityId: 'synthetic-facility',
    departmentId: 'general-medicine',
    actorId: 'synthetic-reception', actorRole: 'RECEPTIONIST', actorName: 'Synthetic',
  });
  const first = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
  expect(first.timelineReady).toBe(true);
  const tenant = db.collection('tenants').doc(tenantId);
  const snap = await tenant.collection('events').get();
  const latest = Math.max(1, ...snap.docs.map(d => Number(d.data().recordedAt || 0)));
  const eventId = id('unsigned_draft');
  const recordedAt = latest + 50000;
  await tenant.collection('events').doc(eventId).set({
    eventId, tenantId, eventType: 'CLINICAL_DRAFT_GENERATED',
    aggregateType: unsignedRoute === 'aggregateId' ? 'PATIENT' : 'CLINICAL_DRAFT',
    aggregateId: unsignedRoute === 'aggregateId' ? patientId : id('draft'),
    payload: unsignedRoute === 'aggregateId' ? {} : { [unsignedRoute]: patientId },
    recordedAt, occurredAt: recordedAt,
  });
  const ref = tenant.collection('patient360Projections').doc(patientId);
  const legacy: Patient360Projection = {
    ...first, contentHash: id('old_hash'), sourceFingerprint: id('old_fingerprint'),
    revision: first.revision + 1, eventCheckpoint: { eventId, recordedAt },
    sourceCheckpoint: `${recordedAt}:${eventId}`,
  };
  delete legacy.projectionPolicyEpoch;
  delete legacy.policyMigrationId;
  await ref.set(legacy);
  return { tenant, ref, legacy, first, eventId, recordedAt };
}

describe('CIQP-05 controlled synthetic Patient360 legacy migration (Firestore emulator)', () => {
  test('epoch CAS migrates only corroborated unsigned metadata; keeps immutable history and is idempotent', async () => {
    const tenantId = id('ciqp_tenant'), patientId = id('ciqp_patient');
    const { tenant, ref, legacy, eventId } = await seededLegacy(tenantId, patientId);
    const beforeEvents = await tenant.collection('events').get();
    const beforeCount = beforeEvents.size;

    const applied = await migratePatient360LegacyPolicyEmulator(tenantId, patientId);
    expect(applied.status).toBe('MIGRATED');
    expect(applied.previousRevision).toBe(legacy.revision);
    expect(applied.currentRevision).toBe(legacy.revision - 1);
    const published = (await ref.get()).data() as Patient360Projection;
    expect(published.projectionPolicyEpoch).toBe(PATIENT360_CLINICAL_POLICY_EPOCH);
    expect(published.timelineReady).toBe(true);
    expect(published.revision).toBe(legacy.revision - 1);
    const rows = await Patient360ProjectionService.getTimeline(tenantId, patientId, 500);
    expect(rows.every(row => row.eventId !== eventId)).toBe(true);
    expect((await tenant.collection('events').get()).size).toBe(beforeCount);
    expect((await tenant.collection('events').doc(eventId).get()).exists).toBe(true);

    const ledger = (await tenant.collection('patient360ProjectionPolicyMigrations').doc(patientId).get()).data();
    expect(ledger?.priorContentHash).toBe(legacy.contentHash);
    expect(ledger?.priorRevision).toBe(legacy.revision);
    expect(ledger?.priorSourceFingerprint).toBe(legacy.sourceFingerprint);
    expect(ledger?.status).toBe('PUBLISHED');
    const retry = await migratePatient360LegacyPolicyEmulator(tenantId, patientId);
    expect(retry.status).toBe('ALREADY_CURRENT');
    expect((await tenant.collection('patient360ProjectionPolicyMigrations').get()).size).toBe(1);
  });

  for (const route of ['primaryPatientId', 'secondaryPatientId', 'aggregateId'] as const) {
    test(`legacy corroboration recognizes the canonical ${route} event identity route`, async () => {
      const tenantId = id('ciqp_tenant'), patientId = id('ciqp_patient');
      const { tenant, eventId, legacy } = await seededLegacy(tenantId, patientId, route);
      const result = await migratePatient360LegacyPolicyEmulator(tenantId, patientId);
      expect(result.status).toBe('MIGRATED');
      expect(result.previousRevision).toBe(legacy.revision);
      expect(result.currentRevision).toBe(legacy.revision - 1);
      expect((await tenant.collection('events').doc(eventId).get()).exists).toBe(true);
    });
  }

  test('already-current migration refuses to certify missing published timeline rows', async () => {
    const tenantId = id('ciqp_tenant'), patientId = id('ciqp_patient');
    const { tenant } = await seededLegacy(tenantId, patientId);
    const first = await migratePatient360LegacyPolicyEmulator(tenantId, patientId);
    expect(first.status).toBe('MIGRATED');
    const projection = (await tenant.collection('patient360Projections').doc(patientId).get())
      .data() as Patient360Projection;
    expect(projection.timelineReady).toBe(true);
    const rows = await tenant.collection('patient360Timeline')
      .where('timelineGeneration', '==', projection.contentHash).get();
    expect(rows.size).toBeGreaterThan(0);
    await rows.docs[0].ref.delete();
    const retry = await migratePatient360LegacyPolicyEmulator(tenantId, patientId);
    expect(retry.status).toBe('BLOCKED_UNCORROBORATED');
  });

  test('crash after policy CAS blocks readers, then replay completes the same generation', async () => {
    const tenantId = id('ciqp_tenant'), patientId = id('ciqp_patient');
    const { tenant, ref } = await seededLegacy(tenantId, patientId);
    console.info('CIQP_EMULATOR_CHECKPOINT_CRASH_FIXTURE_SEEDED');
    await expect(migratePatient360LegacyPolicyEmulator(tenantId, patientId, {
      afterCommit: async () => { throw new Error('SYNTHETIC_CRASH_AFTER_CAS'); },
    })).rejects.toThrow('SYNTHETIC_CRASH_AFTER_CAS');
    console.info('CIQP_EMULATOR_CHECKPOINT_CRASH_INJECTED');
    console.info('CIQP_EMULATOR_CHECKPOINT_BEFORE_POST_CRASH_READ');
    const partial = (await ref.get()).data() as Patient360Projection;
    console.info('CIQP_EMULATOR_CHECKPOINT_AFTER_POST_CRASH_READ');
    expect(partial.projectionPolicyEpoch).toBe(2);
    expect(partial.timelineReady).toBe(false);
    console.info('CIQP_EMULATOR_CHECKPOINT_BEFORE_FAIL_CLOSED_PROJECTION_READ');
    // Explicitly await and inspect the rejection. A failed clinical read must
    // reject rather than hang, resolve with stale data, or rely on a test
    // runner's asynchronous rejection matcher.
    let failClosedReadError: unknown;
    try {
      await Patient360ProjectionService.getProjection(tenantId, patientId);
    } catch (error) {
      failClosedReadError = error;
    }
    console.info('CIQP_EMULATOR_CHECKPOINT_AFTER_FAIL_CLOSED_PROJECTION_READ');
    expect(failClosedReadError).toBeInstanceOf(Error);
    expect((failClosedReadError as Error).message).toBe('PATIENT360_TIMELINE_NOT_READY');
    console.info('CIQP_EMULATOR_CHECKPOINT_INCOMPLETE_VIEW_DENIED');
    console.info('CIQP_EMULATOR_CHECKPOINT_BEFORE_RECOVERY_RETRY');
    const recovered = await migratePatient360LegacyPolicyEmulator(tenantId, patientId);
    console.info('CIQP_EMULATOR_CHECKPOINT_RECOVERY_COMPLETED');
    expect(recovered.status).toBe('RESUMED');
    const final = (await ref.get()).data() as Patient360Projection;
    expect(final.contentHash).toBe(partial.contentHash);
    expect(final.policyMigrationId).toBe(partial.policyMigrationId);
    expect(final.timelineReady).toBe(true);
    expect((await tenant.collection('patient360ProjectionPolicyMigrations').doc(patientId).get())
      .data()?.status).toBe('PUBLISHED');
  });

  test('newly signed fact between preflight and atomic source read rejects stale migration', async () => {
    const tenantId = id('ciqp_tenant'), patientId = id('ciqp_patient');
    const { tenant, ref, legacy, recordedAt } = await seededLegacy(tenantId, patientId);
    const signedId = id('clinician_signed');
    const result = await migratePatient360LegacyPolicyEmulator(tenantId, patientId, {
      beforeTransaction: async () => {
        await tenant.collection('events').doc(signedId).set({
          eventId: signedId, tenantId, eventType: 'CLINICAL_DRAFT_SIGNED',
          aggregateType: 'PATIENT', aggregateId: patientId,
          payload: { patientId }, recordedAt: recordedAt + 1, occurredAt: recordedAt + 1,
        });
      },
    });
    expect(result.status).toBe('BLOCKED_SOURCE_CHANGED');
    expect((await ref.get()).data()?.contentHash).toBe(legacy.contentHash);
    expect((await tenant.collection('patient360ProjectionPolicyMigrations').doc(patientId).get()).exists)
      .toBe(false);
    const healed = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
    expect(healed.eventCheckpoint?.eventId).toBe(signedId);
    expect((await Patient360ProjectionService.getTimeline(tenantId, patientId))
      .some(row => row.eventId === signedId)).toBe(true);
  });

  test('a new event during finalization keeps migration publication blocked', async () => {
    const tenantId = id('ciqp_tenant'), patientId = id('ciqp_patient');
    const { tenant, ref, recordedAt } = await seededLegacy(tenantId, patientId);
    const eventId = id('new_signed_fact');
    const result = await migratePatient360LegacyPolicyEmulator(tenantId, patientId, {
      beforePublication: async () => {
        await tenant.collection('events').doc(eventId).set({
          tenantId, eventId, eventType: 'CLINICAL_DRAFT_SIGNED',
          aggregateType: 'PATIENT', aggregateId: patientId,
          payload: { patientId }, occurredAt: recordedAt + 1, recordedAt: recordedAt + 1,
        });
      },
    });
    expect(result.status).toBe('BLOCKED_CONCURRENT_WRITER');
    expect((await ref.get()).data()?.timelineReady).toBe(false);
    const rebuilt = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
    expect(rebuilt.eventCheckpoint?.eventId).toBe(eventId);
  });

  test('two workers racing on one migration cannot author two policy ledgers', async () => {
    const tenantId = id('ciqp_tenant'), patientId = id('ciqp_patient');
    const { tenant, ref } = await seededLegacy(tenantId, patientId);
    const attempts = await Promise.allSettled([
      migratePatient360LegacyPolicyEmulator(tenantId, patientId),
      migratePatient360LegacyPolicyEmulator(tenantId, patientId),
    ]);
    const statuses = attempts.filter(x => x.status === 'fulfilled')
      .map(x => x.value.status);
    expect(statuses.some(x => x === 'MIGRATED' || x === 'RESUMED')).toBe(true);
    expect((await tenant.collection('patient360ProjectionPolicyMigrations').get()).size).toBe(1);
    expect((await ref.get()).data()?.timelineReady).toBe(true);
    expect((await ref.get()).data()?.projectionPolicyEpoch).toBe(2);
  });

  test('cross-tenant writes and unexplained revisions are rejected, other tenant untouched', async () => {
    const tenantId = id('ciqp_tenant'), otherTenant = id('ciqp_tenant');
    const patientId = id('ciqp_patient');
    const { tenant, ref } = await seededLegacy(tenantId, patientId);
    const before = (await ref.get()).data() as Patient360Projection;
    expect(() => assertEmulatorPolicyMigrationScope(process.env, otherTenant))
      .toThrow('CIQP_POLICY_MIGRATION_EMULATOR_ONLY');
    await expect(migratePatient360LegacyPolicyEmulator(otherTenant, patientId))
      .rejects.toThrow('CIQP_POLICY_MIGRATION_EMULATOR_ONLY');
    const unknown = await tenant.collection('events').add({
      eventType: 'SYNTHETIC_UNCORROBORATED', tenantId, payload: { patientId },
    });
    const result = await migratePatient360LegacyPolicyEmulator(tenantId, patientId);
    expect(result.status).toBe('BLOCKED_UNCORROBORATED');
    expect((await ref.get()).data()?.contentHash).toBe(before.contentHash);
    await unknown.delete();
  });
});
