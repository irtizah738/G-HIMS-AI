/**
 * CI-EXT-22: synthetic dual-/three-steward hospital issuer trust lifecycle.
 * No production/IAM/KMS mutation. All private keys are ephemeral test memory.
 */
import {expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {getAdminFirestore} from '@/server/firebase/admin';
import {syntheticTrustLifecycle} from
  '@/tests/support/ci-ext22-trust-anchor-fixtures';
import {
  applyHospitalTrustLifecycle,inspectCurrentHospitalTrust,
} from '@/lib/clinical/intelligence/external-hospital-trust-anchor';

async function fixture(){
  if(process.env.GHIMS_RUNTIME_MODE!=='TEST'||
    process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
    process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
    process.env.GHIMS_CI_EXTERNAL_TRUST_LIFECYCLE_ENABLED!=='true')
    throw new Error('CI_EXT22_FIXTURE_EMULATOR_ONLY');
  const db=getAdminFirestore();
  if(!db)throw new Error('CI_EXT22_EMULATOR_DB_REQUIRED');
  const tenantId='ext22-'+randomUUID().slice(0,12);
  const root=db.collection('tenants').doc(tenantId);
  const f=syntheticTrustLifecycle(tenantId,Date.now());
  const issue=(c:ReturnType<typeof f.command>,approvals=f.approvals(c),
    stewards=f.stewards)=>applyHospitalTrustLifecycle({
      db,command:c,endorsements:approvals,
      independentlyPinnedStewards:stewards,
    });
  const inspect=(stewards=f.stewards)=>db.runTransaction(tx=>
    inspectCurrentHospitalTrust({
      tx,tenant:root,tenantId,facilityId:f.facilityId,
      issuerId:f.issuerId,independentlyPinnedStewards:stewards,
      now:Date.now(),
    }));
  return {db,root,tenantId,f,issue,inspect};
}

test('CI-EXT-22 dual-steward enroll/rotate/revoke and 3-steward recovery',async()=>{
  const x=await fixture();
  try{
    const enroll=x.f.command('ENROLL',0,0);
    const first=await x.issue(enroll);
    expect(first).toMatchObject({
      status:'ACTIVE',revision:1,replay:false,
      clinicalUseAuthorized:false,aiDraftingEligible:false,
    });
    const active=await x.inspect();
    expect(active.valid).toBe(true);
    expect(active.pin?.keyId).toBe('hospital-ed25519-key-0');
    expect((await x.issue(enroll)).replay).toBe(true);
    expect((await x.root.collection('externalClinicalHospitalTrustEvents').get()).size)
      .toBe(1);

    const rotate=x.f.command('ROTATE',1,1);
    const rotated=await x.issue(rotate);
    expect(rotated.revision).toBe(2);
    expect((await x.inspect()).pin?.keyId).toBe('hospital-ed25519-key-1');
    expect((await x.root.collection('externalClinicalHospitalTrustKeyUsage').get()).size)
      .toBe(2);

    const revoke=x.f.command('REVOKE',2,null);
    const revoked=await x.issue(revoke);
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.revision).toBe(3);
    const denied=await x.inspect();
    expect(denied.valid).toBe(false);
    expect(denied.pin).toBe(null);
    await expect(x.issue(enroll))
      .rejects.toThrow('CI_EXT22_IDEMPOTENCY_CONFLICT_OR_SUPERSEDED');
    await expect(x.issue(x.f.command('ROTATE',3,3)))
      .rejects.toThrow('CI_EXT22_ROOT_NOT_ACTIVE');

    const recovery=x.f.command('RECOVER',3,2);
    const restored=await x.issue(recovery);
    expect(restored.status).toBe('ACTIVE');
    expect(restored.revision).toBe(4);
    expect((await x.inspect()).pin?.keyId).toBe('hospital-ed25519-key-2');
    expect((await x.root.collection('externalClinicalHospitalTrustEvents').get()).size)
      .toBe(4);
    expect((await x.root.collection('externalClinicalHospitalTrustOutbox').get()).size)
      .toBe(4);
    expect((await x.root.collection('externalClinicalHospitalTrustCommands').get()).size)
      .toBe(4);
    expect((await x.root.collection('externalClinicalHospitalTrustKeyUsage').get()).size)
      .toBe(3);
    const reusing=x.f.command('ROTATE',4,0);
    await expect(x.issue(reusing))
      .rejects.toThrow('CI_EXT22_KEY_REUSE_FORBIDDEN');
    await expect(x.issue(x.f.command('RECOVER',4,3)))
      .rejects.toThrow('CI_EXT22_RECOVERY_REQUIRES_REVOKED_ROOT');
    expect((await x.root.collection('patient360Projections').get()).size)
      .toBe(0);
  }finally{await x.db.recursiveDelete(x.root);}
},90000);

test('CI-EXT-22 no self-signed/one-person enrollment or recovery',async()=>{
  const x=await fixture();
  try{
    const enroll=x.f.command('ENROLL',0,0);
    await expect(x.issue(enroll,[x.f.approvals(enroll)[0]]))
      .rejects.toThrow('CI_EXT22_INDEPENDENT_QUORUM_REQUIRED');
    const signatures=x.f.approvals(enroll);
    await expect(x.issue(enroll,[signatures[0],signatures[0]]))
      .rejects.toThrow('CI_EXT22_INDEPENDENT_QUORUM_REQUIRED');
    await expect(x.issue(enroll,[signatures[0],
      {...signatures[1],signatureBase64Url:'A'.repeat(86)}]))
      .rejects.toThrow('CI_EXT22_STEWARD_SIGNATURE_INVALID');
    await expect(x.issue(enroll,signatures,
      x.f.stewards.map(s=>s.role==='HOSPITAL_TRUSTEE'?
        {...s,status:'REVOKED' as const}:s)))
      .rejects.toThrow('CI_EXT22_STEWARDS_NOT_INDEPENDENT_CURRENT');
    await expect(x.issue(enroll,signatures,
      x.f.stewards.map(s=>({...s,tenantId:'another-hospital'}))))
      .rejects.toThrow('CI_EXT22_STEWARDS_NOT_INDEPENDENT_CURRENT');
    expect((await x.root.collection('externalClinicalHospitalTrustEvents').get()).size)
      .toBe(0);
    await x.issue(enroll);
    await x.issue(x.f.command('REVOKE',1,null));
    const recover=x.f.command('RECOVER',2,1);
    await expect(x.issue(recover,x.f.approvals(recover).slice(0,2)))
      .rejects.toThrow('CI_EXT22_INDEPENDENT_QUORUM_REQUIRED');
    expect((await x.inspect()).valid).toBe(false);
  }finally{await x.db.recursiveDelete(x.root);}
},90000);

test('CI-EXT-22 stale revision, immutable-event corruption and invalid pin fail closed',async()=>{
  const x=await fixture();
  try{
    const enroll=x.f.command('ENROLL',0,0);
    const first=await x.issue(enroll);
    await expect(x.issue(x.f.command('ENROLL',0,1)))
      .rejects.toThrow('CI_EXT22_TRUST_ALREADY_ONBOARDED');
    await expect(x.issue(x.f.command('ROTATE',2,1)))
      .rejects.toThrow('CI_EXT22_TRUST_REVISION_OR_SCOPE_CONFLICT');
    await expect(x.issue(x.f.command('ROTATE',1,1,{
      issuedAt:Date.now()-10*60_000,
    }))).rejects.toThrow('CI_EXT22_COMMAND_TIME_STALE');
    const wrong=x.f.command('ROTATE',1,1);
    await expect(x.issue({
      ...wrong,newPin:{...wrong.newPin!,
        sha256SpkiFingerprint:'0'.repeat(64)},
    })).rejects.toThrow('CI_EXT22_KEY_FINGERPRINT_MISMATCH');

    const evt=x.root.collection('externalClinicalHospitalTrustEvents')
      .doc(first.eventId);
    await evt.update({eventHash:'0'.repeat(64)});
    expect((await x.inspect()).reasonCode).toBe('CI_EXT22_ROOT_EVENT_TAMPERED');
    await expect(x.issue(x.f.command('ROTATE',1,1)))
      .rejects.toThrow('CI_EXT22_PREVIOUS_EVENT_CHAIN_INVALID');
  }finally{await x.db.recursiveDelete(x.root);}
},90000);

test('CI-EXT-22 current steward withdrawal immediately invalidates root verification',async()=>{
  const x=await fixture();
  try{
    await x.issue(x.f.command('ENROLL',0,0));
    const compromised=x.f.stewards.map(s=>
      s.role==='SECURITY_TRUSTEE'?{...s,status:'REVOKED' as const}:s);
    expect((await x.inspect(compromised)).reasonCode)
      .toBe('CI_EXT22_STEWARD_QUORUM_NOT_CURRENT');
    expect((await x.inspect()).valid).toBe(true);
  }finally{await x.db.recursiveDelete(x.root);}
},90000);
