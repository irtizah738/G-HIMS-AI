/**
 * CI-EXT-21: strict, transactional, signature-backed consumption of
 * CI-EXT-20 hospital issuer attestations. No unsigned legacy escape hatch.
 *
 * IMPORTANT: No real hospital trust anchor has been commissioned.
 * The ONLY key resolver currently available is test-emulator injection;
 * non-test and unconfigured runtimes DENY, even for a signed record.
 */
import type {DocumentReference,Transaction} from 'firebase-admin/firestore';
import {
  verifyHospitalIssuerClaim,
  type HospitalIssuerClaim,type PinnedHospitalIssuerKey,
  type HospitalIssuerKind,type SignedHospitalIssuerClaim,
} from './external-hospital-issuer-attestation';
import {
  inspectCurrentHospitalTrust,
  type PinnedHospitalTrustSteward,
} from './external-hospital-trust-anchor';

type Row=Record<string,unknown>;
export type SignedAuthorityKind=HospitalIssuerKind;
export type CurrentSignedAuthorityResult=Readonly<{
  valid:boolean;reasonCode:string;
  clinicalUseAuthorized:false;aiDraftingEligible:false;
}>;
const ID=/^[A-Za-z0-9._-]{1,128}$/;
function id(v:unknown):v is string{
  return typeof v==='string'&&ID.test(v)&&v!=='.'&&v!=='..';
}
function ts(v:unknown):v is number{
  return typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
}
function denied(code:string):CurrentSignedAuthorityResult{
  return {valid:false,reasonCode:code,
    clinicalUseAuthorized:false,aiDraftingEligible:false};
}
function testOnly():boolean{
  return process.env.GHIMS_RUNTIME_MODE==='TEST'&&
    process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8080'&&
    process.env.FIREBASE_PROJECT_ID==='ghims-p4-ci'&&
    process.env.GHIMS_CI_EXTERNAL_SIGNED_CONSUMER_ENABLED==='true';
}
/**
 * Only independently pinned stewardship keys can attest a current CI-EXT-22
 * root. The hospital issuer's public key is NEVER trusted from this map.
 * The public issuer pin MUST come from the transactionally validated,
 * steward-signed current root event and head.
 */
const stewardPins=new Map<string,readonly PinnedHospitalTrustSteward[]>();
function stewardIndex(tenantId:string,facilityId:string,issuerId:string):string{
  return JSON.stringify([tenantId,facilityId,issuerId]);
}
export function installEmulatorHospitalTrustStewards(
  stewards:readonly PinnedHospitalTrustSteward[],
):void{
  if(!testOnly())throw new Error('CI_EXT23_EMULATOR_ONLY');
  if(stewards.length<2||stewards.length>3||
    !stewards.every(s=>
      id(s.stewardId)&&id(s.tenantId)&&id(s.facilityId)&&
      Array.isArray(s.permittedIssuerIds)&&s.permittedIssuerIds.length===1&&
      id(s.permittedIssuerIds[0])))
    throw new Error('CI_EXT23_INVALID_SYNTHETIC_STEWARDS');
  const first=stewards[0];
  if(stewards.some(s=>
    s.tenantId!==first.tenantId||
    s.facilityId!==first.facilityId||
    s.permittedIssuerIds[0]!==first.permittedIssuerIds[0]||
    s.stewardId===first.permittedIssuerIds[0])||
    new Set(stewards.map(s=>s.stewardId)).size!==stewards.length||
    new Set(stewards.map(s=>s.role)).size!==stewards.length)
    throw new Error('CI_EXT23_STEWARD_SCOPE_CONFLICT');
  stewardPins.set(stewardIndex(first.tenantId,first.facilityId,
    first.permittedIssuerIds[0]),Object.freeze([...stewards]));
}
export function clearEmulatorHospitalTrustStewards():void{
  if(!testOnly())throw new Error('CI_EXT23_EMULATOR_ONLY');
  stewardPins.clear();
}
function sameList(a:unknown,b:readonly string[]):boolean{
  return Array.isArray(a)&&a.length===b.length&&
    a.every((x,i)=>x===b[i]);
}
function matchRecord(row:Row,c:HospitalIssuerClaim,kind:SignedAuthorityKind,
  recordId:string):boolean{
  if(row.tenantId!==c.tenantId||
    row.issuerId!==c.issuerId||row.issuerKeyId!==c.keyId||
    row.facilityId!==undefined&&row.facilityId!==c.facilityId||
    row.validFrom!==c.validFrom||row.validUntil!==c.validUntil||
    row.revokedAt!==null||
    row.immutableSourceEvent!==true||
    row.clinicalUseAuthorized!==false||row.aiDraftingEligible!==false)
    return false;
  if(kind==='GOVERNANCE_GRANT'){
    return row.actorId===recordId&&row.actorId===c.subjectId&&
      row.status==='ACTIVE'&&
      row.identityAssurance==='HOSPITAL_VERIFIED'&&
      row.mfaStatus==='VERIFIED'&&
      sameList(row.roles,c.roles)&&sameList(row.permissions,c.permissions)&&
      sameList(row.facilityIds,[c.facilityId]);
  }
  return row.evidenceId===recordId&&
    row.schemaVersion===1&&row.kind===kind&&
    row.targetId===c.subjectId&&
    row.facilityId===c.facilityId&&
    row.status==='VERIFIED'&&
    row.identityAssurance==='HOSPITAL_VERIFIED'&&
    row.evidenceHash===c.evidenceDigest&&
    row.verifiedByActorId===c.verifiedByActorId&&
    row.verifiedAt===c.issuedAt&&
    row.licenseVerified===c.licenseVerified&&
    row.siteApprovalId===c.siteApprovalId;
}
function matchJournal(row:Row,attestationId:string,recordId:string,
  claimDigest:string,c:HospitalIssuerClaim,
  fingerprint:string,keyRevision:number):boolean{
  return row.immutable===true&&row.schemaVersion===1&&
    row.tenantId===c.tenantId&&row.attestationId===attestationId&&
    row.recordId===recordId&&row.claimId===c.claimId&&
    row.claimDigest===claimDigest&&row.issuerId===c.issuerId&&
    row.issuerKeyId===c.keyId&&
    row.issuerKeyRevision===keyRevision&&
    row.issuerSpkiFingerprint===fingerprint&&
    row.kind===c.kind&&row.subjectId===c.subjectId&&
    row.facilityId===c.facilityId&&
    row.issuedAt===c.issuedAt&&
    row.validFrom===c.validFrom&&row.validUntil===c.validUntil&&
    row.clinicalUseAuthorized===false&&row.aiDraftingEligible===false;
}
export async function verifyCurrentSignedAuthorityRecord(args:Readonly<{
  tx:Transaction;tenant:DocumentReference;tenantId:string;
  facilityId:string;kind:SignedAuthorityKind;recordId:string;
  record:Row|undefined;now:number;
}>):Promise<CurrentSignedAuthorityResult>{
  const {tx,tenant,tenantId,facilityId,kind,recordId,record,now}=args;
  if(!testOnly())return denied('CI_EXT21_TRUST_STORE_NOT_COMMISSIONED');
  if(!id(tenantId)||!id(facilityId)||!id(recordId)||!ts(now)||
    !['CLINICIAN','SITE','GOVERNANCE_GRANT'].includes(kind))
    return denied('CI_EXT21_SCOPE_INVALID');
  if(!record||record.immutableSourceEvent!==true||
    record.clinicalUseAuthorized!==false||
    record.aiDraftingEligible!==false||
    !id(record.issuerAttestationId)||!id(record.issuerId)||
    !id(record.issuerKeyId)||!ts(record.issuerKeyRevision)||
    typeof record.issuerClaimDigest!=='string'||
    typeof record.issuerSpkiFingerprint!=='string')
    return denied('CI_EXT21_UNSIGNED_LEGACY_RECORD');
  // CI-EXT-23: resolve current issuer key only from a steward-signed,
  // immutable CI-EXT-22 head/event in THIS SAME Firestore transaction.
  // No client-supplied, Firestore-only or legacy in-memory issuer-key fallback.
  const independentStewards=stewardPins.get(stewardIndex(
    tenantId,facilityId,record.issuerId as string));
  if(!independentStewards)
    return denied('CI_EXT23_INDEPENDENT_STEWARDS_REQUIRED');
  const currentRoot=await inspectCurrentHospitalTrust({
    tx,tenant,issuerId:record.issuerId as string,
    tenantId,facilityId,now,
    independentlyPinnedStewards:independentStewards,
  });
  if(!currentRoot.valid||!currentRoot.pin)
    return denied('CI_EXT23_'+currentRoot.reasonCode);
  const pin=currentRoot.pin;
  if(pin.keyId!==record.issuerKeyId||
    pin.keyRevision!==record.issuerKeyRevision||
    pin.sha256SpkiFingerprint!==record.issuerSpkiFingerprint)
    return denied('CI_EXT23_KEY_SUPERSEDED_OR_MISMATCH');
  const attestationId=record.issuerAttestationId as string;
  const [att,command,outbox]=await tx.getAll(
    tenant.collection('externalClinicalIssuerAttestations').doc(attestationId),
    tenant.collection('externalClinicalIssuerEnrollmentCommands').doc(attestationId),
    tenant.collection('externalClinicalIssuerOutbox').doc(attestationId));
  if(!att.exists||!command.exists||!outbox.exists)
    return denied('CI_EXT21_SIGNED_ATTESTATION_MISSING');
  const a=att.data() as Row;
  if(a.signatureAlgorithm!=='Ed25519'||
    typeof a.signatureBase64Url!=='string'||
    !a.claim||typeof a.claim!=='object'||Array.isArray(a.claim))
    return denied('CI_EXT21_SIGNED_ATTESTATION_INVALID');
  const signed:SignedHospitalIssuerClaim={
    claim:a.claim as HospitalIssuerClaim,
    signatureBase64Url:a.signatureBase64Url,
  };
  const check=verifyHospitalIssuerClaim({
    signed,pin,tenantId,facilityId,now,
  });
  if(!check.verified||!check.claimDigest||!check.fingerprint)
    return denied('CI_EXT21_'+check.reasonCode);
  const c=signed.claim;
  if(c.kind!==kind||
    !matchJournal(a,attestationId,recordId,
      check.claimDigest,c,check.fingerprint,pin.keyRevision)||
    !matchJournal(command.data() as Row,attestationId,
      recordId,check.claimDigest,c,check.fingerprint,pin.keyRevision)||
    command.get('eventType')!=='EXTERNAL_HOSPITAL_ISSUER_CLAIM_ENROLLED'||
    !matchJournal(outbox.data() as Row,attestationId,
      recordId,check.claimDigest,c,check.fingerprint,pin.keyRevision)||
    outbox.get('status')!=='HELD'||
    outbox.get('destination')!=='CI_EXTERNAL_ISSUER_GOVERNANCE'||
    record.issuerAttestationId!==attestationId||
    record.issuerClaimDigest!==check.claimDigest||
    record.issuerSpkiFingerprint!==check.fingerprint||
    !matchRecord(record,c,kind,recordId))
    return denied('CI_EXT21_SIGNED_RECORD_LINEAGE_INVALID');
  return {valid:true,reasonCode:'CI_EXT21_SIGNED_AUTHORITY_NON_PROMOTING',
    clinicalUseAuthorized:false,aiDraftingEligible:false};
}
