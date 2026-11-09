import {describe,expect,test} from 'bun:test';
import {generateKeyPairSync,createHash,sign,randomUUID} from 'node:crypto';
import {
  assertHospitalIssuerClaim,hospitalIssuerSigningBytes,
  verifyHospitalIssuerClaim,
  type HospitalIssuerClaim,type PinnedHospitalIssuerKey,
  type SignedHospitalIssuerClaim,
} from '@/lib/clinical/intelligence/external-hospital-issuer-attestation';

const NOW=1794200000000;
const pair=generateKeyPairSync('ed25519');
const publicKeySpkiPem=pair.publicKey.export({format:'pem',type:'spki'}).toString();
const sha256SpkiFingerprint=createHash('sha256')
  .update(pair.publicKey.export({format:'der',type:'spki'})).digest('hex');
const pin:PinnedHospitalIssuerKey={
  issuerId:'hospital-authority-test',keyId:'hospital-ed25519-key',
  tenantId:'tenant-test',facilityId:'facility-a',
  publicKeySpkiPem,sha256SpkiFingerprint,
  permittedKinds:['CLINICIAN','SITE','GOVERNANCE_GRANT'],
  status:'ACTIVE',keyRevision:1,
  validFrom:NOW-100_000,validUntil:NOW+400_000,
};
const claim:HospitalIssuerClaim={
  schemaVersion:1,issuerId:pin.issuerId,keyId:pin.keyId,
  tenantId:pin.tenantId,facilityId:pin.facilityId,
  subjectId:'doctor-a',kind:'CLINICIAN',
  claimId:randomUUID(),verifiedByActorId:'independent-verifier',
  issuedAt:NOW-1000,validFrom:NOW-2000,validUntil:NOW+120_000,
  evidenceDigest:'a'.repeat(64),
  licenseVerified:true,siteApprovalId:null,roles:[],permissions:[],
  mfaVerified:false,
};
function signed(c:HospitalIssuerClaim=claim):SignedHospitalIssuerClaim{
  return {
    claim:c,signatureBase64Url:sign(null,hospitalIssuerSigningBytes(c),
      pair.privateKey).toString('base64url'),
  };
}
function verify(s:SignedHospitalIssuerClaim=signed(),
  trusted:PinnedHospitalIssuerKey=pin,now=NOW){
  return verifyHospitalIssuerClaim({
    signed:s,pin:trusted,tenantId:'tenant-test',facilityId:'facility-a',now,
  });
}
describe('CI-EXT-20 hospital trust-key and signed enrollment contract',()=>{
  test('valid signature and exact independently pinned Ed25519 public key qualify non-promoting',()=>{
    const result=verify();
    expect(result.verified).toBe(true);
    expect(result.claimDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.fingerprint).toBe(sha256SpkiFingerprint);
    expect(result.clinicalUseAuthorized).toBe(false);
    expect(result.aiDraftingEligible).toBe(false);
  });
  test('forged signature or changed subject/license is rejected',()=>{
    const tampered=signed();
    expect(verify({...tampered,claim:{...tampered.claim,subjectId:'doctor-b'}})
      .reasonCode).toBe('CI_EXT20_SIGNATURE_INVALID');
    expect(verify({...tampered,claim:{...tampered.claim,licenseVerified:false}})
      .verified).toBe(false);
    const other=generateKeyPairSync('ed25519');
    const forged={claim,signatureBase64Url:sign(null,
      hospitalIssuerSigningBytes(claim),other.privateKey).toString('base64url')};
    expect(verify(forged).reasonCode).toBe('CI_EXT20_SIGNATURE_INVALID');
  });
  test('unapproved key, pin substitution, wrong tenant or facility, unsupported purpose deny',()=>{
    expect(verify(signed(),{...pin,sha256SpkiFingerprint:'0'.repeat(64)})
      .reasonCode).toBe('CI_EXT20_PIN_MISMATCH');
    expect(verify(signed(),{...pin,status:'REVOKED'})
      .reasonCode).toBe('CI_EXT20_ISSUER_NOT_TRUSTED_CURRENT');
    expect(verify(signed(),{...pin,tenantId:'other-hospital'})
      .reasonCode).toBe('CI_EXT20_ISSUER_NOT_TRUSTED_CURRENT');
    expect(verify(signed(),{...pin,permittedKinds:['SITE']})
      .reasonCode).toBe('CI_EXT20_ISSUER_NOT_TRUSTED_CURRENT');
    expect(verify(signed(),{...pin,keyId:'different-key'})
      .reasonCode).toBe('CI_EXT20_ISSUER_NOT_TRUSTED_CURRENT');
    expect(verify(signed({...claim,tenantId:'other-hospital'})).verified)
      .toBe(false);
    expect(verify(signed({...claim,facilityId:'facility-b'})).verified)
      .toBe(false);
  });
  test('expiry, future issue time and invalid window fail closed',()=>{
    expect(verify(signed(),pin,claim.validUntil).verified).toBe(false);
    expect(verify(signed(),{...pin,validUntil:NOW}).verified).toBe(false);
    expect(verify(signed({...claim,issuedAt:NOW+200_000})).verified).toBe(false);
    expect(()=>assertHospitalIssuerClaim({
      ...claim,validUntil:claim.validFrom+31*60_000,
    })).toThrow('CI_EXT20_CLAIM_FIELDS_INVALID');
    expect(()=>assertHospitalIssuerClaim({...claim,unknownAuthorizer:'admin'}))
      .toThrow('CI_EXT20_CLAIM_SCHEMA_INVALID');
  });
  test('purpose-bound grant cannot request broad privileges or lie about MFA',()=>{
    const grant:HospitalIssuerClaim={
      ...claim,kind:'GOVERNANCE_GRANT',subjectId:'credential-officer',
      licenseVerified:false,siteApprovalId:null,
      roles:['HOSPITAL_CREDENTIAL_OFFICER'],
      permissions:['FHIR_CREDENTIAL_PROPOSE'],mfaVerified:true,
    };
    expect(verify(signed(grant)).verified).toBe(true);
    expect(()=>assertHospitalIssuerClaim({
      ...grant,permissions:['FHIR_CREDENTIAL_PROPOSE','FHIR_AUTHORITY_REVOKE'],
    })).toThrow('CI_EXT20_CLAIM_PURPOSE_INVALID');
    expect(()=>assertHospitalIssuerClaim({
      ...grant,mfaVerified:false,
    })).toThrow('CI_EXT20_CLAIM_PURPOSE_INVALID');
    expect(()=>assertHospitalIssuerClaim({
      ...grant,roles:['HOSPITAL_CREDENTIAL_OFFICER','CLINICAL_SAFETY_OFFICER'],
    })).toThrow('CI_EXT20_CLAIM_PURPOSE_INVALID');
    const site:HospitalIssuerClaim={
      ...claim,kind:'SITE',subjectId:'source-a',siteApprovalId:'hospital-contract',
      licenseVerified:false,
    };
    expect(verify(signed(site)).verified).toBe(true);
    expect(verify(signed({...site,siteApprovalId:'wrong-contract'})).verified)
      .toBe(true);
    // A valid hospital signer may attest either site ID; the integration
    // transaction must STILL match it to the live registered HIS source.
  });
  test('private signing keys are created only in test fixtures, never enrollment source',async()=>{
    const fs=await import('node:fs/promises');
    const source=await fs.readFile('lib/clinical/intelligence/external-hospital-issuer-enrollment.ts','utf8');
    expect(source).not.toContain('generateKeyPairSync');
    expect(source).toContain("process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'");
    expect(source).toContain('tx.create(');
  });
});
