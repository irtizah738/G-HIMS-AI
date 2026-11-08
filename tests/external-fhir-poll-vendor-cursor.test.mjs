import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  EmulatorOnlyStageGCursorTagger,EmulatorOnlyStageGWitnessIssuer,
  EmulatorOnlyStageGWitnessVerifier,deriveStageGPageProofs,
  assertStageGCursorContinuity,stageGCertificateFingerprint,
  EmulatorOnlyDetachedWitnessLedger,
} from '../lib/clinical/intelligence/external-fhir-poll-vendor-cursor.ts';
import {
  EmulatorOnlyStageFRecoverySigner,stageFAnchorFingerprint,
  stageFReservationId,stageFCheckpointId,
} from '../lib/clinical/intelligence/external-fhir-poll-multi-recovery.ts';

const env=['NODE_ENV','GHIMS_RUNTIME_MODE','FIREBASE_PROJECT_ID','FIRESTORE_EMULATOR_HOST',
  'GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED','GHIMS_INTEGRATION_FHIR_R4_STATE'];
const old=Object.fromEntries(env.map(k=>[k,process.env[k]]));
const values=['test','TEST','ghims-p4-ci','127.0.0.1:8080','false','DISABLED'];
env.forEach((k,i)=>process.env[k]=values[i]);
after(()=>env.forEach(k=>old[k]===undefined?delete process.env[k]:process.env[k]=old[k]));
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sourceRevision='1794135521.123456789',tenantId='stage-g-test',sourceId='his-g-synthetic',facilityId='g-facility';
const now=1794135555123;
function make(){
  const privacy=new EmulatorOnlyStageGCursorTagger(randomBytes(32));
  const keys=generateKeyPairSync('ed25519');
  const issuer=new EmulatorOnlyStageGWitnessIssuer(keys.privateKey);
  const verifier=new EmulatorOnlyStageGWitnessVerifier(keys.publicKey);
  const witnessId=randomUUID();
  const items=[0,1].map(p=>[0,1].map(i=>({workId:randomUUID(),resourceType:'Observation',
    resourceId:`obs-g-${p}-${i}`,expectedVersionId:'v1'})));
  const cursor='opaque-synthetic-token-after-page-1';
  const manifests=items.map((group,p)=>({tenantId,sourceId,facilityId,
    sourceRevision,manifestId:randomUUID(),startCheckpointSequence:p*2,
    items:group,vendorCursor:p===0?null:cursor}));
  const pages=manifests.map((m,p)=>({manifestId:m.manifestId,
    manifestRevision:`1794135521.12345679${p}`,startCheckpointSequence:p*2,itemCount:2}));
  const steps=items.flatMap((group,p)=>group.map((w,i)=>{
    const sequence=p*2+i+1,epoch=p+1;
    return {manifestId:manifests[p].manifestId,sequence,index:i,epoch,operationSequence:sequence,
      workId:w.workId,reservationEventId:stageFReservationId(tenantId,sourceId,epoch,sequence),
      checkpointEventId:stageFCheckpointId(tenantId,sourceId,epoch,sequence),
      receiptId:'fir_'+sha([sourceId,w.resourceType,w.resourceId,w.expectedVersionId]),
      checkpointDigest:sha(['CI_EXT12_CHECKPOINT_V1',tenantId,sourceId,manifests[p].manifestId,
        manifests[p].startCheckpointSequence,i+1,w.workId,w.resourceType,w.resourceId,w.expectedVersionId])};
  }));
  const anchor=new EmulatorOnlyStageFRecoverySigner(randomBytes(32)).sign({
    schemaVersion:1,kind:'SYNTHETIC_OFFLINE_EXPORTED_MULTI_PAGE_ANCHOR',tenantId,sourceId,facilityId,
    sourceRevision,startCheckpointSequence:0,endCheckpointSequence:4,
    issuedSequence:4,finalEpoch:2,pages,steps,abandonedReservations:[],
  });
  const evidence={anchor,pages:manifests.map((manifest,p)=>({manifest,
    manifestRevision:pages[p].manifestRevision}))};
  const responseNextCursors=[cursor,null];
  const pageProofs=deriveStageGPageProofs({evidence,responseNextCursors,cursorTags:privacy});
  const draft={schemaVersion:1,kind:'SYNTHETIC_VENDOR_CURSOR_CHAIN_LOCAL_WITNESS',
    witnessId,sequence:1,previousFingerprint:null,issuedAtMs:now-1000,expiresAtMs:now+60_000,
    tenantId,sourceId,facilityId,sourceRevision,
    stageFAnchorFingerprint:stageFAnchorFingerprint(anchor),pages:pageProofs};
  const certificate=issuer.sign(draft);
  const head={witnessId,sequence:1,previousFingerprint:null,
    certificateFingerprint:stageGCertificateFingerprint(certificate)};
  const args={evidence,certificate,verifier,cursorTags:privacy,
    responseNextCursors,trustedHead:head,
    trustedStageFAnchorFingerprint:stageFAnchorFingerprint(anchor),nowMs:now};
  return { ...args,issuer,keys,head,draft,manifests,privacy,cursor};
}
const verify=f=>assertStageGCursorContinuity(f);
function reject(name,alter,re=/FHIR_POLL_G_/){
  test('Stage G rejects '+name,()=>{const f=make();alter(f);assert.throws(()=>verify(f),re);});
}
test('Stage G: two-page cursor handshake binds the completed immutable Stage F anchor',()=>{
 const f=make();assert.equal(verify(f),f.head.certificateFingerprint);
 assert.equal(f.certificate.pages[0].requestCursorTag,null);
 assert.equal(f.certificate.pages[1].nextCursorTag,null);
});
test('Stage G: cursor tags are HMAC protected and scope-separated',()=>{
 const f=make(),tag=f.certificate.pages[0].nextCursorTag;
 assert.ok(!JSON.stringify(f.certificate).includes(f.cursor));
 assert.equal(tag,f.certificate.pages[1].requestCursorTag);
 assert.notEqual(tag,f.privacy.tag({tenantId:'tenant-other',sourceId,facilityId},f.cursor));
 assert.notEqual(tag,sha(f.cursor));
});
test('Stage G: Ed25519 verified with public-only key',()=>{
 const f=make();const publicPem=f.keys.publicKey.export({type:'spki',format:'pem'});
 new EmulatorOnlyStageGWitnessVerifier(publicPem).verify(f.certificate);
});
test('Stage G: stage F source/checkpoint/receipt metadata changes certificate binding',()=>{
 const f=make();f.evidence.anchor.steps[1].receiptId='fir_'+'a'.repeat(64);
 f.trustedStageFAnchorFingerprint=stageFAnchorFingerprint(f.evidence.anchor);
 assert.throws(()=>verify(f),/ANCHOR_SCOPE_CHANGED/);
});
reject('missing detached head',f=>f.trustedHead=null,/DETACHED_WITNESS_NOT_CURRENT/);
reject('stale detached witness sequence',f=>f.trustedHead={...f.head,sequence:2},/DETACHED_WITNESS_NOT_CURRENT/);
reject('witness head fingerprint substitution',f=>f.trustedHead={...f.head,certificateFingerprint:'0'.repeat(64)},/DETACHED_WITNESS_NOT_CURRENT/);
reject('witness identity substitution',f=>f.trustedHead={...f.head,witnessId:randomUUID()},/DETACHED_WITNESS_NOT_CURRENT/);
reject('source changed',f=>f.certificate={...f.certificate,sourceId:'other'},/SIGNATURE_INVALID/);
reject('tenant changed',f=>f.certificate={...f.certificate,tenantId:'other'},/SIGNATURE_INVALID/);
reject('facility changed',f=>f.certificate={...f.certificate,facilityId:'other'},/SIGNATURE_INVALID/);
reject('manifest revision replaced',f=>f.evidence.pages[0].manifestRevision='1794135521.987654321',/PAGE_MANIFEST_CHANGED/);
reject('manifest id replaced',f=>f.evidence.pages[1].manifest.manifestId=randomUUID(),/PAGE_MANIFEST_CHANGED/);
reject('manifest source revision replaced',f=>f.evidence.pages[0].manifest.sourceRevision='1794135521.987654321',/PAGE_MANIFEST_CHANGED/);
reject('manifest tenant substituted',f=>f.evidence.pages[0].manifest.tenantId='other',/PAGE_MANIFEST_CHANGED/);
reject('manifest source substituted',f=>f.evidence.pages[0].manifest.sourceId='other',/PAGE_MANIFEST_CHANGED/);
reject('request cursor substituted',f=>f.evidence.pages[1].manifest.vendorCursor='new-cursor',/CURSOR_CHAIN_DISCONNECTED/);
reject('vendor next cursor substituted',f=>f.responseNextCursors=['some-other-cursor',null],/CURSOR_CHAIN_DISCONNECTED/);
reject('page-two input cursor reset',f=>f.evidence.pages[1].manifest.vendorCursor=null,/CURSOR_CHAIN_DISCONNECTED/);
reject('page-one input cursor not null',f=>f.evidence.pages[0].manifest.vendorCursor='some-token',/INCOMPLETE_CURSOR_WINDOW/);
reject('final page claims another vendor cursor',f=>f.responseNextCursors=[f.cursor,'extra'],/INCOMPLETE_CURSOR_WINDOW/);
reject('missing vendor response cursor',f=>f.responseNextCursors=[null,null],/CURSOR_CHAIN_DISCONNECTED/);
reject('missing page proof',f=>f.evidence.pages.pop(),/PAGE_COUNT_MISMATCH/);
reject('extra response cursor',f=>f.responseNextCursors.push('extra'),/PAGE_COUNT_MISMATCH/);
reject('tampered page proof',f=>f.certificate.pages[0].completedEvidenceDigest='0'.repeat(64),/SIGNATURE_INVALID/);
reject('tampered signature',f=>f.certificate={...f.certificate,signatureHex:'f'.repeat(128)},/SIGNATURE_INVALID/);
reject('modified expiry',f=>f.certificate={...f.certificate,expiresAtMs:f.certificate.expiresAtMs+1},/SIGNATURE_INVALID/);
reject('certificate outside time window expired',f=>f.nowMs=f.certificate.expiresAtMs,/CERTIFICATE_EXPIRED/);
reject('clock earlier than issuer',f=>f.nowMs=f.certificate.issuedAtMs-1,/CERTIFICATE_EXPIRED/);
reject('invalid clock',f=>f.nowMs=NaN,/CERTIFICATE_EXPIRED/);
reject('wrong Ed25519 verifier key',f=>f.verifier=new EmulatorOnlyStageGWitnessVerifier(generateKeyPairSync('ed25519').publicKey),/SIGNATURE_INVALID/);
reject('mutated stage F anchor without resigning vendor proof',f=>{f.evidence.anchor.sourceRevision='1794135521.987654321';f.trustedStageFAnchorFingerprint=stageFAnchorFingerprint(f.evidence.anchor);},/ANCHOR_SCOPE_CHANGED/);
reject('modified step checkpoint id',f=>{f.evidence.anchor.steps[1].checkpointEventId='fse_'+'0'.repeat(64);f.trustedStageFAnchorFingerprint=stageFAnchorFingerprint(f.evidence.anchor);},/ANCHOR_SCOPE_CHANGED/);
reject('replaced resource metadata',f=>f.evidence.pages[0].manifest.items[1].expectedVersionId='v2',/CURSOR_OR_EVIDENCE_CHANGED|PAGE_MANIFEST_CHANGED/);
reject('cursor privacy key substituted',f=>f.cursorTags=new EmulatorOnlyStageGCursorTagger(randomBytes(32)),/CURSOR_OR_EVIDENCE_CHANGED/);
reject('cursor certificate replay from another chain',f=>{const other=make();f.certificate=other.certificate;f.trustedHead=other.head;f.verifier=other.verifier;},/ANCHOR_SCOPE_CHANGED/);
test('Stage G: untrusted page proof cannot be signed with a broken chain',()=>{
 const f=make(),d=structuredClone(f.draft);
 d.pages[1].requestCursorTag='0'.repeat(64);
 assert.throws(()=>f.issuer.sign(d),/CURSOR_CHAIN_DISCONNECTED/);
});
test('Stage G: replayed cursor token on a third page is forbidden',()=>{
 const f=make();const p0=f.draft.pages[0],p1=f.draft.pages[1];
 const d=structuredClone(f.draft);
 const secondToken=p0.nextCursorTag;
 d.pages=[{...p0,nextCursorTag:secondToken},{...p1,nextCursorTag:secondToken},
  {...p1,manifestId:randomUUID(),manifestRevision:'1794135521.123456799',
    startCheckpointSequence:4,endCheckpointSequence:5,
    requestCursorTag:secondToken,nextCursorTag:null}];
 assert.throws(()=>f.issuer.sign(d),/CURSOR_CHAIN_DISCONNECTED/);
});
test('Stage G: forged unapproved witness predecessor is rejected',()=>{
 const f=make();const d={...f.draft,sequence:2,previousFingerprint:null};
 assert.throws(()=>f.issuer.sign(d),/CERTIFICATE_INVALID/);
});
test('Stage G: certificate TTL cannot exceed five minutes',()=>{
 const f=make(),d={...f.draft,expiresAtMs:f.draft.issuedAtMs+300_001};
 assert.throws(()=>f.issuer.sign(d),/CERTIFICATE_INVALID/);
});
test('Stage G: cursor HMAC key must be 256-bit',()=>{
 assert.throws(()=>new EmulatorOnlyStageGCursorTagger(randomBytes(16)),/CURSOR_KEY_INVALID/);
});
test('Stage G: cursor length bounded to 4096 UTF-8 bytes',()=>{
 const f=make();assert.throws(()=>f.privacy.tag({tenantId,sourceId,facilityId},'💉'.repeat(1025)),/CURSOR_INVALID/);
});
test('Stage G: cursor tags never equal across tenant/source/facility',()=>{
 const f=make(),scope={tenantId,sourceId,facilityId};
 const base=f.privacy.tag(scope,f.cursor);
 for(const x of [{...scope,tenantId:'other'},{...scope,sourceId:'other'},{...scope,facilityId:'other'}])
   assert.notEqual(base,f.privacy.tag(x,f.cursor));
});
test('Stage G: production mode cannot instantiate issuer or verifier',()=>{
 const prior=process.env.GHIMS_RUNTIME_MODE;
 process.env.GHIMS_RUNTIME_MODE='PRODUCTION';
 try {assert.throws(()=>new EmulatorOnlyStageGCursorTagger(randomBytes(32)),/EMULATOR_ONLY/);
 assert.throws(()=>new EmulatorOnlyStageGWitnessIssuer(generateKeyPairSync('ed25519').privateKey),/EMULATOR_ONLY/);}
 finally {process.env.GHIMS_RUNTIME_MODE=prior;}
});
test('Stage G: test project alone without local emulator does not qualify',()=>{
 const prior=process.env.FIRESTORE_EMULATOR_HOST;delete process.env.FIRESTORE_EMULATOR_HOST;
 try {assert.throws(()=>new EmulatorOnlyStageGCursorTagger(randomBytes(32)),/EMULATOR_ONLY/);}
 finally {process.env.FIRESTORE_EMULATOR_HOST=prior;}
});
const tempDirs=[];
after(async()=>{await Promise.all(tempDirs.map(d=>rm(d,{recursive:true,force:true})));});
async function ledger(f=make()){
 const dir=await mkdtemp(join(tmpdir(),'helixis-stage-g-witness-'));tempDirs.push(dir);
 const path=join(dir,'detached-witness.ndjson');
 return {f,path,store:new EmulatorOnlyDetachedWitnessLedger(path,f.verifier)};
}
test('Stage G: witness head is persisted outside Firestore and reopens after process state loss',async()=>{
 const {f,path,store}=await ledger();
 assert.equal(await store.readHead(),null);
 await store.pin(f.certificate);
 const reopened=new EmulatorOnlyDetachedWitnessLedger(path,f.verifier);
 assert.deepEqual(await reopened.readHead(),f.head);
 assert.equal(verify({...f,trustedHead:await reopened.readHead()}),f.head.certificateFingerprint);
 const disk=await readFile(path,'utf8');
 assert.ok(!disk.includes(f.cursor));
});
test('Stage G: pinning exact certificate twice rejects witness sequence reuse',async()=>{
 const {f,store}=await ledger();await store.pin(f.certificate);
 await assert.rejects(store.pin(f.certificate),/NON_MONOTONIC_APPEND/);
});
test('Stage G: detached log cannot be placed inside the repository',()=>{
 const f=make();assert.throws(()=>new EmulatorOnlyDetachedWitnessLedger(join(process.cwd(),'bad-witness.ndjson'),f.verifier),/INSIDE_APPLICATION_WORKTREE/);
});
test('Stage G: tampered detached log is detected even if Firestore is unchanged',async()=>{
 const {f,path,store}=await ledger();await store.pin(f.certificate);
 const row=JSON.parse((await readFile(path,'utf8')).trim());row.pages[0].completedEvidenceDigest='0'.repeat(64);
 await writeFile(path,JSON.stringify(row)+'\n');
 await assert.rejects(store.readHead(),/SIGNATURE_INVALID/);
});
test('Stage G: appended revoked or forked witness chain cannot be trusted',async()=>{
 const {f,path,store}=await ledger();await store.pin(f.certificate);
 await writeFile(path,(await readFile(path,'utf8'))+JSON.stringify(f.certificate)+'\n');
 await assert.rejects(store.readHead(),/CHAIN_ROLLBACK_OR_FORK/);
});
test('Stage G: attacker cannot pin a certificate from another issuer',async()=>{
 const {store}=await ledger();const other=make();
 await assert.rejects(store.pin(other.certificate),/SIGNATURE_INVALID/);
});
test('Stage G: after a higher-sequence witness is pinned, old signatures are stale',async()=>{
 const {f,store}=await ledger();await store.pin(f.certificate);
 const second=f.issuer.sign({...f.draft,sequence:2,
  previousFingerprint:f.head.certificateFingerprint,
  issuedAtMs:f.draft.issuedAtMs+2_000,expiresAtMs:f.draft.expiresAtMs+2_000});
 const next=await store.pin(second);
 assert.equal(next.sequence,2);
 assert.throws(()=>verify({...f,trustedHead:next}),/DETACHED_WITNESS_NOT_CURRENT/);
});
