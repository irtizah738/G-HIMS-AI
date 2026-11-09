/**
 * CI-EXT-24: independent verifiers, signed trust handoff, all emulator-only.
 * No real registry lookup, hospital credential, patient data, or delivery.
 */
import {expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {getAdminFirestore} from '@/server/firebase/admin';
import {syntheticTrustLifecycle} from
  '@/tests/support/ci-ext22-trust-anchor-fixtures';
import {syntheticInstitutionalVerifierBundle,
  syntheticDistributionBundle} from
  '@/tests/support/ci-ext24-institutional-fixtures';
import {enrollInstitutionalEvidenceDossier,
  inspectInstitutionalEvidenceDossier} from
  '@/lib/clinical/intelligence/external-institutional-verification';
import {stageTrustDistributionHandoff} from
  '@/lib/clinical/intelligence/external-trust-distribution';
import {applyHospitalTrustLifecycle} from
  '@/lib/clinical/intelligence/external-hospital-trust-anchor';

async function fixture(){
  if(process.env.GHIMS_RUNTIME_MODE!=='TEST'||
    process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
    process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
    process.env.GHIMS_CI_EXTERNAL_TRUST_LIFECYCLE_ENABLED!=='true'||
    process.env.GHIMS_CI_EXTERNAL_INSTITUTIONAL_VERIFICATION_ENABLED!=='true'||
    process.env.GHIMS_CI_EXTERNAL_TRUST_DISTRIBUTION_ENABLED!=='true')
    throw Error('CI_EXT24_EMULATOR_ONLY');
  const db=getAdminFirestore();
  if(!db)throw Error('CI_EXT24_DB_UNAVAILABLE');
  const tenantId='ext24-'+randomUUID().slice(0,12);
  const tenant=db.collection('tenants').doc(tenantId);
  const now=Date.now();
  const root=syntheticTrustLifecycle(tenantId,now);
  const bundle=syntheticInstitutionalVerifierBundle({
    tenantId,facilityId:root.facilityId,issuerId:root.issuerId,
    now,stewards:root.stewards,
  });
  const enrollment=()=>enrollInstitutionalEvidenceDossier({
    db,dossier:bundle.dossier,
    endorsements:bundle.endorsements,
    independentVerifierPins:bundle.independentVerifierPins,
  });
  const inspect=()=>db.runTransaction(tx=>inspectInstitutionalEvidenceDossier({
    tx,tenant,tenantId,facilityId:root.facilityId,issuerId:root.issuerId,
    now:Date.now(),independentVerifierPins:bundle.independentVerifierPins,
  }));
  const applyRoot=(command:ReturnType<typeof root.command>)=>
    applyHospitalTrustLifecycle({db,command,
      endorsements:root.approvals(command),
      independentlyPinnedStewards:root.stewards});
  const stage=(payload:ReturnType<typeof syntheticDistributionBundle>)=>
    stageTrustDistributionHandoff({
      db,manifest:payload.manifest,signatures:payload.signatures,
      independentDistributionPins:payload.independentDistributionPins,
      independentInstitutionPins:bundle.independentVerifierPins,
      independentStewardPins:root.stewards,
    });
  return {db,tenant,tenantId,root,bundle,enrollment,inspect,
    applyRoot,stage,now};
}
test('CI-EXT-24 five independent signatures enroll evidence only; changed facts and revocation deny',async()=>{
  const f=await fixture();
  try{
    expect((await f.inspect()).valid).toBe(false);
    const result=await f.enrollment();
    expect(result.replay).toBe(false);
    expect(result.institutionalIdentityCommissioned).toBe(false);
    expect(result.clinicalUseAuthorized).toBe(false);
    expect((await f.inspect()).valid).toBe(true);
    expect((await f.enrollment()).replay).toBe(true);
    expect((await f.tenant.collection('externalClinicalInstitutionalVerificationEvents').get()).size)
      .toBe(1);
    expect((await f.tenant.collection('externalClinicalInstitutionalVerificationOutbox').get()).size)
      .toBe(1);
    await expect(enrollInstitutionalEvidenceDossier({
      db:f.db,dossier:{...f.bundle.dossier,
        contractingAuthorityEvidenceDigest:'0'.repeat(64)},
      endorsements:f.bundle.endorsements,
      independentVerifierPins:f.bundle.independentVerifierPins,
    })).rejects.toThrow('CI_EXT24_SIGNED_EVIDENCE_INVALID');
    const compromised=f.bundle.independentVerifierPins.map((p,i)=>
      i===0?{...p,status:'REVOKED' as const}:p);
    const revoked=await f.db.runTransaction(tx=>
      inspectInstitutionalEvidenceDossier({
        tx,tenant:f.tenant,tenantId:f.tenantId,
        facilityId:f.root.facilityId,issuerId:f.root.issuerId,
        now:Date.now(),independentVerifierPins:compromised,
      }));
    expect(revoked.reasonCode).toBe('CI_EXT24_CURRENT_VERDICT_INVALID');
    expect((await f.tenant.collection('patient360Projections').get()).size)
      .toBe(0);
  }finally{await f.db.recursiveDelete(f.tenant);}
},90000);

test('CI-EXT-24 quarantines signed distribution only with current hospital root and institutional dossier',async()=>{
  const f=await fixture();
  try{
    const first=await f.applyRoot(f.root.command('ENROLL',0,0));
    const rootDoc=await f.tenant.collection('externalClinicalHospitalTrustHeads')
      .doc(f.root.issuerId).get();
    const pin=f.root.issuerPin(0,1);
    const institution=await f.enrollment();
    const manifest=syntheticDistributionBundle({
      tenantId:f.tenantId,facilityId:f.root.facilityId,
      issuerId:f.root.issuerId,now:f.now,pin,
      rootEventId:first.eventId,
      rootEventHash:rootDoc.get('currentEventHash'),
      rootRevision:1,dossierId:institution.dossierId,
      dossierDigest:rootDoc.get('currentEventHash')&&
        (await f.inspect()).dossierDigest||'0'.repeat(64),
    });
    const staged=await f.stage(manifest);
    expect(staged.staged).toBe(true);
    expect(staged.replay).toBe(false);
    expect(staged.delivered).toBe(false);
    expect(staged.clinicalUseAuthorized).toBe(false);
    expect((await f.stage(manifest)).replay).toBe(true);
    const bad={...manifest,
      signatures:[{...manifest.signatures[0],signatureBase64Url:'A'.repeat(86)},
        manifest.signatures[1]],
    };
    await expect(f.stage(bad)).rejects.toThrow(
      'CI_EXT24_DISTRIBUTION_SIGNATURE_INVALID');
    const next=syntheticDistributionBundle({
      tenantId:f.tenantId,facilityId:f.root.facilityId,
      issuerId:f.root.issuerId,now:f.now,pin,
      rootEventId:first.eventId,rootEventHash:rootDoc.get('currentEventHash'),
      rootRevision:1,dossierId:institution.dossierId,
      dossierDigest:(await f.inspect()).dossierDigest||'0'.repeat(64),
      sequence:2,
    });
    expect((await f.stage(next)).replay).toBe(false);
    await expect(f.stage(manifest)).rejects.toThrow(
      'CI_EXT24_DISTRIBUTION_REPLAY_CONFLICT');
    const rotated=await f.applyRoot(f.root.command('ROTATE',1,1));
    expect(rotated.revision).toBe(2);
    const stale=syntheticDistributionBundle({
      tenantId:f.tenantId,facilityId:f.root.facilityId,
      issuerId:f.root.issuerId,now:f.now,pin,
      rootEventId:first.eventId,rootEventHash:rootDoc.get('currentEventHash'),
      rootRevision:1,dossierId:institution.dossierId,
      dossierDigest:(await f.inspect()).dossierDigest||'0'.repeat(64),
      sequence:3,
    });
    await expect(f.stage(stale)).rejects.toThrow(
      'CI_EXT24_HANDOFF_ROOT_OR_DOSSIER_STALE');
    const revoked=await f.applyRoot(f.root.command('REVOKE',2,null));
    expect(revoked.status).toBe('REVOKED');
    const stopped=syntheticDistributionBundle({
      tenantId:f.tenantId,facilityId:f.root.facilityId,
      issuerId:f.root.issuerId,now:f.now,pin,
      rootEventId:first.eventId,rootEventHash:rootDoc.get('currentEventHash'),
      rootRevision:1,dossierId:institution.dossierId,
      dossierDigest:(await f.inspect()).dossierDigest||'0'.repeat(64),
      sequence:3,
    });
    await expect(f.stage(stopped)).rejects.toThrow(
      'CI_EXT24_CURRENT_ISSUER_ROOT_REQUIRED');
    expect((await f.tenant.collection('externalClinicalTrustDistributionOutbox').get()).size)
      .toBe(2);
    expect((await f.tenant.collection('patient360Projections').get()).size)
      .toBe(0);
  }finally{await f.db.recursiveDelete(f.tenant);}
},90000);
