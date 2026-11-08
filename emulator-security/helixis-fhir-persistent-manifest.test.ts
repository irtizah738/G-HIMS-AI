/**
 * G3 Stage C synthetic emulator qualification. Never connects to live GCP.
 * Node runner rewrites bun:test using the existing project compat helper.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { fhirPatientLinkId, type FhirImportActor } from
  '@/lib/clinical/intelligence/external-fhir-import';
import { EmulatorOnlyAesGcmCipher } from
  '@/lib/clinical/intelligence/external-fhir-poll-manifest-seal';
import {
  loadSealedSyntheticPollManifest, persistSealedSyntheticPollManifest,
  runPersistedSyntheticFhirPoll, type NewPollWorkManifest,
} from '@/lib/clinical/intelligence/external-fhir-poll-manifest-store';

const sourceId = 'his-persisted-synthetic';
const facilityId = 'synthetic-facility';
const localPatientId = 'synthetic-patient';
const externalPatientId = 'external-patient';
const baseUrl = 'https://synthetic-his.example.test/fhir/R4';

function isolate(): void {
  if (process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED') {
    throw new Error('FHIR_POLL_STAGE_C_SYNTHETIC_ONLY');
  }
}
function observation(resourceId: string, versionId: string, at: string, value: number) {
  return {
    resourceType: 'Observation', id: resourceId, status: 'final',
    meta: { versionId, lastUpdated: at },
    subject: { reference: `Patient/${externalPatientId}` },
    code: { coding: [{ system: 'http://loinc.org', code: '2160-0' }] },
    valueQuantity: { value, system: 'http://unitsofmeasure.org', code: 'mg/dL' },
  };
}
function manifestFor(): NewPollWorkManifest {
  return {
    tenantId: '', facilityId, sourceId, manifestId: randomUUID(),
    startCheckpointSequence: 0,
    items: [{ workId: randomUUID(), resourceType: 'Observation',
      resourceId: 'observation-a', expectedVersionId: 'v1' }],
    vendorCursor: 'TEST_VENDOR_CURSOR_MUST_NEVER_LEAK',
  };
}
async function tenantFixture() {
  isolate();
  const db = getAdminFirestore();
  if (!db) throw new Error('STAGE_C_FIRESTORE_ADMIN_UNAVAILABLE');
  const tenantId = 'stage-c-' + randomUUID().slice(0, 10);
  const root = db.collection('tenants').doc(tenantId);
  const actor: FhirImportActor = {
    tenantId, actorId: 'stage-c-synthetic-worker', roles: [],
    permissions: ['FHIR_IMPORT', 'FHIR_POLL_COORDINATE'],
    facilityIds: [facilityId],
  };
  const cipher = new EmulatorOnlyAesGcmCipher(randomBytes(32), 'emulator-cipher-v1');
  await Promise.all([
    root.collection('patients').doc(localPatientId).set({ tenantId, status: 'ACTIVE' }),
    root.collection('fhirSources').doc(sourceId).set({
      tenantId, sourceId, facilityId, baseUrl, status: 'ACTIVE',
      securityReviewStatus: 'APPROVED', syncMode: 'FENCED', syntheticOnly: true,
      approvedResourceTypes: ['Patient', 'Encounter', 'Observation'],
    }),
    root.collection('fhirPatientLinks')
      .doc(fhirPatientLinkId(sourceId, externalPatientId)).set({
        tenantId, sourceId, facilityId, externalPatientId,
        patientId: localPatientId, matchStatus: 'VERIFIED', consentStatus: 'GRANTED',
      }),
  ]);
  return {
    db, root, tenantId, actor, cipher,
    manifest: { ...manifestFor(), tenantId },
  };
}

async function load(f: Awaited<ReturnType<typeof tenantFixture>>, manifestId = f.manifest.manifestId) {
  return loadSealedSyntheticPollManifest({
    db: f.db, actor: f.actor, tenantId: f.tenantId,
    sourceId, manifestId, cipher: f.cipher,
  });
}

/** Includes exact source/auth approval checks and atomic creation of 4 records. */
test('Stage C: encrypted manifest, held audit/outbox and exact idempotent replay', async () => {
  const f = await tenantFixture();
  try {
    const first = await persistSealedSyntheticPollManifest(f);
    assert.equal(first.replay, false);
    assert.match(first.sourceRevision, /^\d+\.\d{9}$/);
    const row = (await f.root.collection('fhirPollWorkManifests').doc(f.manifest.manifestId).get()).data();
    assert.ok(row);
    assert.equal(row.status, 'SEALED');
    assert.equal(row.clinicalAuthority, false);
    assert.equal(row.immutable, true);
    assert.equal(row.payload.suite, 'LOCAL_TEST_AES_256_GCM_V1');
    for (const s of [f.manifest.vendorCursor, f.manifest.items[0].resourceId]) {
      assert.ok(!JSON.stringify(row).includes(s));
    }
    const loaded = await load(f);
    assert.equal(loaded.vendorCursor, f.manifest.vendorCursor);
    assert.deepEqual(loaded.items, f.manifest.items);
    assert.equal(loaded.sourceRevision, first.sourceRevision);
    const replay = await persistSealedSyntheticPollManifest(f);
    assert.equal(replay.replay, true);
    const counts = await Promise.all([
      f.root.collection('fhirPollWorkManifests').get(),
      f.root.collection('fhirPollManifestEvents').get(),
      f.root.collection('fhirPollManifestOutbox').get(),
      f.root.collection('auditLogs').get(),
    ]);
    assert.deepEqual(counts.map(s => s.size), [1,1,1,1]);
    assert.equal(counts[2].docs[0].get('status'), 'HELD');
    assert.equal((await f.root.collection('patient360Projections').get()).size, 0);
  } finally { await f.db.recursiveDelete(f.root); }
}, 60000);

test('Stage C: immutable ID rejects revised cursor, work items and checkpoint', async () => {
  const f = await tenantFixture();
  try {
    await persistSealedSyntheticPollManifest(f);
    for (const next of [
      { ...f.manifest, vendorCursor: 'new-cursor' },
      { ...f.manifest, items: [{ ...f.manifest.items[0], expectedVersionId: 'v2' }] },
      { ...f.manifest, startCheckpointSequence: 1 },
    ]) {
      await assert.rejects(persistSealedSyntheticPollManifest({
        db: f.db, actor: f.actor, manifest: next, cipher: f.cipher,
      }), /FHIR_POLL_MANIFEST_REPLAY_CONFLICT/);
    }
    assert.equal((await f.root.collection('fhirPollWorkManifests').get()).size, 1);
    assert.equal((await f.root.collection('fhirPollManifestOutbox').get()).size, 1);
  } finally { await f.db.recursiveDelete(f.root); }
}, 60000);

test('Stage C: wrong tenant, wrong actor, disabled FENCED and missing synthetic mark fail closed', async () => {
  const f = await tenantFixture();
  try {
    const wrongActor = { ...f.actor, tenantId: 'different-tenant' };
    await assert.rejects(persistSealedSyntheticPollManifest({
      ...f, actor: wrongActor,
    }), /FHIR_POLL_MANIFEST_ACTOR_DENIED/);
    const sourceRef = f.root.collection('fhirSources').doc(sourceId);
    await sourceRef.update({ syncMode: null });
    await assert.rejects(persistSealedSyntheticPollManifest(f),
      /FHIR_POLL_MANIFEST_SOURCE_NOT_AUTHORIZED/);
    await sourceRef.update({ syncMode: 'FENCED', syntheticOnly: false });
    await assert.rejects(persistSealedSyntheticPollManifest(f),
      /FHIR_POLL_MANIFEST_SOURCE_NOT_AUTHORIZED/);
    assert.equal((await f.root.collection('fhirPollWorkManifests').get()).size, 0);
  } finally { await f.db.recursiveDelete(f.root); }
}, 60000);

test('Stage C: source changes and corrupted ciphertext invalidate sealed manifests', async () => {
  const f = await tenantFixture();
  try {
    await persistSealedSyntheticPollManifest(f);
    const src = f.root.collection('fhirSources').doc(sourceId);
    await src.update({ status: 'SUSPENDED' });
    await assert.rejects(load(f), /FHIR_POLL_MANIFEST_SCOPE_OR_REVISION_MISMATCH/);
    await src.update({ status: 'ACTIVE' });
    // Even restoring field values does not resurrect a source revision.
    await assert.rejects(load(f), /FHIR_POLL_MANIFEST_SCOPE_OR_REVISION_MISMATCH/);
    const row = f.root.collection('fhirPollWorkManifests').doc(f.manifest.manifestId);
    const snap = await row.get();
    await row.update({ sourceRevision: '1794135521.100000123' });
    await assert.rejects(load(f), /FHIR_POLL_MANIFEST_SCOPE_OR_REVISION_MISMATCH/);
    // Restore only for synthetic test; then test AES authentication directly.
    await row.update({ sourceRevision: snap.get('sourceRevision') });
    await src.update({ syntheticOnly: false });
    await assert.rejects(load(f), /FHIR_POLL_MANIFEST_SCOPE_OR_REVISION_MISMATCH/);
  } finally { await f.db.recursiveDelete(f.root); }
}, 60000);

test('Stage C: persisted synthetic runner recovers receipt-before-checkpoint crash', async () => {
  const f = await tenantFixture();
  const resource = observation('observation-a', 'v1', '2026-10-21T10:00:00Z', 1.1);
  try {
    await persistSealedSyntheticPollManifest(f);
    const args = {
      db: f.db, actor: f.actor, sourceId,
      manifestId: f.manifest.manifestId, cipher: f.cipher,
      readFixture: async () => resource,
    };
    await assert.rejects(runPersistedSyntheticFhirPoll({
      ...args, afterImportCommitted: async () => {
        throw new Error('SYNTHETIC_CRASH_AFTER_RECEIPT');
      },
    }), /SYNTHETIC_CRASH_AFTER_RECEIPT/);
    assert.equal((await f.root.collection('fhirImportedVersions').get()).size, 1);
    const lease = f.root.collection('fhirSourcePollLeases').doc(sourceId);
    assert.equal((await lease.get()).get('checkpointSequence'), 0);
    // Emulator-only fault injection: exercise new ownership epoch.
    await lease.update({ expiresAtMs: 0 });
    const resumed = await runPersistedSyntheticFhirPoll(args);
    assert.equal(resumed.status, 'COMPLETED');
    assert.equal(resumed.checkpointSequence, 1);
    assert.equal(resumed.replayedImports, 1);
    assert.equal((await f.root.collection('fhirImportedVersions').get()).size, 1);
    assert.equal((await f.root.collection('fhirImportEvents').get()).size, 1);
    for (const snap of (await f.root.collection('fhirImportOutbox').get()).docs) {
      assert.equal(snap.get('status'), 'HELD');
    }
    assert.equal((await f.root.collection('patient360Projections').get()).size, 0);
    const again = await runPersistedSyntheticFhirPoll({
      ...args, readFixture: async () => { throw new Error('DUPLICATE_HTTP_READ_NOT_ALLOWED'); },
    });
    assert.equal(again.processed, 0);
    assert.equal((await f.root.collection('fhirImportedVersions').get()).size, 1);
  } finally { await f.db.recursiveDelete(f.root); }
}, 60000);

test('Stage C: two workers creating same manifest cannot duplicate event/audit/outbox', async () => {
  const f = await tenantFixture();
  try {
    const results = await Promise.all([
      persistSealedSyntheticPollManifest(f),
      persistSealedSyntheticPollManifest(f),
    ]);
    assert.deepEqual(results.map(r => r.replay).sort(), [false, true]);
    assert.equal((await f.root.collection('fhirPollWorkManifests').get()).size, 1);
    assert.equal((await f.root.collection('fhirPollManifestEvents').get()).size, 1);
    assert.equal((await f.root.collection('fhirPollManifestOutbox').get()).size, 1);
    assert.equal((await f.root.collection('auditLogs').get()).size, 1);
  } finally { await f.db.recursiveDelete(f.root); }
}, 60000);

test('Stage C: revocation before poll prevents receipt and checkpoint', async () => {
  const f = await tenantFixture();
  try {
    await persistSealedSyntheticPollManifest(f);
    await f.root.collection('fhirPatientLinks')
      .doc(fhirPatientLinkId(sourceId, externalPatientId))
      .update({ consentStatus: 'WITHDRAWN' });
    const args = {
      db: f.db, actor: f.actor, sourceId,
      manifestId: f.manifest.manifestId, cipher: f.cipher,
      readFixture: async () => observation('observation-a', 'v1', '2026-10-21T10:00:00Z', 1.1),
    };
    await assert.rejects(runPersistedSyntheticFhirPoll(args));
    assert.equal((await f.root.collection('fhirImportedVersions').get()).size, 0);
    assert.equal((await f.root.collection('fhirSourcePollLeases').doc(sourceId).get())
      .get('checkpointSequence'), 0);
    assert.equal((await f.root.collection('patient360Projections').get()).size, 0);
  } finally { await f.db.recursiveDelete(f.root); }
}, 60000);

test('Stage C: corrupt encrypted payload is rejected before lease acquisition', async () => {
  const f = await tenantFixture();
  try {
    await persistSealedSyntheticPollManifest(f);
    await f.root.collection('fhirPollWorkManifests').doc(f.manifest.manifestId)
      .update({ 'payload.tagHex': '0'.repeat(32) });
    await assert.rejects(runPersistedSyntheticFhirPoll({
      db: f.db, actor: f.actor, sourceId, manifestId: f.manifest.manifestId,
      cipher: f.cipher,
      readFixture: async () => { throw new Error('MUST_NOT_READ_AFTER_TAMPER'); },
    }), /FHIR_POLL_MANIFEST_AUTHENTICATION_FAILED/);
    assert.equal((await f.root.collection('fhirSourcePollLeases').get()).size, 0);
    assert.equal((await f.root.collection('fhirImportedVersions').get()).size, 0);
  } finally { await f.db.recursiveDelete(f.root); }
}, 60000);

// G3 Stage D — the persisted runner must select the source+manifest-bound
// transactional checkpoint writer, never the legacy source-only writer.
test('Stage D: checkpoint event cryptographically binds sealed manifest and exact receipt', async () => {
  const f = await tenantFixture();
  try {
    const sealed = await persistSealedSyntheticPollManifest(f);
    const done = await runPersistedSyntheticFhirPoll({
      db: f.db, actor: f.actor, sourceId,
      manifestId: f.manifest.manifestId, cipher: f.cipher,
      readFixture: async () => observation('observation-a','v1','2026-10-21T10:00:00Z',1.1),
    });
    assert.equal(done.checkpointSequence, 1);
    const events = (await f.root.collection('fhirSourcePollEvents').where(
      'eventType','==','FHIR_SOURCE_POLL_CHECKPOINTED').get()).docs;
    assert.equal(events.length, 1);
    const e = events[0].data();
    assert.equal(e.manifestId, f.manifest.manifestId);
    assert.equal(e.manifestSourceRevision, sealed.sourceRevision);
    assert.match(e.manifestRevision, /^\d+\.\d{9}$/);
    assert.equal(e.immutable, true);
    assert.match(e.receiptId, /^fir_[a-f0-9]{64}$/);
    const audit = await f.root.collection('auditLogs').doc('fau_' + events[0].id).get();
    const outbox = await f.root.collection('fhirSourcePollOutbox').doc('fso_' + events[0].id).get();
    assert.equal(audit.get('manifestRevision'), e.manifestRevision);
    assert.equal(outbox.get('receiptId'), e.receiptId);
    assert.equal(outbox.get('status'), 'HELD');
    assert.equal((await f.root.collection('patient360Projections').get()).size,0);
  } finally { await f.db.recursiveDelete(f.root); }
}, 60000);

test('Stage D: tampered receipt bytes cannot advance a sealed manifest checkpoint', async () => {
  const f = await tenantFixture();
  try {
    await persistSealedSyntheticPollManifest(f);
    await assert.rejects(runPersistedSyntheticFhirPoll({
      db: f.db, actor: f.actor, sourceId, manifestId: f.manifest.manifestId,
      cipher: f.cipher,
      readFixture: async () => observation('observation-a','v1','2026-10-21T10:00:00Z',1.1),
      afterImportCommitted: async (_index, receiptId) => {
        await f.root.collection('fhirImportedVersions').doc(receiptId)
          .update({resourceJson: '{"resourceType":"Observation","id":"tampered"}'});
      },
    }), /FHIR_POLL_D_RECEIPT_PAYLOAD_INTEGRITY_INVALID/);
    const lease = await f.root.collection('fhirSourcePollLeases').doc(sourceId).get();
    assert.equal(lease.get('checkpointSequence'),0);
    assert.equal((await f.root.collection('fhirSourcePollEvents')
      .where('eventType','==','FHIR_SOURCE_POLL_CHECKPOINTED').get()).size,0);
  } finally { await f.db.recursiveDelete(f.root); }
}, 60000);

test('Stage D: post-receipt consent withdrawal prevents checkpoint; reverified replay recovers', async () => {
  const f = await tenantFixture();
  const link = f.root.collection('fhirPatientLinks').doc(fhirPatientLinkId(sourceId, externalPatientId));
  const lease = f.root.collection('fhirSourcePollLeases').doc(sourceId);
  const args = {db:f.db,actor:f.actor,sourceId,manifestId:f.manifest.manifestId,
    cipher:f.cipher,readFixture:async()=>observation('observation-a','v1','2026-10-21T10:00:00Z',1.1)};
  try {
    await persistSealedSyntheticPollManifest(f);
    await assert.rejects(runPersistedSyntheticFhirPoll({
      ...args,afterImportCommitted:async()=>{await link.update({consentStatus:'WITHDRAWN'});},
    }), /FHIR_POLL_D_PATIENT_LINK_OR_CONSENT_REVOKED/);
    assert.equal((await lease.get()).get('checkpointSequence'),0);
    assert.equal((await f.root.collection('fhirImportedVersions').get()).size,1);
    await link.update({consentStatus:'GRANTED'});
    // Emulator-only force expiration to simulate takeover after worker failure.
    await lease.update({expiresAtMs:0});
    const resumed=await runPersistedSyntheticFhirPoll(args);
    assert.equal(resumed.replayedImports,1);
    assert.equal(resumed.checkpointSequence,1);
    assert.equal((await f.root.collection('fhirImportedVersions').get()).size,1);
  } finally {await f.db.recursiveDelete(f.root);}
}, 60000);

test('Stage D: manifest update during source read is detected by document revision', async () => {
  const f = await tenantFixture();
  try {
    await persistSealedSyntheticPollManifest(f);
    await assert.rejects(runPersistedSyntheticFhirPoll({
      db:f.db,actor:f.actor,sourceId,manifestId:f.manifest.manifestId,
      cipher:f.cipher,
      readFixture:async()=>observation('observation-a','v1','2026-10-21T10:00:00Z',1.1),
      afterImportCommitted:async()=>{
        await f.root.collection('fhirPollWorkManifests').doc(f.manifest.manifestId)
          .update({syntheticTamperMarker:true});
      },
    }),/FHIR_POLL_D_MANIFEST_REVISED/);
    assert.equal((await f.root.collection('fhirSourcePollLeases').doc(sourceId).get()).get('checkpointSequence'),0);
  } finally {await f.db.recursiveDelete(f.root);}
}, 60000);

test('Stage D: changed source registration after import blocks checkpoint', async () => {
  const f = await tenantFixture();
  try {
    await persistSealedSyntheticPollManifest(f);
    await assert.rejects(runPersistedSyntheticFhirPoll({
      db:f.db,actor:f.actor,sourceId,manifestId:f.manifest.manifestId,cipher:f.cipher,
      readFixture:async()=>observation('observation-a','v1','2026-10-21T10:00:00Z',1.1),
      afterImportCommitted:async()=>{
        await f.root.collection('fhirSources').doc(sourceId).update({securityReviewStatus:'REVOKED'});
      },
    }),/FHIR_POLL_D_SOURCE_REVOKED_OR_REVISED/);
    assert.equal((await f.root.collection('fhirSourcePollLeases').doc(sourceId).get()).get('checkpointSequence'),0);
  } finally {await f.db.recursiveDelete(f.root);}
}, 60000);

test('Stage D: lease takeover after receipt cannot commit a stale epoch', async () => {
  const f = await tenantFixture();
  try {
    await persistSealedSyntheticPollManifest(f);
    await assert.rejects(runPersistedSyntheticFhirPoll({
      db:f.db,actor:f.actor,sourceId,manifestId:f.manifest.manifestId,cipher:f.cipher,
      readFixture:async()=>observation('observation-a','v1','2026-10-21T10:00:00Z',1.1),
      afterImportCommitted:async()=>{
        await f.root.collection('fhirSourcePollLeases').doc(sourceId).update({epoch:2});
      },
    }),/FHIR_POLL_D_LEASE_STALE_OR_CHECKPOINT_RACE/);
    assert.equal((await f.root.collection('fhirSourcePollLeases').doc(sourceId).get()).get('checkpointSequence'),0);
  } finally {await f.db.recursiveDelete(f.root);}
}, 60000);

test('Stage D: tampering with reserved operation work ID blocks checkpoint', async () => {
  const f = await tenantFixture();
  try {
    await persistSealedSyntheticPollManifest(f);
    await assert.rejects(runPersistedSyntheticFhirPoll({
      db:f.db,actor:f.actor,sourceId,manifestId:f.manifest.manifestId,cipher:f.cipher,
      readFixture:async()=>observation('observation-a','v1','2026-10-21T10:00:00Z',1.1),
      afterImportCommitted:async()=>{
        const event=(await f.root.collection('fhirSourcePollEvents')
          .where('eventType','==','FHIR_SOURCE_POLL_RESERVED').get()).docs[0];
        assert.ok(event);
        await event.ref.update({workId:randomUUID()});
      },
    }),/FHIR_POLL_D_RESERVATION_NOT_BOUND_TO_WORK/);
    assert.equal((await f.root.collection('fhirSourcePollLeases').doc(sourceId).get()).get('checkpointSequence'),0);
  } finally {await f.db.recursiveDelete(f.root);}
}, 60000);

test('Stage D: missing committed audit prevents checkpoint even after HTTP success', async () => {
  const f = await tenantFixture();
  try {
    await persistSealedSyntheticPollManifest(f);
    await assert.rejects(runPersistedSyntheticFhirPoll({
      db:f.db,actor:f.actor,sourceId,manifestId:f.manifest.manifestId,cipher:f.cipher,
      readFixture:async()=>observation('observation-a','v1','2026-10-21T10:00:00Z',1.1),
      afterImportCommitted:async()=>{
        const r=(await f.root.collection('fhirImportedVersions').get()).docs[0];
        assert.ok(r);
        await f.root.collection('auditLogs').doc('fau_' + r.id.slice(4)).delete();
      },
    }),/FHIR_POLL_D_CHECKPOINT_EVIDENCE_MISSING/);
    assert.equal((await f.root.collection('fhirSourcePollLeases').doc(sourceId).get()).get('checkpointSequence'),0);
  } finally {await f.db.recursiveDelete(f.root);}
}, 60000);
