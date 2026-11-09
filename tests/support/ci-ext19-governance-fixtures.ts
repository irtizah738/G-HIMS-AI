/** CI-EXT-19 synthetic-only, deterministic event-backed authority fixtures.
 * Must NEVER be imported from a production route or real credential issuer. */
import {createHash} from 'node:crypto';
import {syntheticSignedAuthorityRows,type SyntheticSignedRows}
  from './ci-ext21-signed-fixtures';
import {governanceEventHash,
  type GovernanceEventPayload} from
  '@/lib/clinical/intelligence/external-authority-governance';

type Row=Record<string,unknown>;
export type SyntheticAuthorityBundle=Readonly<{
  head:Row;
  eventId:string;event:Row;
  proposalEventId:string;proposalEvent:Row;
  proposalId:string;proposal:Row;
  evidenceId:string;evidence:Row;
  proposerId:string;proposerGrant:Row;
  approverId:string;approverGrant:Row;
  signedDocuments:readonly SyntheticSignedRows[];
}>;

export function syntheticGovernanceAuthority(args:Readonly<{
  tenantId:string;
  kind:'CLINICIAN'|'SITE';
  targetId:string;
  facilityId:string;
  siteApprovalId?:string|null;
  now:number;
}>):SyntheticAuthorityBundle{
  const {tenantId,kind,targetId,facilityId,now}=args;
  const siteApprovalId=kind==='SITE'?args.siteApprovalId||'site-approved-v1':null;
  const token=createHash('sha256')
    .update(JSON.stringify([tenantId,kind,targetId,facilityId])).digest('hex')
    .slice(0,24);
  const proposalId='egp_'+token;
  const proposalEventId='ege_prop_'+token;
  const eventId='ege_act_'+token;
  const evidenceId='ev_'+token;
  const proposerId='prop_'+token;
  const approverId='auth_'+token;
  const verifierId='verified_'+token;
  const evidenceHash=createHash('sha256')
    .update('synthetic-authority-evidence-'+token).digest('hex');
  const validFrom=now-60000,validUntil=now+60000;
  const proposalPayload:GovernanceEventPayload={
    schemaVersion:1,tenantId,kind,targetId,facilityId,
    proposalId,proposedByActorId:proposerId,authorizedByActorId:null,
    evidenceId,evidenceHash,verifiedByActorId:verifierId,
    siteApprovalId,action:'PROPOSED',status:'PENDING',revision:0,
    validFrom,validUntil:now+30000,revokedAt:null,
    actorId:proposerId,recordedAt:now-2000,reasonCode:null,
    previousEventId:null,previousEventHash:null,
  };
  const proposalEventHash=governanceEventHash(proposalPayload);
  const activatedPayload:GovernanceEventPayload={
    ...proposalPayload,action:'ACTIVATED',
    status:kind==='CLINICIAN'?'VERIFIED':'APPROVED',revision:1,
    authorizedByActorId:approverId,actorId:approverId,
    recordedAt:now-1000,validUntil,
    previousEventId:proposalEventId,previousEventHash:proposalEventHash,
  };
  const eventHash=governanceEventHash(activatedPayload);
  const event={
    eventId,eventHash,payload:activatedPayload,immutable:true,
    clinicalUseAuthorized:false,aiDraftingEligible:false,
  };
  const proposalEvent={
    eventId:proposalEventId,eventHash:proposalEventHash,
    payload:proposalPayload,immutable:true,
    clinicalUseAuthorized:false,aiDraftingEligible:false,
  };
  const proposal={
    ...proposalPayload,proposalEventId,evidenceExpiry:validUntil,
    immutable:true,clinicalUseAuthorized:false,aiDraftingEligible:false,
  };
  const head={
    ...activatedPayload,governanceEventId:eventId,
    governanceEventHash:eventHash,immutableSourceEvent:true,
    evidenceOnly:true,clinicalUseAuthorized:false,aiDraftingEligible:false,
    ...(kind==='CLINICIAN'?{
      actorId:targetId,facilityIds:[facilityId],
      status:'VERIFIED',identityAssurance:'HOSPITAL_VERIFIED',
      licenseVerified:true,
    }:{
      sourceId:targetId,clinicalUseReviewStatus:'APPROVED',
    }),
  };
  const evidence={
    schemaVersion:1,tenantId,kind,targetId,facilityId,evidenceId,
    status:'VERIFIED',identityAssurance:'HOSPITAL_VERIFIED',
    licenseVerified:kind==='CLINICIAN',siteApprovalId,
    evidenceHash,verifiedByActorId:verifierId,
    verifiedAt:now-3000,validFrom,validUntil,
    revokedAt:null,
  };
  const role=kind==='CLINICIAN'?'HOSPITAL_CREDENTIAL_OFFICER':
    'HOSPITAL_INTEGRATION_OFFICER';
  const prefix=kind==='CLINICIAN'?'FHIR_CREDENTIAL_':'FHIR_SITE_AUTHORITY_';
  const grant=(actorId:string,permission:string):Row=>({
    tenantId,actorId,facilityIds:[facilityId],
    roles:[role],permissions:[permission],
    status:'ACTIVE',identityAssurance:'HOSPITAL_VERIFIED',
    mfaStatus:'VERIFIED',validFrom,validUntil,revokedAt:null,
  });
  const proposerGrant=grant(proposerId,prefix+'PROPOSE');
  const approverGrant=grant(approverId,prefix+'ACTIVATE');
  const proof=syntheticSignedAuthorityRows({
    tenantId,facilityId,kind,recordId:evidenceId,record:evidence,now,
  });
  const proposerProof=syntheticSignedAuthorityRows({
    tenantId,facilityId,kind:'GOVERNANCE_GRANT',
    recordId:proposerId,record:proposerGrant,now,
  });
  const approverProof=syntheticSignedAuthorityRows({
    tenantId,facilityId,kind:'GOVERNANCE_GRANT',
    recordId:approverId,record:approverGrant,now,
  });
  return {
    head,eventId,event,proposalEventId,proposalEvent,
    proposalId,proposal,evidenceId,evidence:proof.record,
    proposerId,proposerGrant:proposerProof.record,
    approverId,approverGrant:approverProof.record,
    signedDocuments:[proof,proposerProof,approverProof],
  };
}
