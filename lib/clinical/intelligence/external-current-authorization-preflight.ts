/**
 * CI-EXT-16: server-only, non-promoting current-authority qualification.
 *
 * Called only from within CI-EXT-03's verified Firestore read transaction.
 * Evaluating a historical review outside that transaction is unsafe: a
 * consent withdrawal or source change could race the approval check.
 *
 * No response from this module authorizes clinical use, AI drafting, chart
 * mutation or clinical decision support. All current heads are projections of
 * institutionally governed immutable events; no writer is introduced here.
 */
import {createHash} from 'node:crypto';
import type {DocumentReference,Transaction} from 'firebase-admin/firestore';
import {externalReviewFactDigest} from './external-clinician-review-policy';
import {verifyApprovalEventHead} from './external-fact-approval-event-integrity';
import {verifyCurrentExternalGovernanceAuthority} from './external-governance-authority-consumer';

const ID=/^[A-Za-z0-9._-]{1,128}$/;
const HEX=/^[a-f0-9]{64}$/;
const MAX_FACTS=64;

export type CurrentExternalPreflight =Readonly<{
  state:'DENIED'|'PREQUALIFIED_NON_PROMOTING';
  reasonCode:string;
  clinicalUseAuthorized:false;
  aiDraftingEligible:false;
  evidenceOnly:true;
}>;

export type CurrentFactReference=Readonly<{
  evidenceReceiptId:string;
  sourceVersionId:string;
  resourceHash:string;
  sourceId:string;
}>;

export type CurrentSourceReference=Readonly<{
  sourceId:string;
  facilityId:string;
  siteApprovalId:string|null;
}>;

type Row=Record<string,unknown>;
type Credential=Row & {
  tenantId?:unknown; actorId?:unknown; facilityIds?:unknown;
  status?:unknown; identityAssurance?:unknown; licenseVerified?:unknown;
  revision?:unknown; validFrom?:unknown; validUntil?:unknown;
  revokedAt?:unknown;
};

function validId(v:unknown):v is string{
  return typeof v==='string'&&ID.test(v)&&v!=='.'&&v!=='..';
}
function validHash(v:unknown):v is string{
  return typeof v==='string'&&HEX.test(v);
}
function activeWindow(row:Row,now:number):boolean{
  return typeof row.validFrom==='number'&&Number.isSafeInteger(row.validFrom)&&
    typeof row.validUntil==='number'&&Number.isSafeInteger(row.validUntil)&&
    row.validFrom<=now&&now<row.validUntil&&
    (row.revokedAt===null||row.revokedAt===undefined);
}
function currentCredential(row:Credential|undefined,tenantId:string,
  actorId:string,facilityIds:readonly string[],now:number):boolean{
  const currentFacilities=row?.facilityIds;
  return !!row&&row.tenantId===tenantId&&row.actorId===actorId&&
    row.status==='VERIFIED'&&row.identityAssurance==='HOSPITAL_VERIFIED'&&
    row.licenseVerified===true&&Number.isSafeInteger(row.revision)&&
    Number(row.revision)>0&&Array.isArray(currentFacilities)&&
    facilityIds.every(f=>currentFacilities.includes(f))&&
    activeWindow(row,now);
}
function denied(reasonCode:string):CurrentExternalPreflight{
  return {state:'DENIED',reasonCode,clinicalUseAuthorized:false,
    aiDraftingEligible:false,evidenceOnly:true};
}
/**
 * Stable IDs are never supplied by a browser: approval heads are retrieved
 * using the exact review/fact lineage. Distinct immutable approval events
 * now back these mutable heads in CI-EXT-17 synthetic qualification.
 */
export function externalFactApprovalHeadId(
  reviewId:string,evidenceReceiptId:string,
):string{
  if(!validId(reviewId)||!validId(evidenceReceiptId))
    throw new Error('CI_EXT16_APPROVAL_ID_INVALID');
  return 'efah_'+createHash('sha256').update(JSON.stringify([
    'HELIXIS_CI_EXT16_APPROVAL_HEAD_V1',reviewId,evidenceReceiptId,
  ])).digest('hex');
}

export async function assessCurrentExternalClinicalApproval(args:Readonly<{
  tx:Transaction;
  tenant:DocumentReference;
  tenantId:string;
  patientId:string;
  actorId:string;
  reviewId:string;
  now:number;
  revision:number;
  contentHash:string;
  sourceCheckpoint:string;
  authorityFenceHash:string;
  facts:readonly CurrentFactReference[];
  sources:readonly CurrentSourceReference[];
}>):Promise<CurrentExternalPreflight>{
  const {tx,tenant,tenantId,patientId,actorId,reviewId,now,facts,sources}=args;
  if(!validId(tenantId)||!validId(patientId)||!validId(actorId)||
    !validId(reviewId)||!reviewId.startsWith('ecr_')||
    !Number.isSafeInteger(now)||!Number.isSafeInteger(args.revision)||
    !validHash(args.contentHash)||!validHash(args.sourceCheckpoint)||
    !validHash(args.authorityFenceHash)||
    facts.length<1||facts.length>MAX_FACTS||sources.length<1||
    sources.length>MAX_FACTS||
    new Set(facts.map(f=>f.evidenceReceiptId)).size!==facts.length||
    new Set(sources.map(s=>s.sourceId)).size!==sources.length||
    facts.some(f=>!validId(f.evidenceReceiptId)||!validId(f.sourceVersionId)||
      !validId(f.sourceId)||!validHash(f.resourceHash))||
    sources.some(s=>!validId(s.sourceId)||!validId(s.facilityId))
  )return denied('CI_EXT16_SCOPE_OR_EVIDENCE_INVALID');

  const reviewSnap=await tx.get(
    tenant.collection('externalClinicianEvidenceReviews').doc(reviewId));
  if(!reviewSnap.exists)return denied('CI_EXT16_REVIEW_MISSING');
  const review=reviewSnap.data() as Row;
  const digest=externalReviewFactDigest(facts.map(f=>({
    evidenceReceiptId:f.evidenceReceiptId,
    sourceVersionId:f.sourceVersionId,resourceHash:f.resourceHash,
  })));
  if(review.schemaVersion!==1||review.reviewId!==reviewId||
    review.tenantId!==tenantId||review.patientId!==patientId||
    review.actorId!==actorId||review.disposition!=='SOURCE_EVIDENCE_REVIEWED'||
    review.immutable!==true||review.evidenceOnly!==true||
    review.clinicalUseAuthorized!==false||review.aiDraftingEligible!==false||
    review.projectionRevision!==args.revision||
    review.projectionContentHash!==args.contentHash||
    review.sourceCheckpoint!==args.sourceCheckpoint||
    review.factualDigest!==digest||
    review.authorityFenceHash!==args.authorityFenceHash||
    !Array.isArray(review.factRefs)||review.factRefs.length!==facts.length||
    !Array.isArray(review.sourceRefs)||review.sourceRefs.length!==sources.length
  )return denied('CI_EXT16_REVIEW_STALE_OR_CONTESTED');

  // Check source and fact sets, not just a hash: a damaged read model must
  // not be treated as authoritative despite an unrelated matching field.
  const expectedFactKeys=facts.map(f=>[
    f.evidenceReceiptId,f.sourceVersionId,f.resourceHash].join('|')).sort();
  const storedFactKeys=(review.factRefs as Row[]).map(f=>
    [f.evidenceReceiptId,f.sourceVersionId,f.resourceHash].join('|')).sort();
  const expectedSourceKeys=sources.map(s=>s.sourceId+'|'+s.facilityId).sort();
  const storedSourceKeys=(review.sourceRefs as Row[]).map(s=>
    [s.sourceId,s.facilityId].join('|')).sort();
  if(JSON.stringify(storedFactKeys)!==JSON.stringify(expectedFactKeys)||
    JSON.stringify(storedSourceKeys)!==JSON.stringify(expectedSourceKeys))
    return denied('CI_EXT16_REVIEW_LINEAGE_MISMATCH');

  const reviewerSnap=await tx.get(
    tenant.collection('externalClinicalCredentialHeads').doc(actorId));
  const reviewer=reviewerSnap.exists?reviewerSnap.data() as Credential:undefined;
  const facilities=sources.map(s=>s.facilityId);
  if(!currentCredential(reviewer,tenantId,actorId,facilities,now))
    return denied('CI_EXT16_REVIEWER_CREDENTIAL_NOT_CURRENT');

  const siteSnaps=await tx.getAll(...sources.map(s=>
    tenant.collection('externalClinicalSiteAuthorityHeads').doc(s.sourceId)));
  const siteRevisions=new Map<string,number>();
  for(let i=0;i<sources.length;i++){
    const source=sources[i];
    const site=siteSnaps[i].exists?siteSnaps[i].data() as Row:undefined;
    if(!site||!validId(source.siteApprovalId)||
      site.tenantId!==tenantId||site.sourceId!==source.sourceId||
      site.facilityId!==source.facilityId||
      site.siteApprovalId!==source.siteApprovalId||
      site.status!=='APPROVED'||site.clinicalUseReviewStatus!=='APPROVED'||
      !Number.isSafeInteger(site.revision)||Number(site.revision)<1||
      !activeWindow(site,now))
      return denied('CI_EXT16_SITE_AUTHORITY_NOT_CURRENT');
    siteRevisions.set(source.sourceId,Number(site.revision));
  }

  const approvalSnaps=await tx.getAll(...facts.map(f=>
    tenant.collection('externalClinicalFactApprovalHeads')
      .doc(externalFactApprovalHeadId(reviewId,f.evidenceReceiptId))));
  const approvers=new Set<string>();
  const approvals:Row[]=[];
  for(let i=0;i<facts.length;i++){
    const fact=facts[i];
    const row=approvalSnaps[i].exists?approvalSnaps[i].data() as Row:undefined;
    if(!row||row.tenantId!==tenantId||row.patientId!==patientId||
      row.reviewId!==reviewId||row.evidenceReceiptId!==fact.evidenceReceiptId||
      row.sourceVersionId!==fact.sourceVersionId||
      row.resourceHash!==fact.resourceHash||row.sourceId!==fact.sourceId||
      row.factualDigest!==digest||
      row.authorityFenceHash!==args.authorityFenceHash||
      row.status!=='APPROVED'||!validId(row.approvalEventId)||
      !Number.isSafeInteger(row.revision)||Number(row.revision)<1||
      row.siteAuthorityRevision!==siteRevisions.get(fact.sourceId)||
      row.reviewerCredentialRevision!==reviewer!.revision||
      !validId(row.approvedByActorId)||row.approvedByActorId===actorId||
      !activeWindow(row,now))
      return denied('CI_EXT16_FACT_APPROVAL_MISSING_STALE_OR_REVOKED');
    approvers.add(row.approvedByActorId);
    approvals.push(row);
  }

  // A mutable read model is never sufficient proof of issuance. Each current
  // APPROVED head must match a domain-hashed, immutable issuance event.
  const eventSnaps=await tx.getAll(...approvals.map(a=>
    tenant.collection('externalClinicalFactApprovalEvents')
      .doc(a.approvalEventId as string)));
  for(let i=0;i<approvals.length;i++){
    if(!eventSnaps[i].exists||
      !verifyApprovalEventHead(approvals[i],
        eventSnaps[i].data() as Row,approvals[i].approvalEventId as string))
      return denied('CI_EXT17_APPROVAL_EVENT_CHAIN_INVALID');
  }
  const approverIds=[...approvers].sort();
  const approverSnaps=await tx.getAll(...approverIds.map(id=>
    tenant.collection('externalClinicalCredentialHeads').doc(id)));
  const approverMap=new Map(approverIds.map((id,i)=>[
    id,approverSnaps[i].exists?approverSnaps[i].data() as Credential:undefined,
  ]));
  for(const approval of approvals){
    const approverId=approval.approvedByActorId as string;
    const approver=approverMap.get(approverId);
    const facility=sources.find(s=>s.sourceId===approval.sourceId)?.facilityId;
    if(!facility||!currentCredential(approver,tenantId,approverId,[facility],now)||
      approval.approverCredentialRevision!==approver!.revision)
      return denied('CI_EXT16_APPROVER_CREDENTIAL_NOT_CURRENT');
  }
  // CI-EXT-19: a mutable VERIFIED/APPROVED head and a fact-approval
  // event cannot grant even non-promoting prequalification without its
  // live hospital credential/site event, original proposal, independent
  // verification evidence, and active proposer/approver grant lineage.
  const governance=await verifyCurrentExternalGovernanceAuthority({
    tx,tenant,tenantId,now,
    authorities:[
      {kind:'CLINICIAN',targetId:actorId,facilityId:facilities[0],
        siteApprovalId:null,head:reviewer as Row},
      ...approverIds.map(id=>({
        kind:'CLINICIAN' as const,targetId:id,siteApprovalId:null,
        facilityId:sources.find(s=>approvals.some(x=>
          x.approvedByActorId===id&&x.sourceId===s.sourceId))!.facilityId,
        head:approverMap.get(id) as Row,
      })),
      ...sources.map((s,i)=>({
        kind:'SITE' as const,targetId:s.sourceId,
        facilityId:s.facilityId,siteApprovalId:s.siteApprovalId,
        head:siteSnaps[i].data() as Row,
      })),
    ],
  });
  if(!governance.valid)return denied(governance.reasonCode);
  // Even all these derived heads cannot substitute for independently
  // qualified source trust, hospital signature verification, the clinical
  // approval issuance service, and external AI context release governance.
  return {state:'PREQUALIFIED_NON_PROMOTING',
    reasonCode:'CI_EXT16_INDEPENDENT_RELEASE_GATES_REQUIRED',
    clinicalUseAuthorized:false,aiDraftingEligible:false,evidenceOnly:true};
}
