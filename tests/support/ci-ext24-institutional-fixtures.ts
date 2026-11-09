/** Synthetic independent verifier and distribution signer fixtures only. */
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {
  institutionalEvidenceSigningBytes,
  type InstitutionalEvidenceDossier,
  type InstitutionalVerificationRole,
  type PinnedInstitutionalVerifier,
  type InstitutionalEndorsement,
} from '@/lib/clinical/intelligence/external-institutional-verification';
import {
  distributionSigningBytes,
  type TrustDistributionManifest,type DistributionSignature,
  type DistributionSignerRole,type PinnedDistributionSigner,
} from '@/lib/clinical/intelligence/external-trust-distribution';
import type {PinnedHospitalIssuerKey} from
  '@/lib/clinical/intelligence/external-hospital-issuer-attestation';
import type {PinnedHospitalTrustSteward} from
  '@/lib/clinical/intelligence/external-hospital-trust-anchor';

const VERIFIER_ROLES:InstitutionalVerificationRole[]=[
  'LEGAL_REGISTRY_VERIFIER','HOSPITAL_LICENCE_VERIFIER',
  'CONTRACT_AUTHORITY_VERIFIER','STEWARD_IDENTITY_VERIFIER',
  'SOURCE_AGREEMENT_VERIFIER',
];
const DISTRIBUTION_ROLES:DistributionSignerRole[]=[
  'TRUST_DISTRIBUTION_OPERATOR','INDEPENDENT_SECURITY_AUDITOR',
];
function pemAndFingerprint(pair:ReturnType<typeof generateKeyPairSync>){
  return {
    publicKeySpkiPem:pair.publicKey.export({type:'spki',format:'pem'}).toString(),
    sha256SpkiFingerprint:createHash('sha256')
      .update(pair.publicKey.export({type:'spki',format:'der'})).digest('hex'),
  };
}
function hash(v:string):string{
  return createHash('sha256').update(v).digest('hex');
}
export function syntheticInstitutionalVerifierBundle(args:Readonly<{
  tenantId:string;facilityId:string;issuerId:string;
  now:number;stewards:readonly PinnedHospitalTrustSteward[];
}>){
  const {tenantId,facilityId,issuerId,now,stewards}=args;
  const seed=randomUUID();
  const dossier:InstitutionalEvidenceDossier={
    schemaVersion:1,tenantId,facilityId,issuerId,
    institutionId:'synthetic-hospital-legal-entity',
    jurisdiction:'PK',caseId:'institutional-case-'+seed,
    legalRegistryEvidenceDigest:hash('synthetic-registry-'+seed),
    hospitalLicenceEvidenceDigest:hash('synthetic-licence-'+seed),
    contractingAuthorityEvidenceDigest:hash('synthetic-contract-'+seed),
    sourceAgreementEvidenceDigest:hash('synthetic-source-agreement-'+seed),
    sourceSiteApprovalId:'synthetic-approved-site',
    stewards:stewards.map(s=>({
      stewardId:s.stewardId,role:s.role,
      appointmentEvidenceDigest:hash('synthetic-steward-'+s.stewardId),
      validUntil:now+3_600_000,
    })),
    verifiedAt:now-1000,validFrom:now-60_000,
    validUntil:now+120_000,
  };
  const keys=VERIFIER_ROLES.map(()=>generateKeyPairSync('ed25519'));
  const independentVerifierPins:PinnedInstitutionalVerifier[]=
    VERIFIER_ROLES.map((role,i)=>({
      verifierId:'independent-institutional-'+role.toLowerCase(),
      keyId:'verifier-key-'+i,role,tenantId,facilityId,issuerId,
      ...pemAndFingerprint(keys[i]),status:'ACTIVE',
      validFrom:now-120_000,validUntil:now+240_000,
    }));
  function signatures(d:InstitutionalEvidenceDossier=dossier):
    InstitutionalEndorsement[]{
    return independentVerifierPins.map((p,i)=>({
      verifierId:p.verifierId,keyId:p.keyId,role:p.role,
      signatureBase64Url:sign(null,institutionalEvidenceSigningBytes(
        d,p.role,p.verifierId,p.keyId),keys[i].privateKey).toString('base64url'),
    }));
  }
  return {dossier,independentVerifierPins,endorsements:signatures(),signatures};
}
export function syntheticDistributionBundle(args:Readonly<{
  tenantId:string;facilityId:string;issuerId:string;now:number;
  pin:PinnedHospitalIssuerKey;
  rootEventId:string;rootEventHash:string;rootRevision:number;
  dossierId:string;dossierDigest:string;
  destinationId?:string;sequence?:number;
}>){
  const {tenantId,facilityId,issuerId,now,pin,
    rootEventId,rootEventHash,rootRevision,dossierId,dossierDigest}=args;
  const manifest:TrustDistributionManifest={
    schemaVersion:1,tenantId,facilityId,issuerId,
    destinationId:args.destinationId||'synthetic-trust-agent',
    distributionId:'td_'+randomUUID(),sequence:args.sequence||1,
    anchorEventId:rootEventId,anchorEventHash:rootEventHash,
    anchorRevision:rootRevision,issuerKeyId:pin.keyId,
    issuerSpkiFingerprint:pin.sha256SpkiFingerprint,
    institutionalDossierId:dossierId,
    institutionalDossierDigest:dossierDigest,
    issuedAt:now-1000,validUntil:now+60_000,
    deliveryMode:'HELD_NOT_DELIVERED',
  };
  const pairs=DISTRIBUTION_ROLES.map(()=>generateKeyPairSync('ed25519'));
  const independentDistributionPins:PinnedDistributionSigner[]=
    DISTRIBUTION_ROLES.map((role,i)=>({
      signerId:'independent-distribution-'+role.toLowerCase(),
      keyId:'distribution-key-'+i,role,tenantId,facilityId,issuerId,
      ...pemAndFingerprint(pairs[i]),status:'ACTIVE',
      validFrom:now-60_000,validUntil:now+240_000,
    }));
  const signatures=(m:TrustDistributionManifest=manifest):DistributionSignature[]=>
    independentDistributionPins.map((p,i)=>({
      signerId:p.signerId,keyId:p.keyId,role:p.role,
      signatureBase64Url:sign(null,distributionSigningBytes(
        m,p.role,p.signerId,p.keyId),pairs[i].privateKey).toString('base64url'),
    }));
  return {manifest,independentDistributionPins,signatures:signatures(),
    signManifest:signatures};
}
