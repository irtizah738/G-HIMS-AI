/**
 * CI-EXT-20: cryptographic verification contract for independently pinned
 * hospital issuer keys. Synthetic emulator only; a claimed Firestore issuer
 * registry is NOT an acceptable trust root.
 *
 * Signing keys are never created, persisted, or accepted from HTTP here.
 * Test fixtures may generate ephemeral keys, but a future production trust
 * provider must be independently provisioned and audited.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';

export type HospitalIssuerKind='CLINICIAN'|'SITE'|'GOVERNANCE_GRANT';
export type HospitalIssuerRole=
  'HOSPITAL_CREDENTIAL_OFFICER'|'HOSPITAL_INTEGRATION_OFFICER'|
  'CLINICAL_SAFETY_OFFICER';
export type HospitalIssuerPrivilege=
  'FHIR_CREDENTIAL_PROPOSE'|'FHIR_CREDENTIAL_ACTIVATE'|
  'FHIR_SITE_AUTHORITY_PROPOSE'|'FHIR_SITE_AUTHORITY_ACTIVATE'|
  'FHIR_AUTHORITY_REVOKE';

export type HospitalIssuerClaim=Readonly<{
  schemaVersion:1;issuerId:string;keyId:string;
  tenantId:string;facilityId:string;subjectId:string;
  kind:HospitalIssuerKind;claimId:string;verifiedByActorId:string;
  issuedAt:number;validFrom:number;validUntil:number;
  evidenceDigest:string;
  licenseVerified:boolean;siteApprovalId:string|null;
  roles:readonly HospitalIssuerRole[];
  permissions:readonly HospitalIssuerPrivilege[];
  mfaVerified:boolean;
}>;

export type SignedHospitalIssuerClaim=Readonly<{
  claim:HospitalIssuerClaim;
  signatureBase64Url:string;
}>;

/**
 * A trusted boundary MUST supply this from an independently approved
 * server-side trust store, never from the claim, browser, or tenant Firestore.
 */
export type PinnedHospitalIssuerKey=Readonly<{
  issuerId:string;keyId:string;tenantId:string;facilityId:string;
  publicKeySpkiPem:string;sha256SpkiFingerprint:string;
  permittedKinds:readonly HospitalIssuerKind[];
  status:'ACTIVE'|'REVOKED';
  keyRevision:number;validFrom:number;validUntil:number;
}>;

export type HospitalIssuerVerification=Readonly<{
  verified:boolean;
  reasonCode:string;
  claimDigest:string|null;
  fingerprint:string|null;
  clinicalUseAuthorized:false;
  aiDraftingEligible:false;
}>;

const ID=/^[A-Za-z0-9._-]{1,128}$/;
const HEX=/^[0-9a-f]{64}$/;
const B64URL=/^[A-Za-z0-9_-]{80,256}$/;
const MAX_ISSUER_WINDOW_MS=30*60_000;
const MAX_SKEW_MS=2*60_000;
const GRANT_PRIVILEGES=new Set<string>([
  'FHIR_CREDENTIAL_PROPOSE','FHIR_CREDENTIAL_ACTIVATE',
  'FHIR_SITE_AUTHORITY_PROPOSE','FHIR_SITE_AUTHORITY_ACTIVATE',
  'FHIR_AUTHORITY_REVOKE',
]);
const GRANT_ROLES=new Set<string>([
  'HOSPITAL_CREDENTIAL_OFFICER',
  'HOSPITAL_INTEGRATION_OFFICER',
  'CLINICAL_SAFETY_OFFICER',
]);
type Row=Record<string,unknown>;
function id(x:unknown):x is string{
  return typeof x==='string'&&ID.test(x)&&x!=='.'&&x!=='..';
}
function time(x:unknown):x is number{
  return typeof x==='number'&&Number.isSafeInteger(x)&&x>0;
}
function exact(x:unknown,keys:readonly string[]):x is Row{
  if(!x||typeof x!=='object'||Array.isArray(x))return false;
  const actual=Object.keys(x).sort(),expected=[...keys].sort();
  return actual.length===expected.length&&
    actual.every((name,i)=>name===expected[i]);
}
function canonical(x:unknown):string{
  if(x===null||typeof x!=='object')return JSON.stringify(x)??'null';
  if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';
  const row=x as Row;
  return '{'+Object.keys(row).sort().map(k=>
    JSON.stringify(k)+':'+canonical(row[k])).join(',')+'}';
}
export function hospitalIssuerSigningBytes(claim:HospitalIssuerClaim):Buffer{
  return Buffer.from('HELIXIS_CI_EXT20_ISSUER_CLAIM_V1\n'+canonical(claim),'utf8');
}
export function hospitalIssuerClaimDigest(claim:HospitalIssuerClaim):string{
  return createHash('sha256').update(hospitalIssuerSigningBytes(claim)).digest('hex');
}
function denial(reasonCode:string):HospitalIssuerVerification{
  return {verified:false,reasonCode,claimDigest:null,fingerprint:null,
    clinicalUseAuthorized:false,aiDraftingEligible:false};
}
export function assertHospitalIssuerClaim(input:unknown):
  asserts input is HospitalIssuerClaim{
  const fields=[
    'schemaVersion','issuerId','keyId','tenantId','facilityId',
    'subjectId','kind','claimId','verifiedByActorId','issuedAt',
    'validFrom','validUntil','evidenceDigest','licenseVerified',
    'siteApprovalId','roles','permissions','mfaVerified',
  ];
  if(!exact(input,fields))throw new Error('CI_EXT20_CLAIM_SCHEMA_INVALID');
  const c=input as HospitalIssuerClaim;
  if(c.schemaVersion!==1||
    ![c.issuerId,c.keyId,c.tenantId,c.facilityId,c.subjectId,
      c.claimId,c.verifiedByActorId].every(id)||
    c.subjectId===c.verifiedByActorId||
    !['CLINICIAN','SITE','GOVERNANCE_GRANT'].includes(c.kind)||
    !time(c.issuedAt)||!time(c.validFrom)||!time(c.validUntil)||
    c.validUntil<=c.validFrom||
    c.validUntil-c.validFrom>MAX_ISSUER_WINDOW_MS||
    typeof c.evidenceDigest!=='string'||!HEX.test(c.evidenceDigest)||
    !Array.isArray(c.roles)||!Array.isArray(c.permissions)||
    !c.roles.every(x=>GRANT_ROLES.has(x))||
    !c.permissions.every(x=>GRANT_PRIVILEGES.has(x))||
    new Set(c.roles).size!==c.roles.length||
    new Set(c.permissions).size!==c.permissions.length||
    typeof c.licenseVerified!=='boolean'||typeof c.mfaVerified!=='boolean')
    throw new Error('CI_EXT20_CLAIM_FIELDS_INVALID');
  if(c.kind==='CLINICIAN'&&
    (!c.licenseVerified||c.siteApprovalId!==null||
     c.roles.length!==0||c.permissions.length!==0||
     c.mfaVerified!==false))throw new Error('CI_EXT20_CLAIM_PURPOSE_INVALID');
  if(c.kind==='SITE'&&
    (!id(c.siteApprovalId)||c.licenseVerified||
     c.roles.length!==0||c.permissions.length!==0||
     c.mfaVerified!==false))throw new Error('CI_EXT20_CLAIM_PURPOSE_INVALID');
  if(c.kind==='GOVERNANCE_GRANT'&&
    (c.siteApprovalId!==null||c.licenseVerified||
     !c.mfaVerified||c.roles.length!==1||c.permissions.length!==1||
     !(c.roles[0]==='HOSPITAL_CREDENTIAL_OFFICER'&&
       ['FHIR_CREDENTIAL_PROPOSE','FHIR_CREDENTIAL_ACTIVATE'].includes(c.permissions[0])||
       c.roles[0]==='HOSPITAL_INTEGRATION_OFFICER'&&
       ['FHIR_SITE_AUTHORITY_PROPOSE','FHIR_SITE_AUTHORITY_ACTIVATE'].includes(c.permissions[0])||
       c.roles[0]==='CLINICAL_SAFETY_OFFICER'&&
       c.permissions[0]==='FHIR_AUTHORITY_REVOKE')))
    throw new Error('CI_EXT20_CLAIM_PURPOSE_INVALID');
}
export function verifyHospitalIssuerClaim(args:Readonly<{
  signed:unknown;pin:unknown;tenantId:string;facilityId:string;
  now:number;
}>):HospitalIssuerVerification{
  const {signed,pin,tenantId,facilityId,now}=args;
  if(!exact(signed,['claim','signatureBase64Url'])||
     !exact(pin,['issuerId','keyId','tenantId','facilityId',
       'publicKeySpkiPem','sha256SpkiFingerprint','permittedKinds',
       'status','keyRevision','validFrom','validUntil'])||
     !id(tenantId)||!id(facilityId)||!time(now))
    return denial('CI_EXT20_TRUST_INPUT_INVALID');
  const typed=signed as SignedHospitalIssuerClaim;
  const trusted=pin as PinnedHospitalIssuerKey;
  try{assertHospitalIssuerClaim(typed.claim);}
  catch{return denial('CI_EXT20_CLAIM_INVALID');}
  const c=typed.claim;
  if(trusted.status!=='ACTIVE'||trusted.tenantId!==tenantId||
    trusted.facilityId!==facilityId||trusted.issuerId!==c.issuerId||
    trusted.keyId!==c.keyId||c.tenantId!==tenantId||
    c.facilityId!==facilityId||
    !Array.isArray(trusted.permittedKinds)||
    !trusted.permittedKinds.includes(c.kind)||
    !time(trusted.keyRevision)||!time(trusted.validFrom)||
    !time(trusted.validUntil)||now<trusted.validFrom||
    now>=trusted.validUntil||c.issuedAt<trusted.validFrom||
    c.validUntil>trusted.validUntil)
    return denial('CI_EXT20_ISSUER_NOT_TRUSTED_CURRENT');
  if(c.validFrom>now||c.validUntil<=now||
    c.issuedAt>now+MAX_SKEW_MS||
    c.issuedAt<c.validFrom-MAX_SKEW_MS||
    c.issuedAt>c.validUntil||
    typeof typed.signatureBase64Url!=='string'||
    !B64URL.test(typed.signatureBase64Url))
    return denial('CI_EXT20_TIME_OR_SIGNATURE_INVALID');
  if(typeof trusted.publicKeySpkiPem!=='string'||
    trusted.publicKeySpkiPem.length>2048||
    typeof trusted.sha256SpkiFingerprint!=='string'||
    !HEX.test(trusted.sha256SpkiFingerprint))
    return denial('CI_EXT20_PIN_INVALID');
  try{
    const key=createPublicKey(trusted.publicKeySpkiPem);
    if(key.asymmetricKeyType!=='ed25519')
      return denial('CI_EXT20_ALGORITHM_REJECTED');
    const fingerprint=createHash('sha256')
      .update(key.export({type:'spki',format:'der'})).digest('hex');
    if(fingerprint!==trusted.sha256SpkiFingerprint)
      return denial('CI_EXT20_PIN_MISMATCH');
    const sig=Buffer.from(typed.signatureBase64Url,'base64url');
    if(sig.length!==64||
      sig.toString('base64url')!==typed.signatureBase64Url)
      return denial('CI_EXT20_SIGNATURE_NONCANONICAL');
    if(!verify(null,hospitalIssuerSigningBytes(c),key,sig))
      return denial('CI_EXT20_SIGNATURE_INVALID');
    return {
      verified:true,reasonCode:'CI_EXT20_VALID_SIGNATURE_NON_PROMOTING',
      claimDigest:hospitalIssuerClaimDigest(c),
      fingerprint,clinicalUseAuthorized:false,aiDraftingEligible:false,
    };
  }catch{
    return denial('CI_EXT20_PUBLIC_KEY_OR_SIGNATURE_INVALID');
  }
}
