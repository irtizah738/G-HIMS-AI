/**
 * Synthetic CI-EXT-22 root fixture with independent in-memory stewards.
 * No persisted private signing key and no real institutional trust.
 */
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {
  trustCommandBytes,hospitalTrustEventHash,
  type HospitalTrustCommand,type HospitalTrustEndorsement,
  type PinnedHospitalTrustSteward,type TrustEventPayload,
} from '@/lib/clinical/intelligence/external-hospital-trust-anchor';
import {installEmulatorHospitalTrustStewards} from
  '@/lib/clinical/intelligence/external-signed-authority-consumer';
import type {PinnedHospitalIssuerKey} from
  '@/lib/clinical/intelligence/external-hospital-issuer-attestation';

const roles=['HOSPITAL_TRUSTEE','SECURITY_TRUSTEE','RECOVERY_TRUSTEE'] as const;
const pairs=roles.map(()=>generateKeyPairSync('ed25519'));
function hash(x:unknown):string{
  return createHash('sha256').update(JSON.stringify(x)).digest('hex');
}
export function syntheticCurrentHospitalTrustRoot(
  pin:PinnedHospitalIssuerKey,now:number,
){
  const {issuerId,tenantId,facilityId}=pin;
  const stewards:PinnedHospitalTrustSteward[]=roles.map((role,i)=>({
    stewardId:'ci23-independent-'+role.toLowerCase(),
    role,tenantId,facilityId,
    permittedIssuerIds:[issuerId],
    publicKeySpkiPem:pairs[i].publicKey.export({
      type:'spki',format:'pem',
    }).toString(),
    sha256SpkiFingerprint:createHash('sha256')
      .update(pairs[i].publicKey.export({
        type:'spki',format:'der',
      })).digest('hex'),
    status:'ACTIVE',validFrom:now-60_000,validUntil:now+3_600_000,
  }));
  installEmulatorHospitalTrustStewards(stewards);
  const token=hash([tenantId,facilityId,issuerId]).slice(0,12);
  const command:HospitalTrustCommand={
    schemaVersion:1,operation:'ENROLL',tenantId,facilityId,issuerId,
    commandId:'12345678-1234-4123-8123-'+token,
    expectedRevision:0,issuedAt:now-1000,
    evidenceDigest:hash(['synthetic-independent-hospital-contract',
      tenantId,facilityId,issuerId]),
    reasonCode:'INSTITUTIONAL_ONBOARDING',newPin:pin,
  };
  const endorsements:HospitalTrustEndorsement[]=stewards.slice(0,2).map((s,i)=>({
    stewardId:s.stewardId,
    signatureBase64Url:sign(null,trustCommandBytes(command),
      pairs[i].privateKey).toString('base64url'),
  }));
  const eventId='hte_'+hash([tenantId,issuerId,'ci23-root-v1']);
  const payload:TrustEventPayload={
    schemaVersion:1,command,revision:1,status:'ACTIVE',
    previousEventId:null,previousEventHash:null,
    stewardIds:endorsements.map(e=>e.stewardId).sort(),
    recordedAt:now,
  };
  const eventHash=hospitalTrustEventHash(payload);
  const event={
    eventId,eventHash,payload,endorsements,immutable:true,
    clinicalUseAuthorized:false,aiDraftingEligible:false,
  };
  const head={
    schemaVersion:1,tenantId,facilityId,issuerId,status:'ACTIVE',revision:1,
    currentPin:pin,keyId:pin.keyId,currentEventId:eventId,
    currentEventHash:eventHash,previousEventId:null,previousEventHash:null,
    immutableSourceEvent:true,clinicalUseAuthorized:false,
    aiDraftingEligible:false,
  };
  return {stewards,command,eventId,event,head};
}

/** Test-only signing; never import into production modules. */
export function syntheticStewardEndorsements(
  command:HospitalTrustCommand,
):HospitalTrustEndorsement[]{
  const indices=command.operation==='RECOVER'?[0,1,2]:
    command.operation==='REVOKE'?[1,2]:[0,1];
  return indices.map(i=>({
    stewardId:'ci23-independent-'+roles[i].toLowerCase(),
    signatureBase64Url:sign(null,trustCommandBytes(command),
      pairs[i].privateKey).toString('base64url'),
  }));
}
