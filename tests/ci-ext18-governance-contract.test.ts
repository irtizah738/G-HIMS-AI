import {describe,expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {
  assertAuthorityProposal,assertAuthorityActivate,assertAuthorityRevoke,
  governanceEventHash,verifyGovernanceHead,
  type GovernanceEventPayload,
} from '@/lib/clinical/intelligence/external-authority-governance';
const proposal={
  kind:'CLINICIAN',targetId:'clinician-test',
  facilityId:'facility-a',evidenceId:'proof-test',idempotencyKey:randomUUID(),
} as const;
const activate={proposalId:'egp_'+'a'.repeat(64),idempotencyKey:randomUUID()};
const revoke={
  kind:'CLINICIAN',targetId:'clinician-test',expectedRevision:1,
  idempotencyKey:randomUUID(),reasonCode:'LICENSE_WITHDRAWN',
} as const;
const payload:GovernanceEventPayload={
  schemaVersion:1,tenantId:'synthetic-tenant',kind:'CLINICIAN',
  targetId:'clinician-test',facilityId:'facility-a',
  proposalId:activate.proposalId,
  proposedByActorId:'credential-proposer',authorizedByActorId:'credential-approver',
  evidenceId:'proof-test',evidenceHash:'f'.repeat(64),
  verifiedByActorId:'independent-verifier',siteApprovalId:null,
  action:'ACTIVATED',status:'VERIFIED',revision:1,
  validFrom:1794200000000,validUntil:1794200600000,revokedAt:null,
  actorId:'credential-approver',recordedAt:1794200000000,
  reasonCode:null,previousEventId:'ege_proposal',previousEventHash:'a'.repeat(64),
};
describe('CI-EXT-18 synthetic external credential/site governance',()=>{
  test('strict request fields; no client-forged scope or approval status',()=>{
    expect(()=>assertAuthorityProposal(proposal)).not.toThrow();
    expect(()=>assertAuthorityActivate(activate)).not.toThrow();
    expect(()=>assertAuthorityRevoke(revoke)).not.toThrow();
    expect(()=>assertAuthorityProposal({...proposal,verifiedByActorId:'forged'}))
      .toThrow('CI_EXT18_PROPOSAL_INVALID');
    expect(()=>assertAuthorityProposal({...proposal,idempotencyKey:'invalid'}))
      .toThrow('CI_EXT18_PROPOSAL_INVALID');
    expect(()=>assertAuthorityProposal({...proposal,kind:'SUPERUSER'}))
      .toThrow('CI_EXT18_PROPOSAL_INVALID');
    expect(()=>assertAuthorityActivate({...activate,activatedBy:'browser'}))
      .toThrow('CI_EXT18_ACTIVATE_INVALID');
    expect(()=>assertAuthorityRevoke({...revoke,expectedRevision:0}))
      .toThrow('CI_EXT18_REVOKE_INVALID');
    expect(()=>assertAuthorityRevoke({...revoke,reasonCode:'IGNORE_HOSPITAL'}))
      .toThrow('CI_EXT18_REVOKE_INVALID');
  });
  test('derived head requires exact immutable event, no forged privilege flags',()=>{
    const eventId='ege_qualified',eventHash=governanceEventHash(payload);
    const event={eventId,eventHash,payload,immutable:true,
      clinicalUseAuthorized:false,aiDraftingEligible:false};
    const head={
      ...payload,actorId:payload.targetId,facilityIds:[payload.facilityId],
      identityAssurance:'HOSPITAL_VERIFIED',licenseVerified:true,
      governanceEventId:eventId,governanceEventHash:eventHash,
      immutableSourceEvent:true,evidenceOnly:true,
      clinicalUseAuthorized:false,aiDraftingEligible:false,
    };
    expect(verifyGovernanceHead(head,event,eventId)).toBe(true);
    expect(verifyGovernanceHead({...head,validUntil:0},event,eventId)).toBe(false);
    expect(verifyGovernanceHead({...head,status:'REVOKED'},event,eventId)).toBe(false);
    expect(verifyGovernanceHead({...head,clinicalUseAuthorized:true},event,eventId))
      .toBe(false);
    expect(verifyGovernanceHead(head,{...event,payload:{...payload,revision:9}},
      eventId)).toBe(false);
  });
  test('revoked status is immutable event transition, not document deletion',()=>{
    const second:GovernanceEventPayload={
      ...payload,action:'REVOKED',status:'REVOKED',revision:2,
      revokedAt:payload.recordedAt+1000,
      actorId:'clinical-safety-officer',recordedAt:payload.recordedAt+1000,
      reasonCode:'LICENSE_WITHDRAWN',previousEventId:'ege_qualified',
      previousEventHash:governanceEventHash(payload),
    };
    expect(governanceEventHash(second)).not.toBe(governanceEventHash(payload));
    const eventId='ege_revoked',eventHash=governanceEventHash(second);
    const head={
      ...second,actorId:second.targetId,facilityIds:[second.facilityId],
      identityAssurance:'HOSPITAL_VERIFIED',licenseVerified:true,
      governanceEventId:eventId,governanceEventHash:eventHash,
      immutableSourceEvent:true,evidenceOnly:true,
      clinicalUseAuthorized:false,aiDraftingEligible:false,
    };
    expect(verifyGovernanceHead(head,{eventId,eventHash,payload:second,
      immutable:true,clinicalUseAuthorized:false,aiDraftingEligible:false},eventId))
      .toBe(true);
  });
  test('no public API, emulator locked, client-denied and HELD publication',()=>{
    const root=resolve(process.cwd());
    const source=readFileSync(resolve(root,
      'lib/clinical/intelligence/external-authority-governance.ts'),'utf8');
    expect(source).toContain("process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'");
    expect(source).toContain("process.env.GHIMS_RUNTIME_MODE!=='TEST'");
    expect(source).toContain("process.env.GHIMS_CI_EXTERNAL_AUTHORITY_GOVERNANCE_ENABLED!=='true'");
    expect(source).toContain("status:'HELD'");
    expect(source).toContain('tx.create(tenant.collection(');
    for(const path of [
      'app/api/integrations/fhir/authority-governance/route.ts',
      'app/api/integrations/fhir/credentials/route.ts',
    ])expect(existsSync(resolve(root,path))).toBe(false);
    const rules=readFileSync(resolve(root,'firestore.rules'),'utf8');
    for(const [name,id] of [
      ['externalClinicalGovernanceGrants','actorId'],
      ['externalClinicalAuthorityEvidence','evidenceId'],
      ['externalClinicalAuthorityProposals','proposalId'],
      ['externalClinicalAuthorityEvents','eventId'],
      ['externalClinicalAuthorityOutbox','eventId'],
      ['externalClinicalAuthorityCommands','commandId'],
    ])expect(rules).toContain('match /'+name+'/{'+id+
      '} { allow read, write: if false; }');
  });
});
