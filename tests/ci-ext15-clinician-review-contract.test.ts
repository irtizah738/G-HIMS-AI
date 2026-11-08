import {describe,expect,test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  assertExternalClinicianReviewAuthority,
  assertExternalClinicianReviewInput,
  externalClinicianReviewId,
  externalReviewFactDigest,
} from '@/lib/clinical/intelligence/external-clinician-review-policy';

const input={
  idempotencyKey:'81a7d5f2-c1a9-4f2d-8b64-73b1f4383e15',
  expectedProjectionRevision:2,
  expectedProjectionContentHash:'a'.repeat(64),
  expectedSourceCheckpoint:'b'.repeat(64),
  expectedFacts:[{
    evidenceReceiptId:'fir_1234',sourceVersionId:'v3',resourceHash:'c'.repeat(64),
  }],
  disposition:'SOURCE_EVIDENCE_REVIEWED' as const,
};
const reviewer={
  tenantId:'synthetic-tenant',actorId:'clinician-1',facilityIds:['facility-a'],
  roles:['DOCTOR'],permissions:['FHIR_CLINICAL_EVIDENCE_REVIEW','FHIR_EVIDENCE_REVIEW'],
};

describe('CI-EXT-15 external clinical review anti-promotion policy',()=>{
  test('validates exact digest and deterministic idempotency scope',()=>{
    expect(()=>assertExternalClinicianReviewInput(input)).not.toThrow();
    expect(externalClinicianReviewId('synthetic-tenant','patient-a','clinician-1',
      input.idempotencyKey))
      .toBe(externalClinicianReviewId('synthetic-tenant','patient-a','clinician-1',
        input.idempotencyKey.toUpperCase()));
    expect(externalClinicianReviewId('synthetic-tenant','patient-b','clinician-1',
      input.idempotencyKey)===externalClinicianReviewId('synthetic-tenant','patient-a',
      'clinician-1',input.idempotencyKey)).toBe(false);
    expect(externalReviewFactDigest(input.expectedFacts))
      .toBe(externalReviewFactDigest([...input.expectedFacts].reverse()));
  });
  test('rejects admins, import operators and review without a distinct clinician grant',()=>{
    expect(()=>assertExternalClinicianReviewAuthority(reviewer)).not.toThrow();
    expect(()=>assertExternalClinicianReviewAuthority({
      ...reviewer,roles:['SYSTEM_ADMIN'],
    })).toThrow('CI_EXT15_CLINICIAN_ROLE_REQUIRED');
    expect(()=>assertExternalClinicianReviewAuthority({
      ...reviewer,permissions:['FHIR_IMPORT','FHIR_EVIDENCE_REVIEW'],
    })).toThrow('CI_EXT15_EXPLICIT_REVIEW_PERMISSION_REQUIRED');
  });
  test('rejects extra field smuggling, missing facts, duplicate evidence and fake hashes',()=>{
    expect(()=>assertExternalClinicianReviewInput({
      ...input,reviewApprovedBy:'another-clinician',
    })).toThrow('CI_EXT15_REQUEST_INVALID');
    expect(()=>assertExternalClinicianReviewInput({
      ...input,expectedFacts:[],
    })).toThrow('CI_EXT15_REQUEST_INVALID');
    expect(()=>assertExternalClinicianReviewInput({
      ...input,expectedFacts:[input.expectedFacts[0],input.expectedFacts[0]],
    })).toThrow('CI_EXT15_REQUEST_INVALID');
    expect(()=>assertExternalClinicianReviewInput({
      ...input,expectedFacts:[{...input.expectedFacts[0],resourceHash:'not-a-hash'}],
    })).toThrow('CI_EXT15_REQUEST_INVALID');
    expect(()=>assertExternalClinicianReviewInput({
      ...input,disposition:'APPROVE_CLINICAL_DRAFTING',
    })).toThrow('CI_EXT15_REQUEST_INVALID');
  });
  test('requires browser-deny security rules for review, immutable events and HELD outbox',async()=>{
    const rules=await readFile(resolve(process.cwd(),'firestore.rules'),'utf8');
    for(const name of [
      'externalClinicianEvidenceReviews',
      'externalClinicianEvidenceReviewEvents',
      'externalClinicianEvidenceReviewOutbox',
    ]){
      expect(rules).toContain(
        'match /'+name+'/{'+(
          name.endsWith('Outbox')?'outboxId':name.endsWith('Events')?'eventId':'reviewId'
        )+'} { allow read, write: if false; }',
      );
    }
  });
  test('API defaults to disabled and never returns imported raw FHIR resources',async()=>{
    const route=await readFile(resolve(process.cwd(),
      'app/api/integrations/fhir/clinical-review/route.ts'),'utf8');
    expect(route).toContain("GHIMS_CI_EXTERNAL_CLINICAL_REVIEW_ENABLED!=='true'");
    expect(route).toContain("process.env.GHIMS_RUNTIME_MODE==='PRODUCTION'");
    expect(route).toContain('deriveAuthoritativeContext');
    expect(route).toContain('readExternalClinicalEvidence');
    expect(route).toContain('clinicalUseAuthorized:false,aiDraftingEligible:false');
    expect(route).not.toContain('return NextResponse.json({success:true,...result}');
  });
});
