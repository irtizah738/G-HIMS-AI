/**
 * CI-EXT-13: synthetic-only persistent encrypted source work manifests.
 * Uses an ephemeral in-process test cipher, NEVER a real KMS grant/PHI.
 */
import { test, expect } from 'bun:test';
import {
  randomUUID, randomBytes, createCipheriv, createDecipheriv, createHash,
} from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { fhirPatientLinkId, type FhirImportActor } from '@/lib/clinical/intelligence/external-fhir-import';
import {
  sealFhirPollManifest, openFhirPollManifest, runPersistedSyntheticFhirPoll,
  type FhirPollManifestCipher,
} from '@/lib/clinical/intelligence/external-fhir-encrypted-poll-manifest';
import type { SyntheticPollManifest } from '@/lib/clinical/intelligence/external-fhir-synthetic-poll-runner';

const sourceId='synthetic-source';
const facilityId='synthetic-facility';
const patientId='synthetic-patient';
const baseUrl='https://synthetic-only.example.test/fhir/R4';
function isolatedDb() {
  if (process.env.GHIMS_RUNTIME_MODE!=='TEST' ||
      process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080' ||
      process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE!=='DISABLED' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED!=='false') {
    throw new Error('CI_EXT13_EMULATOR_ONLY');
  }
  const db=getAdminFirestore();
  if(!db)throw new Error('CI_EXT13_ADMIN_MISSING');
  return db;
}
function sha(s:string) {
  return createHash('sha256').update(s).digest('hex');
}
function testCipher(): FhirPollManifestCipher {
  const key=randomBytes(32);
  const wrapped=Buffer.from(sha(key.toString('base64')),'hex').toString('base64');
  return {
    provider:'SYNTHETIC_EMULATOR_ONLY',
    async encrypt(plaintext,aad) {
      const iv=randomBytes(12);
      const aes=createCipheriv('aes-256-gcm',key,iv);
      aes.setAAD(Buffer.from(aad));
      const cipher=Buffer.concat([aes.update(Buffer.from(plaintext)),aes.final()]);
      return {
        suite:'AES-256-GCM' as const,
        ivB64:iv.toString('base64'),
        tagB64:aes.getAuthTag().toString('base64'),
        ciphertextB64:cipher.toString('base64'),
        wrappedDekB64:wrapped,
        keyVersion:'synthetic-emulator-only',
      };
    },
    async decrypt(envelope,aad) {
      if(envelope.wrappedDekB64!==wrapped)throw new Error('CI_EXT13_TEST_KEY_MISMATCH');
      const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.ivB64,'base64'));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(envelope.tagB64,'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertextB64,'base64')),decipher.final(),
      ]);
    },
  };
}
function manifest(start:number, resourceId='lab-a'): SyntheticPollManifest {
  return {manifestId:randomUUID(),sourceId,startCheckpointSequence:start,
    items:[{workId:randomUUID(),resourceType:'Observation',resourceId,expectedVersionId:'opaque-v1'}]};
}
function observation(resourceId:string) {
  return {resourceType:'Observation',id:resourceId,status:'final',
    meta:{versionId:'opaque-v1',lastUpdated:'2026-10-20T09:00:00Z'},
    subject:{reference:'Patient/external-patient'},
    code:{coding:[{system:'http://loinc.org',code:'2160-0'}]},
    valueQuantity:{value:1.1,system:'http://unitsofmeasure.org',code:'mg/dL'}};
}
async function fixture() {
  const db=isolatedDb();
  const tenantId='encrypted-manifest-'+randomUUID().slice(0,10);
  const root=db.collection('tenants').doc(tenantId);
  const actor:FhirImportActor={
    actorId:'synthetic-worker',tenantId,roles:[],
    permissions:['FHIR_IMPORT','FHIR_POLL_COORDINATE'],
    facilityIds:[facilityId],
  };
  await Promise.all([
    root.collection('patients').doc(patientId).set({tenantId,status:'ACTIVE'}),
    root.collection('fhirSources').doc(sourceId).set({
      tenantId,sourceId,facilityId,baseUrl,
      status:'ACTIVE',securityReviewStatus:'APPROVED',
      approvedResourceTypes:['Patient','Encounter','Observation'],
      syncMode:'FENCED',
    }),
    root.collection('fhirPatientLinks')
      .doc(fhirPatientLinkId(sourceId,'external-patient')).set({
        tenantId,sourceId,facilityId,patientId,
        externalPatientId:'external-patient',
        matchStatus:'VERIFIED',consentStatus:'GRANTED',
      }),
  ]);
  return {db,tenantId,root,actor};
}

test('CI-EXT-13: encrypted manifest is tenant scoped, immutable, replay safe and tamper evident',async()=>{
  const {db,root,tenantId,actor}=await fixture();
  const cipher=testCipher();
  const approved=manifest(0);
  try{
    const first=await sealFhirPollManifest({db,actor,manifest:approved,cipher});
    expect(first.replay).toBe(false);
    const saved=await root.collection('fhirPollManifests').doc(approved.manifestId).get();
    expect(saved.get('status')).toBe('SEALED');
    expect(saved.get('cipherProvider')).toBe('SYNTHETIC_EMULATOR_ONLY');
    expect(saved.get('itemCount')).toBe(1);
    expect(saved.get('encrypted.suite')).toBe('AES-256-GCM');
    const stored=JSON.stringify(saved.data());
    expect(stored.includes('lab-a')).toBe(false);
    expect(stored.includes('opaque-v1')).toBe(false);
    const opened=await openFhirPollManifest({
      db,actor,manifestId:approved.manifestId,sourceId,cipher,
    });
    expect(opened).toEqual(approved);
    expect((await sealFhirPollManifest({db,actor,manifest:approved,cipher})).replay).toBe(true);
    expect((await root.collection('fhirPollManifestEvents').get()).size).toBe(1);
    expect((await root.collection('fhirPollManifestOutbox').get()).docs[0].get('status')).toBe('HELD');

    await expect(sealFhirPollManifest({
      db,actor,cipher,manifest:{...approved,items:[
        {...approved.items[0],expectedVersionId:'different-version'},
      ]},
    })).rejects.toThrow('FHIR_MANIFEST_REPLAY_CONFLICT');
    await expect(openFhirPollManifest({
      db,actor:{...actor,tenantId:'unrelated-tenant'},
      manifestId:approved.manifestId,sourceId,cipher,
    })).rejects.toThrow();
    await expect(openFhirPollManifest({
      db,actor:{...actor,facilityIds:['other-site']},
      manifestId:approved.manifestId,sourceId,cipher,
    })).rejects.toThrow('FHIR_IMPORT_FACILITY_ACCESS_DENIED');
    await expect(openFhirPollManifest({
      db,actor:{...actor,permissions:['FHIR_IMPORT']},
      manifestId:approved.manifestId,sourceId,cipher,
    })).rejects.toThrow('FHIR_MANIFEST_COORDINATION_PERMISSION_REQUIRED');

    const encrypted=saved.get('encrypted');
    const altered={...encrypted,
      ciphertextB64: (encrypted.ciphertextB64[0]==='A'?'B':'A')+encrypted.ciphertextB64.slice(1)};
    await saved.ref.update({encrypted:altered});
    await expect(openFhirPollManifest({
      db,actor,manifestId:approved.manifestId,sourceId,cipher,
    })).rejects.toThrow('FHIR_MANIFEST_CIPHERTEXT_DIGEST_INVALID');
    // Isolated fault injection: restore only this synthetic fixture.
    await saved.ref.update({encrypted});
    expect((await openFhirPollManifest({
      db,actor,manifestId:approved.manifestId,sourceId,cipher,
    })).manifestId).toBe(approved.manifestId);
    expect((await root.collection('patient360Projections').get()).empty).toBe(true);
    expect(tenantId.startsWith('encrypted-manifest-')).toBe(true);
  }finally{await db.recursiveDelete(root);}
},45000);

test('CI-EXT-13: persisted encrypted workplan drives synthetic fenced polling and advances manifest head',async()=>{
  const {db,root,actor}=await fixture();
  const cipher=testCipher();
  const first=manifest(0,'lab-a');
  try{
    await sealFhirPollManifest({db,actor,manifest:first,cipher});
    const result=await runPersistedSyntheticFhirPoll({
      db,actor,sourceId,manifestId:first.manifestId,cipher,
      readFixture:async item=>observation(item.resourceId),
    });
    expect(result.status).toBe('COMPLETED');
    expect(result.checkpointSequence).toBe(1);
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(1);
    const repeat=await runPersistedSyntheticFhirPoll({
      db,actor,sourceId,manifestId:first.manifestId,cipher,
      readFixture:async()=>{throw new Error('COMPLETED_WORK_MUST_NOT_REFETCH');},
    });
    expect(repeat.processed).toBe(0);

    const next=manifest(1,'lab-b');
    expect((await sealFhirPollManifest({db,actor,manifest:next,cipher})).replay).toBe(false);
    await expect(openFhirPollManifest({
      db,actor,sourceId,manifestId:first.manifestId,cipher,
    })).rejects.toThrow('FHIR_MANIFEST_NOT_ACTIVE_FOR_SOURCE');
    const second=await runPersistedSyntheticFhirPoll({
      db,actor,sourceId,manifestId:next.manifestId,cipher,
      readFixture:async item=>observation(item.resourceId),
    });
    expect(second.checkpointSequence).toBe(2);
    expect((await root.collection('fhirImportedVersions').get()).size).toBe(2);
    expect((await root.collection('fhirPollManifests').get()).size).toBe(2);
    expect((await root.collection('fhirPollManifestEvents').get()).size).toBe(2);
    expect((await root.collection('patient360Projections').get()).empty).toBe(true);
  }finally{await db.recursiveDelete(root);}
},45000);

test('CI-EXT-13: manifest registration cannot change an uncheckpointed source workplan',async()=>{
  const {db,root,actor}=await fixture();
  const cipher=testCipher();
  const first=manifest(0,'lab-c');
  const attempted=manifest(0,'lab-d');
  try{
    await sealFhirPollManifest({db,actor,manifest:first,cipher});
    await expect(sealFhirPollManifest({db,actor,manifest:attempted,cipher}))
      .rejects.toThrow('FHIR_MANIFEST_PREVIOUS_WORK_NOT_COMPLETE');
    expect((await root.collection('fhirPollManifests').get()).size).toBe(1);
    expect((await root.collection('fhirPollManifestHeads').doc(sourceId).get())
      .get('manifestId')).toBe(first.manifestId);
  }finally{await db.recursiveDelete(root);}
},45000);
