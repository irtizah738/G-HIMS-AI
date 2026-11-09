import {describe,expect,test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {
  EmployeeMaster,EmployeeCredential,ClinicalPrivilege,
} from '@/types/hcm-advanced';
import {
  assertCurrentExternalReviewEvaluationAuthority,
  assessCurrentExternalClinicalReview,
} from '@/lib/clinical/intelligence/external-clinical-current-authorization';
import {externalReviewFactDigest} from
  '@/lib/clinical/intelligence/external-clinician-review-policy';

const reviewId='ecr_'+ 'a'.repeat(64);
const factRefs=[{evidenceReceiptId:'fir_current',
  sourceVersionId:'v1',resourceHash:'b'.repeat(64)}];
const sourceRefs=[{sourceId:'ehr-a',facilityId:'facility-a'}];
const now=Date.parse('2026-11-09T03:00:00.000Z');
const employee={
  employeeId:'emp-reviewer',tenantId:'test-tenant',userId:'clinical-reviewer',
  employmentStatus:'ACTIVE',facilityIds:['facility-a'],
  departmentIds:['clinical-a'],
} as EmployeeMaster;
const credential={
  employeeId:employee.employeeId,isMandatoryForPractice:true,
  verificationStatus:'VERIFIED',verifiedByActorId:'independent-verifier',
  verifiedAt:'2026-10-01T00:00:00Z',
  issueDate:'2025-01-01',expiryDate:'2027-01-01',
} as EmployeeCredential;
const privilege={
  employeeId:employee.employeeId,privilegeType:'CONSULT_OPD',
  status:'GRANTED',facilityId:'facility-a',departmentId:'clinical-a',
  grantedByActorId:'independent-governance',
  effectiveFrom:'2025-01-01',effectiveUntil:'2027-01-01',
} as ClinicalPrivilege;
const common={
  reviewId,tenantId:'test-tenant',patientId:'patient-a',
  projectionRevision:1,projectionContentHash:'c'.repeat(64),
  sourceCheckpoint:'d'.repeat(64),authorityFenceHash:'e'.repeat(64),
  sourceRefs,factRefs,now,
};
const review={
  schemaVersion:1,reviewId,tenantId:common.tenantId,
  patientId:common.patientId,actorId:employee.userId,immutable:true,
  evidenceOnly:true,clinicalUseAuthorized:false,aiDraftingEligible:false,
  disposition:'SOURCE_EVIDENCE_REVIEWED',
  projectionRevision:common.projectionRevision,
  projectionContentHash:common.projectionContentHash,
  sourceCheckpoint:common.sourceCheckpoint,
  factualDigest:externalReviewFactDigest(factRefs),
  authorityFenceHash:common.authorityFenceHash,
  factRefs,sourceRefs,
};
const member={
  userId:employee.userId,status:'ACTIVE',
  roles:['DOCTOR'],permissions:['FHIR_EVIDENCE_REVIEW',
    'FHIR_CLINICAL_EVIDENCE_REVIEW'],
  facilityIds:['facility-a'],
};
const full={
  ...common,review,membership:member,employees:[employee],
  credentials:[credential],privileges:[privilege],approval:null,
};
describe('CI-EXT-16 current clinical evidence authorization is never a draft grant',()=>{
  test('requires explicit evaluator permission and a bounded opaque review ID',()=>{
    const actor={
      actorId:'evaluator',tenantId:common.tenantId,
      roles:['DOCTOR'],facilityIds:['facility-a'],
      permissions:['FHIR_EVIDENCE_REVIEW','FHIR_CLINICAL_EVIDENCE_EVALUATE'],
    };
    expect(()=>assertCurrentExternalReviewEvaluationAuthority(actor,reviewId))
      .not.toThrow();
    expect(()=>assertCurrentExternalReviewEvaluationAuthority({
      ...actor,permissions:['FHIR_EVIDENCE_REVIEW'],
    },reviewId)).toThrow('CI_EXT16_EVALUATION_PERMISSION_REQUIRED');
    expect(()=>assertCurrentExternalReviewEvaluationAuthority(actor,'unknown'))
      .toThrow('CI_EXT16_REVIEW_ID_INVALID');
  });
  test('current HCM and exact evidence remain evidence-only without signed approval',()=>{
    const row=assessCurrentExternalClinicalReview(full);
    expect(row.reviewCurrent).toBe(true);
    expect(row.clinicianCurrentlyQualified).toBe(true);
    expect(row.reason).toBe('CLINICAL_APPROVAL_MISSING');
    expect(row.clinicalApprovalVerified).toBe(false);
    expect(row.clinicalUseAuthorized).toBe(false);
    expect(row.aiDraftingEligible).toBe(false);
  });
  test('stale review/consent fence and revoked member/credential deny qualification',()=>{
    expect(assessCurrentExternalClinicalReview({
      ...full,authorityFenceHash:'f'.repeat(64),
    }).reason).toBe('REVIEW_NOT_CURRENT');
    expect(assessCurrentExternalClinicalReview({
      ...full,membership:{...member,status:'SUSPENDED'},
    }).reason).toBe('CLINICIAN_MEMBERSHIP_INACTIVE');
    expect(assessCurrentExternalClinicalReview({
      ...full,credentials:[{...credential,expiryDate:'2020-01-01'}],
    }).reason).toBe('CLINICIAN_CREDENTIALS_INVALID');
    expect(assessCurrentExternalClinicalReview({
      ...full,privileges:[{...privilege,facilityId:'other-facility'}],
    }).reason).toBe('CLINICIAN_PRIVILEGES_INVALID');
  });
  test('no unsigned approval-like Firestore payload can authorize clinical use',()=>{
    const candidate={
      schemaVersion:1,reviewId,tenantId:common.tenantId,
      patientId:common.patientId,status:'APPROVED',
      approvedByActorId:'independent-approver',
      projectionContentHash:common.projectionContentHash,
      sourceCheckpoint:common.sourceCheckpoint,
      authorityFenceHash:common.authorityFenceHash,
      factualDigest:externalReviewFactDigest(factRefs),
      expiresAt:now+100_000,signature:'fabricated',
    };
    const result=assessCurrentExternalClinicalReview({...full,approval:candidate});
    expect(result.reason).toBe('CLINICAL_APPROVAL_PROOF_UNAVAILABLE');
    expect(result.clinicalApprovalVerified).toBe(false);
    expect(result.clinicalUseAuthorized).toBe(false);
    const wrong=assessCurrentExternalClinicalReview({
      ...full,approval:{...candidate,patientId:'different-patient'},
    });
    expect(wrong.reason).toBe('CLINICAL_APPROVAL_SCOPE_INVALID');
  });
  test('API and Firestore rules expose no clinical-use shortcut',async()=>{
    const route=await readFile(resolve(process.cwd(),
      'app/api/integrations/fhir/current-authorization/route.ts'),'utf8');
    expect(route).toContain("GHIMS_CI_EXTERNAL_CURRENT_AUTH_EVALUATOR_ENABLED!=='true'");
    expect(route).toContain("!['TEST','STAGING'].includes(");
    expect(route).toContain('deriveAuthoritativeContext');
    expect(route).toContain('evaluateReviewId:reviewId');
    expect(route).toContain("externalClinicalRelease:'NO_GO'");
    const rules=await readFile(resolve(process.cwd(),'firestore.rules'),'utf8');
    expect(rules).toContain('match /externalClinicalUseApprovals/{reviewId} { allow read, write: if false; }');
  });
});
