/**
 * CI-EXT-20 synthetic signed-issuer enrollment against Firestore emulator.
 * Tests contain ephemeral key material ONLY in memory, never in source.
 */
import {test,expect} from 'bun:test';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {getAdminFirestore} from '@/server/firebase/admin';
import {enrollSignedHospitalIssuerClaim} from
  '@/lib/clinical/intelligence/external-hospital-issuer-enrollment';
import {hospitalIssuerSigningBytes,
  type HospitalIssuerClaim,type PinnedHospitalIssuerKey,
  type SignedHospitalIssuerClaim} from
  '@/lib/clinical/intelligence/external-hospital-issuer-attestation';
async function fixture(){
  if(process.env.GHIMS_RUNTIME_MODE!=='TEST'||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
     process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
     process.env.GHIMS_CI_EXTERNAL_ISSUER_ENROLLMENT_ENABLED!=='true')
    throw new Error('CI_EXT20_EMULATOR_ONLY');
  const db=getAdminFirestore();
  if(!db)throw Error('CI_EXT20_DB_UNAVAILABLE');
  const now=Date.now();
  const tenantId='ext20-'+randomUUID().slice(0,12);
  const tenant=db.collection('tenants').doc(tenantId);
  const keys=generateKeyPairSync('ed25519');
  const trustedPin:PinnedHospitalIssuerKey={
    issuerId:'synthetic-hospital-issuer',
    keyId:'synthetic-ed25519-key',tenantId,facilityId:'facility-a',
    publicKeySpkiPem:keys.publicKey.export({type:'spki',format:'pem'}).toString(),
    sha256SpkiFingerprint:createHash('sha256').update(
      keys.publicKey.export({type:'spki',format:'der'})).digest('hex'),
    permittedKinds:['CLINICIAN','SITE','GOVERNANCE_GRANT'],
    status:'ACTIVE',keyRevision:1,
    validFrom:now-60000,validUntil:now+600000,
  };
  const claim:HospitalIssuerClaim={
    schemaVersion:1,issuerId:trustedPin.issuerId,keyId:trustedPin.keyId,
    tenantId,facilityId:'facility-a',subjectId:'synthetic-clinician',
    kind:'CLINICIAN',claimId:randomUUID(),
    verifiedByActorId:'independent-hospital-verifier',
    issuedAt:now-1000,validFrom:now-2000,validUntil:now+120000,
    evidenceDigest:'c'.repeat(64),
    licenseVerified:true,siteApprovalId:null,roles:[],permissions:[],
    mfaVerified:false,
  };
  const signClaim=(c:HospitalIssuerClaim):SignedHospitalIssuerClaim=>({
    claim:c,signatureBase64Url:sign(null,
      hospitalIssuerSigningBytes(c),keys.privateKey).toString('base64url'),
  });
  const submit=(signed=signClaim(claim),
    pin=trustedPin)=>enrollSignedHospitalIssuerClaim({
    db,tenantId,signed,trustedPin:pin,
  });
  return {db,tenant,tenantId,claim,trustedPin,signClaim,submit,now};
}
test('CI-EXT-20 transactionally enrolls hospital-signed clinician evidence and replay',async()=>{
  const f=await fixture();
  try{
    const enrolled=await f.submit();
    expect(enrolled.kind).toBe('CLINICIAN');
    expect(enrolled.replay).toBe(false);
    expect(enrolled.clinicalUseAuthorized).toBe(false);
    const evidence=await f.tenant.collection('externalClinicalAuthorityEvidence')
      .doc(enrolled.recordId).get();
    expect(evidence.exists).toBe(true);
    expect(evidence.get('issuerAttestationId')).toBe(enrolled.attestationId);
    expect(evidence.get('issuerSpkiFingerprint'))
      .toBe(f.trustedPin.sha256SpkiFingerprint);
    expect(evidence.get('evidenceHash')).toBe(f.claim.evidenceDigest);
    expect((await f.tenant.collection('externalClinicalIssuerAttestations').get()).size)
      .toBe(1);
    expect((await f.tenant.collection('externalClinicalIssuerOutbox').get()).size)
      .toBe(1);
    expect((await f.tenant.collection('externalClinicalIssuerEnrollmentCommands').get()).size)
      .toBe(1);
    const replay=await f.submit();
    expect(replay.replay).toBe(true);
    expect(replay.attestationId).toBe(enrolled.attestationId);
    expect((await f.tenant.collection('externalClinicalIssuerAttestations').get()).size)
      .toBe(1);
    await expect(f.submit(f.signClaim({
      ...f.claim,evidenceDigest:'d'.repeat(64),
    }))).rejects.toThrow('CI_EXT20_IDEMPOTENCY_CONFLICT_OR_REVOKED');
    expect((await f.tenant.collection('externalClinicalIssuerAttestations').get()).size)
      .toBe(1);
    await evidence.ref.update({status:'REVOKED'});
    await expect(f.submit()).rejects.toThrow('CI_EXT20_IDEMPOTENCY_CONFLICT_OR_REVOKED');
    expect((await f.tenant.collection('patient360Projections').get()).size).toBe(0);
  }finally{await f.db.recursiveDelete(f.tenant);}
},60000);

test('CI-EXT-20 hospital-signed grant enrollment is scoped, no arbitrary role elevation',async()=>{
  const f=await fixture();
  try{
    const grant:HospitalIssuerClaim={
      ...f.claim,kind:'GOVERNANCE_GRANT',
      subjectId:'hospital-credential-officer',claimId:randomUUID(),
      evidenceDigest:'a'.repeat(64),licenseVerified:false,
      roles:['HOSPITAL_CREDENTIAL_OFFICER'],
      permissions:['FHIR_CREDENTIAL_PROPOSE'],mfaVerified:true,
    };
    const result=await f.submit(f.signClaim(grant));
    expect(result.recordId).toBe(grant.subjectId);
    const g=await f.tenant.collection('externalClinicalGovernanceGrants')
      .doc(grant.subjectId).get();
    expect(g.get('mfaStatus')).toBe('VERIFIED');
    expect(g.get('permissions')).toEqual(['FHIR_CREDENTIAL_PROPOSE']);
    expect(g.get('issuerAttestationId')).toBe(result.attestationId);
    const elevated={...grant,claimId:randomUUID(),
      permissions:['FHIR_AUTHORITY_REVOKE'] as
        typeof grant.permissions};
    await expect(f.submit(f.signClaim(elevated)))
      .rejects.toThrow('CI_EXT20_CLAIM_INVALID');
    expect((await f.tenant.collection('externalClinicalGovernanceGrants').get()).size)
      .toBe(1);
    expect((await f.tenant.collection('externalClinicalIssuerAttestations').get()).size)
      .toBe(1);
  }finally{await f.db.recursiveDelete(f.tenant);}
},60000);

test('CI-EXT-20 rejects untrusted issuer, forged signing key and cross-tenant claims',async()=>{
  const f=await fixture();
  try{
    const untrusted={...f.trustedPin,status:'REVOKED' as const};
    await expect(f.submit(f.signClaim(f.claim),untrusted))
      .rejects.toThrow('CI_EXT20_ISSUER_NOT_TRUSTED_CURRENT');
    const rogue=generateKeyPairSync('ed25519');
    const signed={
      claim:f.claim,signatureBase64Url:sign(null,
        hospitalIssuerSigningBytes(f.claim),rogue.privateKey).toString('base64url'),
    };
    await expect(f.submit(signed)).rejects.toThrow('CI_EXT20_SIGNATURE_INVALID');
    await expect(f.submit(f.signClaim({
      ...f.claim,tenantId:'other-hospital',
    }))).rejects.toThrow('CI_EXT20_ISSUER_NOT_TRUSTED_CURRENT');
    await expect(f.submit(f.signClaim({
      ...f.claim,facilityId:'other-facility',
    }))).rejects.toThrow('CI_EXT20_ISSUER_NOT_TRUSTED_CURRENT');
    expect((await f.tenant.collection('externalClinicalIssuerAttestations').get()).size)
      .toBe(0);
    expect((await f.tenant.collection('externalClinicalAuthorityEvidence').get()).size)
      .toBe(0);
  }finally{await f.db.recursiveDelete(f.tenant);}
},60000);
