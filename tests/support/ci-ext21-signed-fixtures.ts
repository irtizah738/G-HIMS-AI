/**
 * CI-EXT-21: synthetic signed hospital authority fixtures.
 * Ephemeral test-only Ed25519 keypair, NEVER a production trust anchor.
 */
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {
  hospitalIssuerClaimDigest,hospitalIssuerSigningBytes,
  type HospitalIssuerClaim,type HospitalIssuerKind,
  type HospitalIssuerRole,type HospitalIssuerPrivilege,
  type PinnedHospitalIssuerKey,
} from '@/lib/clinical/intelligence/external-hospital-issuer-attestation';
import {syntheticCurrentHospitalTrustRoot} from
  './ci-ext23-current-root-fixtures';

type Row=Record<string,unknown>;
const pair=generateKeyPairSync('ed25519');
const pem=pair.publicKey.export({format:'pem',type:'spki'}).toString();
const fingerprint=createHash('sha256').update(
  pair.publicKey.export({format:'der',type:'spki'})).digest('hex');
const issuerId='CI_EXT21_SYNTHETIC_ISSUER';
const keyId='CI_EXT21_EPHEMERAL_KEY';
function stable(...parts:string[]):string{
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}
export type SyntheticSignedRows=Readonly<{
  record:Row;pin:PinnedHospitalIssuerKey;
  attestationId:string;attestation:Row;journal:Row;outbox:Row;
  root:ReturnType<typeof syntheticCurrentHospitalTrustRoot>;
}>;
export function syntheticSignedAuthorityRows(args:Readonly<{
  tenantId:string;facilityId:string;kind:HospitalIssuerKind;
  recordId:string;record:Row;now:number;
}>):SyntheticSignedRows{
  const {tenantId,facilityId,kind,recordId,record,now}=args;
  const subjectId=kind==='GOVERNANCE_GRANT'?
    record.actorId as string:record.targetId as string;
  const verifiedByActorId=kind==='GOVERNANCE_GRANT'?
    'independent-mfa-verifier':record.verifiedByActorId as string;
  const validFrom=record.validFrom as number;
  const validUntil=record.validUntil as number;
  const claimId='synthetic-claim-'+stable(tenantId,kind,recordId).slice(0,36);
  const claim:HospitalIssuerClaim={
    schemaVersion:1,tenantId,facilityId,issuerId,keyId,kind,
    subjectId,claimId,verifiedByActorId,
    issuedAt:kind==='GOVERNANCE_GRANT'?now-1000:record.verifiedAt as number,
    validFrom,validUntil,
    evidenceDigest:kind==='GOVERNANCE_GRANT'?
      stable('synthetic-role-evidence',recordId):record.evidenceHash as string,
    licenseVerified:kind==='CLINICIAN',
    siteApprovalId:kind==='SITE'?record.siteApprovalId as string:null,
    roles:kind==='GOVERNANCE_GRANT'?[...(record.roles as HospitalIssuerRole[])]:[],
    permissions:kind==='GOVERNANCE_GRANT'?
      [...(record.permissions as HospitalIssuerPrivilege[])]:[],
    mfaVerified:kind==='GOVERNANCE_GRANT',
  };
  const pin:PinnedHospitalIssuerKey={
    issuerId,keyId,tenantId,facilityId,publicKeySpkiPem:pem,
    sha256SpkiFingerprint:fingerprint,
    status:'ACTIVE',keyRevision:1,
    permittedKinds:['CLINICIAN','SITE','GOVERNANCE_GRANT'],
    validFrom:now-600000,validUntil:now+3600000,
  };
  const root=syntheticCurrentHospitalTrustRoot(pin,now);
  const claimDigest=hospitalIssuerClaimDigest(claim);
  const attestationId='eia_'+stable('HELIXIS_CI_EXT20_ATTESTATION_V1',
    tenantId,issuerId,claimId);
  const base={
    schemaVersion:1,tenantId,attestationId,recordId,
    claimId,claimDigest,issuerId,issuerKeyId:keyId,
    issuerKeyRevision:pin.keyRevision,issuerSpkiFingerprint:fingerprint,
    kind,subjectId,facilityId,
    issuedAt:claim.issuedAt,validFrom,validUntil,
    immutable:true,clinicalUseAuthorized:false,aiDraftingEligible:false,
  };
  const signed={
    ...record,revokedAt:record.revokedAt??null,
    issuerAttestationId:attestationId,
    issuerId,issuerKeyId:keyId,issuerKeyRevision:pin.keyRevision,
    issuerSpkiFingerprint:fingerprint,issuerClaimDigest:claimDigest,
    immutableSourceEvent:true,
    clinicalUseAuthorized:false,aiDraftingEligible:false,
  };
  return {
    record:signed,pin,attestationId,root,
    attestation:{...base,signatureAlgorithm:'Ed25519',claim,
      signatureBase64Url:sign(null,hospitalIssuerSigningBytes(claim),
        pair.privateKey).toString('base64url')},
    journal:{...base,eventType:'EXTERNAL_HOSPITAL_ISSUER_CLAIM_ENROLLED'},
    outbox:{...base,status:'HELD',
      destination:'CI_EXTERNAL_ISSUER_GOVERNANCE'},
  };
}
