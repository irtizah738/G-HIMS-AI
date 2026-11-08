/**
 * Stage F emulator-only, NO SOURCE MIGRATION or hosted DR claim.
 * Maintains a detached test-key anchor independently of Firestore's documents.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAdminFirestore } from '@/server/firebase/admin';
import { fhirPatientLinkId, type FhirImportActor } from '@/lib/clinical/intelligence/external-fhir-import';
import { EmulatorOnlyAesGcmCipher } from '@/lib/clinical/intelligence/external-fhir-poll-manifest-seal';
import { persistSealedSyntheticPollManifest,runPersistedSyntheticFhirPoll,
  type NewPollWorkManifest } from '@/lib/clinical/intelligence/external-fhir-poll-manifest-store';
import { EmulatorOnlyStageFRecoverySigner,stageFAnchorFingerprint,
  type StageFMultiAnchor,type StageFReview,
} from '@/lib/clinical/intelligence/external-fhir-poll-multi-recovery';
import { rehearseSyntheticMultiPageRecovery } from '@/lib/clinical/intelligence/external-fhir-poll-multi-rehearsal';
import {EmulatorOnlyG2DetachedRestoreSigner,g2RestoreCertificateFingerprint}
  from '@/lib/clinical/intelligence/external-fhir-g2-detached-restore-proof';
import {coldReadbackVerifiedSyntheticG2Evidence,
  encryptVerifiedSyntheticG2Evidence,fingerprintSyntheticG2ColdBackup,
  writeSyntheticColdBackupFile,readSyntheticColdBackupFile,
  type G2SyntheticColdBackup,
} from '@/lib/clinical/intelligence/external-fhir-g2-encrypted-cold-readback';
import {EmulatorOnlyStageGCursorTagger,EmulatorOnlyStageGWitnessIssuer,
  EmulatorOnlyStageGWitnessVerifier,EmulatorOnlyDetachedWitnessLedger,
  stageGCertificateFingerprint,deriveStageGPageProofs,
} from '@/lib/clinical/intelligence/external-fhir-poll-vendor-cursor';

const sourceId='his-stage-f-synthetic';
const facilityId='synthetic-f-facility';
const externalPatientId='synthetic-ext-pf';
const patientId='synthetic-pf';
function guard(){
  if(process.env.NODE_ENV!=='test'||process.env.GHIMS_RUNTIME_MODE!=='TEST'||
      process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
      process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED!=='false'||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE!=='DISABLED'){
    throw new Error('STAGE_F_TEST_EMULATOR_ONLY');
  }
}
function observation(item:{resourceId:string;expectedVersionId:string}){
  return {resourceType:'Observation',id:item.resourceId,status:'final',
    meta:{versionId:item.expectedVersionId,lastUpdated:'2026-10-21T10:00:00Z'},
    subject:{reference:`Patient/${externalPatientId}`},
    code:{coding:[{system:'http://loinc.org',code:'2160-0'}]},
    valueQuantity:{value:1.1,system:'http://unitsofmeasure.org',code:'mg/dL'}};
}
function rev(snap:{updateTime?:{seconds:number;nanoseconds:number}}){
  assert.ok(snap.updateTime);return `${snap.updateTime.seconds}.${String(snap.updateTime.nanoseconds).padStart(9,'0')}`;
}
async function fixture(crashAndRecover=false,secondPageCrash=false,stageGCursor=false){
  guard();const db=getAdminFirestore();if(!db) throw new Error('STAGE_F_ADMIN_EMULATOR_REQUIRED');
  const tenantId='stage-f-'+randomUUID().slice(0,10);
  const root=db.collection('tenants').doc(tenantId);
  const actor:FhirImportActor={actorId:'synthetic-f-migration-worker',tenantId,
    roles:[],permissions:['FHIR_IMPORT','FHIR_POLL_COORDINATE','FHIR_MIGRATION_REHEARSE'],
    facilityIds:[facilityId]};
  const cipher=new EmulatorOnlyAesGcmCipher(randomBytes(32),'stage-f-test-key');
  const signer=new EmulatorOnlyStageFRecoverySigner(randomBytes(32));
  const manifests:NewPollWorkManifest[]=[0,1].map(page=>({tenantId,sourceId,facilityId,
    manifestId:randomUUID(),startCheckpointSequence:page*2,
    items:[0,1].map(i=>({workId:randomUUID(),resourceType:'Observation' as const,
      resourceId:`obs-f-${page}-${i}`,expectedVersionId:'v1'})),
    vendorCursor:stageGCursor ? (page===0?null:'OPAQUE_G_PAGE_1_NEXT_TOKEN') :
      `OPAQUE_F_VENDOR_CURSOR_PAGE_${page}`}));
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
  for(let p=0;p<manifests.length;p++){
    const m=manifests[p];
    await persistSealedSyntheticPollManifest({db,actor,cipher,manifest:m});
    if((p===0 && crashAndRecover)||(p===1 && secondPageCrash)){
      await assert.rejects(runPersistedSyntheticFhirPoll({db,actor,cipher,
        sourceId,manifestId:m.manifestId,
        readFixture:async item=>observation(item),
        afterImportCommitted:async(index)=>{
          if(index===0) throw new Error('STAGE_F_SYNTHETIC_POWER_LOSS');
        },
      }),/STAGE_F_SYNTHETIC_POWER_LOSS/);
      // Explicit emulator-only lease-expiration injection to simulate
      // passage of time. No real Cloud time is changed.
      await root.collection('fhirSourcePollLeases').doc(sourceId).update({expiresAtMs:0});
    }
    await runPersistedSyntheticFhirPoll({db,actor,cipher,sourceId,manifestId:m.manifestId,
      readFixture:async item=>observation(item)});
  }
  const [source,lease,...sealed]=await Promise.all([
    root.collection('fhirSources').doc(sourceId).get(),
    root.collection('fhirSourcePollLeases').doc(sourceId).get(),
    ...manifests.map(m=>root.collection('fhirPollWorkManifests').doc(m.manifestId).get()),
  ]);
  const history=(await root.collection('fhirSourcePollEvents').get()).docs;
  const checkpoints=history.filter(d=>d.get('eventType')==='FHIR_SOURCE_POLL_CHECKPOINTED')
    .sort((a,b)=>a.get('sequence')-b.get('sequence'));
  const reservations=history.filter(d=>d.get('eventType')==='FHIR_SOURCE_POLL_RESERVED');
  assert.equal(checkpoints.length,4);
  const steps=checkpoints.map((checkpoint,index)=>{
    const row=checkpoint.data();
    const matching=reservations.find(d=>d.get('sequence')===row.operationSequence &&
      d.get('epoch')===row.epoch);
    assert.ok(matching);
    const page=manifests.find(m=>m.manifestId===row.manifestId);
    assert.ok(page);
    return {manifestId:row.manifestId,sequence:row.sequence,
      index:row.sequence-page.startCheckpointSequence-1,
      epoch:row.epoch,operationSequence:row.operationSequence,
      workId:row.workId,reservationEventId:matching.id,
      checkpointEventId:checkpoint.id,receiptId:row.receiptId,
      checkpointDigest:row.checkpointDigest};
  });
  const used=new Set(steps.map(s=>s.reservationEventId));
  const abandonedReservations=reservations.filter(d=>!used.has(d.id)).map(d=>({
    epoch:d.get('epoch'),operationSequence:d.get('sequence'),
    workId:d.get('workId'),reservationEventId:d.id,
  })).sort((a,b)=>a.operationSequence-b.operationSequence);
  const draft:Omit<StageFMultiAnchor,'macHex'>={
    schemaVersion:1,kind:'SYNTHETIC_OFFLINE_EXPORTED_MULTI_PAGE_ANCHOR',
    tenantId,sourceId,facilityId,sourceRevision:rev(source),
    startCheckpointSequence:0,endCheckpointSequence:4,
    issuedSequence:lease.get('issuedSequence'),finalEpoch:lease.get('epoch'),
    pages:manifests.map((m,index)=>({manifestId:m.manifestId,
      manifestRevision:rev(sealed[index]),startCheckpointSequence:m.startCheckpointSequence,
      itemCount:m.items.length})),steps,abandonedReservations,
  };
  const anchor=signer.sign(draft);
  const reviews:StageFReview[]=[
    {reviewerId:'synthetic-security-reviewer',role:'SECURITY_REVIEWER',
      disposition:'APPROVE',anchorFingerprint:stageFAnchorFingerprint(anchor)},
    {reviewerId:'synthetic-clinical-reviewer',role:'CLINICAL_REVIEWER',
      disposition:'APPROVE',anchorFingerprint:stageFAnchorFingerprint(anchor)},
  ];
  const args={db,actor,cipher,signer,anchor,reviews,rehearsalId:randomUUID()};
  return {db,root,actor,cipher,signer,anchor,reviews,args,manifests};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function counts(f:Fixture){
  return Promise.all(['fhirPollMultiRecoveryRehearsals','fhirPollMultiRecoveryEvents',
    'fhirPollMultiRecoveryOutbox'].map(async x=>(await f.root.collection(x).get()).size));
}
function scenario(name:string,fn:(f:Fixture)=>Promise<void>,crashAndRecover=false,secondPageCrash=false){
  test('Stage F: '+name,async()=>{
    const f=await fixture(crashAndRecover,secondPageCrash);
    try{await fn(f)}finally{await f.db.recursiveDelete(f.root)}
  },90000);
}
scenario('two-page four-item recovery records only immutable HELD evidence',async f=>{
  const before=await Promise.all([
    f.root.collection('fhirSources').doc(sourceId).get(),
    f.root.collection('fhirSourcePollLeases').doc(sourceId).get(),
    ...f.manifests.map(m=>f.root.collection('fhirPollWorkManifests').doc(m.manifestId).get()),
  ]);
  const result=await rehearseSyntheticMultiPageRecovery(f.args);
  assert.equal(result.replay,false);assert.equal(result.status,'REHEARSAL_ONLY');
  assert.deepEqual(await counts(f),[1,1,1]);
  const outbox=(await f.root.collection('fhirPollMultiRecoveryOutbox').get()).docs[0];
  assert.equal(outbox.get('status'),'HELD');
  const after=await Promise.all(before.map(s=>s.ref.get()));
  assert.deepEqual(after.map(s=>s.updateTime?.toMillis()),before.map(s=>s.updateTime?.toMillis()));
  assert.equal((await f.root.collection('patient360Projections').get()).size,0);
});
scenario('exact replay idempotent, reviewer substitution conflicts',async f=>{
  await rehearseSyntheticMultiPageRecovery(f.args);
  assert.equal((await rehearseSyntheticMultiPageRecovery(f.args)).replay,true);
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,reviews:[
    {...f.reviews[0],reviewerId:'synthetic-other-reviewer'},f.reviews[1],
  ]}),/FHIR_POLL_F_REPLAY_CONFLICT/);
  assert.deepEqual(await counts(f),[1,1,1]);
});
scenario('two concurrent rehearsals commit just one evidence chain',async f=>{
  const results=await Promise.all([
    rehearseSyntheticMultiPageRecovery(f.args),rehearseSyntheticMultiPageRecovery(f.args),
  ]);
  assert.deepEqual(results.map(x=>x.replay).sort(),[false,true]);
  assert.deepEqual(await counts(f),[1,1,1]);
});
scenario('test-only crash rolls back complete rehearsal transaction',async f=>{
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,
    afterValidationBeforeCommit:async()=>{throw new Error('STAGE_F_PRECOMMIT_CRASH')},
  }),/STAGE_F_PRECOMMIT_CRASH/);
  assert.deepEqual(await counts(f),[0,0,0]);
  await rehearseSyntheticMultiPageRecovery(f.args);
  assert.deepEqual(await counts(f),[1,1,1]);
});
scenario('first-page post-receipt crash resumes after lease takeover without gaps',async f=>{
  assert.equal(f.anchor.abandonedReservations.length,1);
  assert.equal(f.anchor.steps[0].operationSequence,2);
  const result=await rehearseSyntheticMultiPageRecovery(f.args);
  assert.equal(result.status,'REHEARSAL_ONLY');
  assert.deepEqual(await counts(f),[1,1,1]);
},true);

scenario('second-page crash cannot skip checkpoint and resumes under a third epoch',async f=>{
  assert.equal(f.anchor.abandonedReservations.length,1);
  assert.equal(f.anchor.abandonedReservations[0].epoch,2);
  assert.equal(f.anchor.steps[2].epoch,3);
  assert.equal(f.anchor.steps[2].sequence,3);
  assert.equal(f.anchor.steps[3].sequence,4);
  const result=await rehearseSyntheticMultiPageRecovery(f.args);
  assert.equal(result.status,'REHEARSAL_ONLY');
  assert.deepEqual(await counts(f),[1,1,1]);
},false,true);
scenario('accepted detached anchor must fail after restored checkpoint rollback',async f=>{
  await rehearseSyntheticMultiPageRecovery(f.args);
  const before=await counts(f);
  await f.root.collection('fhirSourcePollLeases').doc(sourceId)
    .update({checkpointSequence:2});
  await assert.rejects(rehearseSyntheticMultiPageRecovery(f.args),
    /RESTORED_OR_INFLIGHT_LEASE_INVALID/);
  assert.deepEqual(await counts(f),before);
  assert.equal((await f.root.collection('patient360Projections').get()).size,0);
});
scenario('accepted detached anchor must fail after partial receipt loss',async f=>{
  await rehearseSyntheticMultiPageRecovery(f.args);
  const before=await counts(f);
  await f.root.collection('fhirImportedVersions').doc(f.anchor.steps[1].receiptId).delete();
  await assert.rejects(rehearseSyntheticMultiPageRecovery(f.args),
    /IMPORT_EVIDENCE_INVALID|LINK_OR_PATIENT_ID_MISSING/);
  assert.deepEqual(await counts(f),before);
});
scenario('missing middle checkpoint audit blocks whole rehearsal',async f=>{
  await f.root.collection('auditLogs').doc('fau_'+f.anchor.steps[1].checkpointEventId).delete();
  await assert.rejects(rehearseSyntheticMultiPageRecovery(f.args),/CHECKPOINT_CHAIN_INVALID/);
  assert.deepEqual(await counts(f),[0,0,0]);
});
scenario('missing intermediate clinical receipt blocks replay despite final checkpoint',async f=>{
  await f.root.collection('fhirImportedVersions').doc(f.anchor.steps[1].receiptId).delete();
  await assert.rejects(rehearseSyntheticMultiPageRecovery(f.args),/LINK_OR_PATIENT_ID_MISSING|IMPORT_EVIDENCE_INVALID/);
  assert.deepEqual(await counts(f),[0,0,0]);
});
scenario('stale restored checkpoint cannot qualify',async f=>{
  await f.root.collection('fhirSourcePollLeases').doc(sourceId).update({checkpointSequence:2});
  await assert.rejects(rehearseSyntheticMultiPageRecovery(f.args),/RESTORED_OR_INFLIGHT_LEASE_INVALID/);
  assert.deepEqual(await counts(f),[0,0,0]);
});
scenario('source changed after anchor export cannot qualify',async f=>{
  await f.root.collection('fhirSources').doc(sourceId).update({syntheticOnly:false});
  await assert.rejects(rehearseSyntheticMultiPageRecovery(f.args),/SOURCE_CHANGED_OR_UNAUTHORIZED/);
  assert.deepEqual(await counts(f),[0,0,0]);
});
scenario('cross-page consent withdrawal fails whole multi-resource rehearsal',async f=>{
  await f.root.collection('fhirPatientLinks').doc(fhirPatientLinkId(sourceId,externalPatientId))
    .update({consentStatus:'WITHDRAWN'});
  await assert.rejects(rehearseSyntheticMultiPageRecovery(f.args),/CONSENT_OR_PATIENT_LINEAGE_INVALID/);
  assert.deepEqual(await counts(f),[0,0,0]);
});
scenario('rewritten page-1 sealed manifest fails authentication',async f=>{
  await f.root.collection('fhirPollWorkManifests').doc(f.manifests[0].manifestId)
    .update({'payload.tagHex':'0'.repeat(32)});
  await assert.rejects(rehearseSyntheticMultiPageRecovery(f.args),/FHIR_POLL_MANIFEST_AUTHENTICATION_FAILED/);
  assert.deepEqual(await counts(f),[0,0,0]);
});
scenario('missing abandoned reservation is not silently ignored',async f=>{
  assert.equal(f.anchor.abandonedReservations.length,1);
  await f.root.collection('fhirSourcePollEvents').doc(f.anchor.abandonedReservations[0].reservationEventId).delete();
  await assert.rejects(rehearseSyntheticMultiPageRecovery(f.args),/RESERVATION_EVIDENCE_INVALID/);
  assert.deepEqual(await counts(f),[0,0,0]);
},true);
scenario('unresolved earlier page availability blocks complete recovery',async f=>{
  const head=(await f.root.collection('fhirResourceHeads').get()).docs.find(d=>
    d.get('resourceId')===f.manifests[0].items[0].resourceId);
  assert.ok(head);
  await f.root.collection('fhirAvailabilityStates').doc(head.id).set({
    status:'SUSPECTED_ABSENCE',sourceReceiptId:f.anchor.steps[0].receiptId,
  });
  await assert.rejects(rehearseSyntheticMultiPageRecovery(f.args),/AVAILABILITY_UNRESOLVED/);
  assert.deepEqual(await counts(f),[0,0,0]);
});
scenario('unprivileged/cross-tenant actor and invalid signed anchor fail before writes',async f=>{
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,actor:{...f.actor,
    tenantId:'other-tenant'}}),/ACTOR_OR_SCOPE_DENIED/);
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,actor:{...f.actor,
    permissions:['FHIR_IMPORT']}}),/ACTOR_OR_SCOPE_DENIED/);
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,anchor:{...f.anchor,
    macHex:'f'.repeat(64)}}),/SIGNATURE_INVALID/);
  assert.deepEqual(await counts(f),[0,0,0]);
});


/** Stage G: synthetic vendor response cursor must match the next sealed page input. */
async function stageGFixture(crashAndRecover=false,secondPageCrash=false){
  const f=await fixture(crashAndRecover,secondPageCrash,true);
  const keys=generateKeyPairSync('ed25519');
  const issuer=new EmulatorOnlyStageGWitnessIssuer(keys.privateKey);
  const verifier=new EmulatorOnlyStageGWitnessVerifier(keys.publicKey);
  const cursorTags=new EmulatorOnlyStageGCursorTagger(randomBytes(32));
  const responseNextCursors=[f.manifests[1].vendorCursor,null];
  const evidence={anchor:f.anchor,pages:f.manifests.map((m,i)=>({
    manifest:{...m,sourceRevision:f.anchor.sourceRevision},
    manifestRevision:f.anchor.pages[i].manifestRevision,
  }))} as any;
  const pages=deriveStageGPageProofs({evidence,responseNextCursors,cursorTags});
  const now=Date.now();
  const certificate=issuer.sign({schemaVersion:1,
    kind:'SYNTHETIC_VENDOR_CURSOR_CHAIN_LOCAL_WITNESS',witnessId:randomUUID(),
    sequence:1,previousFingerprint:null,issuedAtMs:now-1000,expiresAtMs:now+180000,
    tenantId:f.actor.tenantId,sourceId,facilityId,sourceRevision:f.anchor.sourceRevision,
    stageFAnchorFingerprint:stageFAnchorFingerprint(f.anchor),pages});
  const witnessDir=await mkdtemp(join(tmpdir(),'helixis-stage-g-emulator-witness-'));
  const witnessFile=join(witnessDir,'trusted-witness.ndjson');
  const detachedWitness=new EmulatorOnlyDetachedWitnessLedger(witnessFile,verifier);
  await detachedWitness.pin(certificate);
  const stageG={certificate,verifier,cursorTags,responseNextCursors,detachedWitness};
  return {...f,stageG,issuer,witnessDir,witnessFile};
}
type GFixture=Awaited<ReturnType<typeof stageGFixture>>;
function gScenario(name:string,fn:(f:GFixture)=>Promise<void>,crash1=false,crash2=false){
 test('Stage G: '+name,async()=>{
  const f=await stageGFixture(crash1,crash2);
  try{await fn(f)}finally{
    await Promise.all([f.db.recursiveDelete(f.root),rm(f.witnessDir,{recursive:true,force:true})]);
  }
 },90000);
}
async function assertNoGRecorded(f:GFixture){
 assert.deepEqual(await counts(f),[0,0,0]);
}
gScenario('two-page cursor certificate binds exact multi-resource evidence without plaintext leakage',async f=>{
  const result=await rehearseSyntheticMultiPageRecovery({...f.args,stageG:f.stageG});
  assert.equal(result.status,'REHEARSAL_ONLY');
  assert.equal(result.replay,false);
  const row=(await f.root.collection('fhirPollMultiRecoveryRehearsals').get()).docs[0].data();
  assert.equal(row.vendorCursorWitnessFingerprint,stageGCertificateFingerprint(f.stageG.certificate));
  assert.equal(row.vendorCursorQualification,'LOCAL_SYNTHETIC_WITNESS_ONLY');
  assert.equal(row.productionAuthorization,'NO_GO');
  const saved=JSON.stringify(row);
  assert.ok(!saved.includes('OPAQUE_G_PAGE_1_NEXT_TOKEN'));
  const outbox=(await f.root.collection('fhirPollMultiRecoveryOutbox').get()).docs[0];
  assert.equal(outbox.get('status'),'HELD');
  assert.deepEqual(await counts(f),[1,1,1]);
});
gScenario('exact cursor-attested replay is idempotent and cannot be downgraded to Stage F',async f=>{
  const args={...f.args,stageG:f.stageG};
  assert.equal((await rehearseSyntheticMultiPageRecovery(args)).replay,false);
  assert.equal((await rehearseSyntheticMultiPageRecovery(args)).replay,true);
  await assert.rejects(rehearseSyntheticMultiPageRecovery(f.args),/FHIR_POLL_F_REPLAY_CONFLICT/);
  assert.deepEqual(await counts(f),[1,1,1]);
});
gScenario('two concurrent cursor-attested writers commit only one evidence chain',async f=>{
  const args={...f.args,stageG:f.stageG};
  const result=await Promise.all([rehearseSyntheticMultiPageRecovery(args),rehearseSyntheticMultiPageRecovery(args)]);
  assert.deepEqual(result.map(x=>x.replay).sort(),[false,true]);
  assert.deepEqual(await counts(f),[1,1,1]);
});
gScenario('cursor response substitution after witness export prevents any Firestore evidence',async f=>{
  const altered={...f.stageG,responseNextCursors:['OTHER_SYNTHETIC_CURSOR',null]};
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,stageG:altered}),
    /FHIR_POLL_G_CURSOR_CHAIN_DISCONNECTED/);
  await assertNoGRecorded(f);
});
gScenario('lost independent witness file fails closed',async f=>{
  await rm(f.witnessFile);
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,stageG:f.stageG}),
    /FHIR_POLL_G_DETACHED_WITNESS_NOT_CURRENT/);
  await assertNoGRecorded(f);
});
gScenario('tampered detached witness is rejected regardless of Firestore receipts',async f=>{
  const content=await readFile(f.witnessFile,'utf8');
  const row=JSON.parse(content.trim());row.pages[0].completedEvidenceDigest='f'.repeat(64);
  await writeFile(f.witnessFile,JSON.stringify(row)+'\n');
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,stageG:f.stageG}),
    /FHIR_POLL_G_SIGNATURE_INVALID/);
  await assertNoGRecorded(f);
});
gScenario('expired signed certificate cannot qualify a current source',async f=>{
  const now=Date.now();
  const draft={...f.stageG.certificate,issuedAtMs:now-120000,expiresAtMs:now-1000};
  const {signatureHex:_sig,...unsigned}=draft;
  const certificate=f.issuer.sign(unsigned);
  await rm(f.witnessFile);
  await f.stageG.detachedWitness.pin(certificate);
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,stageG:{...f.stageG,certificate}}),
    /FHIR_POLL_G_CERTIFICATE_EXPIRED_OR_CLOCK_INVALID/);
  await assertNoGRecorded(f);
});
gScenario('consent withdrawal between pages blocks both Stage F and G',async f=>{
  await f.root.collection('fhirPatientLinks').doc(fhirPatientLinkId(sourceId,externalPatientId))
    .update({consentStatus:'WITHDRAWN'});
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,stageG:f.stageG}),
    /FHIR_POLL_F_CONSENT_OR_PATIENT_LINEAGE_INVALID/);
  await assertNoGRecorded(f);
});
gScenario('changed source revision fails before the vendor cursor can be used',async f=>{
  await f.root.collection('fhirSources').doc(sourceId).update({syntheticOnly:false});
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,stageG:f.stageG}),
    /FHIR_POLL_F_SOURCE_CHANGED_OR_UNAUTHORIZED/);
  await assertNoGRecorded(f);
});
gScenario('missing clinical middle receipt blocks signed cursor continuity',async f=>{
  await f.root.collection('fhirImportedVersions').doc(f.anchor.steps[1].receiptId).delete();
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,stageG:f.stageG}),
    /FHIR_POLL_F_LINK_OR_PATIENT_ID_MISSING|FHIR_POLL_F_IMPORT_EVIDENCE_INVALID/);
  await assertNoGRecorded(f);
});
gScenario('precommit interruption leaves only detached witness, no partial Firestore evidence',async f=>{
  const args={...f.args,stageG:f.stageG};
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...args,
    afterValidationBeforeCommit:async()=>{throw new Error('STAGE_G_SYNTHETIC_CRASH');},
  }),/STAGE_G_SYNTHETIC_CRASH/);
  await assertNoGRecorded(f);
  const result=await rehearseSyntheticMultiPageRecovery(args);
  assert.equal(result.replay,false);
  assert.deepEqual(await counts(f),[1,1,1]);
});
gScenario('first-page crash recovery still requires full evidence and cursor chain',async f=>{
  assert.equal(f.anchor.abandonedReservations.length,1);
  const result=await rehearseSyntheticMultiPageRecovery({...f.args,stageG:f.stageG});
  assert.equal(result.status,'REHEARSAL_ONLY');
},true);
gScenario('second-page third-epoch takeover retains cursor chain and all checkpoints',async f=>{
  assert.equal(f.anchor.steps[2].epoch,3);
  const result=await rehearseSyntheticMultiPageRecovery({...f.args,stageG:f.stageG});
  assert.equal(result.status,'REHEARSAL_ONLY');
},false,true);
gScenario('self-provided reviewer cannot bypass detached witness binding',async f=>{
  await assert.rejects(rehearseSyntheticMultiPageRecovery({...f.args,stageG:f.stageG,
    reviews:[{...f.reviews[0],reviewerId:f.actor.actorId},f.reviews[1]]}),
    /FHIR_POLL_F_ACTOR_OR_SCOPE_DENIED|FHIR_POLL_F_REVIEW/);
  await assertNoGRecorded(f);
});

/** G2 detached restore certificate uses a separately held TEST key, never Firestore. */
scenario('detached inventory contains no patient, vendor cursor, or clinical payload',async f=>{
  const signer=new EmulatorOnlyG2DetachedRestoreSigner(randomBytes(32));
  const result=await rehearseSyntheticMultiPageRecovery({
    ...f.args,detachedRestore:{signer},
  });
  const cert=result.detachedRestoreCertificate;
  assert.ok(cert);
  assert.equal(cert.kind,'SYNTHETIC_DETACHED_RESTORE_DATA_INVENTORY');
  assert.ok(cert.entries.length>=40);
  assert.equal(cert.entries.length,new Set(cert.entries.map(x=>x.slot)).size);
  const printed=JSON.stringify(cert);
  for(const confidential of [
    patientId,externalPatientId,'resourceJson','resourceHash',
    'OPAQUE_F_VENDOR_CURSOR_PAGE_1','obs-f-0-0',
    f.actor.tenantId,sourceId,facilityId,
  ])assert.ok(!printed.includes(confidential),'inventory leaked identifier or payload');
  assert.match(g2RestoreCertificateFingerprint(cert),/^[a-f0-9]{64}$/);
  const event=(await f.root.collection('fhirPollMultiRecoveryRehearsals').get()).docs[0];
  assert.equal(event.get('detachedRestoreQualification'),'LOCAL_DATA_INTEGRITY_ONLY');
  assert.equal(event.get('productionAuthorization'),'NO_GO');
  assert.equal((await f.root.collection('patient360Projections').get()).size,0);
});
scenario('exact detached inventory replay is idempotent and cannot be downgraded',async f=>{
  const signer=new EmulatorOnlyG2DetachedRestoreSigner(randomBytes(32));
  const first=await rehearseSyntheticMultiPageRecovery({...f.args,detachedRestore:{signer}});
  assert.equal(first.replay,false);
  assert.ok(first.detachedRestoreCertificate);
  const second=await rehearseSyntheticMultiPageRecovery({...f.args,detachedRestore:{
    signer,expectedCertificate:first.detachedRestoreCertificate,
  }});
  assert.equal(second.replay,true);
  assert.deepEqual(second.detachedRestoreCertificate,first.detachedRestoreCertificate);
  await assert.rejects(rehearseSyntheticMultiPageRecovery(f.args),/FHIR_POLL_F_REPLAY_CONFLICT/);
  assert.deepEqual(await counts(f),[1,1,1]);
});
scenario('post-export added audit metadata fails independent inventory proof',async f=>{
  const signer=new EmulatorOnlyG2DetachedRestoreSigner(randomBytes(32));
  const first=await rehearseSyntheticMultiPageRecovery({...f.args,detachedRestore:{signer}});
  assert.ok(first.detachedRestoreCertificate);
  const audit=f.root.collection('auditLogs').doc('fau_'+f.anchor.steps[1].checkpointEventId);
  await audit.update({syntheticChangedAuditMetadata:'unexpected-edit'});
  // Base Stage F checks necessary fields, but the inventory pins the WHOLE
  // record and rejects unauthorized extra fields before any new write.
  await assert.rejects(rehearseSyntheticMultiPageRecovery({
    ...f.args,rehearsalId:randomUUID(),detachedRestore:{
      signer,expectedCertificate:first.detachedRestoreCertificate,
    },
  }),/G2_DETACHED_RESTORE_INVENTORY_OR_SIGNATURE_MISMATCH/);
  assert.deepEqual(await counts(f),[1,1,1]);
});
scenario('post-export modified resource body fails inventory and Stage F',async f=>{
  const signer=new EmulatorOnlyG2DetachedRestoreSigner(randomBytes(32));
  const first=await rehearseSyntheticMultiPageRecovery({...f.args,detachedRestore:{signer}});
  assert.ok(first.detachedRestoreCertificate);
  const receipt=f.root.collection('fhirImportedVersions').doc(f.anchor.steps[1].receiptId);
  await receipt.update({resourceJson:'{"resourceType":"Observation","id":"forged"}'});
  await assert.rejects(rehearseSyntheticMultiPageRecovery({
    ...f.args,rehearsalId:randomUUID(),detachedRestore:{
      signer,expectedCertificate:first.detachedRestoreCertificate,
    },
  }),/FHIR_POLL_F_IMPORT_EVIDENCE_INVALID/);
  assert.deepEqual(await counts(f),[1,1,1]);
});
scenario('certificate alteration or unrelated key cannot qualify backup replay',async f=>{
  const signer=new EmulatorOnlyG2DetachedRestoreSigner(randomBytes(32));
  const {detachedRestoreCertificate:cert}=await rehearseSyntheticMultiPageRecovery({
    ...f.args,detachedRestore:{signer},
  });
  assert.ok(cert);
  const row=cert.entries[3];
  const changed={...cert,entries:cert.entries.map((x,i)=>
    i===3?{...x,tagHex:x.tagHex==='a'.repeat(64)?'b'.repeat(64):'a'.repeat(64)}:x)};
  await assert.rejects(rehearseSyntheticMultiPageRecovery({
    ...f.args,rehearsalId:randomUUID(),detachedRestore:{
      signer,expectedCertificate:changed,
    },
  }),/G2_DETACHED_RESTORE_INVENTORY_OR_SIGNATURE_MISMATCH/);
  assert.ok(row);
  // Reject unbound fields even if the existing tags and MAC remain valid.
  await assert.rejects(rehearseSyntheticMultiPageRecovery({
    ...f.args,rehearsalId:randomUUID(),detachedRestore:{
      signer,expectedCertificate:{...cert,patientId:'MUST_NOT_BE_EMITTED'},
    },
  }),/G2_DETACHED_RESTORE_CERTIFICATE_INVALID/);
  await assert.rejects(rehearseSyntheticMultiPageRecovery({
    ...f.args,rehearsalId:randomUUID(),detachedRestore:{
      signer,expectedCertificate:{...cert,entries:cert.entries.map((x,i)=>
        i===0?{...x,patientId:'MUST_NOT_BE_EMITTED'}:x)},
    },
  }),/G2_DETACHED_RESTORE_CERTIFICATE_INVALID/);
  const wrongSigner=new EmulatorOnlyG2DetachedRestoreSigner(randomBytes(32));
  await assert.rejects(rehearseSyntheticMultiPageRecovery({
    ...f.args,rehearsalId:randomUUID(),detachedRestore:{
      signer:wrongSigner,expectedCertificate:cert,
    },
  }),/G2_DETACHED_RESTORE_INVENTORY_OR_SIGNATURE_MISMATCH/);
  assert.deepEqual(await counts(f),[1,1,1]);
});
scenario('restored byte-identical manifest fails original revision fence',async f=>{
  const signer=new EmulatorOnlyG2DetachedRestoreSigner(randomBytes(32));
  const first=await rehearseSyntheticMultiPageRecovery({...f.args,detachedRestore:{signer}});
  assert.ok(first.detachedRestoreCertificate);
  const ref=f.root.collection('fhirPollWorkManifests').doc(f.manifests[0].manifestId);
  const copy=(await ref.get()).data();
  assert.ok(copy);
  await ref.delete();
  await ref.create(copy);
  await assert.rejects(rehearseSyntheticMultiPageRecovery({
    ...f.args,rehearsalId:randomUUID(),detachedRestore:{
      signer,expectedCertificate:first.detachedRestoreCertificate,
    },
  }),/FHIR_POLL_F_PAGE_REVISION_OR_PAYLOAD_INVALID/);
  assert.deepEqual(await counts(f),[1,1,1]);
});
scenario('detached inventory cannot run in PRODUCTION mode',async f=>{
  const env=process.env.GHIMS_RUNTIME_MODE;
  try{
    process.env.GHIMS_RUNTIME_MODE='PRODUCTION';
    assert.throws(()=>new EmulatorOnlyG2DetachedRestoreSigner(randomBytes(32)),
      /FHIR_POLL_F_EMULATOR_ONLY/);
  }finally{process.env.GHIMS_RUNTIME_MODE=env;}
  assert.deepEqual(await counts(f),[0,0,0]);
});

/** Cold-readback v1 uses a local encrypted file, never a Firestore restore. */
async function syntheticColdFixture(f:Fixture){
  const detachedSigner=new EmulatorOnlyG2DetachedRestoreSigner(randomBytes(32));
  const encryptionKey=randomBytes(32);
  const first=await rehearseSyntheticMultiPageRecovery({
    ...f.args,captureValidatedEvidenceForBackup:true,
    detachedRestore:{signer:detachedSigner},
  });
  assert.ok(first.detachedRestoreCertificate);
  assert.ok(first.validatedEvidenceForBackup);
  const archiveId=randomUUID();
  const backup=encryptVerifiedSyntheticG2Evidence({
    archiveId,stageFSigner:f.signer,detachedSigner,
    evidence:first.validatedEvidenceForBackup,
    detachedCertificate:first.detachedRestoreCertificate,encryptionKey,
  });
  const readArgs={
    expectedArchiveFingerprint:backup.fingerprint,
    expectedArchiveId:archiveId,
    expectedTenantId:f.actor.tenantId,
    expectedSourceId:sourceId,
    expectedFacilityId:facilityId,
    trustedDetachedCertificate:first.detachedRestoreCertificate,
    stageFSigner:f.signer,detachedSigner,decryptionKey:encryptionKey,
  };
  return {...backup,...readArgs};
}

scenario('encrypted synthetic backup file cold-readback returns quarantined evidence only',async f=>{
  const backup=await syntheticColdFixture(f);
  const dir=await mkdtemp(join(tmpdir(),'helixis-g2-cold-'));
  try{
    const path=join(dir,'restore.g2-test.enc.json');
    await writeSyntheticColdBackupFile(path,backup.envelope);
    const disk=await readFile(path,'utf8');
    for(const secret of [
      patientId,externalPatientId,
      'resourceJson','obs-f-0-0','OPAQUE_F_VENDOR_CURSOR_PAGE_0',
    ])assert.ok(!disk.includes(secret),'encrypted archive leaked clinical field');
    const snapshot=await readSyntheticColdBackupFile(path);
    const restored=coldReadbackVerifiedSyntheticG2Evidence({
      ...backup,envelope:snapshot,
    });
    assert.equal(restored.status,'QUARANTINED_REQUIRES_FRESH_ANCHOR');
    assert.equal(restored.clinicalAuthority,false);
    assert.equal(restored.sourceDispatchAllowed,false);
    assert.equal(restored.productionRelease,'NO_GO');
    assert.equal(restored.validatedEvidence.steps.length,4);
    assert.deepEqual(await counts(f),[1,1,1]);
    assert.equal((await f.root.collection('patient360Projections').get()).size,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});
scenario('cold readback is deterministic across fresh process-like key holders',async f=>{
  const backup=await syntheticColdFixture(f);
  // Distinct AES key object models a fresh local readback session. The
  // test custody signer is deliberately retained independently of the file.
  const after=coldReadbackVerifiedSyntheticG2Evidence({
    ...backup,
    decryptionKey:Buffer.from(backup.decryptionKey),
  });
  assert.equal(after.archiveFingerprint,backup.fingerprint);
  assert.equal(after.status,'QUARANTINED_REQUIRES_FRESH_ANCHOR');
});
scenario('modified encrypted payload fails even with attacker-updated archive fingerprint',async f=>{
  const backup=await syntheticColdFixture(f);
  const bytes=Buffer.from(backup.envelope.ciphertextBase64,'base64');
  bytes[0]^=1;
  const altered:G2SyntheticColdBackup={
    ...backup.envelope,ciphertextBase64:bytes.toString('base64'),
  };
  const guessedFingerprint=fingerprintSyntheticG2ColdBackup(altered);
  assert.notEqual(guessedFingerprint,backup.fingerprint);
  await assert.rejects(async()=>coldReadbackVerifiedSyntheticG2Evidence({
    ...backup,envelope:altered,expectedArchiveFingerprint:guessedFingerprint,
  }),/G2_COLD_READBACK_AUTHENTICATION_FAILED/);
  assert.deepEqual(await counts(f),[1,1,1]);
});
scenario('wrong encryption key rejects the authenticated readback',async f=>{
  const backup=await syntheticColdFixture(f);
  assert.throws(()=>coldReadbackVerifiedSyntheticG2Evidence({
    ...backup,envelope:backup.envelope,decryptionKey:randomBytes(32),
  }),/G2_COLD_READBACK_AUTHENTICATION_FAILED/);
});
scenario('old independently signed archive head is rejected after newer backup',async f=>{
  const original=await syntheticColdFixture(f);
  const newer=encryptVerifiedSyntheticG2Evidence({
    archiveId:randomUUID(),evidence:
      coldReadbackVerifiedSyntheticG2Evidence({...original,envelope:original.envelope}).validatedEvidence,
    stageFSigner:f.signer,detachedSigner:original.detachedSigner,
    detachedCertificate:original.trustedDetachedCertificate,
    encryptionKey:original.decryptionKey,
  });
  assert.notEqual(original.fingerprint,newer.fingerprint);
  assert.throws(()=>coldReadbackVerifiedSyntheticG2Evidence({
    ...original,envelope:original.envelope,
    expectedArchiveFingerprint:newer.fingerprint,
  }),/G2_COLD_READBACK_INDEPENDENT_ARCHIVE_HEAD_MISMATCH/);
});
scenario('changed scope and substituted signed certificate are denied',async f=>{
  const backup=await syntheticColdFixture(f);
  assert.throws(()=>coldReadbackVerifiedSyntheticG2Evidence({
    ...backup,envelope:backup.envelope,expectedTenantId:'other-tenant',
  }),/G2_COLD_READBACK_EXPECTED_SCOPE_MISMATCH/);
  const otherSigner=new EmulatorOnlyG2DetachedRestoreSigner(randomBytes(32));
  const otherCert=otherSigner.sign(
    coldReadbackVerifiedSyntheticG2Evidence({...backup,envelope:backup.envelope}).validatedEvidence);
  assert.throws(()=>coldReadbackVerifiedSyntheticG2Evidence({
    ...backup,envelope:backup.envelope,trustedDetachedCertificate:otherCert,
  }),/G2_COLD_READBACK_DETACHED_CERTIFICATE_MISMATCH/);
});
scenario('backup envelope rejects unsigned metadata smuggling and malformed IV',async f=>{
  const backup=await syntheticColdFixture(f);
  assert.throws(()=>coldReadbackVerifiedSyntheticG2Evidence({
    ...backup,envelope:{...backup.envelope,sourceToken:'SHOULD_NOT_BE_HERE'},
  }),/G2_COLD_READBACK_ENVELOPE_INVALID/);
  assert.throws(()=>coldReadbackVerifiedSyntheticG2Evidence({
    ...backup,envelope:{...backup.envelope,nonceHex:'invalid'},
  }),/G2_COLD_READBACK_ENVELOPE_INVALID/);
});
scenario('exclusive file write cannot overwrite existing backup and truncation denies read',async f=>{
  const backup=await syntheticColdFixture(f);
  const dir=await mkdtemp(join(tmpdir(),'helixis-g2-cold-'));
  try{
    const path=join(dir,'snapshot.g2-test.enc.json');
    await writeSyntheticColdBackupFile(path,backup.envelope);
    await assert.rejects(writeSyntheticColdBackupFile(path,backup.envelope),/EEXIST/);
    const before=await readFile(path,'utf8');
    assert.equal(JSON.parse(before).archiveId,backup.envelope.archiveId);
    await writeFile(path,'{');
    await assert.rejects(readSyntheticColdBackupFile(path),
      /G2_COLD_READBACK_BACKUP_FILE_JSON_INVALID/);
    assert.deepEqual(await counts(f),[1,1,1]);
  }finally{await rm(dir,{recursive:true,force:true});}
});
scenario('restored record remains untrusted if live consent was withdrawn since export',async f=>{
  const backup=await syntheticColdFixture(f);
  await f.root.collection('fhirPatientLinks').doc(
    fhirPatientLinkId(sourceId,externalPatientId)).update({consentStatus:'WITHDRAWN'});
  const result=coldReadbackVerifiedSyntheticG2Evidence({
    ...backup,envelope:backup.envelope,
  });
  // Validity of an old snapshot does not prove current clinical authority.
  assert.equal(result.status,'QUARANTINED_REQUIRES_FRESH_ANCHOR');
  assert.equal(result.sourceDispatchAllowed,false);
  assert.equal(result.clinicalAuthority,false);
  assert.deepEqual(await counts(f),[1,1,1]);
});
scenario('synthetic encryption and readback are unavailable in PRODUCTION mode',async f=>{
  const backup=await syntheticColdFixture(f);
  const mode=process.env.GHIMS_RUNTIME_MODE;
  try{
    process.env.GHIMS_RUNTIME_MODE='PRODUCTION';
    assert.throws(()=>coldReadbackVerifiedSyntheticG2Evidence({
      ...backup,envelope:backup.envelope,
    }),/FHIR_POLL_F_EMULATOR_ONLY/);
  }finally{process.env.GHIMS_RUNTIME_MODE=mode;}
});
