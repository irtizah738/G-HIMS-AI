/**
 * CI-EXT-04: real Firestore emulator enforcement of OAuth revision fencing.
 * No network OAuth calls and no real identities or patient records are used.
 */
import { test, expect } from 'bun:test';
import { getAdminFirestore } from '@/server/firebase/admin';
import { ingestExternalFhirResource, fhirPatientLinkId } from '@/lib/clinical/intelligence/external-fhir-import';

test('CI-EXT-04: source key rotation invalidates in-flight FHIR imports', async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci') {
    throw new Error('CI_EXT04_EMULATOR_ISOLATION_DENIED');
  }
  const db = getAdminFirestore();
  if (!db) throw new Error('CI_EXT04_EMULATOR_ADMIN_UNAVAILABLE');
  const tenantId='ext04-' + crypto.randomUUID().slice(0,12);
  const sourceId='site-his-a';
  const patientId='synthetic-p1';
  const root=db.collection('tenants').doc(tenantId);
  const source=root.collection('fhirSources').doc(sourceId);
  const actor={tenantId,actorId:'test-importer',
    permissions:['FHIR_IMPORT'],roles:[] as string[],facilityIds:['site-one']};
  const obs=(v:string)=>({
    resourceType:'Observation',id:'obs-1',
    meta:{versionId:v,lastUpdated:'2026-10-21T12:00:00Z'},
    subject:{reference:'Patient/vendor-123'},status:'final',
    code:{coding:[{system:'http://loinc.org',code:'2160-0'}]},
    valueQuantity:{value:1.2,system:'http://unitsofmeasure.org',code:'mg/dL'},
  });
  try {
    await Promise.all([
      root.collection('patients').doc(patientId).set({tenantId,patientId,status:'ACTIVE'}),
      root.collection('fhirPatientLinks')
        .doc(fhirPatientLinkId(sourceId,'vendor-123'))
        .set({tenantId,sourceId,patientId,externalPatientId:'vendor-123',
          facilityId:'site-one',matchStatus:'VERIFIED',consentStatus:'GRANTED'}),
      source.set({
        tenantId,sourceId,facilityId:'site-one',
        baseUrl:'https://fhir.sandbox.example.test/r4',
        status:'ACTIVE',securityReviewStatus:'APPROVED',
        approvedResourceTypes:['Patient','Encounter','Observation'],
        oauth:{mode:'SMART_BACKEND',clientId:'sandbox-client',
          tokenUrl:'https://auth.sandbox.example.test/token',keyId:'key-1',
          secretVersion:1,credentialRevision:1,
          scopes:['system/Observation.rs']},
      }),
    ]);
    await expect(ingestExternalFhirResource({
      db,actor,sourceId,resource:obs('v1'),expectedCredentialRevision:2,
    })).rejects.toThrow('FHIR_IMPORT_OAUTH_CONFIG_CHANGED');
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(0);
    const first=await ingestExternalFhirResource({
      db,actor,sourceId,resource:obs('v1'),expectedCredentialRevision:1,
    });
    expect(first.status).toBe('CURRENT');
    await source.update({'oauth.credentialRevision':2,'oauth.secretVersion':2,'oauth.keyId':'key-2'});
    await expect(ingestExternalFhirResource({
      db,actor,sourceId,resource:obs('v2'),expectedCredentialRevision:1,
    })).rejects.toThrow('FHIR_IMPORT_OAUTH_CONFIG_CHANGED');
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(1);
    const after=await ingestExternalFhirResource({
      db,actor,sourceId,resource:obs('v2'),expectedCredentialRevision:2,
    });
    expect(after.status).toBe('RECONCILIATION_REQUIRED');
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(2);
    await expect(ingestExternalFhirResource({
      db,actor:{...actor,tenantId:'unrelated-tenant'},sourceId,resource:obs('v3'),
    })).rejects.toThrow('FHIR_IMPORT_SOURCE_NOT_AUTHORIZED');
  } finally {
    await db.recursiveDelete(root);
  }
},30000);
