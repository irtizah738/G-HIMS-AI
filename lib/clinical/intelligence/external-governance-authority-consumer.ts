/**
 * CI-EXT-19: fail-closed consumer of CI-EXT-18 institutional authority.
 * Only run in the same server Firestore transaction as current evidence,
 * consent, source, and fact-approval checks.
 *
 * Event hashes prove internal consistency, NOT real-world hospital signatures.
 * All successful results are non-promoting engineering qualifications.
 */
import type {DocumentReference,Transaction} from 'firebase-admin/firestore';
import {verifyCurrentSignedAuthorityRecord} from './external-signed-authority-consumer';
import {governanceEventHash,verifyGovernanceHead,
  type GovernanceEventPayload} from './external-authority-governance';

type Row=Record<string,unknown>;
const ID=/^[A-Za-z0-9._-]{1,128}$/;
const HASH=/^[a-f0-9]{64}$/;
const MAX_AUTHORITIES=128;

export type ExternalGovernanceAuthority=Readonly<{
  kind:'CLINICIAN'|'SITE';
  targetId:string;
  facilityId:string;
  siteApprovalId:string|null;
  head:Row;
}>;
export type CurrentAuthorityEvidence=Readonly<{
  valid:boolean;
  reasonCode:string;
  clinicalUseAuthorized:false;
  aiDraftingEligible:false;
}>;
function validId(value:unknown):value is string{
  return typeof value==='string'&&ID.test(value)&&value!=='.'&&value!=='..';
}
function time(value:unknown):value is number{
  return typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
}
function active(row:Row|undefined,now:number):boolean{
  return !!row&&time(row.validFrom)&&time(row.validUntil)&&
    row.validFrom<=now&&now<row.validUntil&&
    (row.revokedAt===null||row.revokedAt===undefined);
}
function deny(code:string):CurrentAuthorityEvidence{
  return {valid:false,reasonCode:code,
    clinicalUseAuthorized:false,aiDraftingEligible:false};
}
function acceptableGrant(row:Row|undefined,tenantId:string,actorId:string,
  facilityId:string,role:string,permission:string,now:number):boolean{
  return !!row&&row.tenantId===tenantId&&row.actorId===actorId&&
    row.status==='ACTIVE'&&row.identityAssurance==='HOSPITAL_VERIFIED'&&
    row.mfaStatus==='VERIFIED'&&
    Array.isArray(row.facilityIds)&&row.facilityIds.includes(facilityId)&&
    Array.isArray(row.roles)&&row.roles.includes(role)&&
    Array.isArray(row.permissions)&&row.permissions.includes(permission)&&
    active(row,now);
}
function matchingEvidence(row:Row|undefined,p:GovernanceEventPayload,
  now:number):boolean{
  return !!row&&row.schemaVersion===1&&row.tenantId===p.tenantId&&
    row.kind===p.kind&&row.targetId===p.targetId&&
    row.facilityId===p.facilityId&&row.evidenceId===p.evidenceId&&
    row.status==='VERIFIED'&&row.identityAssurance==='HOSPITAL_VERIFIED'&&
    row.evidenceHash===p.evidenceHash&&
    row.verifiedByActorId===p.verifiedByActorId&&
    time(row.verifiedAt)&&row.verifiedAt<=now&&
    active(row,now)&&
    (p.kind==='CLINICIAN'?row.licenseVerified===true&&row.siteApprovalId===null:
      row.siteApprovalId===p.siteApprovalId);
}
function proposalMatches(row:Row|undefined,
  p:GovernanceEventPayload):boolean{
  return !!row&&row.schemaVersion===1&&
    row.action==='PROPOSED'&&row.status==='PENDING'&&
    row.revision===0&&row.tenantId===p.tenantId&&
    row.kind===p.kind&&row.targetId===p.targetId&&
    row.facilityId===p.facilityId&&row.proposalId===p.proposalId&&
    row.evidenceId===p.evidenceId&&row.evidenceHash===p.evidenceHash&&
    row.siteApprovalId===p.siteApprovalId&&
    row.proposedByActorId===p.proposedByActorId&&
    row.verifiedByActorId===p.verifiedByActorId&&
    row.authorizedByActorId===null&&
    time(row.recordedAt)&&row.recordedAt<=p.recordedAt&&
    time(row.validUntil)&&p.recordedAt<row.validUntil;
}
export async function verifyCurrentExternalGovernanceAuthority(args:Readonly<{
  tx:Transaction;
  tenant:DocumentReference;
  tenantId:string;
  now:number;
  authorities:readonly ExternalGovernanceAuthority[];
}>):Promise<CurrentAuthorityEvidence>{
  const {tx,tenant,tenantId,now,authorities}=args;
  if(!validId(tenantId)||!time(now)||
    authorities.length<1||authorities.length>MAX_AUTHORITIES)
    return deny('CI_EXT19_SCOPE_INVALID');
  const ids=new Set<string>();
  for(const entry of authorities){
    const key=entry.kind+':'+entry.targetId;
    if(ids.has(key)||!validId(entry.targetId)||
      !validId(entry.facilityId)||
      (entry.kind!=='CLINICIAN'&&entry.kind!=='SITE')||
      (entry.kind==='SITE'&&!validId(entry.siteApprovalId))||
      (entry.kind==='CLINICIAN'&&entry.siteApprovalId!==null)||
      !entry.head||typeof entry.head!=='object')
      return deny('CI_EXT19_SCOPE_INVALID');
    ids.add(key);
    const h=entry.head;
    if(h.tenantId!==tenantId||h.kind!==entry.kind||
      h.targetId!==entry.targetId||h.facilityId!==entry.facilityId||
      h.revision!==1||h.immutableSourceEvent!==true||
      h.evidenceOnly!==true||h.clinicalUseAuthorized!==false||
      h.aiDraftingEligible!==false||!active(h,now)||
      !validId(h.governanceEventId)||
      typeof h.governanceEventHash!=='string'||!HASH.test(h.governanceEventHash)||
      (entry.kind==='SITE'?
        h.status!=='APPROVED'||h.clinicalUseReviewStatus!=='APPROVED'||
        h.siteApprovalId!==entry.siteApprovalId:
        h.status!=='VERIFIED'||h.actorId!==entry.targetId||
        h.licenseVerified!==true||
        h.identityAssurance!=='HOSPITAL_VERIFIED'||
        !Array.isArray(h.facilityIds)||!h.facilityIds.includes(entry.facilityId)))
      return deny('CI_EXT19_HEAD_NOT_GOVERNED');
  }
  const events=await tx.getAll(...authorities.map(a=>
    tenant.collection('externalClinicalAuthorityEvents')
      .doc(a.head.governanceEventId as string)));
  const payloads:GovernanceEventPayload[]=[];
  for(let i=0;i<authorities.length;i++){
    const a=authorities[i],event=events[i];
    if(!event.exists||
      !verifyGovernanceHead(a.head,event.data() as Row,
        a.head.governanceEventId as string))
      return deny('CI_EXT19_CURRENT_EVENT_INVALID');
    const p=event.get('payload') as GovernanceEventPayload;
    if(p.action!=='ACTIVATED'||p.revision!==1||
      p.actorId!==p.authorizedByActorId||
      !validId(p.authorizedByActorId)||
      !validId(p.proposedByActorId)||!validId(p.verifiedByActorId)||
      p.authorizedByActorId===p.proposedByActorId||
      p.authorizedByActorId===p.verifiedByActorId||
      p.proposedByActorId===p.verifiedByActorId||
      (p.kind==='CLINICIAN'&&
        (p.targetId===p.authorizedByActorId||
         p.targetId===p.proposedByActorId||
         p.targetId===p.verifiedByActorId))||
      !validId(p.evidenceId)||typeof p.evidenceHash!=='string'||
      !HASH.test(p.evidenceHash)||
      !validId(p.proposalId)||!validId(p.previousEventId)||
      typeof p.previousEventHash!=='string'||!HASH.test(p.previousEventHash)||
      p.reasonCode!==null||p.revokedAt!==null||
      !time(p.recordedAt)||p.recordedAt>now)
      return deny('CI_EXT19_ISSUANCE_INDEPENDENCE_INVALID');
    payloads.push(p);
  }
  const proposalEvents=await tx.getAll(...payloads.map(p=>
    tenant.collection('externalClinicalAuthorityEvents')
      .doc(p.previousEventId as string)));
  const proposals=await tx.getAll(...payloads.map(p=>
    tenant.collection('externalClinicalAuthorityProposals').doc(p.proposalId)));
  const evidences=await tx.getAll(...payloads.map(p=>
    tenant.collection('externalClinicalAuthorityEvidence').doc(p.evidenceId)));
  const grantRefs=payloads.flatMap(p=>[
    tenant.collection('externalClinicalGovernanceGrants').doc(p.proposedByActorId),
    tenant.collection('externalClinicalGovernanceGrants')
      .doc(p.authorizedByActorId as string),
  ]);
  const grants=await tx.getAll(...grantRefs);
  for(let i=0;i<payloads.length;i++){
    const p=payloads[i];
    const event=proposalEvents[i];
    const original=event.exists?event.get('payload') as Row:undefined;
    const proposal=proposals[i].exists?proposals[i].data() as Row:undefined;
    const proof=evidences[i].exists?evidences[i].data() as Row:undefined;
    if(!event.exists||event.get('immutable')!==true||
      event.get('clinicalUseAuthorized')!==false||
      event.get('aiDraftingEligible')!==false||
      event.get('eventId')!==p.previousEventId||
      event.get('eventHash')!==p.previousEventHash||
      !original||!proposalMatches(original,p)||
      governanceEventHash(original as GovernanceEventPayload)!==p.previousEventHash||
      !proposal||proposal.immutable!==true||
      proposal.proposalEventId!==p.previousEventId||
      !proposalMatches(proposal,p))
      return deny('CI_EXT19_PROPOSAL_CHAIN_INVALID');
    if(!matchingEvidence(proof,p,now))
      return deny('CI_EXT19_VERIFICATION_EVIDENCE_NOT_CURRENT');
    const role=p.kind==='CLINICIAN'?'HOSPITAL_CREDENTIAL_OFFICER':
      'HOSPITAL_INTEGRATION_OFFICER';
    const prefix=p.kind==='CLINICIAN'?'FHIR_CREDENTIAL_':'FHIR_SITE_AUTHORITY_';
    const proposer=grants[i*2].exists?grants[i*2].data() as Row:undefined;
    const approver=grants[i*2+1].exists?grants[i*2+1].data() as Row:undefined;
    if(!acceptableGrant(proposer,tenantId,p.proposedByActorId,p.facilityId,
      role,prefix+'PROPOSE',now)||
       !acceptableGrant(approver,tenantId,p.authorizedByActorId as string,
         p.facilityId,role,prefix+'ACTIVATE',now))
      return deny('CI_EXT19_HOSPITAL_GRANT_NOT_CURRENT');
    // CI-EXT-21: structural heads and matching SHA256 governance events
    // are not evidence of hospital-signed authority. Each of these
    // artifacts needs a currently valid, independently pinned signature,
    // immutable attestation, matching command journal and HELD outbox.
    const signedProof=await verifyCurrentSignedAuthorityRecord({
      tx,tenant,tenantId,facilityId:p.facilityId,
      kind:p.kind,recordId:p.evidenceId,record:proof,now,
    });
    if(!signedProof.valid)return deny(signedProof.reasonCode);
    for(const [grantId,grant] of [
      [p.proposedByActorId,proposer],
      [p.authorizedByActorId,approver],
    ] as const){
      const signedGrant=await verifyCurrentSignedAuthorityRecord({
        tx,tenant,tenantId,facilityId:p.facilityId,
        kind:'GOVERNANCE_GRANT',recordId:grantId as string,
        record:grant,now,
      });
      if(!signedGrant.valid)return deny(signedGrant.reasonCode);
    }
  }
  return {valid:true,reasonCode:'CI_EXT19_EVENT_BACKED_AUTHORITY_NON_PROMOTING',
    clinicalUseAuthorized:false,aiDraftingEligible:false};
}
