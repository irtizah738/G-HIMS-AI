/**
 * CI-EXT-17: isolated, emulator-only issuance/revocation qualifications.
 * Internal to trusted server code. NO HTTP endpoints and NO clinical promotion.
 * The source/consent/evidence snapshot is verified by CI-EXT-03 in the SAME
 * Firestore transaction before issueExternalFactApproval is called.
 */
import {createHash} from 'node:crypto';
import type {Firestore,DocumentReference,Transaction} from 'firebase-admin/firestore';
import type {FhirImportActor} from './external-fhir-import';
import {externalReviewFactDigest} from './external-clinician-review-policy';
import {approvalEventHash,verifyApprovalEventHead} from './external-fact-approval-event-integrity';
import {externalFactApprovalHeadId,type CurrentFactReference,type CurrentSourceReference}
  from './external-current-authorization-preflight';

const ID=/^[A-Za-z0-9._-]{1,128}$/;
const HEX=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Row=Record<string,unknown>;
const TEN_MIN=10*60_000;
export type ApprovalEventType='EXTERNAL_FACT_APPROVAL_ISSUED'|'EXTERNAL_FACT_APPROVAL_REVOKED';
export type ApprovalStatus='APPROVED'|'REVOKED';
export type FactApprovalIssue=Readonly<{
  reviewId:string;evidenceReceiptId:string;sourceVersionId:string;
  resourceHash:string;idempotencyKey:string;
}>;
export type FactApprovalRevoke=Readonly<{
  reviewId:string;evidenceReceiptId:string;idempotencyKey:string;
  expectedRevision:number;
  reasonCode:'SAFETY_CONCERN'|'SOURCE_CORRECTION'|'CREDENTIAL_REVOKED'|'HOSPITAL_POLICY'|'OTHER';
}>;
export type ApprovalResult=Readonly<{
  headId:string;eventId:string;revision:number;status:ApprovalStatus;
  replay:boolean;clinicalUseAuthorized:false;aiDraftingEligible:false;
}>;
export type ApprovalEventPayload=Readonly<{
  schemaVersion:1;
  tenantId:string;patientId:string;reviewId:string;headId:string;
  evidenceReceiptId:string;sourceVersionId:string;resourceHash:string;
  sourceId:string;facilityId:string;factualDigest:string;authorityFenceHash:string;
  status:ApprovalStatus;eventType:ApprovalEventType;revision:number;
  approvedByActorId:string;reviewerActorId:string;
  reviewerCredentialRevision:number;approverCredentialRevision:number;
  siteAuthorityRevision:number;
  validFrom:number;validUntil:number;revokedAt:number|null;
  actorId:string;recordedAt:number;
  reasonCode:string|null;
  previousEventId:string|null;previousEventHash:string|null;
}>;
export type StoredApprovalEvent=Readonly<{
  eventId:string;eventHash:string;immutable:true;
  payload:ApprovalEventPayload;clinicalUseAuthorized:false;aiDraftingEligible:false;
}>;
function fail(code:string):never{throw new Error('CI_EXT17_'+code);}
function validId(v:unknown):v is string{
  return typeof v==='string'&&ID.test(v)&&v!=='.'&&v!=='..';
}
function exact(v:unknown,keys:readonly string[]):v is Row{
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const actual=Object.keys(v).sort(),expected=[...keys].sort();
  return actual.length===expected.length&&actual.every((k,i)=>k===expected[i]);
}
function canonical(value:unknown):string{
  if(value===null||typeof value!=='object')return JSON.stringify(value)??'null';
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const row=value as Row;
  return '{'+Object.keys(row).sort().map(k=>JSON.stringify(k)+':'+canonical(row[k])).join(',')+'}';
}
function digest(value:unknown):string{
  return createHash('sha256').update(canonical(value),'utf8').digest('hex');
}
function realTimestamp(n:unknown):n is number{
  return typeof n==='number'&&Number.isSafeInteger(n)&&n>0;
}
function currentCredential(row:Row|undefined,tenantId:string,actorId:string,
  facilityId:string,now:number):row is Row{
  return !!row&&row.tenantId===tenantId&&row.actorId===actorId&&
    row.status==='VERIFIED'&&row.identityAssurance==='HOSPITAL_VERIFIED'&&
    row.licenseVerified===true&&realTimestamp(row.revision)&&
    Array.isArray(row.facilityIds)&&row.facilityIds.includes(facilityId)&&
    realTimestamp(row.validFrom)&&realTimestamp(row.validUntil)&&
    row.validFrom<=now&&now<row.validUntil&&
    (row.revokedAt===null||row.revokedAt===undefined);
}
function currentSite(row:Row|undefined,tenantId:string,
  source:CurrentSourceReference,now:number):row is Row{
  return !!row&&row.tenantId===tenantId&&row.sourceId===source.sourceId&&
    row.facilityId===source.facilityId&&validId(source.siteApprovalId)&&
    row.siteApprovalId===source.siteApprovalId&&
    row.status==='APPROVED'&&row.clinicalUseReviewStatus==='APPROVED'&&
    realTimestamp(row.revision)&&realTimestamp(row.validFrom)&&
    realTimestamp(row.validUntil)&&row.validFrom<=now&&now<row.validUntil&&
    (row.revokedAt===null||row.revokedAt===undefined);
}
function actorScope(actor:FhirImportActor,tenantId:string,facilityId:string,
  permission:'FHIR_CLINICAL_FACT_APPROVE'|'FHIR_CLINICAL_FACT_REVOKE'):void{
  if(!validId(actor.actorId)||actor.tenantId!==tenantId||
    !Array.isArray(actor.facilityIds)||!actor.facilityIds.includes(facilityId))
    fail('ACTOR_SCOPE_DENIED');
  if(!actor.permissions.map(x=>x.toUpperCase()).includes(permission))
    fail('EXPLICIT_PERMISSION_REQUIRED');
  const roles=new Set(actor.roles.map(x=>x.toUpperCase()));
  if(permission==='FHIR_CLINICAL_FACT_APPROVE'&&
    !['DOCTOR','CONSULTANT','ATTENDING_PHYSICIAN'].some(x=>roles.has(x)))
    fail('CLINICIAN_ROLE_REQUIRED');
  if(permission==='FHIR_CLINICAL_FACT_REVOKE'&&
    !['CLINICAL_SAFETY_OFFICER','DOCTOR','CONSULTANT','ATTENDING_PHYSICIAN']
      .some(x=>roles.has(x)))
    fail('REVOKER_ROLE_REQUIRED');
}
function qualificationOnly():void{
  // A server's runtime-mode flag alone is not proof of isolation.
  if(process.env.GHIMS_RUNTIME_MODE!=='TEST'||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
     process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
     process.env.GHIMS_CI_EXTERNAL_FACT_APPROVAL_ENABLED!=='true')
    fail('EMULATOR_ONLY');
}
export function assertApprovalIssue(v:unknown):asserts v is FactApprovalIssue{
  if(!exact(v,['reviewId','evidenceReceiptId','sourceVersionId','resourceHash','idempotencyKey'])||
    !validId(v.reviewId)||!v.reviewId.startsWith('ecr_')||
    !validId(v.evidenceReceiptId)||!validId(v.sourceVersionId)||
    typeof v.resourceHash!=='string'||!HEX.test(v.resourceHash)||
    typeof v.idempotencyKey!=='string'||!UUID.test(v.idempotencyKey))
    fail('ISSUE_REQUEST_INVALID');
}
export function assertApprovalRevoke(v:unknown):asserts v is FactApprovalRevoke{
  if(!exact(v,['reviewId','evidenceReceiptId','idempotencyKey',
    'expectedRevision','reasonCode'])||
    !validId(v.reviewId)||!v.reviewId.startsWith('ecr_')||
    !validId(v.evidenceReceiptId)||
    typeof v.idempotencyKey!=='string'||!UUID.test(v.idempotencyKey)||
    !realTimestamp(v.expectedRevision)||
    !['SAFETY_CONCERN','SOURCE_CORRECTION','CREDENTIAL_REVOKED',
      'HOSPITAL_POLICY','OTHER'].includes(String(v.reasonCode)))
    fail('REVOKE_REQUEST_INVALID');
}
function commandId(tenantId:string,patientId:string,reviewId:string,
  receiptId:string,actorId:string,key:string):string{
  return 'efac_'+digest(['HELIXIS_FACT_APPROVAL_COMMAND_V1',
    tenantId,patientId,reviewId,receiptId,actorId,key.toLowerCase()]);
}
function eventId(command:string):string{return 'efae_'+command.slice(5);}
function baseHead(payload:ApprovalEventPayload,eventIdValue:string,
  eventHash:string):Row{
  return {
    ...payload,approvalEventId:eventIdValue,eventHash,immutableSourceEvent:true,
    evidenceOnly:true,clinicalUseAuthorized:false,aiDraftingEligible:false,
  };
}
function response(headId:string,id:string,revision:number,status:ApprovalStatus,
  replay:boolean):ApprovalResult{
  return {headId,eventId:id,revision,status,replay,
    clinicalUseAuthorized:false,aiDraftingEligible:false};
}
function commitEvent(tx:Transaction,tenant:DocumentReference,
  payload:ApprovalEventPayload,id:string,headRef:DocumentReference,
  isNew:boolean,commandRef:DocumentReference,requestHash:string,
  cmdId:string):void{
  const eventHash=approvalEventHash(payload);
  const event:StoredApprovalEvent={
    eventId:id,eventHash,immutable:true,payload,
    clinicalUseAuthorized:false,aiDraftingEligible:false,
  };
  tx.create(tenant.collection('externalClinicalFactApprovalEvents').doc(id),event);
  tx.create(tenant.collection('externalClinicalFactApprovalOutbox').doc(id),{
    ...event,status:'HELD',destination:'CI_EXTERNAL_APPROVAL_GOVERNANCE',
  });
  tx.create(tenant.collection('externalClinicalFactApprovalCommands').doc(cmdId),{
    commandId:cmdId,requestHash,eventId:id,eventHash,
    revision:payload.revision,status:payload.status,headId:payload.headId,
    immutable:true,clinicalUseAuthorized:false,
  });
  tx.create(tenant.collection('auditLogs').doc('efaa_'+id.slice(5)),{
    tenantId:payload.tenantId,patientId:payload.patientId,
    actorId:payload.actorId,action:payload.eventType,eventId:id,
    headId:payload.headId,revision:payload.revision,eventHash,
    recordedAt:payload.recordedAt,immutable:true,clinicalUseAuthorized:false,
  });
  if(isNew)tx.create(headRef,baseHead(payload,id,eventHash));
  else tx.update(headRef,baseHead(payload,id,eventHash));
  void commandRef;
}
/**
 * Must be invoked from CI-EXT-03 only after its complete evidence transaction
 * has verified source, consent, provenance, history and latest projection.
 */
export async function issueExternalFactApproval(args:Readonly<{
  tx:Transaction;tenant:DocumentReference;
  actor:FhirImportActor;tenantId:string;patientId:string;now:number;
  revision:number;contentHash:string;sourceCheckpoint:string;
  authorityFenceHash:string;
  facts:readonly CurrentFactReference[];
  sources:readonly CurrentSourceReference[];
  command:FactApprovalIssue;
}>):Promise<ApprovalResult>{
  qualificationOnly();
  const {tx,tenant,actor,tenantId,patientId,now,command,facts,sources}=args;
  assertApprovalIssue(command);
  if(!validId(tenantId)||!validId(patientId)||!realTimestamp(now)||
    !realTimestamp(args.revision)||!HEX.test(args.contentHash)||
    !HEX.test(args.sourceCheckpoint)||!HEX.test(args.authorityFenceHash)||
    facts.length<1||facts.length>64||sources.length<1||sources.length>64)
    fail('EVIDENCE_SCOPE_INVALID');
  const fact=facts.find(f=>f.evidenceReceiptId===command.evidenceReceiptId);
  if(!fact||fact.sourceVersionId!==command.sourceVersionId||
    fact.resourceHash!==command.resourceHash)
    fail('FACT_VERSION_STALE');
  const source=sources.find(s=>s.sourceId===fact.sourceId);
  if(!source)fail('SOURCE_SCOPE_INVALID');
  actorScope(actor,tenantId,source.facilityId,'FHIR_CLINICAL_FACT_APPROVE');
  const headId=externalFactApprovalHeadId(command.reviewId,command.evidenceReceiptId);
  const cmdId=commandId(tenantId,patientId,command.reviewId,
    command.evidenceReceiptId,actor.actorId,command.idempotencyKey);
  const ref=tenant.collection('externalClinicalFactApprovalHeads').doc(headId);
  const cmdRef=tenant.collection('externalClinicalFactApprovalCommands').doc(cmdId);
  const requestHash=digest(['HELIXIS_FACT_APPROVAL_ISSUE_REQUEST_V1',
    tenantId,patientId,actor.actorId,
    {...command,idempotencyKey:command.idempotencyKey.toLowerCase()}]);
  const [cmd,head,reviewSnap,approverSnap,siteSnap]=await tx.getAll(
    cmdRef,ref,tenant.collection('externalClinicianEvidenceReviews').doc(command.reviewId),
    tenant.collection('externalClinicalCredentialHeads').doc(actor.actorId),
    tenant.collection('externalClinicalSiteAuthorityHeads').doc(source.sourceId));
  if(cmd.exists){
    if(cmd.get('requestHash')!==requestHash||
      cmd.get('headId')!==headId||cmd.get('status')!=='APPROVED')
      fail('IDEMPOTENCY_CONFLICT');
    // Never report an old approval as current after safety revocation.
    if(!head.exists||head.get('status')!=='APPROVED'||
      head.get('approvalEventId')!==cmd.get('eventId'))
      fail('APPROVAL_SUPERSEDED');
    return response(headId,cmd.get('eventId'),cmd.get('revision'),'APPROVED',true);
  }
  if(head.exists)fail('ALREADY_ISSUED_REQUIRES_NEW_REVIEW');
  if(!reviewSnap.exists)fail('REVIEW_MISSING');
  const review=reviewSnap.data() as Row;
  const digestFacts=externalReviewFactDigest(facts.map(f=>({
    evidenceReceiptId:f.evidenceReceiptId,
    sourceVersionId:f.sourceVersionId,resourceHash:f.resourceHash,
  })));
  if(review.tenantId!==tenantId||review.patientId!==patientId||
    !validId(review.actorId)||review.actorId===actor.actorId||
    review.disposition!=='SOURCE_EVIDENCE_REVIEWED'||
    review.immutable!==true||review.evidenceOnly!==true||
    review.clinicalUseAuthorized!==false||review.aiDraftingEligible!==false||
    review.projectionRevision!==args.revision||
    review.projectionContentHash!==args.contentHash||
    review.sourceCheckpoint!==args.sourceCheckpoint||
    review.factualDigest!==digestFacts||
    review.authorityFenceHash!==args.authorityFenceHash||
    !Array.isArray(review.factRefs)||
    review.factRefs.length!==facts.length||
    !Array.isArray(review.sourceRefs)||review.sourceRefs.length!==sources.length)
    fail('REVIEW_STALE_OR_NOT_INDEPENDENT');
  const canonicalFacts=facts.map(f=>[f.evidenceReceiptId,f.sourceVersionId,f.resourceHash].join('|')).sort();
  const reviewFacts=(review.factRefs as Row[]).map(f=>
    [f.evidenceReceiptId,f.sourceVersionId,f.resourceHash].join('|')).sort();
  const canonicalSources=sources.map(s=>s.sourceId+'|'+s.facilityId).sort();
  const reviewSources=(review.sourceRefs as Row[]).map(s=>
    [s.sourceId,s.facilityId].join('|')).sort();
  if(JSON.stringify(canonicalFacts)!==JSON.stringify(reviewFacts)||
    JSON.stringify(canonicalSources)!==JSON.stringify(reviewSources))
    fail('REVIEW_LINEAGE_MISMATCH');
  const reviewerId=review.actorId as string;
  const reviewerSnap=await tx.get(
    tenant.collection('externalClinicalCredentialHeads').doc(reviewerId));
  const reviewer=reviewerSnap.exists?reviewerSnap.data() as Row:undefined;
  const approver=approverSnap.exists?approverSnap.data() as Row:undefined;
  const site=siteSnap.exists?siteSnap.data() as Row:undefined;
  if(!currentCredential(reviewer,tenantId,reviewerId,source.facilityId,now)||
    !currentCredential(approver,tenantId,actor.actorId,source.facilityId,now))
    fail('CLINICIAN_CREDENTIAL_NOT_CURRENT');
  if(!currentSite(site,tenantId,source,now))fail('SITE_POLICY_NOT_CURRENT');
  const validUntil=Math.min(
    reviewer.validUntil as number,approver.validUntil as number,
    site.validUntil as number,now+TEN_MIN);
  if(validUntil<=now)fail('APPROVAL_EXPIRY_INVALID');
  const payload:ApprovalEventPayload={
    schemaVersion:1,tenantId,patientId,reviewId:command.reviewId,headId,
    evidenceReceiptId:command.evidenceReceiptId,
    sourceVersionId:fact.sourceVersionId,resourceHash:fact.resourceHash,
    sourceId:fact.sourceId,facilityId:source.facilityId,
    factualDigest:digestFacts,authorityFenceHash:args.authorityFenceHash,
    status:'APPROVED',eventType:'EXTERNAL_FACT_APPROVAL_ISSUED',revision:1,
    approvedByActorId:actor.actorId,reviewerActorId:reviewerId,
    reviewerCredentialRevision:reviewer.revision as number,
    approverCredentialRevision:approver.revision as number,
    siteAuthorityRevision:site.revision as number,
    validFrom:now,validUntil,revokedAt:null,
    actorId:actor.actorId,recordedAt:now,reasonCode:null,
    previousEventId:null,previousEventHash:null,
  };
  const id=eventId(cmdId);
  commitEvent(tx,tenant,payload,id,ref,true,cmdRef,requestHash,cmdId);
  return response(headId,id,1,'APPROVED',false);
}
/**
 * Emergency revocation must succeed even after hospital consent/source
 * withdrawal, expired clinician credentials, or a changed FHIR version.
 * Uses the trusted tenant/facility safety-officer scope, not an evidence read.
 */
export async function revokeExternalFactApproval(args:Readonly<{
  db:Firestore;actor:FhirImportActor;tenantId:string;patientId:string;
  command:FactApprovalRevoke;now?:()=>number;
}>):Promise<ApprovalResult>{
  qualificationOnly();
  const {db,actor,tenantId,patientId,command}=args;
  assertApprovalRevoke(command);
  if(!validId(tenantId)||!validId(patientId)||actor.tenantId!==tenantId)
    fail('TENANT_SCOPE_INVALID');
  const now=(args.now||Date.now)();
  if(!realTimestamp(now))fail('TIME_INVALID');
  const tenant=db.collection('tenants').doc(tenantId);
  const headId=externalFactApprovalHeadId(command.reviewId,command.evidenceReceiptId);
  const headRef=tenant.collection('externalClinicalFactApprovalHeads').doc(headId);
  const cmdId=commandId(tenantId,patientId,command.reviewId,
    command.evidenceReceiptId,actor.actorId,command.idempotencyKey);
  const commandRef=tenant.collection('externalClinicalFactApprovalCommands').doc(cmdId);
  const requestHash=digest(['HELIXIS_FACT_APPROVAL_REVOKE_REQUEST_V1',
    tenantId,patientId,actor.actorId,
    {...command,idempotencyKey:command.idempotencyKey.toLowerCase()}]);
  return db.runTransaction(async tx=>{
    const [priorCommand,headSnap]=await tx.getAll(commandRef,headRef);
    if(!headSnap.exists)fail('APPROVAL_MISSING');
    const head=headSnap.data() as Row;
    if(head.tenantId!==tenantId||head.patientId!==patientId||
      head.reviewId!==command.reviewId||head.headId!==headId||
      !validId(head.facilityId))
      fail('APPROVAL_SCOPE_INVALID');
    // Re-authorization is required even for an idempotent replay.
    actorScope(actor,tenantId,head.facilityId as string,'FHIR_CLINICAL_FACT_REVOKE');
    if(priorCommand.exists){
      if(priorCommand.get('requestHash')!==requestHash||
        priorCommand.get('headId')!==headId||
        priorCommand.get('status')!=='REVOKED'||
        head.status!=='REVOKED'||
        head.approvalEventId!==priorCommand.get('eventId'))
        fail('IDEMPOTENCY_CONFLICT');
      return response(headId,priorCommand.get('eventId'),
        priorCommand.get('revision'),'REVOKED',true);
    }
    if(head.status!=='APPROVED'||
      head.revision!==command.expectedRevision||
      !validId(head.approvalEventId))
      fail('APPROVAL_NOT_CURRENT');
    const oldEventSnap=await tx.get(tenant.collection('externalClinicalFactApprovalEvents')
      .doc(head.approvalEventId as string));
    if(!oldEventSnap.exists||
      !verifyApprovalEventHead(head,oldEventSnap.data() as Row,head.approvalEventId as string))
      fail('EVENT_CHAIN_INVALID');
    const oldEvent=oldEventSnap.data() as StoredApprovalEvent;
    const payload:ApprovalEventPayload={
      ...oldEvent.payload,status:'REVOKED',eventType:'EXTERNAL_FACT_APPROVAL_REVOKED',
      revision:(head.revision as number)+1,
      revokedAt:now,actorId:actor.actorId,recordedAt:now,
      reasonCode:command.reasonCode,
      previousEventId:oldEvent.eventId,previousEventHash:oldEvent.eventHash,
    };
    const id=eventId(cmdId);
    commitEvent(tx,tenant,payload,id,headRef,false,commandRef,requestHash,cmdId);
    return response(headId,id,payload.revision,'REVOKED',false);
  });
}
