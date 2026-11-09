import {describe,expect,test} from 'bun:test';
import type {DocumentReference,Transaction} from 'firebase-admin/firestore';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {syntheticGovernanceAuthority} from './support/ci-ext19-governance-fixtures';
import {
  verifyCurrentExternalGovernanceAuthority,
  type ExternalGovernanceAuthority,
} from '@/lib/clinical/intelligence/external-governance-authority-consumer';

type Row=Record<string,unknown>;
const NOW=1794200000000;
const TENANT='synthetic-tenant';

function fixture(){
  const records=new Map<string,Row>();
  const put=(name:string,id:string,value:Row)=>{
    records.set(name+'/'+id,value);
  };
  const bundles=[
    syntheticGovernanceAuthority({
      tenantId:TENANT,kind:'CLINICIAN',targetId:'reviewer',
      facilityId:'facility-a',now:NOW,
    }),
    syntheticGovernanceAuthority({
      tenantId:TENANT,kind:'CLINICIAN',targetId:'approver',
      facilityId:'facility-a',now:NOW,
    }),
    syntheticGovernanceAuthority({
      tenantId:TENANT,kind:'SITE',targetId:'synthetic-source',
      facilityId:'facility-a',siteApprovalId:'site-v1',now:NOW,
    }),
  ];
  const authorities:ExternalGovernanceAuthority[]=bundles.map((x,i)=>({
    kind:i===2?'SITE':'CLINICIAN',
    targetId:['reviewer','approver','synthetic-source'][i],
    facilityId:'facility-a',siteApprovalId:i===2?'site-v1':null,
    head:x.head,
  }));
  for(let i=0;i<bundles.length;i++){
    const x=bundles[i];
    put('externalClinicalAuthorityEvents',x.eventId,x.event);
    put('externalClinicalAuthorityEvents',x.proposalEventId,x.proposalEvent);
    put('externalClinicalAuthorityProposals',x.proposalId,x.proposal);
    put('externalClinicalAuthorityEvidence',x.evidenceId,x.evidence);
    put('externalClinicalGovernanceGrants',x.proposerId,x.proposerGrant);
    put('externalClinicalGovernanceGrants',x.approverId,x.approverGrant);
  }
  const tenant={
    collection:(name:string)=>({
      doc:(id:string)=>({path:name+'/'+id}),
    }),
  } as unknown as DocumentReference;
  const snapshot=(ref:{path:string})=>{
    const row=records.get(ref.path);
    return {
      exists:row!==undefined,
      data:()=>row,
      get:(key:string)=>row?.[key],
    };
  };
  const tx={
    getAll:async(...refs:{path:string}[])=>refs.map(snapshot),
  } as unknown as Transaction;
  const assess=(entries=authorities)=>verifyCurrentExternalGovernanceAuthority({
    tx,tenant,tenantId:TENANT,now:NOW,authorities:entries,
  });
  const mutate=(collection:string,id:string,changes:Row)=>{
    const key=collection+'/'+id;
    const row=records.get(key);
    if(!row)throw Error('synthetic record missing');
    records.set(key,{...row,...changes});
  };
  return {records,bundles,authorities,assess,mutate};
}

describe('CI-EXT-19 verifiable current governance at consumption',()=>{
  test('all synthetic event/proposal/evidence/grants qualify only non-promoting',async()=>{
    const f=fixture();
    expect(await f.assess()).toEqual({
      valid:true,reasonCode:'CI_EXT19_EVENT_BACKED_AUTHORITY_NON_PROMOTING',
      clinicalUseAuthorized:false,aiDraftingEligible:false,
    });
  });
  test('missing or altered current event/head never qualifies',async()=>{
    const f=fixture();
    f.records.delete('externalClinicalAuthorityEvents/'+f.bundles[0].eventId);
    expect((await f.assess()).reasonCode).toBe('CI_EXT19_CURRENT_EVENT_INVALID');
    const g=fixture();
    const changed=[{...g.authorities[0],
      head:{...g.authorities[0].head,governanceEventHash:'0'.repeat(64)}},
      ...g.authorities.slice(1)];
    expect((await g.assess(changed)).reasonCode)
      .toBe('CI_EXT19_CURRENT_EVENT_INVALID');
  });
  test('revoked grant, expired proof, missing proposal, forged chain all denied',async()=>{
    const f=fixture();
    f.mutate('externalClinicalGovernanceGrants',f.bundles[1].approverId,{
      revokedAt:NOW-10,
    });
    expect((await f.assess()).reasonCode)
      .toBe('CI_EXT19_HOSPITAL_GRANT_NOT_CURRENT');
    const g=fixture();
    g.mutate('externalClinicalAuthorityEvidence',g.bundles[2].evidenceId,{
      validUntil:NOW,
    });
    expect((await g.assess()).reasonCode)
      .toBe('CI_EXT19_VERIFICATION_EVIDENCE_NOT_CURRENT');
    const h=fixture();
    h.records.delete('externalClinicalAuthorityProposals/'+h.bundles[0].proposalId);
    expect((await h.assess()).reasonCode).toBe('CI_EXT19_PROPOSAL_CHAIN_INVALID');
    const i=fixture();
    i.mutate('externalClinicalAuthorityEvents',i.bundles[1].proposalEventId,{
      eventHash:'0'.repeat(64),
    });
    expect((await i.assess()).reasonCode).toBe('CI_EXT19_PROPOSAL_CHAIN_INVALID');
  });
  test('scope refuses wrong tenant and duplicated or unbound source',async()=>{
    const f=fixture();
    expect((await f.assess([f.authorities[0],f.authorities[0]])).reasonCode)
      .toBe('CI_EXT19_SCOPE_INVALID');
    expect((await f.assess([{...f.authorities[2],siteApprovalId:'forged'}]))
      .reasonCode).toBe('CI_EXT19_HEAD_NOT_GOVERNED');
  });
  test('issuer and reader both enforce current governance inside transactions',()=>{
    const root=resolve(process.cwd(),'lib/clinical/intelligence');
    const reader=readFileSync(resolve(root,
      'external-current-authorization-preflight.ts'),'utf8');
    const issuer=readFileSync(resolve(root,
      'external-fact-approval-events.ts'),'utf8');
    expect(reader).toContain('verifyCurrentExternalGovernanceAuthority');
    expect(issuer).toContain('verifyCurrentExternalGovernanceAuthority');
    expect(issuer).toContain('const isReplay=cmd.exists;');
    expect(issuer).toContain('if(isReplay){');
  });
});
