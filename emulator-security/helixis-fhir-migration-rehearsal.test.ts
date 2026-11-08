/**
 * Stage E synthetic-only migration/DR rehearsal. Never touch real cloud.
 * The test operator exports an anchor BEFORE injecting stale/rolled-back state.
 * Node CI compiles through the existing Bun-to-Node test shim.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { fhirPatientLinkId, type FhirImportActor } from '@/lib/clinical/intelligence/external-fhir-import';
import { EmulatorOnlyAesGcmCipher } from '@/lib/clinical/intelligence/external-fhir-poll-manifest-seal';
import { persistSealedSyntheticPollManifest,
  runPersistedSyntheticFhirPoll, type NewPollWorkManifest,
} from '@/lib/clinical/intelligence/external-fhir-poll-manifest-store';
import { EmulatorOnlyStageERecoverySigner,
  stageEAnchorFingerprint, type StageERecoveryAnchor, type StageEApproval,
} from '@/lib/clinical/intelligence/external-fhir-poll-recovery-guard';
import { rehearseSyntheticFencedMigration } from '@/lib/clinical/intelligence/external-fhir-poll-migration-rehearsal';

const sourceId='his-stage-e-synthetic';
const facilityId='synthetic-facility';
const externalPatientId='synthetic-external-p1';
const patientId='synthetic-p1';
function guard() {
  if (process.env.NODE_ENV !== 'test' || process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED') {
    throw new Error('STAGE_E_EMULATOR_ISOLATION_REQUIRED');
  }
}
function obs() {
  return {resourceType:'Observation',id:'obs-e',status:'final',
    meta:{versionId:'v1',lastUpdated:'2026-10-21T10:00:00Z'},
    subject:{reference:`Patient/${externalPatientId}`},
    code:{coding:[{system:'http://loinc.org',code:'2160-0'}]},
    valueQuantity:{value:1.1,system:'http://unitsofmeasure.org',code:'mg/dL'}};
}
async function fixture() {
  guard();
  const db=getAdminFirestore();
  if(!db) throw new Error('STAGE_E_ADMIN_EMULATOR_REQUIRED');
  const tenantId='stage-e-'+randomUUID().slice(0,10);
  const root=db.collection('tenants').doc(tenantId);
  const actor: FhirImportActor = {
    tenantId,actorId:'synthetic-rehearsal-worker',roles:[],
    permissions:['FHIR_IMPORT','FHIR_POLL_COORDINATE','FHIR_MIGRATION_REHEARSE'],
    facilityIds:[facilityId],
  };
  const cipher=new EmulatorOnlyAesGcmCipher(randomBytes(32),'stage-e-test-key');
  const signer=new EmulatorOnlyStageERecoverySigner(randomBytes(32));
  const manifest:NewPollWorkManifest={tenantId,sourceId,facilityId,manifestId:randomUUID(),
    startCheckpointSequence:0,
    items:[{workId:randomUUID(),resourceType:'Observation',resourceId:'obs-e',expectedVersionId:'v1'}],
    vendorCursor:'OPAQUE_LOCAL_ONLY',
  };
  await Promise.all([
    root.collection('patients').doc(patientId).set({tenantId,status:'ACTIVE'}),
    root.collection('fhirSources').doc(sourceId).set({tenantId,sourceId,facilityId,
      baseUrl:'https://synthetic-his.example.test/fhir/R4',status:'ACTIVE',
      securityReviewStatus:'APPROVED',syncMode:'FENCED',syntheticOnly:true,
      approvedResourceTypes:['Patient','Encounter','Observation']}),
    root.collection('fhirPatientLinks').doc(fhirPatientLinkId(sourceId,externalPatientId)).set({
      tenantId,sourceId,facilityId,externalPatientId,patientId,
      matchStatus:'VERIFIED',consentStatus:'GRANTED',
    }),
  ]);
  await persistSealedSyntheticPollManifest({db,actor,cipher,manifest});
  await runPersistedSyntheticFhirPoll({db,actor,cipher,sourceId,manifestId:manifest.manifestId,
    readFixture:async()=>obs()});
  const [source, sealed, lease]=await Promise.all([
    root.collection('fhirSources').doc(sourceId).get(),
    root.collection('fhirPollWorkManifests').doc(manifest.manifestId).get(),
    root.collection('fhirSourcePollLeases').doc(sourceId).get(),
  ]);
  const cp=(await root.collection('fhirSourcePollEvents')
    .where('eventType','==','FHIR_SOURCE_POLL_CHECKPOINTED').get()).docs;
  assert.equal(cp.length,1);
  const doc=cp[0].data();
  function revision(snap:{updateTime?:{seconds:number;nanoseconds:number}}) {
    assert.ok(snap.updateTime);
    return `${snap.updateTime.seconds}.${String(snap.updateTime.nanoseconds).padStart(9,'0')}`;
  }
  const anchor: StageERecoveryAnchor=signer.sign({
    schemaVersion:1,kind:'SYNTHETIC_OFFLINE_EXPORTED_RECOVERY_ANCHOR',
    tenantId,sourceId,facilityId,manifestId:manifest.manifestId,
    sourceRevision:revision(source),manifestRevision:revision(sealed),
    epoch:lease.get('epoch'),issuedSequence:lease.get('issuedSequence'),
    checkpointSequence:lease.get('checkpointSequence'),
    checkpointDigest:lease.get('checkpointDigest'),checkpointWorkId:lease.get('checkpointWorkId'),
    checkpointEventId:cp[0].id,receiptId:doc.receiptId,
  });
  const reviews: StageEApproval[]=[
    {reviewerId:'synthetic-security-reviewer',role:'SECURITY_REVIEWER',
      disposition:'APPROVE',anchorFingerprint:stageEAnchorFingerprint(anchor)},
    {reviewerId:'synthetic-clinical-reviewer',role:'CLINICAL_REVIEWER',
      disposition:'APPROVE',anchorFingerprint:stageEAnchorFingerprint(anchor)},
  ];
  const args={db,actor,cipher,sourceId,manifestId:manifest.manifestId,
    recoverySigner:signer,anchor,reviews,rehearsalId:randomUUID()};
  return {db,root,actor,cipher,signer,manifest,anchor,reviews,args};
}
async function count(f: Awaited<ReturnType<typeof fixture>>) {
  const names=['fhirPollMigrationRehearsals','fhirPollMigrationEvents','fhirPollMigrationOutbox'];
  return Promise.all(names.map(async n=>(await f.root.collection(n).get()).size));
}
function scenario(name:string,handler:(f:Awaited<ReturnType<typeof fixture>>)=>Promise<void>) {
  test('Stage E: '+name,async()=>{
    const f=await fixture();
    try {await handler(f)} finally {await f.db.recursiveDelete(f.root)}
  },75000);
}
scenario('qualified dry-run stores immutable evidence without changing any source, lease or patient',async f=>{
  const before=await Promise.all([
    f.root.collection('fhirSources').doc(sourceId).get(),
    f.root.collection('fhirSourcePollLeases').doc(sourceId).get(),
    f.root.collection('fhirPollWorkManifests').doc(f.manifest.manifestId).get(),
  ]);
  const result=await rehearseSyntheticFencedMigration(f.args);
  assert.equal(result.status,'REHEARSAL_ONLY');assert.equal(result.replay,false);
  assert.deepEqual(await count(f),[1,1,1]);
  const rows=(await f.root.collection('fhirPollMigrationRehearsals').get()).docs;
  assert.equal(rows[0].get('productionAuthorization'),'NO_GO');
  assert.equal((await f.root.collection('fhirPollMigrationOutbox').get()).docs[0].get('status'),'HELD');
  const after=await Promise.all(before.map(s=>s.ref.get()));
  assert.deepEqual(after.map(s=>s.updateTime?.toMillis()),before.map(s=>s.updateTime?.toMillis()));
  assert.equal((await f.root.collection('patient360Projections').get()).size,0);
});
scenario('exact replay is idempotent, conflicting independent reviews fail closed',async f=>{
  await rehearseSyntheticFencedMigration(f.args);
  assert.equal((await rehearseSyntheticFencedMigration(f.args)).replay,true);
  await assert.rejects(rehearseSyntheticFencedMigration({...f.args,reviews:[
    {...f.reviews[0],reviewerId:'different-security-reviewer'},f.reviews[1],
  ]}),/FHIR_POLL_E_REHEARSAL_REPLAY_CONFLICT/);
  assert.deepEqual(await count(f),[1,1,1]);
});
scenario('two concurrent workers cannot create two migration evidence chains',async f=>{
  const result=await Promise.all([
    rehearseSyntheticFencedMigration(f.args),
    rehearseSyntheticFencedMigration(f.args),
  ]);
  assert.deepEqual(result.map(r=>r.replay).sort(),[false,true]);
  assert.deepEqual(await count(f),[1,1,1]);
});
scenario('interrupted rehearsal transaction leaves zero partial evidence and retries once',async f=>{
  await assert.rejects(rehearseSyntheticFencedMigration({...f.args,
    afterValidationBeforeCommit:async()=>{throw new Error('SYNTHETIC_POWER_FAILURE_DURING_REHEARSAL')},
  }),/SYNTHETIC_POWER_FAILURE_DURING_REHEARSAL/);
  assert.deepEqual(await count(f),[0,0,0]);
  const result=await rehearseSyntheticFencedMigration(f.args);
  assert.equal(result.replay,false);
  assert.deepEqual(await count(f),[1,1,1]);
});
scenario('stale restored checkpoint is rejected against retained offline anchor',async f=>{
  const lease=f.root.collection('fhirSourcePollLeases').doc(sourceId);
  await lease.update({checkpointSequence:0});
  await assert.rejects(rehearseSyntheticFencedMigration(f.args),/FHIR_POLL_E_STALE_RESTORED_OR_ADVANCED_LEASE/);
  assert.deepEqual(await count(f),[0,0,0]);
});
scenario('lost issued-operation watermark is rejected',async f=>{
  await f.root.collection('fhirSourcePollLeases').doc(sourceId).update({issuedSequence:0});
  await assert.rejects(rehearseSyntheticFencedMigration(f.args),/STALE_RESTORED_OR_ADVANCED_LEASE/);
  assert.deepEqual(await count(f),[0,0,0]);
});
scenario('expired in-flight lease must not be silently treated as completed',async f=>{
  await f.root.collection('fhirSourcePollLeases').doc(sourceId).update({status:'ACTIVE',expiresAtMs:0});
  await assert.rejects(rehearseSyntheticFencedMigration(f.args),/IN_FLIGHT_LEASE_UNRESOLVED/);
  assert.deepEqual(await count(f),[0,0,0]);
});
scenario('post-import consent withdrawal blocks rehearsal',async f=>{
  await f.root.collection('fhirPatientLinks').doc(fhirPatientLinkId(sourceId,externalPatientId))
    .update({consentStatus:'WITHDRAWN'});
  await assert.rejects(rehearseSyntheticFencedMigration(f.args),/CONSENT_OR_PATIENT_LINEAGE_REVOKED/);
  assert.deepEqual(await count(f),[0,0,0]);
});
scenario('source revision change or migration to live source blocks rehearsal',async f=>{
  await f.root.collection('fhirSources').doc(sourceId).update({syntheticOnly:false});
  await assert.rejects(rehearseSyntheticFencedMigration(f.args),/RESTORE_OR_DOCUMENT_REVISION_CHANGED/);
  assert.deepEqual(await count(f),[0,0,0]);
});
scenario('manifest ciphertext corruption is detected before any evidence creation',async f=>{
  await f.root.collection('fhirPollWorkManifests').doc(f.manifest.manifestId)
    .update({'payload.tagHex':'0'.repeat(32)});
  await assert.rejects(rehearseSyntheticFencedMigration(f.args),/FHIR_POLL_MANIFEST_AUTHENTICATION_FAILED/);
  assert.deepEqual(await count(f),[0,0,0]);
});
scenario('missing checkpoint audit chain cannot be treated as successful migration proof',async f=>{
  await f.root.collection('auditLogs').doc('fau_'+f.anchor.checkpointEventId).delete();
  await assert.rejects(rehearseSyntheticFencedMigration(f.args),/CHECKPOINT_CHAIN_UNVERIFIED/);
  assert.deepEqual(await count(f),[0,0,0]);
});
scenario('unresolved source availability blocks migration rehearsal',async f=>{
  const head=(await f.root.collection('fhirResourceHeads').get()).docs[0];assert.ok(head);
  await f.root.collection('fhirAvailabilityStates').doc(head.id).set({
    status:'SUSPECTED_ABSENCE',sourceReceiptId:f.anchor.receiptId,
  });
  await assert.rejects(rehearseSyntheticFencedMigration(f.args),/AVAILABILITY_RECONCILIATION_UNRESOLVED/);
  assert.deepEqual(await count(f),[0,0,0]);
});
scenario('other tenant and unprivileged actor cannot authorize migration',async f=>{
  await assert.rejects(rehearseSyntheticFencedMigration({...f.args,actor:{...f.actor,tenantId:'other-tenant'}}),/ACTOR_OR_SCOPE_DENIED/);
  await assert.rejects(rehearseSyntheticFencedMigration({...f.args,actor:{...f.actor,
    permissions:['FHIR_IMPORT','FHIR_POLL_COORDINATE']}}),/ACTOR_OR_SCOPE_DENIED/);
  assert.deepEqual(await count(f),[0,0,0]);
});
scenario('forged anchor and self-attested reviewer are rejected',async f=>{
  await assert.rejects(rehearseSyntheticFencedMigration({...f.args,anchor:{...f.anchor,macHex:'b'.repeat(64)}}),/ANCHOR_SIGNATURE_INVALID/);
  await assert.rejects(rehearseSyntheticFencedMigration({...f.args,reviews:[
    {...f.reviews[0],reviewerId:f.actor.actorId},f.reviews[1]]}),/ACTOR_OR_SCOPE_DENIED/);
  assert.deepEqual(await count(f),[0,0,0]);
});
