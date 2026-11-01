/**
 * CI-EXT-05 — Governed hospital FHIR site onboarding.
 *
 * A successful protocol check is not a production authorization. A separate
 * trusted, synthetic round-trip qualification is required, followed by two
 * distinct authenticated clinical/security reviewers and a third activator.
 * Every step is an idempotent Firestore transaction with immutable decisions.
 *
 * This module cannot generate qualification evidence or activate environment
 * flags; it only records a reviewable hospital-specific site approval.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { FhirImportActor, FhirSourceRecord } from '@/lib/clinical/intelligence/external-fhir-import';
import { validateFhirSiteApproval, type FhirSiteApproval } from './fhir-site-approval';

type ReviewKind = 'CLINICAL' | 'SECURITY';
type ApprovalScope = 'Patient' | 'Encounter' | 'Observation';
type RequestState = 'PENDING' | 'APPROVED';

export type SiteProtocolReceipt = {
  qualificationId: string; tenantId: string; sourceId: string; facilityId: string;
  credentialRevision: number; checkedAt: number;
  protocolOutcome: 'PROTOCOL_PASSED_SITE_PENDING' | 'FAILED';
  smartDiscoveryVerified: boolean; fhirR4CapabilityVerified: boolean;
  capabilities: { Patient: boolean; Encounter: boolean; Observation: boolean };
  qualifiedForPatientData: false; qualifiedForProduction: false;
};

export type SiteSyntheticEvidence = {
  evidenceId: string; tenantId: string; sourceId: string; facilityId: string;
  credentialRevision: number; protocolQualificationId: string;
  outcome: 'PASS' | 'FAIL'; syntheticOnly: boolean;
  identityMatchQualified: boolean; replayQualified: boolean;
  consentWithdrawalQualified: boolean; isolationQualified: boolean;
  networkRecoveryQualified: boolean; reviewerId: string;
  checkedAt: number; expiresAt: number;
};

type ReviewerDecision = { actorId: string; decisionId: string };
export type FhirSiteReviewRequest = {
  requestId: string; tenantId: string; sourceId: string; facilityId: string;
  credentialRevision: number; sourceConfigHash: string;
  protocolQualificationId: string; syntheticEvidenceId: string;
  approvedResourceTypes: ApprovalScope[];
  status: RequestState; requestedBy: string; requestedAt: number;
  expiresAt: number;
  clinical?: ReviewerDecision; security?: ReviewerDecision;
  siteApprovalId?: string;
};

const ID=/^[A-Za-z0-9._-]{1,128}$/;
const RESOURCE_TYPES: ApprovalScope[]=['Patient','Encounter','Observation'];
const MS_DAY=86_400_000;
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const safe=(v:string)=>ID.test(v)&&v!=='.'&&v!=='..';
const docId=(prefix:string,values:unknown[])=>prefix+'_'+sha(values).slice(0,36);

function checkActor(actor:FhirImportActor, tenantId:string, permission:string):void {
  if (!safe(tenantId)||!safe(actor.actorId)||actor.tenantId!==tenantId ||
      !actor.permissions.map(p=>p.toUpperCase()).includes(permission)) {
    throw new Error('CI_EXT05_PERMISSION_OR_TENANT_DENIED');
  }
}
function checkSource(source:FhirSourceRecord|null,actor:FhirImportActor,sourceId:string):asserts source is FhirSourceRecord {
  if (!source||source.tenantId!==actor.tenantId||source.sourceId!==sourceId||
      source.status!=='ACTIVE'||source.securityReviewStatus!=='APPROVED'||
      !actor.facilityIds.includes(source.facilityId)||
      !source.oauth||!Number.isSafeInteger(source.oauth.credentialRevision)||
      source.oauth.credentialRevision<1) {
    throw new Error('CI_EXT05_SOURCE_OR_FACILITY_DENIED');
  }
}
function sourceFingerprint(s:FhirSourceRecord):string {
  return sha([s.tenantId,s.sourceId,s.facilityId,s.baseUrl,s.status,
    s.securityReviewStatus,[...s.approvedResourceTypes].sort(),s.oauth]);
}
function checkEvidence(
  source:FhirSourceRecord, protocol:SiteProtocolReceipt|null,
  synthetic:SiteSyntheticEvidence|null, now:number
):void {
  const revision=source.oauth!.credentialRevision;
  if (!protocol||protocol.tenantId!==source.tenantId||
      protocol.sourceId!==source.sourceId||protocol.facilityId!==source.facilityId||
      protocol.credentialRevision!==revision||protocol.protocolOutcome!=='PROTOCOL_PASSED_SITE_PENDING'||
      !protocol.smartDiscoveryVerified||!protocol.fhirR4CapabilityVerified||
      !protocol.capabilities?.Patient||!protocol.capabilities?.Encounter||
      !protocol.capabilities?.Observation||
      protocol.qualifiedForPatientData!==false||protocol.qualifiedForProduction!==false||
      !Number.isFinite(protocol.checkedAt)||protocol.checkedAt>now||
      now-protocol.checkedAt>30*MS_DAY) {
    throw new Error('CI_EXT05_PROTOCOL_EVIDENCE_UNQUALIFIED');
  }
  if (!synthetic||synthetic.tenantId!==source.tenantId||
      synthetic.sourceId!==source.sourceId||synthetic.facilityId!==source.facilityId||
      synthetic.credentialRevision!==revision||
      synthetic.protocolQualificationId!==protocol.qualificationId||
      synthetic.outcome!=='PASS'||synthetic.syntheticOnly!==true||
      !synthetic.identityMatchQualified||!synthetic.replayQualified||
      !synthetic.consentWithdrawalQualified||!synthetic.isolationQualified||
      !synthetic.networkRecoveryQualified||!synthetic.reviewerId||
      !Number.isFinite(synthetic.checkedAt)||!Number.isFinite(synthetic.expiresAt)||
      synthetic.checkedAt>now||synthetic.expiresAt<=now||
      synthetic.expiresAt-synthetic.checkedAt>30*MS_DAY||
      now-synthetic.checkedAt>30*MS_DAY) {
    throw new Error('CI_EXT05_SYNTHETIC_SITE_EVIDENCE_REQUIRED');
  }
}

/** This proves only integrity of trusted evidence records, not that a vendor was contacted. */
export async function requestFhirSiteReview(args:{
  db:Firestore;actor:FhirImportActor;sourceId:string;
  protocolQualificationId:string;syntheticEvidenceId:string;
  resourceTypes:ApprovalScope[];now?:()=>number;
}):Promise<{requestId:string;status:RequestState;replay:boolean}>{
  const {db,actor,sourceId,protocolQualificationId,syntheticEvidenceId}=args;
  checkActor(actor,actor.tenantId,'FHIR_SITE_REQUEST');
  if (![sourceId,protocolQualificationId,syntheticEvidenceId].every(safe)||
      !Array.isArray(args.resourceTypes)||!args.resourceTypes.length||
      new Set(args.resourceTypes).size!==args.resourceTypes.length||
      args.resourceTypes.some(r=>!RESOURCE_TYPES.includes(r))) {
    throw new Error('CI_EXT05_REQUEST_INVALID');
  }
  const root=db.collection('tenants').doc(actor.tenantId);
  const reqId=docId('fsr',[sourceId,protocolQualificationId,syntheticEvidenceId]);
  const sourceRef=root.collection('fhirSources').doc(sourceId);
  const protocolRef=root.collection('fhirSandboxQualifications').doc(protocolQualificationId);
  const syntheticRef=root.collection('fhirSyntheticQualifications').doc(syntheticEvidenceId);
  const requestRef=root.collection('fhirSiteReviewRequests').doc(reqId);
  return db.runTransaction(async tx=>{
    const [s,p,e,existing]=await tx.getAll(sourceRef,protocolRef,syntheticRef,requestRef);
    const source=s.exists?s.data() as FhirSourceRecord:null;
    checkSource(source,actor,sourceId);
    const now=(args.now||Date.now)();
    checkEvidence(source,p.exists?p.data() as SiteProtocolReceipt:null,
      e.exists?e.data() as SiteSyntheticEvidence:null,now);
    if (args.resourceTypes.some(r=>!source.approvedResourceTypes.includes(r))) {
      throw new Error('CI_EXT05_RESOURCE_DENIED');
    }
    const fingerprint=sourceFingerprint(source);
    if(existing.exists){
      const prev=existing.data() as FhirSiteReviewRequest;
      if(prev.sourceConfigHash!==fingerprint||
          sha([...prev.approvedResourceTypes].sort())!==sha([...args.resourceTypes].sort())||
          prev.tenantId!==actor.tenantId) throw new Error('CI_EXT05_REQUEST_REPLAY_MISMATCH');
      return {requestId:reqId,status:prev.status,replay:true};
    }
    const record:FhirSiteReviewRequest={
      requestId:reqId,tenantId:actor.tenantId,sourceId,facilityId:source.facilityId,
      credentialRevision:source.oauth!.credentialRevision,sourceConfigHash:fingerprint,
      protocolQualificationId,syntheticEvidenceId,
      approvedResourceTypes:[...args.resourceTypes].sort() as ApprovalScope[],
      status:'PENDING',requestedBy:actor.actorId,requestedAt:now,
      expiresAt:now+7*MS_DAY,
    };
    tx.create(requestRef,record);
    tx.create(root.collection('fhirSiteReviewEvents').doc(docId('fse',[reqId,'REQUEST'])),{
      eventType:'FHIR_SITE_REVIEW_REQUESTED',...record,recordedAt:now,immutable:true,
    });
    return {requestId:reqId,status:'PENDING',replay:false};
  });
}
export async function reviewFhirSiteRequest(args:{
  db:Firestore;actor:FhirImportActor;requestId:string;
  kind:ReviewKind;rationale:string;now?:()=>number;
}):Promise<{requestId:string;kind:ReviewKind;replay:boolean}>{
  const {db,actor,requestId,kind}=args;
  const grant=kind==='CLINICAL'?'FHIR_SITE_CLINICAL_APPROVE':
    kind==='SECURITY'?'FHIR_SITE_SECURITY_APPROVE':'INVALID';
  checkActor(actor,actor.tenantId,grant);
  if(!safe(requestId)||grant==='INVALID'||args.rationale.trim().length<24||
      args.rationale.length>1500) throw new Error('CI_EXT05_REVIEW_INVALID');
  const root=db.collection('tenants').doc(actor.tenantId);
  const ref=root.collection('fhirSiteReviewRequests').doc(requestId);
  const decisionId=docId('fsd',[requestId,kind]);
  const decisionRef=root.collection('fhirSiteReviewDecisions').doc(decisionId);
  return db.runTransaction(async tx=>{
    const rowSnap=await tx.get(ref);
    if(!rowSnap.exists) throw new Error('CI_EXT05_REVIEW_NOT_FOUND');
    const row=rowSnap.data() as FhirSiteReviewRequest;
    if(row.tenantId!==actor.tenantId||!actor.facilityIds.includes(row.facilityId))
      throw new Error('CI_EXT05_REVIEW_FACILITY_DENIED');
    const sourceSnap=await tx.get(root.collection('fhirSources').doc(row.sourceId));
    const source=sourceSnap.exists?sourceSnap.data() as FhirSourceRecord:null;
    checkSource(source,actor,row.sourceId);
    const now=(args.now||Date.now)();
    if(row.status!=='PENDING'||row.expiresAt<=now||
       row.sourceConfigHash!==sourceFingerprint(source)) throw new Error('CI_EXT05_REVIEW_STALE');
    const existing=await tx.get(decisionRef);
    const key: 'clinical' | 'security' = kind==='CLINICAL'?'clinical':'security';
    const opposite=kind==='CLINICAL'?row.security:row.clinical;
    if(opposite?.actorId===actor.actorId||row.requestedBy===actor.actorId)
      throw new Error('CI_EXT05_INDEPENDENCE_REQUIRED');
    if(existing.exists){
      const prior=existing.data() as {actorId:string;rationaleHash:string};
      if(prior.actorId!==actor.actorId||prior.rationaleHash!==sha(args.rationale.trim()))
        throw new Error('CI_EXT05_REVIEW_REPLAY_MISMATCH');
      return {requestId,kind,replay:true};
    }
    if(row[key]) throw new Error('CI_EXT05_REVIEW_ALREADY_DECIDED');
    const decision={actorId:actor.actorId,decisionId};
    tx.create(decisionRef,{
      tenantId:actor.tenantId,requestId,decisionId,kind,
      actorId:actor.actorId,rationaleHash:sha(args.rationale.trim()),
      recordedAt:now,immutable:true,
    });
    tx.update(ref,{[key]:decision});
    return {requestId,kind,replay:false};
  });
}
export async function activateFhirSiteRequest(args:{
  db:Firestore;actor:FhirImportActor;requestId:string;
  now?:()=>number;
}):Promise<{requestId:string;siteApprovalId:string;replay:boolean}>{
  const {db,actor,requestId}=args;
  checkActor(actor,actor.tenantId,'FHIR_SITE_ACTIVATE');
  if(!safe(requestId)) throw new Error('CI_EXT05_REQUEST_INVALID');
  const root=db.collection('tenants').doc(actor.tenantId);
  const requestRef=root.collection('fhirSiteReviewRequests').doc(requestId);
  const approvalId=docId('fsa',[actor.tenantId,requestId]);
  const approvalRef=root.collection('fhirSiteApprovals').doc(approvalId);
  return db.runTransaction(async tx=>{
    const r=await tx.get(requestRef);
    if(!r.exists) throw new Error('CI_EXT05_REVIEW_NOT_FOUND');
    const request=r.data() as FhirSiteReviewRequest;
    if(request.tenantId!==actor.tenantId||
        !actor.facilityIds.includes(request.facilityId)) throw new Error('CI_EXT05_FACILITY_DENIED');
    const refs=[
      root.collection('fhirSources').doc(request.sourceId),
      root.collection('fhirSandboxQualifications').doc(request.protocolQualificationId),
      root.collection('fhirSyntheticQualifications').doc(request.syntheticEvidenceId),
      root.collection('fhirSiteReviewDecisions').doc(docId('fsd',[requestId,'CLINICAL'])),
      root.collection('fhirSiteReviewDecisions').doc(docId('fsd',[requestId,'SECURITY'])),
      approvalRef,
    ];
    const [s,p,e,clinical,security,prior]=await tx.getAll(...refs);
    const source=s.exists?s.data() as FhirSourceRecord:null;
    checkSource(source,actor,request.sourceId);
    const now=(args.now||Date.now)();
    if(request.status==='APPROVED'&&request.siteApprovalId===approvalId&&prior.exists){
      return {requestId,siteApprovalId:approvalId,replay:true};
    }
    if(request.status!=='PENDING'||request.expiresAt<=now||
        sourceFingerprint(source)!==request.sourceConfigHash||
        source.oauth!.credentialRevision!==request.credentialRevision) {
      throw new Error('CI_EXT05_ACTIVATION_STALE');
    }
    checkEvidence(source,p.exists?p.data() as SiteProtocolReceipt:null,
      e.exists?e.data() as SiteSyntheticEvidence:null,now);
    if(!request.clinical||!request.security||
        request.clinical.actorId===request.security.actorId||
        [request.clinical.actorId,request.security.actorId,request.requestedBy].includes(actor.actorId)||
        request.clinical.actorId===request.requestedBy||
        request.security.actorId===request.requestedBy||
        !clinical.exists||!security.exists) throw new Error('CI_EXT05_INDEPENDENT_REVIEWS_REQUIRED');
    const clinicalDecision=clinical.data() as {actorId:string;requestId:string;kind:string};
    const securityDecision=security.data() as {actorId:string;requestId:string;kind:string};
    if(clinicalDecision.actorId!==request.clinical.actorId||
        clinicalDecision.kind!=='CLINICAL'||clinicalDecision.requestId!==requestId||
        securityDecision.actorId!==request.security.actorId||
        securityDecision.kind!=='SECURITY'||securityDecision.requestId!==requestId||
        prior.exists) throw new Error('CI_EXT05_REVIEW_INTEGRITY_DENIED');
    const approval:FhirSiteApproval={
      approvalId,tenantId:actor.tenantId,sourceId:request.sourceId,
      facilityId:request.facilityId,status:'APPROVED',
      credentialRevision:request.credentialRevision,
      approvedResourceTypes:request.approvedResourceTypes,
      clinicalReviewerId:request.clinical.actorId,
      securityReviewerId:request.security.actorId,
      sandboxQualificationId:request.protocolQualificationId,
      reviewedAt:now,expiresAt:Math.min(now+30*MS_DAY,
        (e.data() as SiteSyntheticEvidence).expiresAt),
    };
    validateFhirSiteApproval({...source,siteApprovalId:approvalId},approval,
      request.approvedResourceTypes[0],now);
    tx.create(approvalRef,{...approval,syntheticEvidenceId:request.syntheticEvidenceId,
      activationActorId:actor.actorId,immutable:true});
    tx.update(refs[0],{siteApprovalId:approvalId});
    tx.update(requestRef,{status:'APPROVED',siteApprovalId:approvalId,activatedAt:now,
      activatedBy:actor.actorId});
    tx.create(root.collection('fhirSiteReviewEvents').doc(docId('fse',[requestId,'ACTIVATE'])),{
      eventType:'FHIR_SITE_APPROVAL_ACTIVATED',tenantId:actor.tenantId,
      sourceId:request.sourceId,requestId,siteApprovalId:approvalId,
      actorId:actor.actorId,recordedAt:now,immutable:true,
    });
    return {requestId,siteApprovalId:approvalId,replay:false};
  });
}
export async function suspendFhirSite(args:{
  db:Firestore;actor:FhirImportActor;sourceId:string;reason:string;now?:()=>number;
}):Promise<{suspended:boolean;replay:boolean}>{
  const {db,actor,sourceId}=args;
  checkActor(actor,actor.tenantId,'FHIR_SITE_SUSPEND');
  if(!safe(sourceId)||args.reason.trim().length<24||args.reason.length>1500)
    throw new Error('CI_EXT05_SUSPEND_INVALID');
  const root=db.collection('tenants').doc(actor.tenantId);
  const ref=root.collection('fhirSources').doc(sourceId);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    const source=snap.exists?snap.data() as FhirSourceRecord:null;
    if(!source||source.tenantId!==actor.tenantId||
        !actor.facilityIds.includes(source.facilityId)) {
      throw new Error('CI_EXT05_SOURCE_OR_FACILITY_DENIED');
    }
    if(source.status==='SUSPENDED'||source.status==='REVOKED')
      return {suspended:true,replay:true};
    const now=(args.now||Date.now)();
    tx.update(ref,{status:'SUSPENDED',suspendedAt:now,suspendedBy:actor.actorId});
    tx.create(root.collection('fhirSiteReviewEvents').doc('fse_'+randomUUID()),{
      eventType:'FHIR_SITE_SOURCE_SUSPENDED',tenantId:actor.tenantId,
      sourceId,actorId:actor.actorId,reasonHash:sha(args.reason.trim()),
      recordedAt:now,immutable:true,
    });
    return {suspended:true,replay:false};
  });
}
