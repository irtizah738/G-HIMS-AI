/** CI-EXT-22 synthetic-only institutional stewards and ephemeral keys. */
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {
  trustCommandBytes,
  type HospitalTrustCommand,type HospitalTrustOperation,
  type HospitalTrustEndorsement,type PinnedHospitalTrustSteward,
  type StewardRole,
} from '@/lib/clinical/intelligence/external-hospital-trust-anchor';
import type {PinnedHospitalIssuerKey} from
  '@/lib/clinical/intelligence/external-hospital-issuer-attestation';

const stewardRoles:StewardRole[]=[
  'HOSPITAL_TRUSTEE','SECURITY_TRUSTEE','RECOVERY_TRUSTEE'];
type KeyPair=ReturnType<typeof generateKeyPairSync>;
export function syntheticTrustLifecycle(tenantId:string,
  now:number,facilityId='hospital-facility',issuerId='hospital-issuer'){
  const keys=[generateKeyPairSync('ed25519'),
    generateKeyPairSync('ed25519'),generateKeyPairSync('ed25519'),
    generateKeyPairSync('ed25519')];
  const stewards=stewardRoles.map((role,i)=>{
    const pair=generateKeyPairSync('ed25519');
    const pinned:PinnedHospitalTrustSteward={
      stewardId:'independent-steward-'+role.toLowerCase(),
      role,tenantId,facilityId,permittedIssuerIds:[issuerId],
      publicKeySpkiPem:pair.publicKey.export({type:'spki',format:'pem'}).toString(),
      sha256SpkiFingerprint:createHash('sha256')
        .update(pair.publicKey.export({type:'spki',format:'der'})).digest('hex'),
      status:'ACTIVE',validFrom:now-60_000,validUntil:now+3_600_000,
    };
    return {role,pinned,pair};
  });
  const reason={
    ENROLL:'INSTITUTIONAL_ONBOARDING',
    ROTATE:'SCHEDULED_ROTATION',
    REVOKE:'KEY_COMPROMISE',
    RECOVER:'INSTITUTIONAL_RECOVERY',
  } as const;
  function issuerPin(keyIndex:number,revision:number):PinnedHospitalIssuerKey{
    const key=keys[keyIndex];
    return {
      issuerId,keyId:'hospital-ed25519-key-'+keyIndex,
      tenantId,facilityId,
      publicKeySpkiPem:key.publicKey.export({type:'spki',format:'pem'}).toString(),
      sha256SpkiFingerprint:createHash('sha256')
        .update(key.publicKey.export({type:'spki',format:'der'})).digest('hex'),
      permittedKinds:['CLINICIAN','SITE','GOVERNANCE_GRANT'],
      status:'ACTIVE',keyRevision:revision,
      validFrom:now-60_000,validUntil:now+3_000_000,
    };
  }
  function command(operation:HospitalTrustOperation,expectedRevision:number,
    keyIndex:number|null,opts:{commandId?:string;issuedAt?:number;
      evidenceDigest?:string}={}):HospitalTrustCommand{
    return {
      schemaVersion:1,tenantId,facilityId,issuerId,
      operation,commandId:opts.commandId||randomUUID(),
      expectedRevision,issuedAt:opts.issuedAt||now,
      evidenceDigest:opts.evidenceDigest||'a'.repeat(64),
      reasonCode:reason[operation],
      newPin:keyIndex===null?null:issuerPin(keyIndex,expectedRevision+1),
    };
  }
  function endorsement(c:HospitalTrustCommand,
    role:StewardRole):HospitalTrustEndorsement{
    const signer=stewards.find(x=>x.role===role);
    if(!signer)throw Error('CI_EXT22_TEST_STEWARD_MISSING');
    return {
      stewardId:signer.pinned.stewardId,
      signatureBase64Url:sign(null,trustCommandBytes(c),
        signer.pair.privateKey).toString('base64url'),
    };
  }
  function approvals(c:HospitalTrustCommand):HospitalTrustEndorsement[]{
    const roles=c.operation==='RECOVER'?stewardRoles:
      c.operation==='REVOKE'?stewardRoles.slice(1):stewardRoles.slice(0,2);
    return roles.map(role=>endorsement(c,role));
  }
  return {
    tenantId,facilityId,issuerId,now,
    stewards:stewards.map(x=>x.pinned),command,approvals,endorsement,issuerPin,
  };
}
