import {describe,expect,test} from 'bun:test';
import type {DocumentReference,Transaction} from 'firebase-admin/firestore';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {externalReviewFactDigest} from '@/lib/clinical/intelligence/external-clinician-review-policy';
import {approvalEventHash} from '@/lib/clinical/intelligence/external-fact-approval-event-integrity';
import type {ApprovalEventPayload} from '@/lib/clinical/intelligence/external-fact-approval-events';
import {
  assessCurrentExternalClinicalApproval,
  externalFactApprovalHeadId,
} from '@/lib/clinical/intelligence/external-current-authorization-preflight';

const NOW=1794200000000;
const TENANT='synthetic-tenant';
const PATIENT='synthetic-patient';
const REVIEWER='clinician-reviewer';
const APPROVER='clinician-approver';
const REVIEW_ID='ecr_'+'a'.repeat(64);
const FACT={
  evidenceReceiptId:'fir_test',sourceVersionId:'v1',
  resourceHash:'c'.repeat(64),sourceId:'synthetic-source',
};
const SOURCE={
  sourceId:'synthetic-source',facilityId:'facility-a',
  siteApprovalId:'site-approved-v1',
};
const CONTENT_HASH='d'.repeat(64);
const CHECKPOINT='e'.repeat(64);
const FENCE='f'.repeat(64);
const DIGEST=externalReviewFactDigest([{
  evidenceReceiptId:FACT.evidenceReceiptId,
  sourceVersionId:FACT.sourceVersionId,
  resourceHash:FACT.resourceHash,
}]);

type Mutable=Record<string,unknown>;
function fixture(){
  const records=new Map<string,Mutable>();
  const path=(collection:string,id:string)=>collection+'/'+id;
  const put=(collection:string,id:string,data:Mutable)=>{
    records.set(path(collection,id),data);
  };
  const tenant={
    collection:(collection:string)=>({
      doc:(id:string)=>({path:path(collection,id)}),
    }),
  } as unknown as DocumentReference;
  const snapshot=(reference:{path:string})=>{
    const data=records.get(reference.path);
    return {exists:data!==undefined,data:()=>data};
  };
  const tx={
    get:async(reference:{path:string})=>snapshot(reference),
    getAll:async(...references:{path:string}[])=>references.map(snapshot),
  } as unknown as Transaction;
  const validFrom=NOW-60_000;
  const validUntil=NOW+60_000;
  const credential=(actorId:string):Mutable=>({
    tenantId:TENANT,actorId,facilityIds:['facility-a'],
    status:'VERIFIED',identityAssurance:'HOSPITAL_VERIFIED',
    licenseVerified:true,revision:1,validFrom,validUntil,revokedAt:null,
  });
  put('externalClinicianEvidenceReviews',REVIEW_ID,{
    schemaVersion:1,reviewId:REVIEW_ID,tenantId:TENANT,patientId:PATIENT,
    actorId:REVIEWER,disposition:'SOURCE_EVIDENCE_REVIEWED',
    immutable:true,evidenceOnly:true,
    clinicalUseAuthorized:false,aiDraftingEligible:false,
    projectionRevision:2,projectionContentHash:CONTENT_HASH,
    sourceCheckpoint:CHECKPOINT,factualDigest:DIGEST,
    authorityFenceHash:FENCE,sourceRefs:[{
      sourceId:SOURCE.sourceId,facilityId:SOURCE.facilityId,
    }],factRefs:[{
      evidenceReceiptId:FACT.evidenceReceiptId,
      sourceVersionId:FACT.sourceVersionId,resourceHash:FACT.resourceHash,
    }],
  });
  put('externalClinicalCredentialHeads',REVIEWER,credential(REVIEWER));
  put('externalClinicalCredentialHeads',APPROVER,credential(APPROVER));
  put('externalClinicalSiteAuthorityHeads',SOURCE.sourceId,{
    tenantId:TENANT,sourceId:SOURCE.sourceId,facilityId:SOURCE.facilityId,
    siteApprovalId:SOURCE.siteApprovalId,status:'APPROVED',
    clinicalUseReviewStatus:'APPROVED',revision:4,
    validFrom,validUntil,revokedAt:null,
  });
  const approvalId=externalFactApprovalHeadId(REVIEW_ID,FACT.evidenceReceiptId);
  const eventId='efae_synthetic_seed';
  const payload:ApprovalEventPayload={
    schemaVersion:1,tenantId:TENANT,patientId:PATIENT,reviewId:REVIEW_ID,
    headId:approvalId,evidenceReceiptId:FACT.evidenceReceiptId,
    sourceVersionId:FACT.sourceVersionId,
    resourceHash:FACT.resourceHash,sourceId:FACT.sourceId,
    facilityId:SOURCE.facilityId,factualDigest:DIGEST,authorityFenceHash:FENCE,
    status:'APPROVED',eventType:'EXTERNAL_FACT_APPROVAL_ISSUED',
    revision:1,approvedByActorId:APPROVER,reviewerActorId:REVIEWER,
    reviewerCredentialRevision:1,approverCredentialRevision:1,
    siteAuthorityRevision:4,validFrom,validUntil,revokedAt:null,
    actorId:APPROVER,recordedAt:NOW,reasonCode:null,
    previousEventId:null,previousEventHash:null,
  };
  const eventHash=approvalEventHash(payload);
  put('externalClinicalFactApprovalEvents',eventId,{
    eventId,eventHash,immutable:true,payload,
    clinicalUseAuthorized:false,aiDraftingEligible:false,
  });
  put('externalClinicalFactApprovalHeads',approvalId,{
    ...payload,approvalEventId:eventId,eventHash,
    immutableSourceEvent:true,evidenceOnly:true,
    clinicalUseAuthorized:false,aiDraftingEligible:false,
  });
  const args={
    tx,tenant,tenantId:TENANT,patientId:PATIENT,actorId:REVIEWER,
    reviewId:REVIEW_ID,now:NOW,revision:2,
    contentHash:CONTENT_HASH,sourceCheckpoint:CHECKPOINT,
    authorityFenceHash:FENCE,facts:[FACT],sources:[SOURCE],
  };
  const mutate=(collection:string,id:string,changes:Mutable)=>{
    const original=records.get(path(collection,id));
    if(!original)throw new Error('synthetic fixture document missing');
    records.set(path(collection,id),{...original,...changes});
  };
  const assess=()=>assessCurrentExternalClinicalApproval(args);
  return {records,put,mutate,assess,args,approvalId};
}
describe('CI-EXT-16 current clinical authority preflight is non-promoting',()=>{
  test('prequalifies exact current heads but NEVER authorizes clinical use or drafting',async()=>{
    const f=fixture();
    const result=await f.assess();
    expect(result).toEqual({
      state:'PREQUALIFIED_NON_PROMOTING',
      reasonCode:'CI_EXT16_INDEPENDENT_RELEASE_GATES_REQUIRED',
      clinicalUseAuthorized:false,aiDraftingEligible:false,evidenceOnly:true,
    });
  });
  test('rejects historical review after source or consent generation changes',async()=>{
    const f=fixture();
    const result=await assessCurrentExternalClinicalApproval({
      ...f.args,authorityFenceHash:'0'.repeat(64),
    });
    expect(result.reasonCode).toBe('CI_EXT16_REVIEW_STALE_OR_CONTESTED');
  });
  test('rejects wrong tenant, reviewer, patient and contested clinical concern',async()=>{
    const f=fixture();
    expect((await assessCurrentExternalClinicalApproval({
      ...f.args,tenantId:'other-tenant',
    })).state).toBe('DENIED');
    f.mutate('externalClinicianEvidenceReviews',REVIEW_ID,{
      disposition:'CLINICAL_CONCERN_RECORDED',
    });
    expect((await f.assess()).reasonCode).toBe('CI_EXT16_REVIEW_STALE_OR_CONTESTED');
  });
  test('rejects expired or revoked clinician licensure',async()=>{
    const f=fixture();
    f.mutate('externalClinicalCredentialHeads',REVIEWER,{validUntil:NOW});
    expect((await f.assess()).reasonCode).toBe('CI_EXT16_REVIEWER_CREDENTIAL_NOT_CURRENT');
    f.mutate('externalClinicalCredentialHeads',REVIEWER,{validUntil:NOW+1000});
    f.mutate('externalClinicalCredentialHeads',APPROVER,{revokedAt:NOW-10});
    expect((await f.assess()).reasonCode).toBe('CI_EXT16_APPROVER_CREDENTIAL_NOT_CURRENT');
  });
  test('rejects revoked or expired hospital source authority',async()=>{
    const f=fixture();
    f.mutate('externalClinicalSiteAuthorityHeads',SOURCE.sourceId,{status:'REVOKED'});
    expect((await f.assess()).reasonCode).toBe('CI_EXT16_SITE_AUTHORITY_NOT_CURRENT');
    f.mutate('externalClinicalSiteAuthorityHeads',SOURCE.sourceId,{
      status:'APPROVED',validUntil:NOW,
    });
    expect((await f.assess()).reasonCode).toBe('CI_EXT16_SITE_AUTHORITY_NOT_CURRENT');
  });
  test('rejects missing, revoked, stale, or conflicting per-fact clinical approval',async()=>{
    const f=fixture();
    f.records.delete('externalClinicalFactApprovalHeads/'+f.approvalId);
    expect((await f.assess()).reasonCode)
      .toBe('CI_EXT16_FACT_APPROVAL_MISSING_STALE_OR_REVOKED');
    const g=fixture();
    g.mutate('externalClinicalFactApprovalHeads',g.approvalId,{revokedAt:NOW-1});
    expect((await g.assess()).state).toBe('DENIED');
    g.mutate('externalClinicalFactApprovalHeads',g.approvalId,{
      revokedAt:null,siteAuthorityRevision:3,
    });
    expect((await g.assess()).state).toBe('DENIED');
    g.mutate('externalClinicalFactApprovalHeads',g.approvalId,{
      siteAuthorityRevision:4,resourceHash:'0'.repeat(64),
    });
    expect((await g.assess()).state).toBe('DENIED');
  });
  test('a forged mutable approval head without immutable event is denied',async()=>{
    const f=fixture();
    f.mutate('externalClinicalFactApprovalHeads',f.approvalId,{
      eventHash:'0'.repeat(64),
    });
    expect((await f.assess()).reasonCode)
      .toBe('CI_EXT17_APPROVAL_EVENT_CHAIN_INVALID');
    const g=fixture();
    g.records.delete('externalClinicalFactApprovalEvents/efae_synthetic_seed');
    expect((await g.assess()).reasonCode)
      .toBe('CI_EXT17_APPROVAL_EVENT_CHAIN_INVALID');
  });
  test('requires independently credentialed clinical approver, never reviewer self-approval',async()=>{
    const f=fixture();
    f.mutate('externalClinicalFactApprovalHeads',f.approvalId,{
      approvedByActorId:REVIEWER,
    });
    expect((await f.assess()).state).toBe('DENIED');
    const g=fixture();
    g.mutate('externalClinicalCredentialHeads',APPROVER,{licenseVerified:false});
    expect((await g.assess()).reasonCode).toBe('CI_EXT16_APPROVER_CREDENTIAL_NOT_CURRENT');
  });
  test('source enforces same-transaction integration and browser-deny rules',async()=>{
    const reader=await readFile(resolve(process.cwd(),
      'lib/clinical/intelligence/external-clinical-evidence-reader.ts'),'utf8');
    expect(reader).toContain('currentAuthorizationReviewId');
    expect(reader).toContain('tx,tenant,tenantId,patientId,actorId:actor.actorId');
    expect(reader).toContain('assessCurrentExternalClinicalApproval');
    const rules=await readFile(resolve(process.cwd(),'firestore.rules'),'utf8');
    for(const [collection,id] of [
      ['externalClinicalCredentialHeads','actorId'],
      ['externalClinicalSiteAuthorityHeads','sourceId'],
      ['externalClinicalFactApprovalHeads','approvalId'],
    ]){
      expect(rules).toContain('match /'+collection+'/{'+id+
        '} { allow read, write: if false; }');
    }
  });
});
