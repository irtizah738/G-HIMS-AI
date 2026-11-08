/**
 * G2 persistent work-state emulator qualification, NEVER hosted Firestore.
 * Tests exercise concurrent delivery, immutable event write, fail-closed
 * source revision, crash/takeover, replay, and manual evidence review.
 */
import {test,expect} from 'bun:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {getAdminFirestore} from '@/server/firebase/admin';
import {EmulatorOnlyAesGcmCipher} from '@/lib/clinical/intelligence/external-fhir-poll-manifest-seal';
import {
  persistSealedSyntheticPollManifest, type NewPollWorkManifest,
} from '@/lib/clinical/intelligence/external-fhir-poll-manifest-store';
import {
  enqueueSyntheticG2Work,claimSyntheticG2Work,settleSyntheticG2Work,
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
