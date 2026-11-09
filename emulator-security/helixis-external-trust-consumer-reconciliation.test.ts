/**
 * CI-EXT-23: exact-transaction root-state reconciliation.
 * Real CI-EXT-22 Firestore mutations; synthetic ephemeral private keys only.
 */
import {expect,test} from 'bun:test';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {getAdminFirestore} from '@/server/firebase/admin';
import {
  applyHospitalTrustLifecycle,
  type HospitalTrustCommand,
} from '@/lib/clinical/intelligence/external-hospital-trust-anchor';
import {verifyCurrentSignedAuthorityRecord} from
  '@/lib/clinical/intelligence/external-signed-authority-consumer';
import {syntheticSignedAuthorityRows} from
  '@/tests/support/ci-ext21-signed-fixtures';
import {syntheticStewardEndorsements} from
  '@/tests/support/ci-ext23-current-root-fixtures';

test('CI-EXT-23 live root enrolment, revocation and recovery fence exact clinical consumption',async()=>{
  if(process.env.GHIMS_RUNTIME_MODE!=='TEST'||
    process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
    process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
    process.env.GHIMS_CI_EXTERNAL_TRUST_LIFECYCLE_ENABLED!=='true'||
    process.env.GHIMS_CI_EXTERNAL_SIGNED_CONSUMER_ENABLED!=='true')
    throw new Error('CI_EXT23_EMULATOR_ONLY');
  const db=getAdminFirestore();
  if(!db)throw Error('CI_EXT23_DB_REQUIRED');
  const tenantId='ext23-'+randomUUID().slice(0,12);
  const tenant=db.collection('tenants').doc(tenantId);
  const now=Date.now(),facilityId='facility-a';
  const recordId='verified-clinician-credential';
  const signed=syntheticSignedAuthorityRows({
    tenantId,facilityId,kind:'CLINICIAN',recordId,now,
    record:{
      schemaVersion:1,tenantId,kind:'CLINICIAN',
      targetId:'synthetic-physician',facilityId,evidenceId:recordId,
      status:'VERIFIED',identityAssurance:'HOSPITAL_VERIFIED',
      evidenceHash:'a'.repeat(64),verifiedByActorId:'independent-license-verifier',
      verifiedAt:now-1000,validFrom:now-60_000,
      validUntil:now+120_000,licenseVerified:true,siteApprovalId:null,
      revokedAt:null,
    },
  });
  const evidence=tenant.collection('externalClinicalAuthorityEvidence').doc(recordId);
  const assess=()=>db.runTransaction(async tx=>{
    const snap=await tx.get(evidence);
    return verifyCurrentSignedAuthorityRecord({
      tx,tenant,tenantId,facilityId,kind:'CLINICIAN',
      recordId,record:snap.exists?snap.data():undefined,now:Date.now(),
    });
  });
  const apply=(command:HospitalTrustCommand)=>
    applyHospitalTrustLifecycle({
      db,command,endorsements:syntheticStewardEndorsements(command),
      independentlyPinnedStewards:signed.root.stewards,
    });
  try{
    await Promise.all([
      evidence.set(signed.record),
      tenant.collection('externalClinicalIssuerAttestations')
        .doc(signed.attestationId).set(signed.attestation),
      tenant.collection('externalClinicalIssuerEnrollmentCommands')
        .doc(signed.attestationId).set(signed.journal),
      tenant.collection('externalClinicalIssuerOutbox')
        .doc(signed.attestationId).set(signed.outbox),
    ]);
    expect((await assess()).reasonCode).toBe('CI_EXT23_CI_EXT22_ROOT_MISSING');

    const first=await apply(signed.root.command);
    expect(first.status).toBe('ACTIVE');
    expect(first.revision).toBe(1);
    const approved=await assess();
    expect(approved.valid).toBe(true);
    expect(approved.clinicalUseAuthorized).toBe(false);
    expect(approved.aiDraftingEligible).toBe(false);

    const revoke:HospitalTrustCommand={
      ...signed.root.command,operation:'REVOKE',
      commandId:randomUUID(),expectedRevision:1,
      issuedAt:Date.now(),newPin:null,reasonCode:'KEY_COMPROMISE',
    };
    const revoked=await apply(revoke);
    expect(revoked.status).toBe('REVOKED');
    const denied=await assess();
    expect(denied.valid).toBe(false);
    expect(denied.reasonCode)
      .toBe('CI_EXT23_CI_EXT22_ROOT_REVOKED_OR_SCOPE_INVALID');
    await expect(apply(signed.root.command))
      .rejects.toThrow('CI_EXT22_IDEMPOTENCY_CONFLICT_OR_SUPERSEDED');

    const keys=generateKeyPairSync('ed25519');
    const recoveredPin={
      ...signed.pin,
      keyId:'synthetic-recovery-key',keyRevision:3,
      publicKeySpkiPem:keys.publicKey.export({type:'spki',format:'pem'}).toString(),
      sha256SpkiFingerprint:createHash('sha256')
        .update(keys.publicKey.export({type:'spki',format:'der'})).digest('hex'),
    };
    const recover:HospitalTrustCommand={
      ...signed.root.command,operation:'RECOVER',
      commandId:randomUUID(),expectedRevision:2,
      issuedAt:Date.now(),newPin:recoveredPin,
      reasonCode:'INSTITUTIONAL_RECOVERY',
    };
    const recovered=await apply(recover);
    expect(recovered.status).toBe('ACTIVE');
    expect(recovered.revision).toBe(3);
    // A valid but *old* hospital signature cannot survive a root recovery.
    const oldClaim=await assess();
    expect(oldClaim.valid).toBe(false);
    expect(oldClaim.reasonCode).toBe('CI_EXT23_KEY_SUPERSEDED_OR_MISMATCH');
    expect((await tenant.collection('patient360Projections').get()).size).toBe(0);
  }finally{await db.recursiveDelete(tenant);}
},90000);
