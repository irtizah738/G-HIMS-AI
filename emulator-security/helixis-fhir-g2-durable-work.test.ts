/**
 * G2 persistent work-state emulator qualification, NEVER hosted Firestore.
 * Tests exercise concurrent delivery, immutable event write, fail-closed
 * source revision, crash/takeover, replay, and manual evidence review.
 */
import {test,expect} from 'bun:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {getAdminFirestore} from '@/server/firebase/admin';
import {EmulatorOnlyAesGcmCipher} from '@/lib/clinical/intelligence/external-fhir-poll-manifest-seal';
import {fhirPatientLinkId} from '@/lib/clinical/intelligence/external-fhir-import';
import {recoverSyntheticG2FreshManifest} from '@/lib/clinical/intelligence/external-fhir-g2-fresh-manifest-recovery';
import {syntheticG2RecoveryCredentialBinding} from '@/lib/clinical/intelligence/external-fhir-g2-recovery-credential-binding';
import {
  persistSealedSyntheticPollManifest,runPersistedSyntheticFhirPoll, type NewPollWorkManifest,
} from '@/lib/clinical/intelligence/external-fhir-poll-manifest-store';
import {
  enqueueSyntheticG2Work,claimSyntheticG2Work,settleSyntheticG2Work,
  reconcileSyntheticG2Checkpoint,recordSyntheticG2HeldReview,supersedeSyntheticG2HeldWork,
} from '@/lib/clinical/intelligence/external-fhir-g2-durable-work';

const sourceId='g2-synthetic-fhir',facilityId='synthetic-facility';
function isolation(){
  if(process.env.NODE_ENV!=='test'||process.env.GHIMS_RUNTIME_MODE!=='TEST'||
     process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
     process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED!=='false'||
     process.env.GHIMS_INTEGRATION_FHIR_R4_STATE!=='DISABLED') {
    throw new Error('G2_EMULATOR_ISOLATION_REQUIRED');
  }
}
async function fixture() {
  isolation();
  const db=getAdminFirestore();
  if(!db) throw new Error('G2_EMULATOR_ADMIN_REQUIRED');
  const tenantId='g2-'+randomUUID().slice(0,10);
  const root=db.collection('tenants').doc(tenantId);
  const workId=randomUUID();
  const actor={
    actorId:'g2-offline-tester',tenantId,roles:[],
    permissions:['FHIR_IMPORT','FHIR_POLL_COORDINATE'],
    facilityIds:[facilityId],
  };
  const cipher=new EmulatorOnlyAesGcmCipher(randomBytes(32),'g2-fixture-key');
  const source=root.collection('fhirSources').doc(sourceId);
  const manifest:NewPollWorkManifest={
    tenantId,facilityId,sourceId,manifestId:randomUUID(),
    startCheckpointSequence:0,vendorCursor:null,
    items:[{workId,resourceType:'Observation' as const,
      resourceId:'test-observation',expectedVersionId:'v1'}],
  };
  await Promise.all([
    root.collection('patients').doc('g2-local-patient').set({tenantId,status:'ACTIVE'}),
    root.collection('fhirPatientLinks')
      .doc(fhirPatientLinkId(sourceId,'g2-external-patient')).set({
        tenantId,sourceId,facilityId,externalPatientId:'g2-external-patient',
        patientId:'g2-local-patient',matchStatus:'VERIFIED',consentStatus:'GRANTED',
      }),
  ]);
  await source.set({
    tenantId,facilityId,sourceId,baseUrl:'https://fhir.example.test/r4',
    status:'ACTIVE',securityReviewStatus:'APPROVED',syncMode:'FENCED',
    syntheticOnly:true,approvedResourceTypes:['Patient','Encounter','Observation'],
  });
  const stored=await persistSealedSyntheticPollManifest({db,actor,manifest,cipher});
  const scope={
    db,actor,cipher,workId,
    manifest:{...manifest,sourceRevision:stored.sourceRevision},
  };
  return {root,source,scope};
}
const claimArgs=(scope:Awaited<ReturnType<typeof fixture>>['scope'])=>({
  ...scope,workerId:randomUUID(),claimId:randomUUID(),ttlMs:60_000,
});
const fence=(s:Awaited<ReturnType<typeof fixture>>['scope'],w:string,c:string,
  leaseEpoch:number,attempts:number)=>({
  tenantId:s.manifest.tenantId,sourceId,manifestId:s.manifest.manifestId,
  workId:s.workId,workerId:w,claimId:c,leaseEpoch,attempts,
});
test('G2: duplicate enqueue is one immutable event, audit, held outbox',async()=>{
  const f=await fixture();
  try{
    const [a,b]=await Promise.all([enqueueSyntheticG2Work(f.scope),enqueueSyntheticG2Work(f.scope)]);
    expect([a.replay,b.replay].sort()).toEqual([false,true]);
    expect(a.state.status).toBe('QUEUED');
    const events=await f.root.collection('fhirG2SyntheticWorkEvents').get();
    const outbox=await f.root.collection('fhirG2SyntheticWorkOutbox').get();
    expect(events.size).toBe(1);
    expect(outbox.size).toBe(1);
    expect(events.docs[0].get('immutable')).toBe(true);
    expect(outbox.docs[0].get('status')).toBe('HELD');
    expect((await f.root.collection('auditLogs').get()).size).toBe(2); // sealed manifest + work event
    expect((await f.root.collection('patient360Projections').get()).size).toBe(0);
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: concurrent owners, deterministic retry, stale claim and held evidence',async()=>{
  const f=await fixture();
  try{
    await enqueueSyntheticG2Work(f.scope);
    const a=claimArgs(f.scope),b=claimArgs(f.scope);
    const race=await Promise.allSettled([claimSyntheticG2Work(a),claimSyntheticG2Work(b)]);
    expect(race.filter(x=>x.status==='fulfilled').length).toBe(1);
    expect(race.filter(x=>x.status==='rejected').length).toBe(1);
    const winner=(race[0].status==='fulfilled'?a:b);
    const first=(race[0].status==='fulfilled'?race[0]:race[1]);
    if(first.status!=='fulfilled')throw new Error('G2_CLAIM_RACE_NO_WINNER');
    const firstFence=fence(f.scope,winner.workerId,winner.claimId,
      first.value.state.leaseEpoch,first.value.state.attempts);
    expect(first.value.state.attempts).toBe(1);
    const repeated=await claimSyntheticG2Work(winner);
    expect(repeated.replay).toBe(true);
    const result=await settleSyntheticG2Work({
      ...f.scope,claim:firstFence,httpStatus:429,retryAfterSeconds:0,
    });
    expect(result.state.status).toBe('RETRY_WAIT');
    expect(result.checkpointAuthorized).toBe(false);
    const replay=await settleSyntheticG2Work({
      ...f.scope,claim:firstFence,httpStatus:429,retryAfterSeconds:0,
    });
    expect(replay.replay).toBe(true);
    await expect(settleSyntheticG2Work({
      ...f.scope,claim:firstFence,httpStatus:200,
    })).rejects.toThrow('OUTCOME_REPLAY_CONFLICT');
    const stateRef=f.root.collection('fhirG2SyntheticWorkStates')
      .doc((await f.root.collection('fhirG2SyntheticWorkStates').get()).docs[0].id);
    // Move retry clock only in synthetic emulator to simulate due date.
    await stateRef.update({retryNotBeforeMs:0});
    const second=await claimSyntheticG2Work(claimArgs(f.scope));
    expect(second.state.leaseEpoch).toBe(2);
    expect(second.state.attempts).toBe(2);
    await expect(settleSyntheticG2Work({
      ...f.scope,claim:firstFence,httpStatus:200,
    })).rejects.toThrow('STALE_WORK_CLAIM');
    const secondFence=fence(f.scope,second.state.workerId!,second.state.claimId!,
      second.state.leaseEpoch,second.state.attempts);
    const pending=await settleSyntheticG2Work({...f.scope,claim:secondFence,httpStatus:200});
    expect(pending.state.status).toBe('EVIDENCE_PENDING');
    await expect(claimSyntheticG2Work(claimArgs(f.scope))).rejects
      .toThrow('WORK_HELD_FOR_REVIEW');
    expect((await f.root.collection('fhirSourcePollEvents').get()).size).toBe(0);
    expect((await f.root.collection('fhirImportedVersions').get()).size).toBe(0);
    expect((await f.root.collection('patient360Projections').get()).size).toBe(0);
    const ev=await f.root.collection('fhirG2SyntheticWorkEvents').get();
    const ob=await f.root.collection('fhirG2SyntheticWorkOutbox').get();
    expect(ev.size).toBe(5); // enqueue, claim, retry, claim, evidence pending
    expect(ob.size).toBe(5);
    for(const row of ob.docs)expect(row.get('status')).toBe('HELD');
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: lease expiry requires new epoch; old owner cannot settle',async()=>{
  const f=await fixture();
  try{
    await enqueueSyntheticG2Work(f.scope);
    const a=claimArgs(f.scope);
    const first=await claimSyntheticG2Work(a);
    const row=(await f.root.collection('fhirG2SyntheticWorkStates').get()).docs[0];
    await row.ref.update({leaseExpiresAtMs:0});
    await expect(claimSyntheticG2Work(a)).rejects.toThrow('EXPIRED_CLAIM_REPLAY');
    const second=await claimSyntheticG2Work(claimArgs(f.scope));
    expect(second.state.leaseEpoch).toBe(first.state.leaseEpoch+1);
    await expect(settleSyntheticG2Work({
      ...f.scope,
      claim:fence(f.scope,a.workerId,a.claimId,first.state.leaseEpoch,first.state.attempts),
      httpStatus:200,
    })).rejects.toThrow('STALE_WORK_CLAIM');
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: changed or revoked source cannot enqueue, claim or settle',async()=>{
  const f=await fixture();
  try{
    await enqueueSyntheticG2Work(f.scope);
    const a=claimArgs(f.scope),got=await claimSyntheticG2Work(a);
    await f.source.update({status:'REVOKED'});
    await expect(settleSyntheticG2Work({
      ...f.scope,
      claim:fence(f.scope,a.workerId,a.claimId,got.state.leaseEpoch,got.state.attempts),
      httpStatus:200,
    })).rejects.toThrow('SOURCE_REVOKED_OR_REVISED');
    await expect(claimSyntheticG2Work(claimArgs(f.scope))).rejects.toThrow('SOURCE_REVOKED_OR_REVISED');
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: error responses pause/quarantine without retry or clinical deletion',async()=>{
  for(const [httpStatus,status] of [[403,'PAUSED_AUTH'],[404,'HELD_ABSENCE'],
      [410,'HELD_ABSENCE'],[302,'QUARANTINED'],[304,'QUARANTINED']] as const){
    const f=await fixture();
    try{
      await enqueueSyntheticG2Work(f.scope);
      const a=claimArgs(f.scope),got=await claimSyntheticG2Work(a);
      const result=await settleSyntheticG2Work({
        ...f.scope,claim:fence(f.scope,a.workerId,a.claimId,got.state.leaseEpoch,got.state.attempts),
        httpStatus,
      });
      expect(result.state.status).toBe(status);
      expect(result.clinicalAuthority).toBe(false);
      expect(result.checkpointAuthorized).toBe(false);
      await expect(claimSyntheticG2Work(claimArgs(f.scope))).rejects.toThrow('WORK_HELD_FOR_REVIEW');
    }finally{await f.scope.db.recursiveDelete(f.root);}
  }
},60000);
test('G2: local guard rejects production and non-emulator execution',async()=>{
  const f=await fixture();
  try{
    for(const [key,value] of [['GHIMS_RUNTIME_MODE','PRODUCTION'],
      ['FIRESTORE_EMULATOR_HOST','']] as const){
      const saved=process.env[key];
      try {
        process.env[key]=value;
        await expect(enqueueSyntheticG2Work(f.scope)).rejects.toThrow('EMULATOR_ONLY');
      }finally{process.env[key]=saved;}
    }
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);

function fhirObservation(){
  return {
    resourceType:'Observation',id:'test-observation',status:'final',
    meta:{versionId:'v1',lastUpdated:'2026-10-21T10:00:00Z'},
    subject:{reference:'Patient/g2-external-patient'},
    code:{coding:[{system:'http://loinc.org',code:'2160-0'}]},
    valueQuantity:{value:1.1,system:'http://unitsofmeasure.org',code:'mg/dL'},
  };
}
async function pendingG2(f:Awaited<ReturnType<typeof fixture>>){
  await enqueueSyntheticG2Work(f.scope);
  const c=claimArgs(f.scope),got=await claimSyntheticG2Work(c);
  const claim=fence(f.scope,c.workerId,c.claimId,got.state.leaseEpoch,got.state.attempts);
  await settleSyntheticG2Work({...f.scope,claim,httpStatus:200});
}
async function genuineStageDEvidence(f:Awaited<ReturnType<typeof fixture>>){
  const result=await runPersistedSyntheticFhirPoll({
    db:f.scope.db,actor:f.scope.actor,sourceId,
    manifestId:f.scope.manifest.manifestId,cipher:f.scope.cipher,
    readFixture:async()=>fhirObservation(),
  });
  expect(result.checkpointSequence).toBe(1);
  const cp=await f.root.collection('fhirSourcePollEvents')
    .where('eventType','==','FHIR_SOURCE_POLL_CHECKPOINTED').get();
  expect(cp.size).toBe(1);
  return cp.docs[0].id;
}
test('G2: HTTP 200 cannot reconcile without independently persisted Stage D evidence',async()=>{
  const f=await fixture();
  try{
    await pendingG2(f);
    await expect(reconcileSyntheticG2Checkpoint({
      ...f.scope,checkpointEventId:'fse_'+'a'.repeat(64),
    })).rejects.toThrow('STAGE_D_EVIDENCE_MISSING');
    const states=await f.root.collection('fhirG2SyntheticWorkStates').get();
    expect(states.docs[0].get('status')).toBe('EVIDENCE_PENDING');
    expect((await f.root.collection('fhirG2SyntheticWorkEvents').get()).size).toBe(3);
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: genuine Stage D checkpoint reconciles once without authorizing clinical projection',async()=>{
  const f=await fixture();
  try{
    await pendingG2(f);
    const checkpointEventId=await genuineStageDEvidence(f);
    const [a,b]=await Promise.all([
      reconcileSyntheticG2Checkpoint({...f.scope,checkpointEventId}),
      reconcileSyntheticG2Checkpoint({...f.scope,checkpointEventId}),
    ]);
    expect([a.replay,b.replay].sort()).toEqual([false,true]);
    expect(a.state.status).toBe('EVIDENCE_RECONCILED');
    expect(a.state.reconciledCheckpointEventId).toBe(checkpointEventId);
    expect(a.clinicalAuthority).toBe(false);
    expect(a.checkpointAuthorized).toBe(false);
    expect((await f.root.collection('fhirG2SyntheticWorkEvents').get()).size).toBe(4);
    expect((await f.root.collection('fhirG2SyntheticWorkOutbox').get()).size).toBe(4);
    expect((await f.root.collection('patient360Projections').get()).size).toBe(0);
    await expect(claimSyntheticG2Work(claimArgs(f.scope))).rejects.toThrow('WORK_HELD_FOR_REVIEW');
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: consent withdrawal or receipt tampering blocks post-checkpoint reconciliation',async()=>{
  const f=await fixture();
  try{
    await pendingG2(f);
    const checkpointEventId=await genuineStageDEvidence(f);
    const link=f.root.collection('fhirPatientLinks').doc(fhirPatientLinkId(sourceId,'g2-external-patient'));
    await link.update({consentStatus:'WITHDRAWN'});
    await expect(reconcileSyntheticG2Checkpoint({...f.scope,checkpointEventId}))
      .rejects.toThrow('PATIENT_LINK_OR_CONSENT_REVOKED');
    await link.update({consentStatus:'GRANTED'});
    const receipt=(await f.root.collection('fhirImportedVersions').get()).docs[0];
    await receipt.ref.update({resourceJson:'{"resourceType":"Observation","id":"tampered"}'});
    await expect(reconcileSyntheticG2Checkpoint({...f.scope,checkpointEventId}))
      .rejects.toThrow('STAGE_D_RECEIPT_INTEGRITY_INVALID');
    expect((await f.root.collection('fhirG2SyntheticWorkStates').get()).docs[0]
      .get('status')).toBe('EVIDENCE_PENDING');
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
const reviewer=(f:Awaited<ReturnType<typeof fixture>>,actorId:string,
  role:'SECURITY'|'CLINICAL')=>({
  actorId,tenantId:f.scope.manifest.tenantId,roles:[],
  permissions:[role==='SECURITY'?'FHIR_POLL_SECURITY_REVIEW':'FHIR_POLL_CLINICAL_REVIEW'],
  facilityIds:[facilityId],
});
async function heldG2(f:Awaited<ReturnType<typeof fixture>>){
  await enqueueSyntheticG2Work(f.scope);
  const c=claimArgs(f.scope),got=await claimSyntheticG2Work(c);
  await settleSyntheticG2Work({...f.scope,
    claim:fence(f.scope,c.workerId,c.claimId,got.state.leaseEpoch,got.state.attempts),
    httpStatus:403});
}
test('G2: two separate governed reviewers supersede held attempt, never requeue',async()=>{
  const f=await fixture();
  try{
    await heldG2(f);
    const reviewId=randomUUID();
    const security=reviewer(f,'g2-independent-security','SECURITY');
    const clinical=reviewer(f,'g2-independent-clinician','CLINICAL');
    const securityArgs={...f.scope,reviewId,reviewer:security,
      role:'SECURITY' as const,reason:'REQUIRES_NEW_MANIFEST' as const};
    await recordSyntheticG2HeldReview(securityArgs);
    const repeated=await recordSyntheticG2HeldReview(securityArgs);
    expect(repeated.replay).toBe(true);
    await expect(supersedeSyntheticG2HeldWork({...f.scope,reviewId}))
      .rejects.toThrow('INDEPENDENT_REVIEWS_REQUIRED');
    await recordSyntheticG2HeldReview({...f.scope,reviewId,reviewer:clinical,
      role:'CLINICAL',reason:'REQUIRES_NEW_MANIFEST'});
    const [a,b]=await Promise.all([
      supersedeSyntheticG2HeldWork({...f.scope,reviewId}),
      supersedeSyntheticG2HeldWork({...f.scope,reviewId}),
    ]);
    expect([a.replay,b.replay].sort()).toEqual([false,true]);
    expect(a.state.status).toBe('REVIEWED_SUPERSEDED');
    expect(a.state.lastReviewId).toBe(reviewId);
    await expect(claimSyntheticG2Work(claimArgs(f.scope))).rejects
      .toThrow('WORK_HELD_FOR_REVIEW');
    expect((await f.root.collection('fhirG2SyntheticWorkReviews').get()).size).toBe(2);
    expect((await f.root.collection('fhirG2SyntheticWorkEvents').get()).size).toBe(4);
    expect((await f.root.collection('patient360Projections').get()).size).toBe(0);
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: unprivileged, same reviewer and cross-facility cannot authorize reopening',async()=>{
  const f=await fixture();
  try{
    await heldG2(f);
    const reviewId=randomUUID();
    await expect(recordSyntheticG2HeldReview({...f.scope,reviewId,
      reviewer:reviewer(f,'unprivileged','SECURITY'),
      role:'CLINICAL',reason:'REQUIRES_NEW_MANIFEST'}))
      .rejects.toThrow('REVIEW_AUTHORIZATION_DENIED');
    await expect(recordSyntheticG2HeldReview({...f.scope,reviewId,
      reviewer:{...reviewer(f,'cross-facility','SECURITY'),facilityIds:['wrong-facility']},
      role:'SECURITY',reason:'REQUIRES_NEW_MANIFEST'}))
      .rejects.toThrow('REVIEW_AUTHORIZATION_DENIED');
    const both={...reviewer(f,'same-user','SECURITY'),
      permissions:['FHIR_POLL_SECURITY_REVIEW','FHIR_POLL_CLINICAL_REVIEW']};
    await recordSyntheticG2HeldReview({...f.scope,reviewId,reviewer:both,
      role:'SECURITY',reason:'REQUIRES_NEW_MANIFEST'});
    await recordSyntheticG2HeldReview({...f.scope,reviewId,reviewer:both,
      role:'CLINICAL',reason:'REQUIRES_NEW_MANIFEST'});
    await expect(supersedeSyntheticG2HeldWork({...f.scope,reviewId}))
      .rejects.toThrow('INDEPENDENT_REVIEWS_REQUIRED');
    const rec=await f.root.collection('fhirG2SyntheticWorkStates').get();
    expect(rec.docs[0].get('status')).toBe('PAUSED_AUTH');
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: source revocation invalidates prior reviews and reconciliation',async()=>{
  const f=await fixture();
  try{
    await heldG2(f);
    const reviewId=randomUUID();
    await recordSyntheticG2HeldReview({...f.scope,reviewId,
      reviewer:reviewer(f,'reviewer-security','SECURITY'),
      role:'SECURITY',reason:'REQUIRES_NEW_MANIFEST'});
    await f.source.update({status:'REVOKED'});
    await expect(recordSyntheticG2HeldReview({...f.scope,reviewId,
      reviewer:reviewer(f,'reviewer-clinical','CLINICAL'),
      role:'CLINICAL',reason:'REQUIRES_NEW_MANIFEST'}))
      .rejects.toThrow('SOURCE_REVOKED_OR_REVISED');
    await expect(supersedeSyntheticG2HeldWork({...f.scope,reviewId}))
      .rejects.toThrow('SOURCE_REVOKED_OR_REVISED');
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);

test('G2: missing Stage D reservation invalidates checkpoint provenance',async()=>{
  const f=await fixture();
  try{
    await pendingG2(f);
    const checkpointEventId=await genuineStageDEvidence(f);
    const reservations=await f.root.collection('fhirSourcePollEvents')
      .where('eventType','==','FHIR_SOURCE_POLL_RESERVED').get();
    expect(reservations.size).toBe(1);
    await reservations.docs[0].ref.update({workId:'forged-different-work'});
    await expect(reconcileSyntheticG2Checkpoint({...f.scope,checkpointEventId}))
      .rejects.toThrow('STAGE_D_RESERVATION_PROOF_INVALID');
    expect((await f.root.collection('fhirG2SyntheticWorkStates').get()).docs[0]
      .get('status')).toBe('EVIDENCE_PENDING');
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: wrong tenant, facility or absent production guard cannot reconcile',async()=>{
  const f=await fixture();
  try{
    await pendingG2(f);
    const checkpointEventId=await genuineStageDEvidence(f);
    await expect(reconcileSyntheticG2Checkpoint({
      ...f.scope,actor:{...f.scope.actor,tenantId:'different-tenant'},checkpointEventId,
    })).rejects.toThrow('SCOPE_DENIED');
    await expect(reconcileSyntheticG2Checkpoint({
      ...f.scope,actor:{...f.scope.actor,facilityIds:['another-facility']},checkpointEventId,
    })).rejects.toThrow('SCOPE_DENIED');
    const prev=process.env.GHIMS_RUNTIME_MODE;
    try{
      process.env.GHIMS_RUNTIME_MODE='PRODUCTION';
      await expect(reconcileSyntheticG2Checkpoint({...f.scope,checkpointEventId}))
        .rejects.toThrow('EMULATOR_ONLY');
    }finally{process.env.GHIMS_RUNTIME_MODE=prev;}
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);

async function approvedRecoveryFixture(f:Awaited<ReturnType<typeof fixture>>){
  await heldG2(f);
  const reviewId=randomUUID();
  await recordSyntheticG2HeldReview({...f.scope,reviewId,
    reviewer:reviewer(f,'g2-security-recovery-reviewer','SECURITY'),
    role:'SECURITY',reason:'REQUIRES_NEW_MANIFEST'});
  await recordSyntheticG2HeldReview({...f.scope,reviewId,
    reviewer:reviewer(f,'g2-clinical-recovery-reviewer','CLINICAL'),
    role:'CLINICAL',reason:'REQUIRES_NEW_MANIFEST'});
  await supersedeSyntheticG2HeldWork({...f.scope,reviewId});
  // Simulate a separately authorized, synthetic credential rotation and
  // site review, without creating or using any OAuth secret.
  await f.source.update({
    siteApprovalId:'g2-recovery-site-approval',
    oauth:{mode:'SMART_BACKEND',vendorProfile:'EPIC_SANDBOX',
      clientId:'synthetic-only',tokenUrl:'https://fhir.example.test/oauth',
      keyId:'synthetic-key-not-a-secret',secretVersion:2,credentialRevision:2,
      scopes:['system/Observation.read']},
  });
  const reviewedAt=Date.now()-10_000;
  const sourceForApproval=(await f.source.get()).data();
  if(!sourceForApproval)throw new Error('G2_SOURCE_APPROVAL_MISSING');
  const recoveryBindingSha256=syntheticG2RecoveryCredentialBinding(
    sourceForApproval as Parameters<typeof syntheticG2RecoveryCredentialBinding>[0]);
  await f.root.collection('fhirSiteApprovals').doc('g2-recovery-site-approval').set({
    tenantId:f.scope.manifest.tenantId,sourceId,facilityId,
    approvalId:'g2-recovery-site-approval',status:'APPROVED',
    credentialRevision:2,approvedResourceTypes:['Observation'],
    recoveryBindingSha256,
    clinicalReviewerId:'site-clinician',securityReviewerId:'site-security',
    sandboxQualificationId:'g2-synthetic-qual',reviewedAt,
    expiresAt:reviewedAt+86_400_000,
  });
  const snap=await f.source.get();
  const t=snap.updateTime!;
  const expectedSourceRevision=t.seconds+'.'+String(t.nanoseconds).padStart(9,'0');
  const freshManifest={
    tenantId:f.scope.manifest.tenantId,facilityId,sourceId,
    manifestId:randomUUID(),startCheckpointSequence:0,vendorCursor:null,
    items:[{workId:randomUUID(),resourceType:'Observation' as const,
      resourceId:'test-observation',expectedVersionId:'v2'}],
  };
  const actor={...f.scope.actor,
    permissions:[...f.scope.actor.permissions,'FHIR_POLL_RECOVERY']};
  return {...f.scope,oldManifest:f.scope.manifest,oldWorkId:f.scope.workId,
    reviewId,freshManifest,expectedCredentialRevision:2,expectedSourceRevision,
    externalPatientId:'g2-external-patient',actor};
}
test('G2: independently approved recovery seals one new manifest atomically and replays once',async()=>{
  const f=await fixture();
  try{
    const recovery=await approvedRecoveryFixture(f);
    const [one,two]=await Promise.all([
      recoverSyntheticG2FreshManifest(recovery),
      recoverSyntheticG2FreshManifest(recovery),
    ]);
    expect([one.replay,two.replay].sort()).toEqual([false,true]);
    expect(one.newManifestId).toBe(recovery.freshManifest.manifestId);
    expect(one.credentialRevision).toBe(2);
    expect(one.clinicalAuthority).toBe(false);
    expect(one.checkpointAuthorized).toBe(false);
    expect(one.importAuthorized).toBe(false);
    expect(one.productionRelease).toBe('NO_GO');
    expect((await f.root.collection('fhirG2SyntheticFreshRecoveries').get()).size).toBe(1);
    expect((await f.root.collection('fhirG2SyntheticRecoveryEvents').get()).size).toBe(1);
    expect((await f.root.collection('fhirPollWorkManifests').get()).size).toBe(2);
    expect((await f.root.collection('fhirPollManifestOutbox').get()).size).toBe(2);
    expect((await f.root.collection('patient360Projections').get()).size).toBe(0);
    const old=(await f.root.collection('fhirG2SyntheticWorkStates').get()).docs[0];
    expect(old.get('status')).toBe('REVIEWED_SUPERSEDED');
    const resumed=await enqueueSyntheticG2Work({
      ...f.scope,actor:recovery.actor,manifest:{
        ...recovery.freshManifest,sourceRevision:one.sourceRevision,
      },workId:one.newWorkId,
    });
    expect(resumed.state.status).toBe('QUEUED');
    expect((await f.root.collection('fhirSourcePollEvents').get()).size).toBe(0);
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: old credential revision or conflicting new manifest cannot recover',async()=>{
  const f=await fixture();
  try{
    const recovery=await approvedRecoveryFixture(f);
    await expect(recoverSyntheticG2FreshManifest({
      ...recovery,expectedCredentialRevision:1,
    })).rejects.toThrow('SOURCE_OR_CREDENTIAL_REVISION_INVALID');
    const first=await recoverSyntheticG2FreshManifest(recovery);
    expect(first.replay).toBe(false);
    await expect(recoverSyntheticG2FreshManifest({
      ...recovery,freshManifest:{...recovery.freshManifest,
        manifestId:randomUUID(),items:[{...recovery.freshManifest.items[0],
          workId:randomUUID()}]},
    })).rejects.toThrow('RECOVERY_REPLAY_CONFLICT');
    expect((await f.root.collection('fhirG2SyntheticFreshRecoveries').get()).size).toBe(1);
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: withdrawn consent, wrong tenant or facility, and expired site approval reject recovery',async()=>{
  const f=await fixture();
  try{
    const recovery=await approvedRecoveryFixture(f);
    await expect(recoverSyntheticG2FreshManifest({
      ...recovery,actor:{...recovery.actor,tenantId:'different-tenant'},
    })).rejects.toThrow('SCOPE_OR_MANIFEST_INVALID');
    await expect(recoverSyntheticG2FreshManifest({
      ...recovery,actor:{...recovery.actor,facilityIds:['wrong-facility']},
    })).rejects.toThrow('SCOPE_OR_MANIFEST_INVALID');
    const link=f.root.collection('fhirPatientLinks')
      .doc(fhirPatientLinkId(sourceId,recovery.externalPatientId));
    await link.update({consentStatus:'WITHDRAWN'});
    await expect(recoverSyntheticG2FreshManifest(recovery))
      .rejects.toThrow('PATIENT_LINK_OR_CONSENT_REVOKED');
    await link.update({consentStatus:'GRANTED'});
    await f.root.collection('fhirSiteApprovals')
      .doc('g2-recovery-site-approval').update({status:'REVOKED'});
    await expect(recoverSyntheticG2FreshManifest(recovery))
      .rejects.toThrow('CI_EXT04_SITE_APPROVAL_REQUIRED');
    expect((await f.root.collection('fhirG2SyntheticFreshRecoveries').get()).size).toBe(0);
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: old review or supersession corruption and changed source reject recovery',async()=>{
  const f=await fixture();
  try{
    const recovery=await approvedRecoveryFixture(f);
    const reviewDocs=await f.root.collection('fhirG2SyntheticWorkReviews').get();
    expect(reviewDocs.size).toBe(2);
    await reviewDocs.docs[0].ref.update({reason:'UNAUTHORIZED_REOPEN'});
    await expect(recoverSyntheticG2FreshManifest(recovery))
      .rejects.toThrow('REVIEW_PROOF_INVALID');
    await reviewDocs.docs[0].ref.update({reason:'REQUIRES_NEW_MANIFEST'});
    const event=(await f.root.collection('fhirG2SyntheticWorkEvents')
      .where('transition','==','REVIEWED_SUPERSEDED').get()).docs[0];
    await event.ref.update({governanceReviewId:'different'});
    await expect(recoverSyntheticG2FreshManifest(recovery))
      .rejects.toThrow('SUPERSESSION_EVENT_INVALID');
    await event.ref.update({governanceReviewId:recovery.reviewId});
    await f.source.update({status:'REVOKED'});
    await expect(recoverSyntheticG2FreshManifest(recovery))
      .rejects.toThrow('SOURCE_OR_CREDENTIAL_REVISION_INVALID');
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: recovery cannot reuse the held work, send cursor, or run in production',async()=>{
  const f=await fixture();
  try{
    const recovery=await approvedRecoveryFixture(f);
    for(const freshManifest of [
      {...recovery.freshManifest,manifestId:recovery.oldManifest.manifestId},
      {...recovery.freshManifest,items:[{...recovery.freshManifest.items[0],
        workId:recovery.oldWorkId}]},
      {...recovery.freshManifest,vendorCursor:'opaque-cursor'},
      {...recovery.freshManifest,items:[{...recovery.freshManifest.items[0],
        resourceId:'other-observation'}]},
    ]){
      await expect(recoverSyntheticG2FreshManifest({...recovery,freshManifest}))
        .rejects.toThrow('SCOPE_OR_MANIFEST_INVALID');
    }
    const prev=process.env.GHIMS_RUNTIME_MODE;
    try{
      process.env.GHIMS_RUNTIME_MODE='PRODUCTION';
      await expect(recoverSyntheticG2FreshManifest(recovery))
        .rejects.toThrow('EMULATOR_ONLY');
    }finally{process.env.GHIMS_RUNTIME_MODE=prev;}
    expect((await f.root.collection('fhirG2SyntheticFreshRecoveries').get()).size).toBe(0);
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);

test('G2: stale source generation, absent recovery privilege and merged patient deny recovery',async()=>{
  const f=await fixture();
  try{
    const recovery=await approvedRecoveryFixture(f);
    await expect(recoverSyntheticG2FreshManifest({
      ...recovery,expectedSourceRevision:recovery.oldManifest.sourceRevision,
    })).rejects.toThrow('SOURCE_OR_CREDENTIAL_REVISION_INVALID');
    await expect(recoverSyntheticG2FreshManifest({
      ...recovery,actor:{...recovery.actor,
        permissions:recovery.actor.permissions.filter(p=>p!=='FHIR_POLL_RECOVERY')},
    })).rejects.toThrow('SCOPE_OR_MANIFEST_INVALID');
    const patient=f.root.collection('patients').doc('g2-local-patient');
    await patient.update({mergedIntoPatientId:'different-patient'});
    await expect(recoverSyntheticG2FreshManifest(recovery))
      .rejects.toThrow('CANONICAL_PATIENT_INVALID');
    expect((await f.root.collection('fhirG2SyntheticFreshRecoveries').get()).size).toBe(0);
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: recovered manifest replay never bypasses subsequently withdrawn consent',async()=>{
  const f=await fixture();
  try{
    const recovery=await approvedRecoveryFixture(f);
    await recoverSyntheticG2FreshManifest(recovery);
    const link=f.root.collection('fhirPatientLinks')
      .doc(fhirPatientLinkId(sourceId,recovery.externalPatientId));
    await link.update({consentStatus:'WITHDRAWN'});
    await expect(recoverSyntheticG2FreshManifest(recovery))
      .rejects.toThrow('PATIENT_LINK_OR_CONSENT_REVOKED');
    expect((await f.root.collection('fhirG2SyntheticFreshRecoveries').get()).size).toBe(1);
    expect((await f.root.collection('fhirPollWorkManifests').get()).size).toBe(2);
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);

function sourceRevisionFromSnapshot(snap: {updateTime?: {seconds:number;nanoseconds:number}}):string {
  if(!snap.updateTime)throw new Error('SYNTHETIC_SOURCE_REVISION_ABSENT');
  return snap.updateTime.seconds+'.'+String(snap.updateTime.nanoseconds).padStart(9,'0');
}
test('G2: same credentialRevision cannot mask rotated token URL, client, key, secret or scopes',async()=>{
  const f=await fixture();
  try{
    const recovery=await approvedRecoveryFixture(f);
    const sourceBase=(await f.source.get()).data();
    if(!sourceBase||!sourceBase.oauth)throw new Error('G2_OAUTH_FIXTURE_MISSING');
    const altered=[
      {oauth:{...sourceBase.oauth,tokenUrl:'https://auth2.example.test/token'}},
      {oauth:{...sourceBase.oauth,clientId:'other-oauth-client'}},
      {oauth:{...sourceBase.oauth,keyId:'other-key-id'}},
      {oauth:{...sourceBase.oauth,secretVersion:3}},
      {oauth:{...sourceBase.oauth,scopes:['system/Patient.read']}},
      {baseUrl:'https://other-fhir.example.test/r4'},
    ];
    for(const patch of altered){
      await f.source.update(patch);
      const current=await f.source.get();
      await expect(recoverSyntheticG2FreshManifest({
        ...recovery,expectedSourceRevision:sourceRevisionFromSnapshot(current),
      })).rejects.toThrow('CREDENTIAL_APPROVAL_BINDING_INVALID');
      expect((await f.root.collection('fhirG2SyntheticFreshRecoveries').get()).size).toBe(0);
    }
    // Restoring the exact approved non-secret configuration uses a fresh
    // source generation but does not require a new credential approval.
    await f.source.update({oauth:sourceBase.oauth,baseUrl:sourceBase.baseUrl});
    const valid=await f.source.get();
    const created=await recoverSyntheticG2FreshManifest({
      ...recovery,expectedSourceRevision:sourceRevisionFromSnapshot(valid),
    });
    expect(created.replay).toBe(false);
    expect(created.productionRelease).toBe('NO_GO');
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: credential revision must be reapproved with an exact rotated config binding',async()=>{
  const f=await fixture();
  try{
    const recovery=await approvedRecoveryFixture(f);
    const original=(await f.source.get()).data();
    if(!original||!original.oauth)throw new Error('G2_OAUTH_FIXTURE_MISSING');
    await f.source.update({oauth:{...original.oauth,credentialRevision:3,secretVersion:3}});
    const rotated=await f.source.get();
    const next={...recovery,expectedCredentialRevision:3,
      expectedSourceRevision:sourceRevisionFromSnapshot(rotated)};
    await expect(recoverSyntheticG2FreshManifest(next))
      .rejects.toThrow('CI_EXT04_SITE_APPROVAL_REQUIRED');
    const approval=f.root.collection('fhirSiteApprovals').doc('g2-recovery-site-approval');
    await approval.update({credentialRevision:3});
    await expect(recoverSyntheticG2FreshManifest(next))
      .rejects.toThrow('CREDENTIAL_APPROVAL_BINDING_INVALID');
    await approval.update({recoveryBindingSha256:syntheticG2RecoveryCredentialBinding(
      rotated.data() as Parameters<typeof syntheticG2RecoveryCredentialBinding>[0])});
    const accepted=await recoverSyntheticG2FreshManifest(next);
    expect(accepted.credentialRevision).toBe(3);
    expect(accepted.checkpointAuthorized).toBe(false);
    expect((await f.root.collection('fhirG2SyntheticFreshRecoveries').get()).size).toBe(1);
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: synthetic precommit power loss leaves zero partial writes; retry commits once',async()=>{
  const f=await fixture();
  try{
    const recovery=await approvedRecoveryFixture(f);
    const before={
      manifests:(await f.root.collection('fhirPollWorkManifests').get()).size,
      events:(await f.root.collection('fhirPollManifestEvents').get()).size,
      audits:(await f.root.collection('auditLogs').get()).size,
      outboxes:(await f.root.collection('fhirPollManifestOutbox').get()).size,
    };
    await expect(recoverSyntheticG2FreshManifest({
      ...recovery,afterValidationBeforeCommit:async()=>{
        throw new Error('SYNTHETIC_POWER_LOSS_BEFORE_COMMIT');
      },
    })).rejects.toThrow('SYNTHETIC_POWER_LOSS_BEFORE_COMMIT');
    expect((await f.root.collection('fhirG2SyntheticFreshRecoveries').get()).size).toBe(0);
    expect((await f.root.collection('fhirG2SyntheticRecoveryEvents').get()).size).toBe(0);
    expect((await f.root.collection('fhirPollWorkManifests').get()).size).toBe(before.manifests);
    expect((await f.root.collection('fhirPollManifestEvents').get()).size).toBe(before.events);
    expect((await f.root.collection('auditLogs').get()).size).toBe(before.audits);
    expect((await f.root.collection('fhirPollManifestOutbox').get()).size).toBe(before.outboxes);
    const committed=await recoverSyntheticG2FreshManifest(recovery);
    expect(committed.replay).toBe(false);
    const lostResponseReplay=await recoverSyntheticG2FreshManifest(recovery);
    expect(lostResponseReplay.replay).toBe(true);
    expect((await f.root.collection('fhirG2SyntheticFreshRecoveries').get()).size).toBe(1);
    expect((await f.root.collection('fhirG2SyntheticRecoveryEvents').get()).size).toBe(1);
    expect((await f.root.collection('fhirPollWorkManifests').get()).size).toBe(before.manifests+1);
    expect((await f.root.collection('patient360Projections').get()).size).toBe(0);
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
test('G2: source active lease and checkpoint cursor inconsistency block fresh manifest',async()=>{
  const f=await fixture();
  try{
    const recovery=await approvedRecoveryFixture(f);
    const lease=f.root.collection('fhirSourcePollLeases').doc(sourceId);
    await lease.set({tenantId:recovery.oldManifest.tenantId,
      sourceId,facilityId,status:'ACTIVE',expiresAtMs:Date.now()+120000,
      checkpointSequence:0});
    await expect(recoverSyntheticG2FreshManifest(recovery))
      .rejects.toThrow('CHECKPOINT_SEQUENCE_OR_ACTIVE_LEASE');
    await lease.update({status:'RELEASED',expiresAtMs:0,checkpointSequence:2});
    await expect(recoverSyntheticG2FreshManifest(recovery))
      .rejects.toThrow('CHECKPOINT_SEQUENCE_OR_ACTIVE_LEASE');
    expect((await f.root.collection('fhirG2SyntheticFreshRecoveries').get()).size).toBe(0);
  }finally{await f.scope.db.recursiveDelete(f.root);}
},60000);
