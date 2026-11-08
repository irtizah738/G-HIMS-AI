import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EmulatorOnlyStageERecoverySigner,
  assertStageERecoveryEvidence, stageEAnchorFingerprint,
} from '../lib/clinical/intelligence/external-fhir-poll-recovery-guard.ts';

const env = ['NODE_ENV','GHIMS_RUNTIME_MODE','FIREBASE_PROJECT_ID','FIRESTORE_EMULATOR_HOST',
  'GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED','GHIMS_INTEGRATION_FHIR_R4_STATE'];
const values = ['test','TEST','ghims-p4-ci','127.0.0.1:8080','false','DISABLED'];
const old = Object.fromEntries(env.map(k=>[k,process.env[k]]));
env.forEach((k,i)=>process.env[k]=values[i]);
const signer = new EmulatorOnlyStageERecoverySigner(randomBytes(32));
const sha = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const tenantId='synthetic-tenant';
const sourceId='his-e-test';
const facilityId='synthetic-facility';
const patientId='p1';
const resourceId='obs-a';
const externalId='ext-p1';
const sourceRevision='1794135521.123456789';
const manifestRevision='1794135521.123456790';
const workId=randomUUID();
const manifestId=randomUUID();
const last = {workId,resourceType:'Observation',resourceId,expectedVersionId:'v1'};
const manifest={tenantId,sourceId,facilityId,manifestId,sourceRevision,startCheckpointSequence:0,
  items:[last],vendorCursor:'TEST_ONLY_NOT_SHARED'};
const receiptId='fir_'+sha([sourceId,'Observation',resourceId,'v1']);
const checkpointDigest=sha(['CI_EXT12_CHECKPOINT_V1',tenantId,sourceId,manifestId,0,1,
  workId,'Observation',resourceId,'v1']);
const checkpointEventId='fse_'+sha([tenantId,sourceId,1,'CHECKPOINTED',1]);
const anchor=signer.sign({schemaVersion:1,kind:'SYNTHETIC_OFFLINE_EXPORTED_RECOVERY_ANCHOR',
  tenantId,sourceId,facilityId,manifestId,sourceRevision,manifestRevision,
  epoch:1,issuedSequence:1,checkpointSequence:1,checkpointDigest,checkpointWorkId:workId,
  checkpointEventId,receiptId});
const linkId='fpl_'+sha([sourceId,externalId]);
const reviews=[
  {reviewerId:'security-01',role:'SECURITY_REVIEWER',disposition:'APPROVE',anchorFingerprint:stageEAnchorFingerprint(anchor)},
  {reviewerId:'clinical-02',role:'CLINICAL_REVIEWER',disposition:'APPROVE',anchorFingerprint:stageEAnchorFingerprint(anchor)},
];
const doc = {
 anchor,manifest,sourceRevision,manifestRevision,
 source:{tenantId,sourceId,facilityId,status:'ACTIVE',securityReviewStatus:'APPROVED',
   syncMode:'FENCED',syntheticOnly:true,approvedResourceTypes:['Patient','Encounter','Observation']},
 sealed:{tenantId,sourceId,facilityId,manifestId,sourceRevision,status:'SEALED',immutable:true,clinicalAuthority:false},
 lease:{tenantId,sourceId,facilityId,status:'RELEASED',expiresAtMs:0,epoch:1,
   issuedSequence:1,checkpointSequence:1,checkpointDigest,checkpointWorkId:workId},
 checkpointEvent:{eventType:'FHIR_SOURCE_POLL_CHECKPOINTED',immutable:true,
   eventId:checkpointEventId,tenantId,sourceId,facilityId,manifestId,manifestRevision,
   manifestSourceRevision:sourceRevision,epoch:1,sequence:1,workId,receiptId,checkpointDigest},
 checkpointAudit:{tenantId,sourceId,eventId:checkpointEventId,immutable:true,action:'FHIR_SOURCE_POLL_CHECKPOINTED'},
 checkpointOutbox:{tenantId,sourceId,eventId:checkpointEventId,status:'HELD',destination:'CI_EXTERNAL_CONTEXT_QUALIFICATION'},
 receipt:{tenantId,sourceId,receiptId,resourceType:'Observation',resourceId,sourceVersionId:'v1',
   patientId,resourceHash:'a'.repeat(64),status:'CURRENT',immutable:true,
   projectionAuthority:'UNVERIFIED_EXTERNAL_EVIDENCE',provenance:{mappedByVerifiedLink:linkId}},
 head:{tenantId,sourceId,receiptId,patientId},
 importEvent:{tenantId,sourceId,receiptId,eventType:'EXTERNAL_FHIR_VERSION_IMPORTED',resourceHash:'a'.repeat(64)},
 importAudit:{tenantId,sourceId,targetId:receiptId,action:'EXTERNAL_FHIR_IMPORT',resourceHash:'a'.repeat(64),immutable:true},
 importOutbox:{tenantId,sourceId,receiptId,resourceHash:'a'.repeat(64),status:'HELD',destination:'CI_EXTERNAL_CONTEXT_QUALIFICATION'},
 availability:null,
 link:{tenantId,sourceId,facilityId,patientId,matchStatus:'VERIFIED',consentStatus:'GRANTED',_documentId:linkId},
 patient:{tenantId,status:'ACTIVE'}, reviews,
};
function fixture(){return structuredClone(doc)}
function reject(name,mutate,pattern=/FHIR_POLL_E_/){test('Stage E: '+name,()=>{
 const e=fixture();mutate(e);assert.throws(()=>assertStageERecoveryEvidence(e),pattern);
})}

test('Stage E: exact synthetic, independently anchored single-item rehearsal may be examined (never deployed)',()=>{
 signer.verify(anchor);
 assert.doesNotThrow(()=>assertStageERecoveryEvidence(fixture()));
});
for(const [name,key,value] of [
 ['restored source snapshot','sourceRevision','1794135520.123456789'],
 ['stale manifest revision','manifestRevision','1794135520.123456789'],
 ['missing source','source',null],['missing sealed manifest','sealed',null],
 ['missing lease','lease',null],['missing import audit','importAudit',null],
 ['missing checkpoint event','checkpointEvent',null],
 ['missing checkpoint audit','checkpointAudit',null],
 ['missing checkpoint outbox','checkpointOutbox',null],
 ['missing receipt','receipt',null],['missing head','head',null],
 ['missing import event','importEvent',null],['missing import outbox','importOutbox',null],
 ['missing patient','patient',null],['missing link','link',null],
]) reject(name,e=>{e[key]=value});
for(const [name,path,value] of [
 ['source identity swapped','source.tenantId','other-tenant'],
 ['wrong source facility','source.facilityId','other-facility'],
 ['source suspended','source.status','SUSPENDED'],
 ['source review revoked','source.securityReviewStatus','REVOKED'],
 ['source unfenced','source.syncMode','LEGACY'],
 ['live source','source.syntheticOnly',false],
 ['manifest unsealed','sealed.status','DRAFT'],
 ['manifest clinical authority escalated','sealed.clinicalAuthority',true],
 ['manifest mutability changed','sealed.immutable',false],
 ['restored lease epoch','lease.epoch',0],
 ['restored issued sequence','lease.issuedSequence',0],
 ['missing checkpoint after restore','lease.checkpointSequence',0],
 ['changed checkpoint digest','lease.checkpointDigest','b'.repeat(64)],
 ['new work ID under lease','lease.checkpointWorkId',randomUUID()],
 ['in-flight unexpired lease','lease.status','ACTIVE'],
  ['unreleased lease expiry','lease.expiresAtMs',42],
 ['wrong checkpoint event type','checkpointEvent.eventType','FHIR_POLL_RESERVED'],
 ['checkpoint event forged manifest revision','checkpointEvent.manifestRevision','1794135521.000000001'],
 ['checkpoint event forged source','checkpointEvent.sourceId','other-source'],
 ['checkpoint event forged epoch','checkpointEvent.epoch',2],
 ['checkpoint event forged work ID','checkpointEvent.workId',randomUUID()],
 ['checkpoint event forged receipt','checkpointEvent.receiptId','fir_'+'0'.repeat(64)],
 ['checkpoint outbox delivered','checkpointOutbox.status','SENT'],
 ['import receipt wrong version','receipt.sourceVersionId','v2'],
 ['import receipt is quarantined','receipt.status','RECONCILIATION_REQUIRED'],
 ['import receipt mutable','receipt.immutable',false],
 ['import head moved','head.receiptId','fir_'+'0'.repeat(64)],
 ['import event changed','importEvent.eventType','UNKNOWN'],
 ['import audit mismatched','importAudit.targetId','fir_'+'0'.repeat(64)],
 ['import outbox released','importOutbox.status','PUBLISHED'],
 ['consent withdrawn','link.consentStatus','WITHDRAWN'],
 ['patient link unverified','link.matchStatus','UNVERIFIED'],
 ['patient wrong tenant','patient.tenantId','other-tenant'],
 ['patient merged','patient.mergedIntoPatientId','p2'],
 ['reused reviewer','reviews.1.reviewerId','security-01'],
 ['unapproved reviewer','reviews.0.disposition','HOLD'],
 ['reviewer stale fingerprint','reviews.0.anchorFingerprint','a'.repeat(64)],
]) reject(name,e=>{let parts=path.split('.');let t=e;for(let i=0;i<parts.length-1;i++)t=t[parts[i]];t[parts.at(-1)]=value});
reject('in-flight expired lease still blocks migration',e=>{e.lease.status='ACTIVE';e.lease.expiresAtMs=0});
reject('availability says missing resource',e=>e.availability={status:'SUSPECTED_ABSENCE',sourceReceiptId:receiptId});
reject('availability points to old receipt',e=>e.availability={status:'AVAILABLE_CONFIRMED',sourceReceiptId:'old'});
reject('availability newer than operation',e=>e.availability={status:'AVAILABLE_CONFIRMED',sourceReceiptId:receiptId,lastOperationSequence:2});
reject('gap between issued operations and completed checkpoints',e=>{e.anchor=signer.sign({...anchor,issuedSequence:2});e.lease.issuedSequence=2;
 e.reviews=e.reviews.map(r=>({...r,anchorFingerprint:stageEAnchorFingerprint(e.anchor)}));});
reject('manifest has not fully checkpointed',e=>{e.manifest.items.push({...last,workId:randomUUID()})});
reject('two-item manifest is not falsely qualified as reconciled',e=>{e.manifest.items=[{...last,workId:randomUUID()},last]});
reject('manifest cross-tenant substitution',e=>e.manifest.tenantId='other-tenant');
reject('manifest expected version modified',e=>e.manifest.items[0].expectedVersionId='v2');
reject('checkpoint digest forged',e=>{e.anchor=signer.sign({...anchor,checkpointDigest:'b'.repeat(64)});
 e.lease.checkpointDigest=e.anchor.checkpointDigest;e.checkpointEvent.checkpointDigest=e.anchor.checkpointDigest;
 e.reviews=e.reviews.map(r=>({...r,anchorFingerprint:stageEAnchorFingerprint(e.anchor)}));});
reject('receipt ID fabricated consistently',e=>{e.anchor=signer.sign({...anchor,receiptId:'fir_'+'b'.repeat(64)});
 e.checkpointEvent.receiptId=e.anchor.receiptId;e.receipt.receiptId=e.anchor.receiptId;
 e.head.receiptId=e.anchor.receiptId;e.importEvent.receiptId=e.anchor.receiptId;
 e.importAudit.targetId=e.anchor.receiptId;e.importOutbox.receiptId=e.anchor.receiptId;
 e.reviews=e.reviews.map(r=>({...r,anchorFingerprint:stageEAnchorFingerprint(e.anchor)}));});

test('Stage E: invalid recovery anchor MAC is rejected',()=>{
 assert.throws(()=>signer.verify({...anchor,macHex:'a'.repeat(64)}),/FHIR_POLL_E_ANCHOR_SIGNATURE_INVALID/);
});
test('Stage E: anchor cannot be authenticated with another local key',()=>{
 assert.throws(()=>new EmulatorOnlyStageERecoverySigner(randomBytes(32)).verify(anchor),/SIGNATURE_INVALID/);
});
test('Stage E: a modified checkpoint cannot reuse signed anchor',()=>{
 assert.throws(()=>signer.verify({...anchor,checkpointSequence:0}),/ANCHOR_INVALID/);
});
test('Stage E: signer rejects weak test keys',()=>{
 assert.throws(()=>new EmulatorOnlyStageERecoverySigner(randomBytes(16)),/ANCHOR_KEY_INVALID/);
});
test('Stage E: signer fails closed outside TEST even if key is valid',()=>{
 const before=process.env.GHIMS_RUNTIME_MODE;process.env.GHIMS_RUNTIME_MODE='PRODUCTION';
 try{assert.throws(()=>signer.verify(anchor),/EMULATOR_ONLY/)}finally{process.env.GHIMS_RUNTIME_MODE=before}
});
test('Stage E: signer fails closed when emulator address is missing',()=>{
 const before=process.env.FIRESTORE_EMULATOR_HOST;delete process.env.FIRESTORE_EMULATOR_HOST;
 try{assert.throws(()=>signer.verify(anchor),/EMULATOR_ONLY/)}finally{process.env.FIRESTORE_EMULATOR_HOST=before}
});
// Do not restore process environment until these local tests finish: node:test
// schedules callbacks after module evaluation. This is a short-lived TEST runner.

test('Stage E: browser rules explicitly deny new migration evidence collections',()=>{
 const rules=readFileSync('firestore.rules','utf8');
 for(const match of [
  'match /fhirPollMigrationRehearsals/{rehearsalId} { allow read, write: if false; }',
  'match /fhirPollMigrationEvents/{eventId} { allow read, write: if false; }',
  'match /fhirPollMigrationOutbox/{outboxId} { allow read, write: if false; }',
 ]) assert.ok(rules.includes(match),`missing explicit deny: ${match}`);
});
