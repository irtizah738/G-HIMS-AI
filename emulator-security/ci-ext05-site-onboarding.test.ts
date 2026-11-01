import { test, expect } from 'bun:test';
import { getAdminFirestore } from '@/server/firebase/admin';
import { preflightFhirSiteApproval } from '@/lib/interop/fhir-site-approval';
import { assertFhirSource } from '@/lib/clinical/intelligence/external-fhir-import';
import {
  activateFhirSiteRequest, requestFhirSiteReview,
  reviewFhirSiteRequest, suspendFhirSite,
} from '@/lib/interop/fhir-site-onboarding';

test('CI-EXT-05: qualified evidence, four distinct identities, immutable decisions and suspension',async()=>{
  if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080' ||
     process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci') throw Error('CI_EXT05_EMULATOR_ONLY');
  const db=getAdminFirestore();if(!db)throw Error('CI_EXT05_DB_MISSING');
  const tenantId='ext05-'+crypto.randomUUID().slice(0,12);
  const sourceId='synthetic-his',facilityId='synthetic-facility';
  const root=db.collection('tenants').doc(tenantId);
  const protocolQualificationId='protocol-1',syntheticEvidenceId='synthetic-1';
  const sourceRef=root.collection('fhirSources').doc(sourceId);
  const now=Date.now();
  const actor=(id:string,grant:string)=>({
    tenantId,actorId:id,roles:[] as string[],permissions:[grant],facilityIds:[facilityId],
  });
  const requester=actor('operator-request','FHIR_SITE_REQUEST');
  const clinician=actor('clinician-review','FHIR_SITE_CLINICAL_APPROVE');
  const security=actor('security-review','FHIR_SITE_SECURITY_APPROVE');
  const activator=actor('operator-activation','FHIR_SITE_ACTIVATE');
  const suspension=actor('security-suspend','FHIR_SITE_SUSPEND');
  try {
    await Promise.all([
      sourceRef.set({
        tenantId,sourceId,facilityId,baseUrl:'https://example.test/fhir',
        status:'ACTIVE',securityReviewStatus:'APPROVED',
        approvedResourceTypes:['Patient','Encounter','Observation'],
        oauth:{mode:'SMART_BACKEND',clientId:'source-client',
          keyId:'synthetic-key',secretVersion:1,credentialRevision:1,
          tokenUrl:'https://auth.example.test/token',
          scopes:['system/Patient.rs','system/Encounter.rs','system/Observation.rs']},
      }),
      root.collection('fhirSandboxQualifications').doc(protocolQualificationId).set({
        qualificationId:protocolQualificationId,tenantId,sourceId,facilityId,
        credentialRevision:1,checkedAt:now-1000,
        protocolOutcome:'PROTOCOL_PASSED_SITE_PENDING',
        smartDiscoveryVerified:true,fhirR4CapabilityVerified:true,
        capabilities:{Patient:true,Encounter:true,Observation:true},
        qualifiedForPatientData:false,qualifiedForProduction:false,immutable:true,
      }),
    ]);
    const requestArgs={
      db,actor:requester,sourceId,protocolQualificationId,syntheticEvidenceId,
      resourceTypes:['Observation'] as Array<'Patient'|'Encounter'|'Observation'>,
      now:()=>now,
    };
    await expect(requestFhirSiteReview(requestArgs)).rejects.toThrow(
      'CI_EXT05_SYNTHETIC_SITE_EVIDENCE_REQUIRED');
    expect((await root.collection('fhirSiteReviewRequests').get()).size).toBe(0);
    await root.collection('fhirSyntheticQualifications').doc(syntheticEvidenceId).set({
      evidenceId:syntheticEvidenceId,tenantId,sourceId,facilityId,credentialRevision:1,
      protocolQualificationId,outcome:'PASS',syntheticOnly:true,
      identityMatchQualified:true,replayQualified:true,
      consentWithdrawalQualified:true,isolationQualified:true,
      networkRecoveryQualified:true,reviewerId:'synthetic-independent-reviewer',
      checkedAt:now-1000,expiresAt:now+10*86400_000,immutable:true,
    });
    const first=await requestFhirSiteReview(requestArgs);
    expect(first.status).toBe('PENDING');
    expect(first.replay).toBe(false);
    const repeated=await requestFhirSiteReview(requestArgs);
    expect(repeated.replay).toBe(true);
    await expect(activateFhirSiteRequest({
      db,actor:activator,requestId:first.requestId,now:()=>now,
    })).rejects.toThrow('CI_EXT05_INDEPENDENT_REVIEWS_REQUIRED');
    const rationale='Independent review of synthetic source evidence and consent.';
    await expect(reviewFhirSiteRequest({
      db,actor:{...requester,permissions:['FHIR_SITE_CLINICAL_APPROVE']},
      requestId:first.requestId,kind:'CLINICAL',rationale,now:()=>now,
    })).rejects.toThrow('CI_EXT05_INDEPENDENCE_REQUIRED');
    const review1=await reviewFhirSiteRequest({
      db,actor:clinician,requestId:first.requestId,kind:'CLINICAL',rationale,now:()=>now,
    });
    expect(review1.replay).toBe(false);
    const replayReview=await reviewFhirSiteRequest({
      db,actor:clinician,requestId:first.requestId,kind:'CLINICAL',rationale,now:()=>now,
    });
    expect(replayReview.replay).toBe(true);
    await expect(reviewFhirSiteRequest({
      db,actor:{...clinician,permissions:['FHIR_SITE_SECURITY_APPROVE']},
      requestId:first.requestId,kind:'SECURITY',rationale,now:()=>now,
    })).rejects.toThrow('CI_EXT05_INDEPENDENCE_REQUIRED');
    await reviewFhirSiteRequest({
      db,actor:security,requestId:first.requestId,kind:'SECURITY',rationale,now:()=>now,
    });
    await expect(activateFhirSiteRequest({
      db,actor:{...clinician,permissions:['FHIR_SITE_ACTIVATE']},
      requestId:first.requestId,now:()=>now,
    })).rejects.toThrow('CI_EXT05_INDEPENDENT_REVIEWS_REQUIRED');
    const activated=await activateFhirSiteRequest({
      db,actor:activator,requestId:first.requestId,now:()=>now,
    });
    expect(activated.replay).toBe(false);
    expect((await root.collection('fhirSiteApprovals').get()).size).toBe(1);
    const replayActivation=await activateFhirSiteRequest({
      db,actor:activator,requestId:first.requestId,now:()=>now,
    });
    expect(replayActivation.replay).toBe(true);
    const approvedSource=(await sourceRef.get()).data()!;
    const live=await preflightFhirSiteApproval({
      db,source:approvedSource as never,resourceType:'Observation',now:()=>now,
    });
    expect(live.approvalId).toBe(activated.siteApprovalId);
    expect((await root.collection('fhirSiteReviewDecisions').get()).size).toBe(2);
    await expect(requestFhirSiteReview({
      ...requestArgs,actor:{...requester,tenantId:'another-hospital'},
    })).rejects.toThrow('CI_EXT05_SOURCE_OR_FACILITY_DENIED');
    const suspended=await suspendFhirSite({
      db,actor:suspension,sourceId,
      reason:'Approved hospital operator requests immediate integration suspension',
      now:()=>now,
    });
    expect(suspended.suspended).toBe(true);
    const suspendedSource=(await sourceRef.get()).data()!;
    expect(()=>assertFhirSource(
      suspendedSource as never,tenantId,sourceId,activator,'Observation',
    )).toThrow('FHIR_IMPORT_SOURCE_NOT_AUTHORIZED');
    const again=await suspendFhirSite({
      db,actor:suspension,sourceId,
      reason:'Approved hospital operator requests immediate integration suspension',
      now:()=>now,
    });
    expect(again.replay).toBe(true);
    expect((await root.collection('fhirSiteReviewEvents').get()).size).toBe(3);
  } finally {
    await db.recursiveDelete(root);
  }
},35000);
