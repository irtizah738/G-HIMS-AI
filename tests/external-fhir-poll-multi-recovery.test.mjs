import { test, after } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  EmulatorOnlyStageFRecoverySigner, assertStageFMultiRecoveryEvidence,
  stageFAnchorFingerprint, stageFReceiptId, stageFCheckpointDigest,
  stageFReservationId, stageFCheckpointId,
} from '../lib/clinical/intelligence/external-fhir-poll-multi-recovery.ts';

const keys=['NODE_ENV','GHIMS_RUNTIME_MODE','FIREBASE_PROJECT_ID','FIRESTORE_EMULATOR_HOST',
  'GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED','GHIMS_INTEGRATION_FHIR_R4_STATE'];
const val=['test','TEST','ghims-p4-ci','127.0.0.1:8080','false','DISABLED'];
const prev=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
keys.forEach((k,i)=>process.env[k]=val[i]);
after(()=>keys.forEach(k=>prev[k]===undefined?delete process.env[k]:process.env[k]=prev[k]));
const signer=new EmulatorOnlyStageFRecoverySigner(randomBytes(32));
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const tenantId='synthetic-f-tenant',sourceId='his-f-test',facilityId='synthetic-f-facility';
const sourceRevision='1794135521.123456789';
const mRevs=['1794135521.123456790','1794135521.123456791'];
const patientId='p-f-test',externalId='ext-p-f-test';
function build({abandoned=false}={}) {
  const pageManifests=[0,1].map(p=>({
    tenantId,sourceId,facilityId,manifestId:randomUUID(),sourceRevision,
    startCheckpointSequence:p*2,
    items:[0,1].map(i=>({workId:randomUUID(),resourceType:'Observation',
      resourceId:`obs-f-${p}-${i}`,expectedVersionId:'v1'})),
    vendorCursor:p===0?'OPAQUE_CURSOR_PAGE_1':'OPAQUE_CURSOR_PAGE_2',
  }));
  const pages=pageManifests.map((m,p)=>({
    manifestId:m.manifestId,manifestRevision:mRevs[p],
    startCheckpointSequence:m.startCheckpointSequence,itemCount:m.items.length,
  }));
  const steps=[],stepEvidence=[];
  const skip=abandoned?{epoch:1,operationSequence:1,workId:randomUUID(),
    reservationEventId:stageFReservationId(tenantId,sourceId,1,1)}:null;
  const linkId='fpl_'+sha([sourceId,externalId]);
  for (let index=0;index<4;index++) {
    const p=Math.floor(index/2),i=index%2,m=pageManifests[p],w=m.items[i];
    const sequence=index+1,epoch=p+1,operationSequence=index+1+(abandoned?1:0);
    const receiptId=stageFReceiptId(m,i);
    const checkpointDigest=stageFCheckpointDigest(m,i);
    const reservationEventId=stageFReservationId(tenantId,sourceId,epoch,operationSequence);
    const checkpointEventId=stageFCheckpointId(tenantId,sourceId,epoch,sequence);
    steps.push({manifestId:m.manifestId,sequence,index:i,epoch,operationSequence,
      workId:w.workId,reservationEventId,checkpointEventId,receiptId,checkpointDigest});
    const resourceJson=JSON.stringify({resourceType:w.resourceType,id:w.resourceId,
      meta:{versionId:w.expectedVersionId},subject:{reference:`Patient/${externalId}`}});
    const resourceHash=createHash('sha256').update(resourceJson).digest('hex');
    stepEvidence.push({
      reservation:{tenantId,sourceId,eventId:reservationEventId,epoch,sequence:operationSequence,
        workId:w.workId,eventType:'FHIR_SOURCE_POLL_RESERVED',immutable:true},
      checkpoint:{tenantId,sourceId,facilityId,eventId:checkpointEventId,epoch,
        sequence,operationSequence,workId:w.workId,manifestId:m.manifestId,
        manifestRevision:mRevs[p],manifestSourceRevision:sourceRevision,
        receiptId,checkpointDigest,immutable:true,clinicalAuthority:false,
        eventType:'FHIR_SOURCE_POLL_CHECKPOINTED'},
      checkpointAudit:{tenantId,sourceId,eventId:checkpointEventId,immutable:true,
        action:'FHIR_SOURCE_POLL_CHECKPOINTED'},
      checkpointOutbox:{tenantId,sourceId,eventId:checkpointEventId,status:'HELD',
        destination:'CI_EXTERNAL_CONTEXT_QUALIFICATION'},
      receipt:{tenantId,sourceId,patientId,resourceType:w.resourceType,resourceId:w.resourceId,
        sourceVersionId:w.expectedVersionId,receiptId,resourceHash,status:'CURRENT',
        immutable:true,projectionAuthority:'UNVERIFIED_EXTERNAL_EVIDENCE',resourceJson,
        provenance:{mappedByVerifiedLink:linkId,contentSha256:resourceHash,sourceId,
          sourceFacilityId:facilityId,sourceResourceType:w.resourceType,
          sourceResourceId:w.resourceId,sourceVersionId:w.expectedVersionId}},
      head:{tenantId,sourceId,patientId,receiptId,resourceType:w.resourceType,
        resourceId:w.resourceId,sourceVersionId:w.expectedVersionId},
      importEvent:{tenantId,sourceId,patientId,receiptId,resourceHash,
        eventType:'EXTERNAL_FHIR_VERSION_IMPORTED'},
      importAudit:{tenantId,sourceId,targetId:receiptId,resourceHash,
        action:'EXTERNAL_FHIR_IMPORT',result:'CURRENT',immutable:true},
      importOutbox:{tenantId,sourceId,receiptId,resourceHash,status:'HELD',
        destination:'CI_EXTERNAL_CONTEXT_QUALIFICATION'},
      availability:null,
      link:{tenantId,sourceId,facilityId,patientId,externalPatientId:externalId,
        matchStatus:'VERIFIED',consentStatus:'GRANTED',_documentId:linkId},
      patient:{tenantId,status:'ACTIVE'},
    });
  }
  const endCheckpointSequence=4,issuedSequence=abandoned?5:4;
  const draft={schemaVersion:1,kind:'SYNTHETIC_OFFLINE_EXPORTED_MULTI_PAGE_ANCHOR',
    tenantId,sourceId,facilityId,sourceRevision,startCheckpointSequence:0,
    endCheckpointSequence,issuedSequence,finalEpoch:2,pages,steps,
    abandonedReservations:skip?[skip]:[]};
  // The abandoned operation must be superseded by a later epoch. For this
  // fixture the first completed item after restart begins in epoch 2.
  if(abandoned){steps[0].epoch=2;steps[0].reservationEventId=stageFReservationId(tenantId,sourceId,2,steps[0].operationSequence);
    steps[0].checkpointEventId=stageFCheckpointId(tenantId,sourceId,2,steps[0].sequence);
    stepEvidence[0].reservation={...stepEvidence[0].reservation,epoch:2,
      eventId:steps[0].reservationEventId};
    stepEvidence[0].checkpoint={...stepEvidence[0].checkpoint,epoch:2,
      eventId:steps[0].checkpointEventId};
    stepEvidence[0].checkpointAudit.eventId=steps[0].checkpointEventId;
    stepEvidence[0].checkpointOutbox.eventId=steps[0].checkpointEventId;
    // All completed events in this scenario belong to the new epoch.
    for(let j=1;j<steps.length;j++){
      steps[j].epoch=2;
      steps[j].reservationEventId=stageFReservationId(tenantId,sourceId,2,steps[j].operationSequence);
      steps[j].checkpointEventId=stageFCheckpointId(tenantId,sourceId,2,steps[j].sequence);
      stepEvidence[j].reservation={...stepEvidence[j].reservation,epoch:2,eventId:steps[j].reservationEventId};
      stepEvidence[j].checkpoint={...stepEvidence[j].checkpoint,epoch:2,eventId:steps[j].checkpointEventId};
      stepEvidence[j].checkpointAudit.eventId=steps[j].checkpointEventId;
      stepEvidence[j].checkpointOutbox.eventId=steps[j].checkpointEventId;
    }
  }
  const anchor=signer.sign(draft);
  const reviews=[{role:'SECURITY_REVIEWER',reviewerId:'synthetic-security',
    disposition:'APPROVE',anchorFingerprint:stageFAnchorFingerprint(anchor)},
  {role:'CLINICAL_REVIEWER',reviewerId:'synthetic-clinical',
    disposition:'APPROVE',anchorFingerprint:stageFAnchorFingerprint(anchor)}];
  return {anchor,sourceRevision,source:{tenantId,sourceId,facilityId,
    status:'ACTIVE',securityReviewStatus:'APPROVED',syncMode:'FENCED',syntheticOnly:true,
    approvedResourceTypes:['Patient','Encounter','Observation']},
  lease:{tenantId,sourceId,facilityId,status:'RELEASED',expiresAtMs:0,epoch:2,
    issuedSequence,checkpointSequence:4,
    checkpointDigest:steps[3].checkpointDigest,checkpointWorkId:steps[3].workId},
  pages:pageManifests.map((manifest,p)=>({manifest,manifestRevision:mRevs[p],
    sealed:{tenantId,sourceId,facilityId,manifestId:manifest.manifestId,
      sourceRevision,status:'SEALED',immutable:true,clinicalAuthority:false},
    manifestEvent:{tenantId,sourceId,eventId:'fpme_'+manifest.manifestId,
      manifestId:manifest.manifestId,sourceRevision,immutable:true,
      eventType:'FHIR_POLL_MANIFEST_SEALED'},
    manifestAudit:{tenantId,sourceId,eventId:'fpme_'+manifest.manifestId,
      action:'FHIR_POLL_MANIFEST_SEALED',immutable:true},
    manifestOutbox:{tenantId,sourceId,eventId:'fpme_'+manifest.manifestId,
      status:'HELD',destination:'CI_EXTERNAL_CONTEXT_QUALIFICATION'}})),
  steps:stepEvidence,abandonedReservations:skip?[{tenantId,sourceId,epoch:1,
    sequence:1,workId:skip.workId,eventId:skip.reservationEventId,
    eventType:'FHIR_SOURCE_POLL_RESERVED',immutable:true}]:[],reviews};
}
function verified(e){signer.verify(e.anchor);assertStageFMultiRecoveryEvidence(e)}
test('Stage F: two manifests, four receipts and all checkpoint chains are verified',()=>verified(build()));
test('Stage F: an interrupted reservation is accounted for only with new-epoch takeover',()=>verified(build({abandoned:true})));
test('Stage F: input-sensitive digest and event identifiers are deterministic',()=>{
 const e=build();assert.equal(e.anchor.steps[0].receiptId,stageFReceiptId(e.pages[0].manifest,0));
 assert.equal(e.anchor.steps[0].checkpointDigest,stageFCheckpointDigest(e.pages[0].manifest,0));
});
test('Stage F: anchor signature is invalid after any mutation',()=>{
 const e=build(); e.anchor.pages[0].manifestRevision='1794135521.123456799';
 assert.throws(()=>signer.verify(e.anchor),/SIGNATURE_INVALID/);
});
test('Stage F: different test key cannot verify detached anchor',()=>{
 const e=build();const other=new EmulatorOnlyStageFRecoverySigner(randomBytes(32));
 assert.throws(()=>other.verify(e.anchor),/SIGNATURE_INVALID/);
});
test('Stage F: signer requires 256-bit key',()=>assert.throws(()=>new EmulatorOnlyStageFRecoverySigner(randomBytes(16)),/KEY_INVALID/));
test('Stage F: signer fails closed outside TEST',()=>{
 const old=process.env.GHIMS_RUNTIME_MODE;process.env.GHIMS_RUNTIME_MODE='PRODUCTION';
 try{assert.throws(()=>new EmulatorOnlyStageFRecoverySigner(randomBytes(32)),/EMULATOR_ONLY/)}
 finally{process.env.GHIMS_RUNTIME_MODE=old;}
});
test('Stage F: signer fails closed without emulator',()=>{
 const old=process.env.FIRESTORE_EMULATOR_HOST;delete process.env.FIRESTORE_EMULATOR_HOST;
 try{assert.throws(()=>signer.verify(build().anchor),/EMULATOR_ONLY/)}
 finally{process.env.FIRESTORE_EMULATOR_HOST=old;}
});
function mutate(name,fn,code){test('Stage F denies '+name,()=>{
 const e=build();fn(e);assert.throws(()=>verified(e),code);
})}
const F=/FHIR_POLL_F_/;
for (const [name,patch] of [
 ['source rollback',e=>e.sourceRevision='1794135520.123456789'],
 ['source suspended',e=>e.source.status='SUSPENDED'],
 ['source security review revoked',e=>e.source.securityReviewStatus='REVOKED'],
 ['source no longer FENCED',e=>delete e.source.syncMode],
 ['live source substitution',e=>e.source.syntheticOnly=false],
 ['wrong source facility',e=>e.source.facilityId='facility-other'],
 ['source tenant altered',e=>e.source.tenantId='other-tenant'],
 ['approved resource type removed',e=>e.source.approvedResourceTypes=[]],
 ['lease missing',e=>e.lease=null],
 ['lease still active',e=>e.lease.status='ACTIVE'],
 ['lease expiry stale',e=>e.lease.expiresAtMs=9],
 ['lease checkpoint rolled back',e=>e.lease.checkpointSequence=3],
 ['lease issued watermark rolled back',e=>e.lease.issuedSequence=3],
 ['lease last checkpoint digest changed',e=>e.lease.checkpointDigest='f'.repeat(64)],
 ['lease last work id changed',e=>e.lease.checkpointWorkId=randomUUID()],
 ['lease epoch stale',e=>e.lease.epoch=1],
 ['missing first manifest',e=>e.pages[0].sealed=null],
 ['missing page-two manifest seal audit',e=>e.pages[1].manifestAudit=null],
 ['manifest seal outbox dispatched',e=>e.pages[0].manifestOutbox.status='DELIVERED'],
 ['wrong manifest revision',e=>e.pages[0].manifestRevision='1794135521.987654321'],
 ['manifest reused id',e=>e.pages[1].manifest.manifestId=e.pages[0].manifest.manifestId],
 ['manifest changed source revision',e=>e.pages[1].manifest.sourceRevision='1794135521.987654321'],
 ['manifest ciphertext metadata escalated',e=>e.pages[0].sealed.clinicalAuthority=true],
 ['manifest plaintext resource modified',e=>e.pages[1].manifest.items[0].resourceId='tampered'],
 ['duplicate resource across pages',e=>{e.pages[1].manifest.items[0].resourceId=e.pages[0].manifest.items[0].resourceId}],
 ['missing first operation reservation',e=>e.steps[0].reservation=null],
 ['reservation work ID spoofed',e=>e.steps[2].reservation.workId=randomUUID()],
 ['reservation event changed',e=>e.steps[1].reservation.eventType='OTHER'],
 ['missing first checkpoint',e=>e.steps[0].checkpoint=null],
 ['missing middle checkpoint',e=>e.steps[2].checkpoint=null],
 ['checkpoint wrong epoch',e=>e.steps[2].checkpoint.epoch=9],
 ['checkpoint wrong sequence',e=>e.steps[2].checkpoint.sequence=11],
 ['checkpoint wrong manifest',e=>e.steps[2].checkpoint.manifestId=randomUUID()],
 ['checkpoint wrong operation sequence',e=>e.steps[1].checkpoint.operationSequence=9],
 ['checkpoint wrong receipt',e=>e.steps[0].checkpoint.receiptId='fir_'+'0'.repeat(64)],
 ['checkpoint wrong digest',e=>e.steps[2].checkpoint.checkpointDigest='0'.repeat(64)],
 ['checkpoint missing audit',e=>e.steps[1].checkpointAudit=null],
 ['checkpoint missing outbox',e=>e.steps[1].checkpointOutbox=null],
 ['checkpoint outbox dispatched',e=>e.steps[0].checkpointOutbox.status='DISPATCHED'],
 ['missing clinical receipt',e=>e.steps[1].receipt=null],
 ['receipt not current',e=>e.steps[1].receipt.status='HISTORICAL'],
 ['receipt changed version',e=>e.steps[1].receipt.sourceVersionId='v2'],
 ['receipt changed tenant',e=>e.steps[1].receipt.tenantId='evil'],
 ['receipt tampered resource hash',e=>e.steps[1].receipt.resourceHash='x'],
 ['tampered clinical resource JSON',e=>e.steps[1].receipt.resourceJson='{}'],
 ['resource JSON patient switched',e=>{const r=e.steps[1].receipt;r.resourceJson=JSON.stringify({resourceType:'Observation',id:'obs-f-0-1',meta:{versionId:'v1'},subject:{reference:'Patient/another'}});r.resourceHash=createHash('sha256').update(r.resourceJson).digest('hex');e.steps[1].importEvent.resourceHash=r.resourceHash;e.steps[1].importAudit.resourceHash=r.resourceHash;e.steps[1].importOutbox.resourceHash=r.resourceHash;r.provenance.contentSha256=r.resourceHash;}],
 ['head changed',e=>e.steps[1].head.receiptId='fir_'+'a'.repeat(64)],
 ['missing import event',e=>e.steps[1].importEvent=null],
 ['missing import audit',e=>e.steps[1].importAudit=null],
 ['missing import outbox',e=>e.steps[1].importOutbox=null],
 ['import outbox published',e=>e.steps[1].importOutbox.status='DELIVERED'],
 ['revoked patient consent',e=>e.steps[1].link.consentStatus='WITHDRAWN'],
 ['unverified patient link',e=>e.steps[1].link.matchStatus='PENDING'],
 ['patient merged',e=>e.steps[1].patient.mergedIntoPatientId='other'],
 ['patient suspended',e=>e.steps[1].patient.status='SUSPENDED'],
 ['available record missing resource',e=>e.steps[1].availability={status:'SUSPECTED_ABSENCE'}],
 ['stale availability receipt',e=>e.steps[1].availability={status:'AVAILABLE_CONFIRMED',sourceReceiptId:'fir_'+'a'.repeat(64)}],
 ['same reviewer twice',e=>e.reviews[1].reviewerId=e.reviews[0].reviewerId],
 ['review not approved',e=>e.reviews[1].disposition='DENY'],
 ['review stale anchor fingerprint',e=>e.reviews[0].anchorFingerprint='f'.repeat(64)],
]) mutate(name,patch,F);
function mutateSigned(name,fn){test('Stage F signed anchor rejects '+name,()=>{
 const e=build();const draft=structuredClone(e.anchor);delete draft.macHex;
 fn(draft);assert.throws(()=>signer.sign(draft),F);
})}
for(const [name,fn] of [
 ['duplicate page ID',a=>a.pages[1].manifestId=a.pages[0].manifestId],
 ['missing page',a=>a.pages.splice(1,1)],
 ['noncontiguous page start',a=>a.pages[1].startCheckpointSequence=5],
 ['end watermark mismatch',a=>a.endCheckpointSequence=8],
 ['missing middle step',a=>a.steps.splice(1,1)],
 ['out of order step',a=>a.steps[1].sequence=9],
 ['duplicate work id',a=>a.steps[1].workId=a.steps[0].workId],
 ['wrong page index',a=>a.steps[2].index=1],
 ['repeated operation sequence',a=>a.steps[2].operationSequence=2],
 ['wrong final epoch',a=>a.finalEpoch=6],
 ['issued watermark with missing operation',a=>a.issuedSequence=5],
 ['unknown abandoned reservation',a=>a.abandonedReservations.push({epoch:1,operationSequence:1,
    workId:randomUUID(),reservationEventId:stageFReservationId(tenantId,sourceId,1,1)})],
]) mutateSigned(name,fn);
test('Stage F abandoned reservation with missing original event fails closed',()=>{
 const e=build({abandoned:true});e.abandonedReservations[0]=null;
 assert.throws(()=>verified(e),/RESERVATION_EVIDENCE_INVALID/);
});
test('Stage F order stable across property key insertion in signatures',()=>{
 const e=build();const clone=structuredClone(e.anchor);
 const shuffled={...clone,steps:clone.steps.map(x=>Object.fromEntries(Object.entries(x).reverse()))};
 signer.verify(shuffled);assert.equal(stageFAnchorFingerprint(shuffled),stageFAnchorFingerprint(e.anchor));
});

test('Stage F: client Firestore access is explicitly denied for all new collections',()=>{
  const rules=readFileSync('firestore.rules','utf8');
  for(const marker of ['fhirPollMultiRecoveryRehearsals/{rehearsalId}',
    'fhirPollMultiRecoveryEvents/{eventId}',
    'fhirPollMultiRecoveryOutbox/{outboxId}']) {
    assert.ok(rules.includes('match /'+marker+' { allow read, write: if false; }'),marker);
  }
});
