/**
 * CI-EXT-18: synthetic-only dual-person credential and HIS-site governance.
 * Immutable proposal -> independently attested activation -> safety revocation.
 * No HTTP route, no certificate/signature issuance, no clinical activation.
 */
import {createHash} from 'node:crypto';
import type {Firestore,DocumentReference,Transaction} from 'firebase-admin/firestore';
import type {FhirImportActor} from './external-fhir-import';

type Row=Record<string,unknown>;
export type AuthorityKind='CLINICIAN'|'SITE';
export type GovernanceAction='PROPOSED'|'ACTIVATED'|'REVOKED';
export type GovernanceStatus='PENDING'|'VERIFIED'|'APPROVED'|'REVOKED';
export type AuthorityProposalCommand=Readonly<{
  kind:AuthorityKind;targetId:string;facilityId:string;
  evidenceId:string;idempotencyKey:string;
}>;
export type AuthorityActivateCommand=Readonly<{
  proposalId:string;idempotencyKey:string;
}>;
export type AuthorityRevokeCommand=Readonly<{
  kind:AuthorityKind;targetId:string;expectedRevision:number;
  idempotencyKey:string;
  reasonCode:'LICENSE_WITHDRAWN'|'HOSPITAL_POLICY'|'SOURCE_COMPROMISED'|'SAFETY_CONCERN';
}>;
export type GovernanceResult=Readonly<{
  action:GovernanceAction;eventId:string;revision:number;replay:boolean;
  proposalId:string;status:GovernanceStatus;
  clinicalUseAuthorized:false;aiDraftingEligible:false;
}>;

export type GovernanceEventPayload=Readonly<{
  schemaVersion:1;tenantId:string;kind:AuthorityKind;
  targetId:string;facilityId:string;proposalId:string;
  proposedByActorId:string;authorizedByActorId:string|null;
  evidenceId:string;evidenceHash:string;verifiedByActorId:string;
  siteApprovalId:string|null;
  action:GovernanceAction;status:GovernanceStatus;revision:number;
  validFrom:number;validUntil:number;revokedAt:number|null;
  actorId:string;recordedAt:number;
  reasonCode:string|null;previousEventId:string|null;previousEventHash:string|null;
}>;
const ID=/^[A-Za-z0-9._-]{1,128}$/;
const HEX=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POLICY_TTL_MS=10*60_000;
const PROPOSAL_TTL_MS=5*60_000;
function deny(code:string):never{throw new Error('CI_EXT18_'+code);}
function id(v:unknown):v is string{return typeof v==='string'&&ID.test(v)&&v!=='.'&&v!=='..';}
function ts(v:unknown):v is number{return typeof v==='number'&&Number.isSafeInteger(v)&&v>0;}
function revision(v:unknown):v is number{return ts(v);}
function kind(v:unknown):v is AuthorityKind{return v==='CLINICIAN'||v==='SITE';}
function exact(v:unknown,fields:readonly string[]):v is Row{
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const keys=Object.keys(v).sort(),required=[...fields].sort();
  return keys.length===required.length&&keys.every((x,i)=>x===required[i]);
}
function canonical(v:unknown):string{
  if(v===null||typeof v!=='object')return JSON.stringify(v)??'null';
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  const record=v as Row;
  return '{'+Object.keys(record).sort().map(k=>JSON.stringify(k)+':'+canonical(record[k])).join(',')+'}';
}
function sha(v:unknown):string{return createHash('sha256').update(canonical(v)).digest('hex');}
export function governanceEventHash(payload:GovernanceEventPayload):string{
  return sha(['HELIXIS_CI_EXT18_GOVERNANCE_EVENT_V1',payload]);
}
function guard():void{
  if(process.env.GHIMS_RUNTIME_MODE!=='TEST'||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
     process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
     process.env.GHIMS_CI_EXTERNAL_AUTHORITY_GOVERNANCE_ENABLED!=='true')
    deny('EMULATOR_ONLY');
}
export function assertAuthorityProposal(v:unknown):asserts v is AuthorityProposalCommand{
  if(!exact(v,['kind','targetId','facilityId','evidenceId','idempotencyKey'])||
    !kind(v.kind)||!id(v.targetId)||!id(v.facilityId)||!id(v.evidenceId)||
    typeof v.idempotencyKey!=='string'||!UUID.test(v.idempotencyKey))
    deny('PROPOSAL_INVALID');
}
export function assertAuthorityActivate(v:unknown):asserts v is AuthorityActivateCommand{
  if(!exact(v,['proposalId','idempotencyKey'])||!id(v.proposalId)||
    !v.proposalId.startsWith('egp_')||
    typeof v.idempotencyKey!=='string'||!UUID.test(v.idempotencyKey))
    deny('ACTIVATE_INVALID');
}
export function assertAuthorityRevoke(v:unknown):asserts v is AuthorityRevokeCommand{
  if(!exact(v,['kind','targetId','expectedRevision','idempotencyKey','reasonCode'])||
    !kind(v.kind)||!id(v.targetId)||!revision(v.expectedRevision)||
    typeof v.idempotencyKey!=='string'||!UUID.test(v.idempotencyKey)||
    !['LICENSE_WITHDRAWN','HOSPITAL_POLICY','SOURCE_COMPROMISED','SAFETY_CONCERN']
      .includes(String(v.reasonCode)))deny('REVOKE_INVALID');
}
function commandId(tenantId:string,actorId:string,key:string):string{
  return 'egc_'+sha(['HELIXIS_CI_EXT18_COMMAND_V1',tenantId,actorId,key.toLowerCase()]);
}
function proposalId(tenantId:string,actorId:string,command:AuthorityProposalCommand):string{
  return 'egp_'+sha(['HELIXIS_CI_EXT18_PROPOSAL_V1',tenantId,actorId,
    command.kind,command.targetId,command.facilityId,command.evidenceId,
    command.idempotencyKey.toLowerCase()]);
}
function eventId(cmdId:string):string{return 'ege_'+cmdId.slice(4);}
function headRef(tenant:DocumentReference,kindValue:AuthorityKind,targetId:string):DocumentReference{
  return tenant.collection(kindValue==='CLINICIAN'?'externalClinicalCredentialHeads':
    'externalClinicalSiteAuthorityHeads').doc(targetId);
}
function permission(action:GovernanceAction,kindValue:AuthorityKind):string{
  if(action==='REVOKED')return 'FHIR_AUTHORITY_REVOKE';
  return 'FHIR_'+(kindValue==='CLINICIAN'?'CREDENTIAL':'SITE_AUTHORITY')+
    '_'+(action==='PROPOSED'?'PROPOSE':'ACTIVATE');
}
function requiredRole(action:GovernanceAction,kindValue:AuthorityKind):string{
  return action==='REVOKED'?'CLINICAL_SAFETY_OFFICER':
    kindValue==='CLINICIAN'?'HOSPITAL_CREDENTIAL_OFFICER':
    'HOSPITAL_INTEGRATION_OFFICER';
}
async function authorize(tx:Transaction,tenant:DocumentReference,
  actor:FhirImportActor,tenantId:string,facilityId:string,
  action:GovernanceAction,kindValue:AuthorityKind,now:number):Promise<void>{
  const perm=permission(action,kindValue),role=requiredRole(action,kindValue);
  if(actor.tenantId!==tenantId||!id(actor.actorId)||
    !Array.isArray(actor.facilityIds)||!actor.facilityIds.includes(facilityId)||
    !Array.isArray(actor.roles)||!actor.roles.includes(role)||
    !Array.isArray(actor.permissions)||!actor.permissions.includes(perm))
    deny('ACTOR_SCOPE_DENIED');
  const grantSnap=await tx.get(tenant.collection('externalClinicalGovernanceGrants')
    .doc(actor.actorId));
  const grant=grantSnap.exists?grantSnap.data() as Row:null;
  if(!grant||grant.tenantId!==tenantId||grant.actorId!==actor.actorId||
    grant.status!=='ACTIVE'||grant.identityAssurance!=='HOSPITAL_VERIFIED'||
    grant.mfaStatus!=='VERIFIED'||!Array.isArray(grant.facilityIds)||
    !grant.facilityIds.includes(facilityId)||
    !Array.isArray(grant.roles)||!grant.roles.includes(role)||
    !Array.isArray(grant.permissions)||!grant.permissions.includes(perm)||
    !ts(grant.validFrom)||!ts(grant.validUntil)||
    now<grant.validFrom||now>=grant.validUntil||
    (grant.revokedAt!==null&&grant.revokedAt!==undefined))
    deny('CURRENT_GOVERNANCE_GRANT_REQUIRED');
}
function evidenceValid(row:Row|undefined,tenantId:string,
  command:AuthorityProposalCommand,now:number):row is Row{
  return !!row&&row.schemaVersion===1&&row.tenantId===tenantId&&
    row.kind===command.kind&&row.targetId===command.targetId&&
    row.facilityId===command.facilityId&&row.evidenceId===command.evidenceId&&
    row.status==='VERIFIED'&&row.identityAssurance==='HOSPITAL_VERIFIED'&&
    typeof row.evidenceHash==='string'&&HEX.test(row.evidenceHash)&&
    id(row.verifiedByActorId)&&row.verifiedByActorId!==command.targetId&&
    ts(row.verifiedAt)&&row.verifiedAt<=now&&
    ts(row.validFrom)&&ts(row.validUntil)&&row.validFrom<=now&&now<row.validUntil&&
    (command.kind==='CLINICIAN'?
      row.licenseVerified===true&&row.siteApprovalId===null:
      id(row.siteApprovalId));
}
function result(p:GovernanceEventPayload,idValue:string,replay:boolean):GovernanceResult{
  return {action:p.action,eventId:idValue,revision:p.revision,replay,
    proposalId:p.proposalId,status:p.status,
    clinicalUseAuthorized:false,aiDraftingEligible:false};
}
function derivedHead(payload:GovernanceEventPayload,eventIdValue:string,
  eventHash:string):Row{
  const base={
    ...payload,governanceEventId:eventIdValue,governanceEventHash:eventHash,
    immutableSourceEvent:true,evidenceOnly:true,
    clinicalUseAuthorized:false,aiDraftingEligible:false,
  };
  return payload.kind==='CLINICIAN'?{
    ...base,actorId:payload.targetId,facilityIds:[payload.facilityId],
    status:payload.status,identityAssurance:'HOSPITAL_VERIFIED',licenseVerified:true,
  }:{
    ...base,sourceId:payload.targetId,
    clinicalUseReviewStatus:payload.status,
  };
}
export function verifyGovernanceHead(head:Row,event:Row,eventIdValue:string):boolean{
  if(!id(eventIdValue)||event.eventId!==eventIdValue||
    event.immutable!==true||event.clinicalUseAuthorized!==false||
    event.aiDraftingEligible!==false||
    !event.payload||typeof event.payload!=='object'||Array.isArray(event.payload))
    return false;
  const payload=event.payload as GovernanceEventPayload;
  if(!kind(payload.kind)||payload.schemaVersion!==1||
    !['ACTIVATED','REVOKED'].includes(payload.action)||
    !['VERIFIED','APPROVED','REVOKED'].includes(payload.status)||
    !ts(payload.revision)||!id(payload.targetId)||!id(payload.facilityId)||
    !id(payload.proposalId)||!id(payload.actorId)||
    !ts(payload.validFrom)||!ts(payload.validUntil)||
    typeof event.eventHash!=='string'||!HEX.test(event.eventHash)||
    governanceEventHash(payload)!==event.eventHash)
    return false;
  const expected=derivedHead(payload,eventIdValue,event.eventHash as string);
  return Object.keys(expected).every(key=>canonical(head[key])===canonical(expected[key]));
}
function commit(tx:Transaction,tenant:DocumentReference,
  payload:GovernanceEventPayload,cmdId:string,requestHash:string,
  proposal?:Row,createHead=false):void{
  const eid=eventId(cmdId),hash=governanceEventHash(payload);
  const event={
    eventId:eid,eventHash:hash,payload,immutable:true,
    clinicalUseAuthorized:false,aiDraftingEligible:false,
  };
  tx.create(tenant.collection('externalClinicalAuthorityEvents').doc(eid),event);
  tx.create(tenant.collection('externalClinicalAuthorityOutbox').doc(eid),{
    ...event,status:'HELD',destination:'CI_EXTERNAL_AUTHORITY_GOVERNANCE',
  });
  tx.create(tenant.collection('externalClinicalAuthorityCommands').doc(cmdId),{
    commandId:cmdId,requestHash,eventId:eid,
    proposalId:payload.proposalId,action:payload.action,
    revision:payload.revision,status:payload.status,immutable:true,
  });
  if(proposal){
    tx.create(tenant.collection('externalClinicalAuthorityProposals')
      .doc(payload.proposalId),proposal);
  }
  if(payload.action!=='PROPOSED'){
    const ref=headRef(tenant,payload.kind,payload.targetId);
    if(createHead)tx.create(ref,derivedHead(payload,eid,hash));
    else tx.update(ref,derivedHead(payload,eid,hash));
  }
  tx.create(tenant.collection('auditLogs').doc('egaa_'+eid.slice(4)),{
    tenantId:payload.tenantId,actorId:payload.actorId,
    targetId:payload.targetId,facilityId:payload.facilityId,
    action:payload.action,kind:payload.kind,
    eventId:eid,eventHash:hash,recordedAt:payload.recordedAt,
    immutable:true,clinicalUseAuthorized:false,
  });
}
/** A proposal records already inspected synthetic evidence, never self-verifies it. */
export async function proposeExternalClinicalAuthority(args:Readonly<{
  db:Firestore;tenantId:string;actor:FhirImportActor;
  command:AuthorityProposalCommand;now?:()=>number;
}>):Promise<GovernanceResult>{
  guard();assertAuthorityProposal(args.command);
  const {db,tenantId,actor,command}=args;
  if(!id(tenantId))deny('TENANT_INVALID');
  const now=(args.now||Date.now)();if(!ts(now))deny('TIME_INVALID');
  const tenant=db.collection('tenants').doc(tenantId);
  const pid=proposalId(tenantId,actor.actorId,command);
  const cid=commandId(tenantId,actor.actorId,command.idempotencyKey);
  const hash=sha(['CI_EXT18_PROPOSAL_COMMAND_V1',tenantId,actor.actorId,
    {...command,idempotencyKey:command.idempotencyKey.toLowerCase()}]);
  return db.runTransaction(async tx=>{
    await authorize(tx,tenant,actor,tenantId,command.facilityId,
      'PROPOSED',command.kind,now);
    const [existing,evidenceSnap,existingHead]=await tx.getAll(
      tenant.collection('externalClinicalAuthorityCommands').doc(cid),
      tenant.collection('externalClinicalAuthorityEvidence').doc(command.evidenceId),
      headRef(tenant,command.kind,command.targetId));
    if(existing.exists){
      if(existing.get('requestHash')!==hash||existing.get('action')!=='PROPOSED'||
        existing.get('proposalId')!==pid)deny('IDEMPOTENCY_CONFLICT');
      const snap=await tx.get(
        tenant.collection('externalClinicalAuthorityEvents').doc(existing.get('eventId')));
      if(!snap.exists)deny('EVENT_MISSING');
      return result(snap.get('payload') as GovernanceEventPayload,
        existing.get('eventId') as string,true);
    }
    if(existingHead.exists)deny('AUTHORITY_ALREADY_REGISTERED');
    const evidence=evidenceSnap.exists?evidenceSnap.data() as Row:undefined;
    if(!evidenceValid(evidence,tenantId,command,now)||
      evidence!.verifiedByActorId===actor.actorId)
      deny('INDEPENDENT_EVIDENCE_REQUIRED');
    const expiresAt=Math.min(now+PROPOSAL_TTL_MS,evidence!.validUntil as number);
    const payload:GovernanceEventPayload={
      schemaVersion:1,tenantId,kind:command.kind,targetId:command.targetId,
      facilityId:command.facilityId,proposalId:pid,
      proposedByActorId:actor.actorId,authorizedByActorId:null,
      evidenceId:command.evidenceId,evidenceHash:evidence!.evidenceHash as string,
      verifiedByActorId:evidence!.verifiedByActorId as string,
      siteApprovalId:evidence!.siteApprovalId as string|null,
      action:'PROPOSED',status:'PENDING',revision:0,
      validFrom:evidence!.validFrom as number,
      validUntil:expiresAt,revokedAt:null,actorId:actor.actorId,
      recordedAt:now,reasonCode:null,previousEventId:null,previousEventHash:null,
    };
    const proposal={
      ...payload,proposalEventId:eventId(cid),evidenceExpiry:evidence!.validUntil,
      immutable:true,clinicalUseAuthorized:false,aiDraftingEligible:false,
    };
    commit(tx,tenant,payload,cid,hash,proposal);
    return result(payload,eventId(cid),false);
  });
}
/** Two-person activation, current evidence and institution-scoped grants. */
export async function activateExternalClinicalAuthority(args:Readonly<{
  db:Firestore;tenantId:string;actor:FhirImportActor;
  command:AuthorityActivateCommand;now?:()=>number;
}>):Promise<GovernanceResult>{
  guard();assertAuthorityActivate(args.command);
  const {db,tenantId,actor,command}=args;
  if(!id(tenantId))deny('TENANT_INVALID');
  const now=(args.now||Date.now)();if(!ts(now))deny('TIME_INVALID');
  const tenant=db.collection('tenants').doc(tenantId);
  const cid=commandId(tenantId,actor.actorId,command.idempotencyKey);
  const hash=sha(['CI_EXT18_ACTIVATE_COMMAND_V1',tenantId,actor.actorId,
    {...command,idempotencyKey:command.idempotencyKey.toLowerCase()}]);
  return db.runTransaction(async tx=>{
    const proposalSnap=await tx.get(
      tenant.collection('externalClinicalAuthorityProposals').doc(command.proposalId));
    if(!proposalSnap.exists)deny('PROPOSAL_MISSING');
    const p=proposalSnap.data() as Row;
    if(p.tenantId!==tenantId||!kind(p.kind)||!id(p.targetId)||
      !id(p.facilityId)||!id(p.evidenceId)||!id(p.proposedByActorId)||
      p.proposalId!==command.proposalId||p.status!=='PENDING'||
      !ts(p.validUntil)||now>=p.validUntil)
      deny('PROPOSAL_EXPIRED_OR_INVALID');
    await authorize(tx,tenant,actor,tenantId,p.facilityId as string,
      'ACTIVATED',p.kind,now);
    if(actor.actorId===p.proposedByActorId||
      actor.actorId===p.verifiedByActorId||
      (p.kind==='CLINICIAN'&&actor.actorId===p.targetId))
      deny('INDEPENDENT_APPROVER_REQUIRED');
    const [cmdSnap,evidenceSnap,headSnap,proposerGrantSnap,proposeEventSnap]=await tx.getAll(
      tenant.collection('externalClinicalAuthorityCommands').doc(cid),
      tenant.collection('externalClinicalAuthorityEvidence').doc(p.evidenceId as string),
      headRef(tenant,p.kind,p.targetId as string),
      tenant.collection('externalClinicalGovernanceGrants').doc(p.proposedByActorId as string),
      tenant.collection('externalClinicalAuthorityEvents').doc(p.proposalEventId as string));
    if(cmdSnap.exists){
      if(cmdSnap.get('requestHash')!==hash||
        cmdSnap.get('action')!=='ACTIVATED')deny('IDEMPOTENCY_CONFLICT');
      if(!headSnap.exists||headSnap.get('governanceEventId')!==cmdSnap.get('eventId'))
        deny('ACTIVATION_SUPERSEDED');
      const eventSnap=await tx.get(
        tenant.collection('externalClinicalAuthorityEvents').doc(cmdSnap.get('eventId')));
      if(!eventSnap.exists||!verifyGovernanceHead(headSnap.data() as Row,
        eventSnap.data() as Row,cmdSnap.get('eventId')))deny('EVENT_CHAIN_INVALID');
      return result(eventSnap.get('payload') as GovernanceEventPayload,
        cmdSnap.get('eventId') as string,true);
    }
    if(headSnap.exists)deny('AUTHORITY_ALREADY_REGISTERED');
    const evidence=evidenceSnap.exists?evidenceSnap.data() as Row:undefined;
    const evidenceCmd={
      kind:p.kind,targetId:p.targetId as string,facilityId:p.facilityId as string,
      evidenceId:p.evidenceId as string,idempotencyKey:command.idempotencyKey,
    };
    if(!evidenceValid(evidence,tenantId,evidenceCmd,now)||
      evidence!.evidenceHash!==p.evidenceHash||
      evidence!.verifiedByActorId!==p.verifiedByActorId)
      deny('EVIDENCE_REVISED_OR_EXPIRED');
    const proposalEvent=proposeEventSnap.exists?proposeEventSnap.data() as Row:undefined;
    if(!proposalEvent||proposalEvent.immutable!==true||
      proposalEvent.eventId!==p.proposalEventId||
      governanceEventHash(proposalEvent.payload as GovernanceEventPayload)!==
        proposalEvent.eventHash)
      deny('PROPOSAL_EVENT_INVALID');
    const proposerGrant=proposerGrantSnap.exists?proposerGrantSnap.data() as Row:undefined;
    const proposerPerm=permission('PROPOSED',p.kind),proposerRole=requiredRole('PROPOSED',p.kind);
    if(!proposerGrant||proposerGrant.tenantId!==tenantId||
      proposerGrant.status!=='ACTIVE'||
      !Array.isArray(proposerGrant.roles)||!proposerGrant.roles.includes(proposerRole)||
      !Array.isArray(proposerGrant.permissions)||
      !proposerGrant.permissions.includes(proposerPerm)||
      !Array.isArray(proposerGrant.facilityIds)||
      !proposerGrant.facilityIds.includes(p.facilityId)||
      proposerGrant.identityAssurance!=='HOSPITAL_VERIFIED'||
      proposerGrant.mfaStatus!=='VERIFIED'||
      !ts(proposerGrant.validFrom)||!ts(proposerGrant.validUntil)||
      now<proposerGrant.validFrom||now>=proposerGrant.validUntil||
      (proposerGrant.revokedAt!==null&&proposerGrant.revokedAt!==undefined))
      deny('PROPOSER_AUTHORITY_WITHDRAWN');
    if(p.kind==='SITE'){
      const source=await tx.get(tenant.collection('fhirSources').doc(p.targetId as string));
      if(!source.exists||source.get('tenantId')!==tenantId||
        source.get('facilityId')!==p.facilityId||
        source.get('status')!=='ACTIVE'||
        source.get('securityReviewStatus')!=='APPROVED'||
        source.get('siteApprovalId')!==p.siteApprovalId)
        deny('FHIR_SITE_SOURCE_NOT_CURRENT');
    }
    const validUntil=Math.min(now+POLICY_TTL_MS,
      evidence!.validUntil as number,proposerGrant.validUntil as number);
    if(validUntil<=now)deny('AUTHORITY_EXPIRY_INVALID');
    const action='ACTIVATED' as const;
    const payload:GovernanceEventPayload={
      schemaVersion:1,tenantId,kind:p.kind,targetId:p.targetId as string,
      facilityId:p.facilityId as string,proposalId:command.proposalId,
      proposedByActorId:p.proposedByActorId as string,
      authorizedByActorId:actor.actorId,evidenceId:p.evidenceId as string,
      evidenceHash:p.evidenceHash as string,
      verifiedByActorId:p.verifiedByActorId as string,
      siteApprovalId:p.siteApprovalId as string|null,
      action,status:p.kind==='CLINICIAN'?'VERIFIED':'APPROVED',revision:1,
      validFrom:now,validUntil,revokedAt:null,
      actorId:actor.actorId,recordedAt:now,reasonCode:null,
      previousEventId:p.proposalEventId as string,
      previousEventHash:proposalEvent.eventHash as string,
    };
    commit(tx,tenant,payload,cid,hash,undefined,true);
    return result(payload,eventId(cid),false);
  });
}
/** Emergency revocation is deliberately independent of original evidence or HIS availability. */
export async function revokeExternalClinicalAuthority(args:Readonly<{
  db:Firestore;tenantId:string;actor:FhirImportActor;
  command:AuthorityRevokeCommand;now?:()=>number;
}>):Promise<GovernanceResult>{
  guard();assertAuthorityRevoke(args.command);
  const {db,tenantId,actor,command}=args;
  if(!id(tenantId))deny('TENANT_INVALID');
  const now=(args.now||Date.now)();if(!ts(now))deny('TIME_INVALID');
  const tenant=db.collection('tenants').doc(tenantId);
  const cid=commandId(tenantId,actor.actorId,command.idempotencyKey);
  const hash=sha(['CI_EXT18_REVOKE_COMMAND_V1',tenantId,actor.actorId,
    {...command,idempotencyKey:command.idempotencyKey.toLowerCase()}]);
  return db.runTransaction(async tx=>{
    const hRef=headRef(tenant,command.kind,command.targetId);
    const headSnap=await tx.get(hRef);
    if(!headSnap.exists)deny('HEAD_MISSING');
    const head=headSnap.data() as Row;
    if(head.tenantId!==tenantId||head.kind!==command.kind||
      head.targetId!==command.targetId||!id(head.facilityId)||
      !id(head.governanceEventId))
      deny('HEAD_SCOPE_INVALID');
    await authorize(tx,tenant,actor,tenantId,head.facilityId as string,
      'REVOKED',command.kind,now);
    const [cmdSnap,oldEventSnap]=await tx.getAll(
      tenant.collection('externalClinicalAuthorityCommands').doc(cid),
      tenant.collection('externalClinicalAuthorityEvents')
        .doc(head.governanceEventId as string));
    if(!oldEventSnap.exists||
      !verifyGovernanceHead(head,oldEventSnap.data() as Row,
        head.governanceEventId as string))
      deny('HEAD_EVENT_INTEGRITY_FAILURE');
    if(cmdSnap.exists){
      if(cmdSnap.get('requestHash')!==hash||
        cmdSnap.get('action')!=='REVOKED'||
        head.governanceEventId!==cmdSnap.get('eventId'))
        deny('IDEMPOTENCY_CONFLICT');
      return result(oldEventSnap.get('payload') as GovernanceEventPayload,
        cmdSnap.get('eventId') as string,true);
    }
    if(head.status==='REVOKED')deny('ALREADY_REVOKED');
    if(head.revision!==command.expectedRevision||
      !['VERIFIED','APPROVED'].includes(String(head.status)))
      deny('REVISION_CONFLICT');
    const previousEvent=oldEventSnap.data() as Row;
    const prev=previousEvent.payload as GovernanceEventPayload;
    const payload:GovernanceEventPayload={
      ...prev,action:'REVOKED',status:'REVOKED',
      revision:(head.revision as number)+1,
      actorId:actor.actorId,recordedAt:now,reasonCode:command.reasonCode,
      revokedAt:now,previousEventId:head.governanceEventId as string,
      previousEventHash:previousEvent.eventHash as string,
    };
    commit(tx,tenant,payload,cid,hash);
    return result(payload,eventId(cid),false);
  });
}
