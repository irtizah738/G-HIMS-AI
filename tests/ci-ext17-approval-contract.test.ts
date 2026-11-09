import {describe,expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  assertApprovalIssue,assertApprovalRevoke,
  type ApprovalEventPayload,
} from '@/lib/clinical/intelligence/external-fact-approval-events';
import {approvalEventHash,verifyApprovalEventHead}
  from '@/lib/clinical/intelligence/external-fact-approval-event-integrity';

const issue={
  reviewId:'ecr_'+'a'.repeat(64),evidenceReceiptId:'fir_synthetic',
  sourceVersionId:'v1',resourceHash:'c'.repeat(64),
  idempotencyKey:randomUUID(),
};
const revoke={
  reviewId:issue.reviewId,evidenceReceiptId:issue.evidenceReceiptId,
  idempotencyKey:randomUUID(),expectedRevision:1,
  reasonCode:'SAFETY_CONCERN' as const,
};
const payload:ApprovalEventPayload={
  schemaVersion:1,tenantId:'synthetic-tenant',patientId:'synthetic-patient',
  reviewId:issue.reviewId,headId:'efah_'+'b'.repeat(64),
  evidenceReceiptId:issue.evidenceReceiptId,
  sourceVersionId:issue.sourceVersionId,resourceHash:issue.resourceHash,
  sourceId:'synthetic-source',facilityId:'facility-a',
  factualDigest:'d'.repeat(64),authorityFenceHash:'e'.repeat(64),
  status:'APPROVED',eventType:'EXTERNAL_FACT_APPROVAL_ISSUED',
  revision:1,approvedByActorId:'synthetic-approver',
  reviewerActorId:'synthetic-reviewer',
  reviewerCredentialRevision:2,approverCredentialRevision:3,
  siteAuthorityRevision:4,validFrom:1794200000000,
  validUntil:1794200600000,revokedAt:null,
  actorId:'synthetic-approver',recordedAt:1794200000000,
  reasonCode:null,previousEventId:null,previousEventHash:null,
};
describe('CI-EXT-17 immutable clinical fact approvals',()=>{
  test('commands accept exact typed IDs, hashes and disposition codes only',()=>{
    expect(()=>assertApprovalIssue(issue)).not.toThrow();
    expect(()=>assertApprovalRevoke(revoke)).not.toThrow();
    expect(()=>assertApprovalIssue({...issue,actorId:'client-forged'}))
      .toThrow('CI_EXT17_ISSUE_REQUEST_INVALID');
    expect(()=>assertApprovalIssue({...issue,resourceHash:'bad'}))
      .toThrow('CI_EXT17_ISSUE_REQUEST_INVALID');
    expect(()=>assertApprovalIssue({...issue,idempotencyKey:'replay'}))
      .toThrow('CI_EXT17_ISSUE_REQUEST_INVALID');
    expect(()=>assertApprovalRevoke({...revoke,expectedRevision:0}))
      .toThrow('CI_EXT17_REVOKE_REQUEST_INVALID');
    expect(()=>assertApprovalRevoke({...revoke,reasonCode:'AUTO_REENABLE'}))
      .toThrow('CI_EXT17_REVOKE_REQUEST_INVALID');
  });
  test('head is accepted only with an exact immutable domain-hashed event',()=>{
    const eventHash=approvalEventHash(payload);
    const eventId='efae_synthetic';
    const event={
      eventId,eventHash,immutable:true,payload,
      clinicalUseAuthorized:false,aiDraftingEligible:false,
    };
    const head={
      ...payload,approvalEventId:eventId,eventHash,immutableSourceEvent:true,
      evidenceOnly:true,clinicalUseAuthorized:false,aiDraftingEligible:false,
    };
    expect(verifyApprovalEventHead(head,event,eventId)).toBe(true);
    expect(verifyApprovalEventHead({...head,resourceHash:'0'.repeat(64)},
      event,eventId)).toBe(false);
    expect(verifyApprovalEventHead({...head,status:'REVOKED'},
      event,eventId)).toBe(false);
    expect(verifyApprovalEventHead(head,{...event,
      payload:{...payload,validUntil:payload.validUntil+1}},eventId)).toBe(false);
    expect(verifyApprovalEventHead(head,{...event,
      clinicalUseAuthorized:true},eventId)).toBe(false);
  });
  test('revocation event forms a distinct chained immutable transition',()=>{
    const firstHash=approvalEventHash(payload);
    const revokePayload:ApprovalEventPayload={
      ...payload,status:'REVOKED',eventType:'EXTERNAL_FACT_APPROVAL_REVOKED',
      revision:2,actorId:'clinical-safety-officer',
      recordedAt:payload.recordedAt+5000,revokedAt:payload.recordedAt+5000,
      reasonCode:'SAFETY_CONCERN',previousEventId:'efae_first',
      previousEventHash:firstHash,
    };
    expect(approvalEventHash(revokePayload)).not.toBe(firstHash);
    const eventId='efae_second',eventHash=approvalEventHash(revokePayload);
    expect(verifyApprovalEventHead({
      ...revokePayload,approvalEventId:eventId,eventHash,
      immutableSourceEvent:true,evidenceOnly:true,
      clinicalUseAuthorized:false,aiDraftingEligible:false,
    },{
      eventId,eventHash,immutable:true,payload:revokePayload,
      clinicalUseAuthorized:false,aiDraftingEligible:false,
    },eventId)).toBe(true);
  });
  test('approval mutation paths are emulator-only, no public API, all client rules denied',()=>{
    const base=resolve(process.cwd());
    const source=readFileSync(resolve(base,
      'lib/clinical/intelligence/external-fact-approval-events.ts'),'utf8');
    expect(source).toContain("process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'");
    expect(source).toContain("process.env.GHIMS_RUNTIME_MODE!=='TEST'");
    expect(source).toContain("process.env.GHIMS_CI_EXTERNAL_FACT_APPROVAL_ENABLED!=='true'");
    expect(source).toContain('tx.create(tenant.collection(');
    expect(source).toContain('tx.update(headRef,baseHead(');
    expect(existsSync(resolve(base,'app/api/integrations/fhir/fact-approval/route.ts')))
      .toBe(false);
    const rules=readFileSync(resolve(base,'firestore.rules'),'utf8');
    for(const [collection,id] of [
      ['externalClinicalFactApprovalEvents','eventId'],
      ['externalClinicalFactApprovalOutbox','eventId'],
      ['externalClinicalFactApprovalCommands','commandId'],
      ['externalClinicalFactApprovalHeads','approvalId'],
    ]){
      expect(rules).toContain('match /'+collection+'/{'+id+
        '} { allow read, write: if false; }');
    }
  });
});
