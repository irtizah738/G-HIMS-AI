import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertStageDCheckpointEvidence } from '../lib/clinical/intelligence/external-fhir-poll-checkpoint-policy.ts';

function valid() {
  const resourceJson=JSON.stringify({
    resourceType:'Observation',id:'observation-a',meta:{versionId:'v1'},
  });
  const resourceHash=createHash('sha256').update(resourceJson,'utf8').digest('hex');
  const expected = {
    tenantId:'synthetic-tenant',sourceId:'synthetic-source',facilityId:'synthetic-facility',
    manifestId:'47eedc4e-2f4c-48a8-80e4-bd980cb86c22',
    sourceRevision:'1794151200.000000100',manifestRevision:'1794151200.000000200',
    epoch:1,workerId:'781579fb-fadf-494e-b2b0-5848dad0e822',
    claimId:'21d3443c-b01d-4f70-a7d6-6f5de74e44c9',
    operationSequence:1,sequence:1,previousSequence:0,
    workId:'a167b304-d3b6-4fc9-a7cf-81cefb38f57a',resourceType:'Observation',
    resourceId:'observation-a',expectedVersionId:'v1',receiptId:'fir_'+'a'.repeat(64),
    headId:'fhd_'+'b'.repeat(64),
  };
  return {
    expected,
    sourceRevision:expected.sourceRevision,manifestRevision:expected.manifestRevision,
    source:{tenantId:expected.tenantId,sourceId:expected.sourceId,facilityId:expected.facilityId,
      status:'ACTIVE',securityReviewStatus:'APPROVED',syncMode:'FENCED',
      syntheticOnly:true,approvedResourceTypes:['Patient','Encounter','Observation']},
    manifest:{tenantId:expected.tenantId,sourceId:expected.sourceId,facilityId:expected.facilityId,
      manifestId:expected.manifestId,sourceRevision:expected.sourceRevision,
      immutable:true,status:'SEALED',clinicalAuthority:false},
    lease:{tenantId:expected.tenantId,sourceId:expected.sourceId,facilityId:expected.facilityId,
      status:'ACTIVE',workerId:expected.workerId,claimId:expected.claimId,
      epoch:1,expiresAtMs:4000,checkpointSequence:0,issuedSequence:1},
    operation:{eventType:'FHIR_SOURCE_POLL_RESERVED',immutable:true,tenantId:expected.tenantId,
      sourceId:expected.sourceId,epoch:1,sequence:1,workId:expected.workId},
    receipt:{tenantId:expected.tenantId,sourceId:expected.sourceId,resourceType:'Observation',
      resourceId:expected.resourceId,sourceVersionId:'v1',receiptId:expected.receiptId,
      patientId:'local-patient',status:'CURRENT',immutable:true,
      projectionAuthority:'UNVERIFIED_EXTERNAL_EVIDENCE',resourceHash,resourceJson,
      provenance:{mappedByVerifiedLink:'fpl_'+'d'.repeat(64),contentSha256:resourceHash}},
    head:{receiptId:expected.receiptId,sourceId:expected.sourceId,tenantId:expected.tenantId,
      patientId:'local-patient',resourceType:'Observation',resourceId:expected.resourceId,
      sourceVersionId:'v1'},
    importEvent:{eventType:'EXTERNAL_FHIR_VERSION_IMPORTED',receiptId:expected.receiptId,
      resourceHash,patientId:'local-patient'},
    importAudit:{action:'EXTERNAL_FHIR_IMPORT',targetId:expected.receiptId,
      resourceHash,immutable:true,result:'CURRENT'},
    importOutbox:{receiptId:expected.receiptId,resourceHash,
      status:'HELD',destination:'CI_EXTERNAL_CONTEXT_QUALIFICATION'},
    availability:null,
    patientLink:{tenantId:expected.tenantId,sourceId:expected.sourceId,
      facilityId:expected.facilityId,patientId:'local-patient',matchStatus:'VERIFIED',consentStatus:'GRANTED'},
    patient:{tenantId:expected.tenantId,status:'ACTIVE'},nowServerMs:1000,
  };
}
const cases = [
  ['source changed while HTTP in flight', e => e.sourceRevision = '1794151201.000000001', /SOURCE_REVOKED/],
  ['manifest rewritten with same ciphertext', e => e.manifestRevision = '1794151201.000000001', /MANIFEST_REVISED/],
  ['manifest ID substituted',e=>e.manifest.manifestId='forged',/MANIFEST_REVISED/],
  ['manifest source revision forged',e=>e.manifest.sourceRevision='1794151201.000000001',/MANIFEST_REVISED/],
  ['source suspended',e=>e.source.status='SUSPENDED',/SOURCE_REVOKED/],
  ['source review revoked',e=>e.source.securityReviewStatus='REVOKED',/SOURCE_REVOKED/],
  ['source sync unfenced',e=>e.source.syncMode=null,/SOURCE_REVOKED/],
  ['source synthetic marker removed',e=>e.source.syntheticOnly=false,/SOURCE_REVOKED/],
  ['wrong facility',e=>e.source.facilityId='another',/SOURCE_REVOKED/],
  ['wrong tenant',e=>e.source.tenantId='another',/SOURCE_REVOKED/],
  ['resource scope removed',e=>e.source.approvedResourceTypes=['Patient'],/SOURCE_REVOKED/],
  ['lease removed',e=>e.lease=null,/EVIDENCE_MISSING/],
  ['lease released',e=>e.lease.status='RELEASED',/LEASE_STALE/],
  ['expired lease by authoritative server time',e=>e.nowServerMs=4000,/LEASE_STALE/],
  ['stale worker',e=>e.lease.workerId='other',/LEASE_STALE/],
  ['stale claim',e=>e.lease.claimId='other',/LEASE_STALE/],
  ['stale epoch',e=>e.lease.epoch=2,/LEASE_STALE/],
  ['missing operation reservation',e=>e.operation=null,/EVIDENCE_MISSING/],
  ['operation not bound to item',e=>e.operation.workId='other',/RESERVATION_NOT_BOUND/],
  ['operation from other epoch',e=>e.operation.epoch=2,/RESERVATION_NOT_BOUND/],
  ['unreserved operation sequence',e=>e.lease.issuedSequence=0,/LEASE_STALE/],
  ['checkpoint contention',e=>e.lease.checkpointSequence=1,/LEASE_STALE/],
  ['out of sequence',e=>e.expected.sequence=2,/EVIDENCE_MISSING/],
  ['missing receipt',e=>e.receipt=null,/EVIDENCE_MISSING/],
  ['historical version',e=>e.receipt.status='HISTORICAL',/IMPORTED_RECEIPT_INVALID/],
  ['reconciliation version',e=>e.receipt.status='RECONCILIATION_REQUIRED',/IMPORTED_RECEIPT_INVALID/],
  ['receipt wrong source version',e=>e.receipt.sourceVersionId='v2',/IMPORTED_RECEIPT_INVALID/],
  ['receipt body tampered after import',e=>e.receipt.resourceJson='{"resourceType":"Patient"}',/RECEIPT_PAYLOAD_INTEGRITY/],
  ['receipt content hash changed',e=>e.receipt.resourceHash='e'.repeat(64),/RECEIPT_PAYLOAD_INTEGRITY/],
  ['receipt provenance digest changed',e=>e.receipt.provenance.contentSha256='e'.repeat(64),/RECEIPT_PAYLOAD_INTEGRITY/],
  ['receipt payload exceeds import limit',e=>e.receipt.resourceJson='A'.repeat(120001),/RECEIPT_PAYLOAD_INTEGRITY/],
  ['receipt resource identity substituted with coherent hashes',e=>{
    const body=JSON.stringify({resourceType:'Observation',id:'other',meta:{versionId:'v1'}});
    const hash=createHash('sha256').update(body,'utf8').digest('hex');
    e.receipt.resourceJson=body;e.receipt.resourceHash=hash;
    e.receipt.provenance.contentSha256=hash;
    e.importEvent.resourceHash=hash;e.importAudit.resourceHash=hash;e.importOutbox.resourceHash=hash;
  },/RECEIPT_PAYLOAD_INTEGRITY/],
  ['current head moved',e=>e.head.receiptId='other',/CURRENT_HEAD_CHANGED/],
  ['import event missing',e=>e.importEvent=null,/EVIDENCE_MISSING/],
  ['import audit missing',e=>e.importAudit=null,/EVIDENCE_MISSING/],
  ['outbox missing',e=>e.importOutbox=null,/EVIDENCE_MISSING/],
  ['outbox dispatched',e=>e.importOutbox.status='DISPATCHED',/IMMUTABLE_EVIDENCE_INCOMPLETE/],
  ['audit hash mismatches receipt',e=>e.importAudit.resourceHash='other',/IMMUTABLE_EVIDENCE_INCOMPLETE/],
  ['patient link absent',e=>e.patientLink=null,/EVIDENCE_MISSING/],
  ['patient consent withdrawn',e=>e.patientLink.consentStatus='WITHDRAWN',/PATIENT_LINK/],
  ['patient match revoked',e=>e.patientLink.matchStatus='REVOKED',/PATIENT_LINK/],
  ['patient merged',e=>e.patient.mergedIntoPatientId='survivor',/PATIENT_LINK/],
  ['patient suspended',e=>e.patient.status='SUSPENDED',/PATIENT_LINK/],
  ['availability suspect absence',e=>e.availability={status:'SUSPECTED_ABSENCE',sourceReceiptId:e.expected.receiptId,headId:e.expected.headId},/AVAILABILITY_FENCE/],
  ['availability has stale receipt',e=>e.availability={status:'AVAILABLE_CONFIRMED',sourceReceiptId:'other',headId:e.expected.headId},/AVAILABILITY_FENCE/],
  ['availability newer source observation',e=>e.availability={status:'AVAILABLE_CONFIRMED',sourceReceiptId:e.expected.receiptId,headId:e.expected.headId,lastOperationSequence:2},/AVAILABILITY_FENCE/],
  ['no authoritative server time',e=>e.nowServerMs=0,/EVIDENCE_MISSING/],
];
test('Stage D: exact committed immutable evidence permits only one checkpoint', () => {
  assert.doesNotThrow(() => assertStageDCheckpointEvidence(valid()));
});
test('Stage D: a reconciled available head permits checkpoint', () => {
  const e=valid();e.availability={status:'AVAILABLE_CONFIRMED',sourceReceiptId:e.expected.receiptId,headId:e.expected.headId,lastOperationSequence:1};
  assert.doesNotThrow(() => assertStageDCheckpointEvidence(e));
});
for (const [name, mutate, expected] of cases) {
  test('Stage D fail closed: '+name, () => {
    const e=valid();mutate(e);
    assert.throws(()=>assertStageDCheckpointEvidence(e),expected);
  });
}
