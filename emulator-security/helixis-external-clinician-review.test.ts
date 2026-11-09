/**
 * CI-EXT-15: clinician review is an immutable non-promoting transaction, never
 * a route to native Patient360 or external AI drafting.
 * Runs only against ghims-p4-ci Firestore emulator (127.0.0.1:8080).
 */
import {expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {getAdminFirestore} from '@/server/firebase/admin';
import {fhirPatientLinkId,ingestExternalFhirResource} from
  '@/lib/clinical/intelligence/external-fhir-import';
import {rebuildExternalPatient360} from
  '@/lib/clinical/intelligence/external-patient360-projection';
import {readExternalClinicalEvidence} from
  '@/lib/clinical/intelligence/external-clinical-evidence-reader';
import type {ExternalClinicianReviewInput} from
  '@/lib/clinical/intelligence/external-clinician-review-policy';
import {revokeExternalFactApproval} from
  '@/lib/clinical/intelligence/external-fact-approval-events';
import {externalFactApprovalHeadId} from
  '@/lib/clinical/intelligence/external-current-authorization-preflight';

function observation(version:string,date:string,value:number){
  return {
    resourceType:'Observation',id:'lab-ext15',
    meta:{versionId:version,lastUpdated:date},status:'final',
    subject:{reference:'Patient/external-ext15'},
    code:{coding:[{system:'http://loinc.org',code:'2160-0'}]},
    valueQuantity:{value,code:'mg/dL',system:'http://unitsofmeasure.org'},
  };
}
async function fixture(){
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
     process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
     process.env.GHIMS_RUNTIME_MODE!=='TEST'||
     process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED!=='false')
    throw new Error('CI_EXT15_EMULATOR_ONLY');
  const db=getAdminFirestore();
  if(!db)throw new Error('CI_EXT15_EMULATOR_ADMIN_UNAVAILABLE');
  const tenantId='ci-ext15-'+randomUUID().slice(0,12);
  const patientId='synthetic-clinical-patient';
  const sourceId='synthetic-his';
  const root=db.collection('tenants').doc(tenantId);
  const link=root.collection('fhirPatientLinks')
    .doc(fhirPatientLinkId(sourceId,'external-ext15'));
  const source=root.collection('fhirSources').doc(sourceId);
  const importer={
    actorId:'integration-operator',tenantId,roles:[] as string[],
    permissions:['FHIR_IMPORT'],facilityIds:['facility-a'],
  };
  const clinician={
    actorId:'independent-clinician',tenantId,roles:['DOCTOR'],
    permissions:['FHIR_CLINICAL_EVIDENCE_REVIEW','FHIR_EVIDENCE_REVIEW'],
    facilityIds:['facility-a'],
  };
  await Promise.all([
    root.collection('patients').doc(patientId).set({
      tenantId,patientId,status:'ACTIVE',
    }),
    source.set({
      tenantId,sourceId,facilityId:'facility-a',
      baseUrl:'https://synthetic-his.example.test/fhir/R4',
      siteApprovalId:'site-approved-v1',
      status:'ACTIVE',securityReviewStatus:'APPROVED',
      approvedResourceTypes:['Patient','Encounter','Observation'],
    }),
    link.set({
      tenantId,sourceId,patientId,externalPatientId:'external-ext15',
      facilityId:'facility-a',matchStatus:'VERIFIED',
      consentStatus:'GRANTED',verifiedBy:'synthetic-registrar',
    }),
  ]);
  await ingestExternalFhirResource({
    db,actor:importer,sourceId,
    resource:observation('v1','2026-10-20T12:00:00Z',1.2),
  });
  await rebuildExternalPatient360({db,actor:importer,tenantId,patientId});
  const read=await readExternalClinicalEvidence({
    db,actor:clinician,tenantId,patientId,
  });
  const review:ExternalClinicianReviewInput={
    idempotencyKey:randomUUID(),
    expectedProjectionRevision:read.projectionRevision,
    expectedProjectionContentHash:read.projectionContentHash,
    expectedSourceCheckpoint:read.sourceCheckpoint,
    expectedFacts:read.facts.map(f=>({
      evidenceReceiptId:f.evidenceReceiptId,
      sourceVersionId:f.sourceVersionId,resourceHash:f.resourceHash,
    })),
    disposition:'SOURCE_EVIDENCE_REVIEWED',
  };
  const submit=(input:ExternalClinicianReviewInput=review,
    actor=clinician)=>readExternalClinicalEvidence({
      db,actor,tenantId,patientId,review:input,
    });
  return {db,root,source,link,tenantId,patientId,sourceId,
    importer,clinician,review,submit};
}

test('CI-EXT-15 atomic clinician review, immutable event, HELD delivery and replay',async()=>{
  const f=await fixture();
  try{
    const first=await f.submit();
    expect(first.review?.replay).toBe(false);
    expect(first.review?.clinicalUseAuthorized).toBe(false);
    expect(first.review?.aiDraftingEligible).toBe(false);
    expect(first.facts[0].clinicalVerification).toBe('UNVERIFIED_EXTERNAL');
    const reviews=await f.root.collection('externalClinicianEvidenceReviews').get();
    expect(reviews.size).toBe(1);
    expect(reviews.docs[0].get('immutable')).toBe(true);
    expect(reviews.docs[0].get('clinicalUseAuthorized')).toBe(false);
    expect(reviews.docs[0].get('evidenceOnly')).toBe(true);
    expect(reviews.docs[0].get('factRefs').length).toBe(1);
    expect(reviews.docs[0].get('authorityFenceHash').length).toBe(64);
    const events=await f.root.collection('externalClinicianEvidenceReviewEvents').get();
    expect(events.size).toBe(1);
    expect(events.docs[0].get('eventType')).toBe('EXTERNAL_CLINICIAN_EVIDENCE_REVIEW_RECORDED');
    const outbox=await f.root.collection('externalClinicianEvidenceReviewOutbox').get();
    expect(outbox.size).toBe(1);
    expect(outbox.docs[0].get('status')).toBe('HELD');
    expect(outbox.docs[0].get('aiDraftingEligible')).toBe(false);
    expect((await f.root.collection('patient360Projections').get()).size).toBe(0);
    const replay=await f.submit();
    expect(replay.review?.replay).toBe(true);
    expect(replay.review?.reviewId).toBe(first.review?.reviewId);
    expect((await f.root.collection('externalClinicianEvidenceReviews').get()).size).toBe(1);
    await expect(f.submit({...f.review,
      disposition:'CLINICAL_CONCERN_RECORDED'}))
      .rejects.toThrow('CI_EXT15_IDEMPOTENCY_CONFLICT');
    expect((await f.root.collection('externalClinicianEvidenceReviewEvents').get()).size).toBe(1);
    expect((await f.root.collection('externalClinicianEvidenceReviewOutbox').get()).size).toBe(1);
  }finally{await f.db.recursiveDelete(f.root);}
},45000);

test('CI-EXT-15 independent clinician RBAC, identity and snapshot validation',async()=>{
  const f=await fixture();
  try{
    await expect(f.submit(f.review,{
      ...f.clinician,roles:['SYSTEM_ADMIN'],
    })).rejects.toThrow('CI_EXT15_CLINICIAN_ROLE_REQUIRED');
    await expect(f.submit(f.review,{
      ...f.clinician,permissions:['FHIR_EVIDENCE_REVIEW'],
    })).rejects.toThrow('CI_EXT15_EXPLICIT_REVIEW_PERMISSION_REQUIRED');
    await expect(f.submit(f.review,{
      ...f.clinician,tenantId:'other-tenant',
    })).rejects.toThrow('CI_EXT03_TENANT_ACCESS_DENIED');
    await expect(f.submit(f.review,{
      ...f.clinician,facilityIds:['other-facility'],
    })).rejects.toThrow('CI_EXT03_FACILITY_OR_SOURCE_ACCESS_DENIED');
    await expect(f.submit(f.review,{
      ...f.clinician,actorId:f.importer.actorId,
    })).rejects.toThrow('CI_EXT15_INDEPENDENT_CLINICIAN_REQUIRED');
    await expect(f.submit({...f.review,
      expectedFacts:[{...f.review.expectedFacts[0],resourceHash:'f'.repeat(64)}],
    })).rejects.toThrow('CI_EXT15_EVIDENCE_SNAPSHOT_STALE');
    await expect(f.submit({...f.review,idempotencyKey:'not-a-uuid'}))
      .rejects.toThrow('CI_EXT15_REQUEST_INVALID');
    await expect(f.submit({...f.review,unexpectedField:'PHI'} as never))
      .rejects.toThrow('CI_EXT15_REQUEST_INVALID');
    expect((await f.root.collection('externalClinicianEvidenceReviews').get()).size).toBe(0);
    expect((await f.root.collection('externalClinicianEvidenceReviewEvents').get()).size).toBe(0);
    expect((await f.root.collection('externalClinicianEvidenceReviewOutbox').get()).size).toBe(0);
  }finally{await f.db.recursiveDelete(f.root);}
},45000);

test('CI-EXT-15 consent/source revisions, patient relink, and new import invalidate review',async()=>{
  const f=await fixture();
  try{
    await f.submit();
    await f.link.update({consentStatus:'WITHDRAWN'});
    await expect(f.submit()).rejects.toThrow('CI_EXT03_PATIENT_LINK_OR_CONSENT_REVOKED');
    await f.link.update({consentStatus:'GRANTED'});
    await expect(f.submit()).rejects.toThrow('CI_EXT15_IDEMPOTENCY_CONFLICT');
    const afterConsent={...f.review,idempotencyKey:randomUUID()};
    await f.submit(afterConsent);
    await f.source.update({status:'REVOKED'});
    await expect(f.submit(afterConsent)).rejects.toThrow('CI_EXT03_SOURCE_REVOKED');
    await f.source.update({status:'ACTIVE'});
    await expect(f.submit(afterConsent)).rejects.toThrow('CI_EXT15_IDEMPOTENCY_CONFLICT');
    const afterSource={...f.review,idempotencyKey:randomUUID()};
    await f.submit(afterSource);
    await f.link.update({matchStatus:'PENDING'});
    await expect(f.submit(afterSource)).rejects.toThrow('CI_EXT03_PATIENT_LINK_OR_CONSENT_REVOKED');
    await f.link.update({matchStatus:'VERIFIED'});
    await f.source.update({siteApprovalId:'revised-site-authority'});
    await expect(f.submit(afterSource)).rejects.toThrow('CI_EXT15_IDEMPOTENCY_CONFLICT');
    await ingestExternalFhirResource({
      db:f.db,actor:f.importer,sourceId:f.sourceId,
      resource:observation('v2','2026-10-21T12:00:00Z',1.7),
    });
    await expect(f.submit()).rejects.toThrow('CI_EXT03_PROJECTION_FACT_LINEAGE_INVALID');
    await rebuildExternalPatient360({
      db:f.db,actor:f.importer,tenantId:f.tenantId,patientId:f.patientId,
    });
    await expect(f.submit({...f.review,idempotencyKey:randomUUID()}))
      .rejects.toThrow('CI_EXT15_EVIDENCE_SNAPSHOT_STALE');
    const source=await f.root.collection('externalPatient360Projections')
      .doc(f.patientId).get();
    expect(source.get('status')).toBe('EVIDENCE_ONLY');
    expect(source.get('dataQuality.externalEvidenceVerifiedByClinician')).toBe(false);
    expect((await f.root.collection('externalClinicianEvidenceReviews').get()).size).toBe(3);
    expect((await f.root.collection('externalClinicianEvidenceReviewOutbox').get()).size).toBe(3);
    expect((await f.root.collection('patient360Projections').get()).size).toBe(0);
  }finally{await f.db.recursiveDelete(f.root);}
},60000);


test('CI-EXT-16 reader transaction denies unissued credentials, stale review and withdrawn consent',async()=>{
  const f=await fixture();
  try{
    const recorded=await f.submit();
    const reviewId=recorded.review?.reviewId;
    expect(typeof reviewId).toBe('string');
    const evaluate=()=>readExternalClinicalEvidence({
      db:f.db,actor:f.clinician,tenantId:f.tenantId,
      patientId:f.patientId,currentAuthorizationReviewId:reviewId,
    });
    const initial=await evaluate();
    expect(initial.currentAuthorization?.state).toBe('DENIED');
    expect(initial.currentAuthorization?.reasonCode)
      .toBe('CI_EXT16_REVIEWER_CREDENTIAL_NOT_CURRENT');
    expect(initial.currentAuthorization?.clinicalUseAuthorized).toBe(false);
    expect(initial.currentAuthorization?.aiDraftingEligible).toBe(false);
    await f.source.update({siteApprovalId:'revised-hospital-site-policy'});
    const stale=await evaluate();
    expect(stale.currentAuthorization?.reasonCode)
      .toBe('CI_EXT16_REVIEW_STALE_OR_CONTESTED');
    await f.link.update({consentStatus:'WITHDRAWN'});
    await expect(evaluate()).rejects.toThrow('CI_EXT03_PATIENT_LINK_OR_CONSENT_REVOKED');
    expect((await f.root.collection('patient360Projections').get()).size).toBe(0);
    expect((await f.root.collection('externalClinicalFactApprovalHeads').get()).size).toBe(0);
  }finally{await f.db.recursiveDelete(f.root);}
},60000);


test('CI-EXT-17 exact-event issuance, idempotency, non-promotion, emergency revocation',async()=>{
  const f=await fixture();
  try{
    const reviewed=await f.submit();
    const reviewId=reviewed.review?.reviewId;
    if(!reviewId)throw new Error('CI_EXT17_SYNTHETIC_REVIEW_MISSING');
    const now=Date.now();
    const cred=(actorId:string)=>({
      tenantId:f.tenantId,actorId,facilityIds:['facility-a'],
      status:'VERIFIED',identityAssurance:'HOSPITAL_VERIFIED',
      licenseVerified:true,revision:1,validFrom:now-60_000,
      validUntil:now+900_000,revokedAt:null,
    });
    const approver={
      ...f.clinician,actorId:'independent-fact-approver',
      permissions:['FHIR_EVIDENCE_REVIEW','FHIR_CLINICAL_FACT_APPROVE'],
    };
    const safetyOfficer={
      ...f.clinician,actorId:'clinical-safety-officer',
      roles:['CLINICAL_SAFETY_OFFICER'],
      permissions:['FHIR_CLINICAL_FACT_REVOKE'],
    };
    await Promise.all([
      f.root.collection('externalClinicalCredentialHeads')
        .doc(f.clinician.actorId).set(cred(f.clinician.actorId)),
      f.root.collection('externalClinicalCredentialHeads')
        .doc(approver.actorId).set(cred(approver.actorId)),
      f.root.collection('externalClinicalSiteAuthorityHeads')
        .doc(f.sourceId).set({
          tenantId:f.tenantId,sourceId:f.sourceId,facilityId:'facility-a',
          siteApprovalId:'site-approved-v1',status:'APPROVED',
          clinicalUseReviewStatus:'APPROVED',
          revision:1,validFrom:now-60_000,validUntil:now+900_000,
          revokedAt:null,
        }),
    ]);
    const fact=reviewed.facts[0];
    const issueCommand={
      reviewId,evidenceReceiptId:fact.evidenceReceiptId,
      sourceVersionId:fact.sourceVersionId,resourceHash:fact.resourceHash,
      idempotencyKey:randomUUID(),
    };
    const issue=async(cmd=issueCommand,actor=approver)=>
      readExternalClinicalEvidence({
        db:f.db,actor,tenantId:f.tenantId,patientId:f.patientId,
        factApprovalIssue:cmd,
      });
    const first=await issue();
    expect(first.factApproval?.status).toBe('APPROVED');
    expect(first.factApproval?.replay).toBe(false);
    expect(first.factApproval?.clinicalUseAuthorized).toBe(false);
    expect(first.factApproval?.aiDraftingEligible).toBe(false);
    const replay=await issue();
    expect(replay.factApproval?.replay).toBe(true);
    const headId=externalFactApprovalHeadId(reviewId,fact.evidenceReceiptId);
    const heads=f.root.collection('externalClinicalFactApprovalHeads');
    const events=f.root.collection('externalClinicalFactApprovalEvents');
    const head=await heads.doc(headId).get();
    expect(head.get('revision')).toBe(1);
    expect(head.get('status')).toBe('APPROVED');
    expect((await events.get()).size).toBe(1);
    expect((await f.root.collection('externalClinicalFactApprovalOutbox').get()).size).toBe(1);
    const current=await readExternalClinicalEvidence({
      db:f.db,actor:f.clinician,tenantId:f.tenantId,
      patientId:f.patientId,currentAuthorizationReviewId:reviewId,
    });
    expect(current.currentAuthorization?.state).toBe('PREQUALIFIED_NON_PROMOTING');
    expect(current.currentAuthorization?.clinicalUseAuthorized).toBe(false);
    expect(current.currentAuthorization?.aiDraftingEligible).toBe(false);
    await expect(issue({...issueCommand,idempotencyKey:randomUUID()}))
      .rejects.toThrow('CI_EXT17_ALREADY_ISSUED_REQUIRES_NEW_REVIEW');
    await f.source.update({status:'REVOKED'});
    await f.link.update({consentStatus:'WITHDRAWN'});
    await expect(issue()).rejects.toThrow('CI_EXT03_SOURCE_REVOKED');
    const revokeCommand={
      reviewId,evidenceReceiptId:fact.evidenceReceiptId,
      expectedRevision:1,idempotencyKey:randomUUID(),
      reasonCode:'SAFETY_CONCERN' as const,
    };
    const revoked=await revokeExternalFactApproval({
      db:f.db,actor:safetyOfficer,tenantId:f.tenantId,
      patientId:f.patientId,command:revokeCommand,
    });
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.revision).toBe(2);
    expect(revoked.clinicalUseAuthorized).toBe(false);
    const again=await revokeExternalFactApproval({
      db:f.db,actor:safetyOfficer,tenantId:f.tenantId,
      patientId:f.patientId,command:revokeCommand,
    });
    expect(again.replay).toBe(true);
    expect((await events.get()).size).toBe(2);
    expect((await f.root.collection('externalClinicalFactApprovalOutbox').get()).size).toBe(2);
    const updated=await heads.doc(headId).get();
    expect(updated.get('status')).toBe('REVOKED');
    expect(updated.get('revision')).toBe(2);
    expect(updated.get('previousEventId')).toBe(first.factApproval?.eventId);
    expect((await f.root.collection('patient360Projections').get()).size).toBe(0);
    expect((await f.root.collection('externalPatient360Projections').doc(f.patientId)
      .get()).get('dataQuality.externalEvidenceVerifiedByClinician')).toBe(false);
  }finally{await f.db.recursiveDelete(f.root);}
},90000);

test('CI-EXT-17 denies uncredentialed or non-independent issuance without writes',async()=>{
  const f=await fixture();
  try{
    const recorded=await f.submit();
    const fact=recorded.facts[0];
    const reviewId=recorded.review?.reviewId||'';
    const cmd={
      reviewId,evidenceReceiptId:fact.evidenceReceiptId,
      sourceVersionId:fact.sourceVersionId,resourceHash:fact.resourceHash,
      idempotencyKey:randomUUID(),
    };
    const unauthorized={...f.clinician,actorId:'fake-approver',
      permissions:['FHIR_EVIDENCE_REVIEW','FHIR_CLINICAL_FACT_APPROVE']};
    await expect(readExternalClinicalEvidence({
      db:f.db,actor:unauthorized,tenantId:f.tenantId,
      patientId:f.patientId,factApprovalIssue:cmd,
    })).rejects.toThrow('CI_EXT17_CLINICIAN_CREDENTIAL_NOT_CURRENT');
    await expect(readExternalClinicalEvidence({
      db:f.db,actor:{...f.clinician,
        permissions:['FHIR_EVIDENCE_REVIEW','FHIR_CLINICAL_FACT_APPROVE']},
      tenantId:f.tenantId,patientId:f.patientId,factApprovalIssue:cmd,
    })).rejects.toThrow('CI_EXT17_REVIEW_STALE_OR_NOT_INDEPENDENT');
    await expect(readExternalClinicalEvidence({
      db:f.db,actor:unauthorized,tenantId:f.tenantId,
      patientId:f.patientId,
      factApprovalIssue:{...cmd,resourceHash:'0'.repeat(64)},
    })).rejects.toThrow('CI_EXT17_FACT_VERSION_STALE');
    expect((await f.root.collection('externalClinicalFactApprovalEvents').get()).size).toBe(0);
    expect((await f.root.collection('externalClinicalFactApprovalHeads').get()).size).toBe(0);
    expect((await f.root.collection('externalClinicalFactApprovalOutbox').get()).size).toBe(0);
  }finally{await f.db.recursiveDelete(f.root);}
},60000);
