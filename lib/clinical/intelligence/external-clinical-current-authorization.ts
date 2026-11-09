/**
 * CI-EXT-16 — read-only, current-snapshot eligibility assessment.
 *
 * This is NOT a clinical release or an AI-drafting authorization. A historical
 * review, HCM privilege, or untrusted approval document can NEVER switch
 * clinicalUseAuthorized/aiDraftingEligible to true. A separately governed,
 * independently verifiable clinical approval protocol is not yet installed.
 */
import type {FhirImportActor} from './external-fhir-import';
import type {
  ClinicalPrivilege,EmployeeCredential,EmployeeMaster,
} from '@/types/hcm-advanced';
import {activePrivileges,credentialsValid} from './consultant-directory-service';
import {externalReviewFactDigest,type ExternalReviewFactRef}
  from './external-clinician-review-policy';

export type CurrentExternalAuthorizationReason=
  | 'REVIEW_NOT_FOUND'
  | 'REVIEW_NOT_CURRENT'
  | 'CLINICAL_CONCERN_UNRESOLVED'
  | 'CLINICIAN_MEMBERSHIP_INACTIVE'
  | 'CLINICIAN_EMPLOYMENT_INVALID'
  | 'CLINICIAN_CREDENTIALS_INVALID'
  | 'CLINICIAN_PRIVILEGES_INVALID'
  | 'CLINICAL_APPROVAL_MISSING'
  | 'CLINICAL_APPROVAL_SCOPE_INVALID'
  | 'CLINICAL_APPROVAL_PROOF_UNAVAILABLE';

export type CurrentExternalAuthorizationResult=Readonly<{
  reviewId:string;
  reviewCurrent:boolean;
  clinicianCurrentlyQualified:boolean;
  clinicalApprovalVerified:false;
  clinicalUseAuthorized:false;
  aiDraftingEligible:false;
  disposition:'EVIDENCE_ONLY';
  reason:CurrentExternalAuthorizationReason;
}>;

export const EXTERNAL_CURRENT_AUTH_MAX_EMPLOYEES=2;
export const EXTERNAL_CURRENT_AUTH_MAX_CREDENTIALS=32;
export const EXTERNAL_CURRENT_AUTH_MAX_PRIVILEGES=32;

const REVIEW=/^ecr_[a-f0-9]{64}$/;
const CLINICAL_ROLES=new Set(['DOCTOR','CONSULTANT','ATTENDING_PHYSICIAN']);
const ELIGIBLE_PRIVILEGES=new Set(['CONSULT_OPD','SIGN_CLINICAL_NOTE']);
const isObject=(x:unknown):x is Record<string,unknown>=>
  x!==null&&typeof x==='object'&&!Array.isArray(x);
function normalized(value:unknown):string{
  return typeof value==='string'?value.trim().toUpperCase():'';
}
function contains(scope:unknown,id:string):boolean{
  return Array.isArray(scope)&&scope.some(v=>normalized(v)===normalized(id));
}
function denied(reviewId:string,reason:CurrentExternalAuthorizationReason,
  reviewCurrent=false,clinicianCurrentlyQualified=false):CurrentExternalAuthorizationResult{
  return {reviewId,reviewCurrent,clinicianCurrentlyQualified,
    clinicalApprovalVerified:false,clinicalUseAuthorized:false,
    aiDraftingEligible:false,disposition:'EVIDENCE_ONLY',reason};
}
function sameJson(a:unknown,b:unknown):boolean{
  return JSON.stringify(a)===JSON.stringify(b);
}
export function assertCurrentExternalReviewEvaluationAuthority(actor:FhirImportActor,
  reviewId:string):void{
  if(!REVIEW.test(reviewId))throw new Error('CI_EXT16_REVIEW_ID_INVALID');
  if(!actor.permissions?.some(x=>normalized(x)==='FHIR_EVIDENCE_REVIEW')||
     !actor.permissions?.some(x=>normalized(x)==='FHIR_CLINICAL_EVIDENCE_EVALUATE'))
    throw new Error('CI_EXT16_EVALUATION_PERMISSION_REQUIRED');
}

/** All inputs MUST be read in the same Firestore transaction as the FHIR heads. */
export function assessCurrentExternalClinicalReview(args:Readonly<{
  reviewId:string;tenantId:string;patientId:string;
  projectionRevision:number;
  projectionContentHash:string;sourceCheckpoint:string;
  authorityFenceHash:string;
  factRefs:readonly ExternalReviewFactRef[];
  sourceRefs:readonly {sourceId:string;facilityId:string}[];
  review:Record<string,unknown>|null;
  membership:Record<string,unknown>|null;
  employees:readonly EmployeeMaster[];
  credentials:readonly EmployeeCredential[];
  privileges:readonly ClinicalPrivilege[];
  approval:Record<string,unknown>|null;
  now:number;
}>):CurrentExternalAuthorizationResult{
  const {reviewId,tenantId,patientId,review,now}=args;
  if(!REVIEW.test(reviewId))throw new Error('CI_EXT16_REVIEW_ID_INVALID');
  if(!Number.isSafeInteger(now)||now<1)
    throw new Error('CI_EXT16_CLOCK_INVALID');
  if(!review)return denied(reviewId,'REVIEW_NOT_FOUND');
  const expectedFacts=externalReviewFactDigest(args.factRefs);
  if(review.schemaVersion!==1||review.reviewId!==reviewId||
     review.tenantId!==tenantId||review.patientId!==patientId||
     review.immutable!==true||review.evidenceOnly!==true||
     review.clinicalUseAuthorized!==false||review.aiDraftingEligible!==false||
     typeof review.actorId!=='string'||!review.actorId||
     review.projectionRevision!==args.projectionRevision||
     review.projectionContentHash!==args.projectionContentHash||
     review.sourceCheckpoint!==args.sourceCheckpoint||
     review.factualDigest!==expectedFacts||
     review.authorityFenceHash!==args.authorityFenceHash||
     !sameJson(review.factRefs,args.factRefs)||
     !sameJson(review.sourceRefs,args.sourceRefs))
    return denied(reviewId,'REVIEW_NOT_CURRENT');
  if(review.disposition!=='SOURCE_EVIDENCE_REVIEWED')
    return denied(reviewId,'CLINICAL_CONCERN_UNRESOLVED');
  const uid=review.actorId;
  const member=args.membership;
  const roles=Array.isArray(member?.roles)?member.roles:[member?.role];
  if(!member||member.status!=='ACTIVE'||
     (member.userId&&member.userId!==uid)||
     !roles.some(role=>CLINICAL_ROLES.has(normalized(role)))||
     args.sourceRefs.some(ref=>!contains(member.facilityIds,ref.facilityId)))
    return denied(reviewId,'CLINICIAN_MEMBERSHIP_INACTIVE',true);
  const employee=args.employees.length===1?args.employees[0]:null;
  if(!employee||employee.userId!==uid||employee.tenantId!==tenantId||
     employee.employmentStatus!=='ACTIVE'||
     !Array.isArray(employee.departmentIds)||employee.departmentIds.length===0||
     args.sourceRefs.some(ref=>!contains(employee.facilityIds,ref.facilityId)))
    return denied(reviewId,'CLINICIAN_EMPLOYMENT_INVALID',true);
  if(args.credentials.length>EXTERNAL_CURRENT_AUTH_MAX_CREDENTIALS||
     !credentialsValid([...args.credentials],now)||
     args.credentials.some(c=>c.employeeId!==employee.employeeId||
       (c.isMandatoryForPractice&&c.verifiedByActorId===uid)))
    return denied(reviewId,'CLINICIAN_CREDENTIALS_INVALID',true);
  if(args.privileges.length>EXTERNAL_CURRENT_AUTH_MAX_PRIVILEGES||
     !args.sourceRefs.every(ref=>activePrivileges([...args.privileges],now,ref.facilityId)
       .some(priv=>priv.employeeId===employee.employeeId&&
         ELIGIBLE_PRIVILEGES.has(priv.privilegeType)&&
         contains(employee.departmentIds,priv.departmentId)&&
         priv.grantedByActorId!==uid)))
    return denied(reviewId,'CLINICIAN_PRIVILEGES_INVALID',true);
  if(!args.approval)
    return denied(reviewId,'CLINICAL_APPROVAL_MISSING',true,true);
  if(args.approval.schemaVersion!==1||
     args.approval.reviewId!==reviewId||
     args.approval.tenantId!==tenantId||
     args.approval.patientId!==patientId||
     args.approval.status!=='APPROVED'||
     args.approval.projectionContentHash!==args.projectionContentHash||
     args.approval.sourceCheckpoint!==args.sourceCheckpoint||
     args.approval.authorityFenceHash!==args.authorityFenceHash||
     args.approval.factualDigest!==expectedFacts||
     typeof args.approval.approvedByActorId!=='string'||
     args.approval.approvedByActorId===uid||
     typeof args.approval.expiresAt!=='number'||
     !Number.isSafeInteger(args.approval.expiresAt)||
     args.approval.expiresAt<=now)
    return denied(reviewId,'CLINICAL_APPROVAL_SCOPE_INVALID',true,true);
  // An Admin-SDK row can be forged or replayed without a trusted issuer.
  // No signature trust roots, clinician-assignment attestations, or governed
  // approval-writer exist yet. Never turn a plausible row into a use grant.
  return denied(reviewId,'CLINICAL_APPROVAL_PROOF_UNAVAILABLE',true,true);
}
