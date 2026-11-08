/**
 * CI-EXT-12 synthetic-only end-to-end poll qualification.
 * The FHIR reader below NEVER issues a network request.
 */
import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { fhirPatientLinkId, type FhirImportActor } from '@/lib/clinical/intelligence/external-fhir-import';
import {
  runSyntheticFhirPoll, type SyntheticPollManifest,
} from '@/lib/clinical/intelligence/external-fhir-synthetic-poll-runner';

const sourceId = 'his-synthetic-poll';
const facilityId = 'synthetic-facility';
const patientId = 'synthetic-patient';
const baseUrl = 'https://synthetic-his.example.test/fhir/R4';
function obs(resourceId: string, versionId: string, date: string, value: number) {
  return {
    resourceType: 'Observation', id: resourceId, status: 'final',
    meta: { versionId, lastUpdated: date },
    subject: { reference: 'Patient/external-patient' },
    code: { coding: [{ system: 'http://loinc.org', code: '2160-0' }] },
    valueQuantity: { value, system: 'http://unitsofmeasure.org', code: 'mg/dL' },
  };
}
function makeManifest(start: number, work: Array<{
  id: string; version: string; workId: string;
}>): SyntheticPollManifest {
  return {
    manifestId: randomUUID(), sourceId, startCheckpointSequence: start,
    items: work.map(w => ({
      workId: w.workId,
      resourceType: 'Observation' as const,
      resourceId: w.id,
      expectedVersionId: w.version,
    })),
  };
}
async function fixtureTenant(tenantId: string) {
  const db = getAdminFirestore();
  if (!db) throw new Error('FHIR_POLL_EMULATOR_ADMIN_UNAVAILABLE');
  const root = db.collection('tenants').doc(tenantId);
  const actor: FhirImportActor = {
    actorId: 'synthetic-server', tenantId, roles: [],
    permissions: ['FHIR_IMPORT', 'FHIR_POLL_COORDINATE'],
    facilityIds: [facilityId],
  };
  await Promise.all([
    root.collection('patients').doc(patientId).set({ tenantId, status: 'ACTIVE' }),
    root.collection('fhirSources').doc(sourceId).set({
      tenantId, sourceId, facilityId, baseUrl,
      status: 'ACTIVE', securityReviewStatus: 'APPROVED',
      approvedResourceTypes: ['Patient', 'Encounter', 'Observation'],
      syncMode: 'FENCED', syntheticOnly: true,
    }),
    root.collection('fhirPatientLinks')
      .doc(fhirPatientLinkId(sourceId, 'external-patient')).set({
        tenantId, sourceId, facilityId, externalPatientId: 'external-patient',
        patientId, matchStatus: 'VERIFIED', consentStatus: 'GRANTED',
      }),
  ]);
  return { db, root, actor };
}
function testIsolation() {
  if (process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci') {
    throw new Error('FHIR_POLL_TEST_ISOLATION_REQUIRED');
  }
}

test('CI-EXT-12: bounded synthetic poll checkpoints only committed immutable receipts', async () => {
  testIsolation();
  const tenantId = 'synthetic-poll-' + randomUUID().slice(0, 10);
  const { db, root, actor } = await fixtureTenant(tenantId);
  const manifest = makeManifest(0, [
    { workId: randomUUID(), id: 'lab-a', version: 'v1' },
    { workId: randomUUID(), id: 'lab-b', version: 'v1' },
  ]);
  const fixtures = {
    'lab-a': obs('lab-a','v1','2026-10-20T09:00:00Z',1.1),
    'lab-b': obs('lab-b','v1','2026-10-20T10:00:00Z',1.2),
  };
  try {
    const first = await runSyntheticFhirPoll({
      db, actor, manifest,
      readFixture: async work => fixtures[work.resourceId as keyof typeof fixtures],
    });
    expect(first.status).toBe('COMPLETED');
    expect(first.processed).toBe(2);
    expect(first.checkpointSequence).toBe(2);
    expect((await root.collection('fhirSourcePollLeases').doc(sourceId).get())
      .get('status')).toBe('RELEASED');
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(2);
    expect((await root.collection('fhirImportEvents').get()).size).toBe(2);
    const previousCount = (await root.collection('fhirImportOutbox').get()).size;
    const rerun = await runSyntheticFhirPoll({
      db, actor, manifest,
      readFixture: async () => { throw new Error('ALREADY_COMPLETE_SHOULD_NOT_READ'); },
    });
    expect(rerun.processed).toBe(0);
    expect(rerun.fencingEpoch).toBe(first.fencingEpoch + 1);
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(2);
    expect((await root.collection('fhirImportOutbox').get()).size).toBe(previousCount);
    expect((await root.collection('patient360Projections').get()).empty).toBe(true);
    for (const row of (await root.collection('fhirSourcePollOutbox').get()).docs) {
      expect(row.get('status')).toBe('HELD');
    }
  } finally {
    await db.recursiveDelete(root);
  }
}, 45000);

test('CI-EXT-12: crash after receipt before checkpoint replays exactly once under new epoch', async () => {
  testIsolation();
  const tenantId = 'synthetic-crash-' + randomUUID().slice(0, 10);
  const { db, root, actor } = await fixtureTenant(tenantId);
  const manifest = makeManifest(0, [
    { workId: randomUUID(), id: 'lab-c', version: 'v1' },
  ]);
  const resource = obs('lab-c','v1','2026-10-20T09:00:00Z',1.2);
  try {
    await expect(runSyntheticFhirPoll({
      db, actor, manifest, readFixture: async () => resource,
      afterImportCommitted: async () => {
        throw new Error('SIMULATED_POWER_FAILURE_BEFORE_CHECKPOINT');
      },
    })).rejects.toThrow('SIMULATED_POWER_FAILURE_BEFORE_CHECKPOINT');
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(1);
    expect((await root.collection('fhirSourcePollLeases').doc(sourceId).get())
      .get('checkpointSequence')).toBe(0);
    // Test-only fault injection: the former worker is considered expired.
    await root.collection('fhirSourcePollLeases').doc(sourceId).update({ expiresAtMs: 0 });
    const resumed = await runSyntheticFhirPoll({
      db, actor, manifest, readFixture: async () => resource,
    });
    expect(resumed.fencingEpoch).toBe(2);
    expect(resumed.processed).toBe(1);
    expect(resumed.replayedImports).toBe(1);
    expect(resumed.checkpointSequence).toBe(1);
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(1);
    expect((await root.collection('fhirImportEvents').get()).size).toBe(1);
    expect((await root.collection('fhirSourcePollLeases').doc(sourceId).get())
      .get('status')).toBe('RELEASED');
    expect((await root.collection('patient360Projections').get()).empty).toBe(true);
  } finally {
    await db.recursiveDelete(root);
  }
}, 45000);

test('CI-EXT-12: 404 is held without checkpoint, verified later 200 recovers; 403 is not deletion', async () => {
  testIsolation();
  const tenantId = 'synthetic-absence-' + randomUUID().slice(0, 10);
  const { db, root, actor } = await fixtureTenant(tenantId);
  const current = obs('lab-d','v1','2026-10-20T09:00:00Z',1.3);
  const later = obs('lab-d','v2','2026-10-21T09:00:00Z',1.4);
  const firstManifest = makeManifest(0, [
    { workId: randomUUID(), id: 'lab-d', version: 'v1' },
  ]);
  const secondManifest = makeManifest(1, [
    { workId: randomUUID(), id: 'lab-d', version: 'v2' },
  ]);
  try {
    await runSyntheticFhirPoll({
      db, actor, manifest: firstManifest,
      readFixture: async () => current,
    });
    await expect(runSyntheticFhirPoll({
      db, actor, manifest: secondManifest,
      readFixture: async () => { throw new Error('FHIR_HTTP_404: synthetic'); },
    })).rejects.toThrow('FHIR_POLL_SOURCE_UNAVAILABLE_HELD');
    const leaseRef = root.collection('fhirSourcePollLeases').doc(sourceId);
    expect((await leaseRef.get()).get('checkpointSequence')).toBe(1);
    expect((await root.collection('fhirAvailabilityStates').get()).docs[0]
      .get('status')).toBe('SUSPECTED_ABSENCE');
    expect((await root.collection('fhirReconciliationCases').get()).docs[0]
      .get('status')).toBe('OPEN');
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(1);
    await leaseRef.update({ expiresAtMs: 0 });
    const recovered = await runSyntheticFhirPoll({
      db, actor, manifest: secondManifest, readFixture: async () => later,
    });
    expect(recovered.checkpointSequence).toBe(2);
    expect((await root.collection('fhirAvailabilityStates').get()).docs[0]
      .get('status')).toBe('AVAILABLE_CONFIRMED');
    expect((await root.collection('fhirReconciliationCases').get()).docs[0]
      .get('status')).toBe('RESOLVED');
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(2);

    const deniedManifest = makeManifest(2, [
      { workId: randomUUID(), id: 'lab-d', version: 'v3' },
    ]);
    await expect(runSyntheticFhirPoll({
      db, actor, manifest: deniedManifest,
      readFixture: async () => { throw new Error('FHIR_HTTP_403: synthetic'); },
    })).rejects.toThrow('FHIR_HTTP_403');
    expect((await leaseRef.get()).get('checkpointSequence')).toBe(2);
    expect((await root.collection('fhirReconciliationCases').get()).size).toBe(1);
    expect((await root.collection('patient360Projections').get()).empty).toBe(true);
  } finally {
    await db.recursiveDelete(root);
  }
}, 45000);

test('CI-EXT-12: erroneous source revision is retained immutably but not checkpointed', async () => {
  testIsolation();
  const tenantId = 'synthetic-error-' + randomUUID().slice(0, 10);
  const { db, root, actor } = await fixtureTenant(tenantId);
  const manifest = makeManifest(0, [
    { workId: randomUUID(), id: 'lab-e', version: 'error-v1' },
  ]);
  const incorrect = {
    ...obs('lab-e', 'error-v1', '2026-10-22T09:00:00Z', 3.2),
    status: 'entered-in-error',
  };
  try {
    await expect(runSyntheticFhirPoll({
      db, actor, manifest, readFixture: async () => incorrect,
    })).rejects.toThrow('FHIR_POLL_ERRONEOUS_RESOURCE_REQUIRES_REVIEW');
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(1);
    expect((await root.collection('fhirImportEvents').get()).size).toBe(1);
    expect((await root.collection('fhirImportOutbox').get()).docs[0]
      .get('status')).toBe('HELD');
    expect((await root.collection('fhirSourcePollLeases').doc(sourceId).get())
      .get('checkpointSequence')).toBe(0);
    expect((await root.collection('patient360Projections').get()).empty).toBe(true);
  } finally {
    await db.recursiveDelete(root);
  }
}, 45000);
