/**
 * CI-EXT-20: signed hospital issuer enrollment into synthetic Firestore.
 * NOT a production trust-anchor bootstrap or a browser-callable endpoint.
 *
 * The pin is injected ONLY by a separately trusted server configuration.
 * Never derive it from the signed claim or Firestore tenant documents.
 */
import {createHash} from 'node:crypto';
import type {Firestore,DocumentReference,Transaction} from 'firebase-admin/firestore';
import {
  verifyHospitalIssuerClaim,
  type SignedHospitalIssuerClaim,type PinnedHospitalIssuerKey,
  type HospitalIssuerClaim,
} from './external-hospital-issuer-attestation';

const ID=/^[A-Za-z0-9._-]{1,128}$/;
const MAX_DOCUMENT_ID=128;
type Row=Record<string,unknown>;
export type EnrolledHospitalAuthority=Readonly<{
  attestationId:string;recordId:string;
  kind:'CLINICIAN'|'SITE'|'GOVERNANCE_GRANT';
  replay:boolean;
  clinicalUseAuthorized:false;aiDraftingEligible:false;
}>;
function fail(code:string):never{throw new Error('CI_EXT20_'+code);}
function validId(v:unknown):v is string{
  return typeof v==='string'&&v.length<=MAX_DOCUMENT_ID&&
    ID.test(v)&&v!=='.'&&v!=='..';
}
function stableId(domain:string,...parts:string[]):string{
  return createHash('sha256').update(JSON.stringify([domain,...parts]))
    .digest('hex');
}
function testOnly():void{
  if(process.env.GHIMS_RUNTIME_MODE!=='TEST'||
    process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
    process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
    process.env.GHIMS_CI_EXTERNAL_ISSUER_ENROLLMENT_ENABLED!=='true')
    fail('EMULATOR_ONLY');
}
function recordRef(tenant:DocumentReference,c:HospitalIssuerClaim,
  recordId:string):DocumentReference{
  return tenant.collection(c.kind==='GOVERNANCE_GRANT'?
    'externalClinicalGovernanceGrants':'externalClinicalAuthorityEvidence')
    .doc(recordId);
}
function record(c:HospitalIssuerClaim,attestationId:string,
  claimDigest:string,fingerprint:string,keyRevision:number,
  recordId:string):Row{
  const audit={
    issuerAttestationId:attestationId,
    issuerId:c.issuerId,issuerKeyId:c.keyId,
    issuerKeyRevision:keyRevision,issuerSpkiFingerprint:fingerprint,
    issuerClaimDigest:claimDigest,immutableSourceEvent:true,
    clinicalUseAuthorized:false,aiDraftingEligible:false,
  };
  if(c.kind==='GOVERNANCE_GRANT'){
    return {
      ...audit,tenantId:c.tenantId,actorId:c.subjectId,
      facilityIds:[c.facilityId],roles:[...c.roles],
      permissions:[...c.permissions],status:'ACTIVE',
      identityAssurance:'HOSPITAL_VERIFIED',
      mfaStatus:'VERIFIED',validFrom:c.validFrom,
      validUntil:c.validUntil,revokedAt:null,
    };
  }
  return {
    ...audit,schemaVersion:1,
    tenantId:c.tenantId,kind:c.kind,
    targetId:c.subjectId,facilityId:c.facilityId,
    evidenceId:recordId,status:'VERIFIED',
    identityAssurance:'HOSPITAL_VERIFIED',
    evidenceHash:c.evidenceDigest,
    verifiedByActorId:c.verifiedByActorId,
    verifiedAt:c.issuedAt,validFrom:c.validFrom,validUntil:c.validUntil,
    licenseVerified:c.licenseVerified,siteApprovalId:c.siteApprovalId,
    revokedAt:null,
  };
}
function replayState(row:Row|undefined,c:HospitalIssuerClaim,
  attestationId:string,claimDigest:string,recordId:string):boolean{
  if(!row||row.issuerAttestationId!==attestationId||
    row.issuerClaimDigest!==claimDigest||
    row.tenantId!==c.tenantId||row.issuerId!==c.issuerId)
    return false;
  return c.kind==='GOVERNANCE_GRANT'?
    row.actorId===c.subjectId&&row.status==='ACTIVE'&&
      row.revokedAt===null&&
      Array.isArray(row.facilityIds)&&row.facilityIds.length===1&&
      row.facilityIds[0]===c.facilityId&&
      JSON.stringify(row.roles)===JSON.stringify(c.roles)&&
      JSON.stringify(row.permissions)===JSON.stringify(c.permissions)&&
      row.validUntil===c.validUntil:
    row.evidenceId===recordId&&row.targetId===c.subjectId&&
      row.kind===c.kind&&row.facilityId===c.facilityId&&
      row.status==='VERIFIED'&&row.revokedAt===null&&
      row.evidenceHash===c.evidenceDigest&&
      row.siteApprovalId===c.siteApprovalId&&
      row.licenseVerified===c.licenseVerified&&
      row.validUntil===c.validUntil;
}
/**
 * Qualification-only. The externally pinned key is server injected.
 * All certificate, grant, enrollment record, audit and HELD outbox writes
 * either commit together or do not commit. No PHI is accepted here.
 */
export async function enrollSignedHospitalIssuerClaim(args:Readonly<{
  db:Firestore;
  tenantId:string;
  signed:SignedHospitalIssuerClaim;
  trustedPin:PinnedHospitalIssuerKey;
  now?:()=>number;
}>):Promise<EnrolledHospitalAuthority>{
  testOnly();
  const now=(args.now||Date.now)();
  const {tenantId,signed,trustedPin,db}=args;
  if(!validId(tenantId)||!signed||typeof signed!=='object'||
    !signed.claim||!validId(signed.claim.subjectId)||
    !validId(signed.claim.claimId))
    fail('ENROLLMENT_SCOPE_INVALID');
  const c=signed.claim;
  const result=verifyHospitalIssuerClaim({
    signed,pin:trustedPin,tenantId,facilityId:c.facilityId,now,
  });
  if(!result.verified||!result.claimDigest||!result.fingerprint)
    fail(result.reasonCode);
  const claimDigest:string=result.claimDigest;
  const fingerprint:string=result.fingerprint;
  const idSuffix=stableId('HELIXIS_CI_EXT20_ATTESTATION_V1',
    tenantId,c.issuerId,c.claimId);
  const attestationId='eia_'+idSuffix;
  const recordId=c.kind==='GOVERNANCE_GRANT'?c.subjectId:
    'ev_'+stableId('HELIXIS_CI_EXT20_VERIFIED_EVIDENCE_V1',
      tenantId,c.kind,c.subjectId,c.claimId);
  const tenant=db.collection('tenants').doc(tenantId);
  const attestationRef=tenant.collection('externalClinicalIssuerAttestations')
    .doc(attestationId);
  const journalRef=tenant.collection('externalClinicalIssuerEnrollmentCommands')
    .doc(attestationId);
  const ref=recordRef(tenant,c,recordId);
  return db.runTransaction(async(tx:Transaction)=>{
    const [attestationSnap,commandSnap,recordSnap]=await tx.getAll(
      attestationRef,journalRef,ref);
    if(attestationSnap.exists||commandSnap.exists){
      if(!attestationSnap.exists||!commandSnap.exists||
        attestationSnap.get('claimDigest')!==claimDigest||
        commandSnap.get('claimDigest')!==claimDigest||
        attestationSnap.get('recordId')!==recordId||
        commandSnap.get('recordId')!==recordId||
        attestationSnap.get('issuerSpkiFingerprint')!==fingerprint||
        !recordSnap.exists||!replayState(recordSnap.data() as Row,
          c,attestationId,claimDigest,recordId))
        fail('IDEMPOTENCY_CONFLICT_OR_REVOKED');
      return {attestationId,recordId,kind:c.kind,replay:true,
        clinicalUseAuthorized:false,aiDraftingEligible:false};
    }
    if(recordSnap.exists)fail('RECORD_ALREADY_EXISTS');
    const common={
      schemaVersion:1,tenantId,attestationId,recordId,
      claimId:c.claimId,claimDigest,issuerId:c.issuerId,
      issuerKeyId:c.keyId,
      issuerKeyRevision:trustedPin.keyRevision,
      issuerSpkiFingerprint:fingerprint,
      kind:c.kind,subjectId:c.subjectId,facilityId:c.facilityId,
      issuedAt:c.issuedAt,validFrom:c.validFrom,validUntil:c.validUntil,
      immutable:true,clinicalUseAuthorized:false,aiDraftingEligible:false,
    };
    tx.create(attestationRef,{
      ...common,signatureAlgorithm:'Ed25519',
      signatureBase64Url:signed.signatureBase64Url,
      claim:c,
    });
    tx.create(journalRef,{
      ...common,eventType:'EXTERNAL_HOSPITAL_ISSUER_CLAIM_ENROLLED',
    });
    tx.create(ref,record(c,attestationId,claimDigest,
      fingerprint,trustedPin.keyRevision,recordId));
    tx.create(tenant.collection('externalClinicalIssuerOutbox')
      .doc(attestationId),{
        ...common,status:'HELD',destination:'CI_EXTERNAL_ISSUER_GOVERNANCE',
      });
    tx.create(tenant.collection('auditLogs').doc('eiaa_'+idSuffix),{
      tenantId,actorId:c.issuerId,
      action:'EXTERNAL_HOSPITAL_ISSUER_CLAIM_ENROLLED',
      targetId:c.subjectId,facilityId:c.facilityId,
      attestationId,claimDigest,recordedAt:now,
      immutable:true,clinicalUseAuthorized:false,
    });
    return {attestationId,recordId,kind:c.kind,replay:false,
      clinicalUseAuthorized:false,aiDraftingEligible:false};
  });
}
