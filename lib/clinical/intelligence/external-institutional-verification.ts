/**
 * CI-EXT-24 independent institutional-evidence verification contract.
 *
 * CRITICAL: a signed verification verdict authenticates the verifier's
 * assertion; it is NOT proof that a hospital exists, a license is valid,
 * or a signer is legally empowered. Primary-source checks and independent
 * commissioning are external, unfinished release gates.
 *
 * Emulator-only; no public API, real trust onboarding or PHI.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';
import type {DocumentReference,Firestore,Transaction} from 'firebase-admin/firestore';

export type InstitutionalVerificationRole=
  'LEGAL_REGISTRY_VERIFIER'|'HOSPITAL_LICENCE_VERIFIER'|
  'CONTRACT_AUTHORITY_VERIFIER'|'STEWARD_IDENTITY_VERIFIER'|
  'SOURCE_AGREEMENT_VERIFIER';
export type HospitalStewardEvidence=Readonly<{
  stewardId:string;
  role:'HOSPITAL_TRUSTEE'|'SECURITY_TRUSTEE'|'RECOVERY_TRUSTEE';
  appointmentEvidenceDigest:string;
  validUntil:number;
}>;
export type InstitutionalEvidenceDossier=Readonly<{
  schemaVersion:1;
  tenantId:string;facilityId:string;issuerId:string;
  institutionId:string;jurisdiction:string;caseId:string;
  legalRegistryEvidenceDigest:string;
  hospitalLicenceEvidenceDigest:string;
  contractingAuthorityEvidenceDigest:string;
  sourceAgreementEvidenceDigest:string;
  sourceSiteApprovalId:string;
  stewards:readonly HospitalStewardEvidence[];
  verifiedAt:number;validFrom:number;validUntil:number;
}>;
export type PinnedInstitutionalVerifier=Readonly<{
  verifierId:string;keyId:string;role:InstitutionalVerificationRole;
  tenantId:string;facilityId:string;issuerId:string;
  publicKeySpkiPem:string;sha256SpkiFingerprint:string;
  status:'ACTIVE'|'REVOKED';validFrom:number;validUntil:number;
}>;
export type InstitutionalEndorsement=Readonly<{
  verifierId:string;keyId:string;
  role:InstitutionalVerificationRole;signatureBase64Url:string;
}>;
export type InstitutionVerificationResult=Readonly<{
  valid:boolean;reasonCode:string;dossierDigest:string|null;
  institutionalIdentityCommissioned:false;
  clinicalUseAuthorized:false;aiDraftingEligible:false;
}>;

type Row=Record<string,unknown>;
const ID=/^[A-Za-z0-9._-]{1,128}$/;
const HEX=/^[0-9a-f]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/;
const ROLES:InstitutionalVerificationRole[]=[
  'LEGAL_REGISTRY_VERIFIER','HOSPITAL_LICENCE_VERIFIER',
  'CONTRACT_AUTHORITY_VERIFIER','STEWARD_IDENTITY_VERIFIER',
  'SOURCE_AGREEMENT_VERIFIER',
];
const STEWARD_ROLES=['HOSPITAL_TRUSTEE','SECURITY_TRUSTEE','RECOVERY_TRUSTEE'];
const MAX_TTL_MS=24*60*60*1000;
const MAX_CLOCK_SKEW_MS=120_000;
const DENY=(reasonCode:string):InstitutionVerificationResult=>({
  valid:false,reasonCode,dossierDigest:null,
  institutionalIdentityCommissioned:false,
  clinicalUseAuthorized:false,aiDraftingEligible:false,
});
function id(v:unknown):v is string{
  return typeof v==='string'&&ID.test(v)&&v!=='.'&&v!=='..';
}
function stamp(v:unknown):v is number{
  return typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
}
function exact(v:unknown,fields:readonly string[]):v is Row{
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const a=Object.keys(v).sort(),b=[...fields].sort();
  return a.length===b.length&&a.every((x,i)=>x===b[i]);
}
function canonical(v:unknown):string{
  if(v===null||typeof v!=='object')return JSON.stringify(v)??'null';
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  const o=v as Row;
  return '{'+Object.keys(o).sort()
    .map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';
}
export function institutionalEvidenceSigningBytes(
  dossier:InstitutionalEvidenceDossier,
  role:InstitutionalVerificationRole,verifierId:string,keyId:string,
):Buffer{
  return Buffer.from('HELIXIS_CI_EXT24_INSTITUTION_EVIDENCE_V1\n'+
    canonical({dossier,role,verifierId,keyId}),'utf8');
}
export function institutionalEvidenceDigest(dossier:InstitutionalEvidenceDossier):string{
  return createHash('sha256').update('HELIXIS_CI_EXT24_DOSSIER_V1\n'+
    canonical(dossier)).digest('hex');
}
export function assertInstitutionalEvidenceDossier(v:unknown):
  asserts v is InstitutionalEvidenceDossier{
  if(!exact(v,['schemaVersion','tenantId','facilityId','issuerId',
    'institutionId','jurisdiction','caseId',
    'legalRegistryEvidenceDigest','hospitalLicenceEvidenceDigest',
    'contractingAuthorityEvidenceDigest','sourceAgreementEvidenceDigest',
    'sourceSiteApprovalId','stewards','verifiedAt','validFrom','validUntil']))
    throw Error('CI_EXT24_DOSSIER_SCHEMA_INVALID');
  const d=v as InstitutionalEvidenceDossier;
  if(d.schemaVersion!==1||
    ![d.tenantId,d.facilityId,d.issuerId,d.institutionId,d.caseId,
      d.sourceSiteApprovalId].every(id)||
    typeof d.jurisdiction!=='string'||!/^[A-Z]{2}$/.test(d.jurisdiction)||
    ![d.legalRegistryEvidenceDigest,d.hospitalLicenceEvidenceDigest,
      d.contractingAuthorityEvidenceDigest,d.sourceAgreementEvidenceDigest]
      .every(v=>typeof v==='string'&&HEX.test(v))||
    !stamp(d.verifiedAt)||!stamp(d.validFrom)||!stamp(d.validUntil)||
    d.validFrom>d.verifiedAt||d.verifiedAt>=d.validUntil||
    d.validUntil-d.validFrom>MAX_TTL_MS||
    !Array.isArray(d.stewards)||d.stewards.length!==3||
    !d.stewards.every(s=>exact(s,
      ['stewardId','role','appointmentEvidenceDigest','validUntil'])&&
      id(s.stewardId)&&s.stewardId!==d.issuerId&&
      s.stewardId!==d.institutionId&&STEWARD_ROLES.includes(s.role)&&
      typeof s.appointmentEvidenceDigest==='string'&&
      HEX.test(s.appointmentEvidenceDigest)&&stamp(s.validUntil)&&
      s.validUntil>=d.validUntil)||
    new Set(d.stewards.map(s=>s.stewardId)).size!==3||
    new Set(d.stewards.map(s=>s.role)).size!==3)
    throw Error('CI_EXT24_DOSSIER_FIELDS_INVALID');
}
function verifiedEd25519Key(pem:unknown,fingerprint:unknown){
  if(typeof pem!=='string'||pem.length>2048||
    typeof fingerprint!=='string'||!HEX.test(fingerprint))
    throw Error('CI_EXT24_PIN_SCHEMA_INVALID');
  const publicKey=createPublicKey(pem);
  if(publicKey.asymmetricKeyType!=='ed25519')
    throw Error('CI_EXT24_ALGORITHM_INVALID');
  const actual=createHash('sha256')
    .update(publicKey.export({type:'spki',format:'der'})).digest('hex');
  if(actual!==fingerprint)throw Error('CI_EXT24_PIN_MISMATCH');
  return publicKey;
}
export function verifyInstitutionalEvidence(args:Readonly<{
  dossier:unknown;
  endorsements:readonly InstitutionalEndorsement[];
  independentVerifierPins:readonly PinnedInstitutionalVerifier[];
  now:number;tenantId:string;facilityId:string;issuerId:string;
}>):InstitutionVerificationResult{
  const {dossier,endorsements,independentVerifierPins:pins,now,
    tenantId,facilityId,issuerId}=args;
  if(!stamp(now)||!id(tenantId)||!id(facilityId)||!id(issuerId))
    return DENY('CI_EXT24_SCOPE_INVALID');
  try{assertInstitutionalEvidenceDossier(dossier);}
  catch{return DENY('CI_EXT24_DOSSIER_INVALID');}
  const d=dossier as InstitutionalEvidenceDossier;
  if(d.tenantId!==tenantId||d.facilityId!==facilityId||
    d.issuerId!==issuerId)
    return DENY('CI_EXT24_CROSS_TENANT_OR_FACILITY');
  if(now<d.validFrom||now>=d.validUntil||
    d.verifiedAt>now+MAX_CLOCK_SKEW_MS||
    now-d.verifiedAt>MAX_TTL_MS)
    return DENY('CI_EXT24_DOSSIER_EXPIRED_OR_FUTURE');
  if(!Array.isArray(endorsements)||endorsements.length!==ROLES.length||
    !Array.isArray(pins)||pins.length<ROLES.length||
    new Set(endorsements.map(e=>e.verifierId)).size!==ROLES.length||
    new Set(endorsements.map(e=>e.role)).size!==ROLES.length)
    return DENY('CI_EXT24_INDEPENDENT_QUORUM_REQUIRED');
  const fingerprints=new Set<string>();
  for(const role of ROLES){
    const endorsement=endorsements.find(e=>e.role===role);
    if(!exact(endorsement,['verifierId','keyId','role','signatureBase64Url'])||
      !id(endorsement.verifierId)||!id(endorsement.keyId)||
      typeof endorsement.signatureBase64Url!=='string'||
      !SIG.test(endorsement.signatureBase64Url))
      return DENY('CI_EXT24_ENDORSEMENT_INVALID');
    const pin=pins.find(p=>p.verifierId===endorsement.verifierId&&
      p.keyId===endorsement.keyId&&p.role===role);
    if(!pin||pin.status!=='ACTIVE'||pin.tenantId!==tenantId||
      pin.facilityId!==facilityId||pin.issuerId!==issuerId||
      pin.verifierId===issuerId||pin.verifierId===d.institutionId||
      d.stewards.some(s=>s.stewardId===pin.verifierId)||
      !stamp(pin.validFrom)||!stamp(pin.validUntil)||
      now<pin.validFrom||now>=pin.validUntil||
      d.verifiedAt<pin.validFrom||
      d.validUntil>pin.validUntil||
      fingerprints.has(pin.sha256SpkiFingerprint))
      return DENY('CI_EXT24_VERIFIER_NOT_CURRENT_OR_INDEPENDENT');
    try{
      const publicKey=verifiedEd25519Key(
        pin.publicKeySpkiPem,pin.sha256SpkiFingerprint);
      const signature=Buffer.from(endorsement.signatureBase64Url,'base64url');
      if(signature.length!==64||
        signature.toString('base64url')!==endorsement.signatureBase64Url||
        !verify(null,institutionalEvidenceSigningBytes(
          d,role,endorsement.verifierId,endorsement.keyId
        ),publicKey,signature))
        return DENY('CI_EXT24_SIGNED_EVIDENCE_INVALID');
    }catch{return DENY('CI_EXT24_SIGNED_EVIDENCE_INVALID');}
    fingerprints.add(pin.sha256SpkiFingerprint);
  }
  return {valid:true,
    reasonCode:'CI_EXT24_INDEPENDENT_ASSERTIONS_SYNTHETIC_NON_PROMOTING',
    dossierDigest:institutionalEvidenceDigest(d),
    institutionalIdentityCommissioned:false,
    clinicalUseAuthorized:false,aiDraftingEligible:false};
}
function guard():void{
  if(process.env.GHIMS_RUNTIME_MODE!=='TEST'||
    process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
    process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
    process.env.GHIMS_CI_EXTERNAL_INSTITUTIONAL_VERIFICATION_ENABLED!=='true')
    throw Error('CI_EXT24_EMULATOR_ONLY');
}
function commandId(d:InstitutionalEvidenceDossier):string{
  return 'ivc_'+createHash('sha256').update(
    JSON.stringify(['CI_EXT24_ENROLL',d.tenantId,d.issuerId,d.caseId]))
    .digest('hex');
}
export async function enrollInstitutionalEvidenceDossier(args:Readonly<{
  db:Firestore;dossier:InstitutionalEvidenceDossier;
  endorsements:readonly InstitutionalEndorsement[];
  independentVerifierPins:readonly PinnedInstitutionalVerifier[];
  now?:()=>number;
}>):Promise<Readonly<{
  dossierId:string;replay:boolean;
  institutionalIdentityCommissioned:false;
  clinicalUseAuthorized:false;aiDraftingEligible:false;
}>>{
  guard();
  const {db,dossier,endorsements,independentVerifierPins}=args;
  const now=(args.now||Date.now)();
  const assessed=verifyInstitutionalEvidence({dossier,endorsements,
    independentVerifierPins,tenantId:dossier.tenantId,
    facilityId:dossier.facilityId,issuerId:dossier.issuerId,now});
  if(!assessed.valid||!assessed.dossierDigest)
    throw Error(assessed.reasonCode);
  const digest=assessed.dossierDigest;
  const tenant=db.collection('tenants').doc(dossier.tenantId);
  const idValue=commandId(dossier);
  const doc=tenant.collection('externalClinicalInstitutionalVerificationEvents')
    .doc(idValue);
  const journal=tenant.collection('externalClinicalInstitutionalVerificationCommands')
    .doc(idValue);
  const outbox=tenant.collection('externalClinicalInstitutionalVerificationOutbox')
    .doc(idValue);
  const head=tenant.collection('externalClinicalInstitutionalVerificationHeads')
    .doc(dossier.issuerId);
  return db.runTransaction(async(tx:Transaction)=>{
    const [eventSnap,cmdSnap,headSnap]=await tx.getAll(doc,journal,head);
    if(eventSnap.exists||cmdSnap.exists){
      if(!eventSnap.exists||!cmdSnap.exists||!headSnap.exists||
        eventSnap.get('dossierDigest')!==digest||
        cmdSnap.get('dossierDigest')!==digest||
        headSnap.get('currentEventId')!==idValue||
        headSnap.get('status')!=='QUALIFIED_NON_PROMOTING')
        throw Error('CI_EXT24_REPLAY_CONFLICT_OR_SUPERSEDED');
      return {dossierId:idValue,replay:true,
        institutionalIdentityCommissioned:false,
        clinicalUseAuthorized:false,aiDraftingEligible:false};
    }
    if(headSnap.exists)
      throw Error('CI_EXT24_INSTITUTIONAL_CASE_ALREADY_REGISTERED');
    const common={tenantId:dossier.tenantId,facilityId:dossier.facilityId,
      issuerId:dossier.issuerId,institutionId:dossier.institutionId,
      dossierDigest:digest,caseId:dossier.caseId,
      validFrom:dossier.validFrom,validUntil:dossier.validUntil,
      institutionalIdentityCommissioned:false,
      clinicalUseAuthorized:false,aiDraftingEligible:false,
      immutable:true};
    tx.create(doc,{...common,eventId:idValue,dossier,endorsements,
      reasonCode:'CI_EXT24_INDEPENDENT_ASSERTIONS_ONLY'});
    tx.create(journal,{...common,eventId:idValue,
      eventType:'INSTITUTIONAL_EVIDENCE_DOSSIER_ENROLLED'});
    tx.create(outbox,{...common,eventId:idValue,status:'HELD',
      destination:'INSTITUTIONAL_VERIFICATION_QUARANTINE'});
    tx.create(head,{...common,currentEventId:idValue,
      status:'QUALIFIED_NON_PROMOTING',revision:1});
    tx.create(tenant.collection('auditLogs').doc('iva_'+idValue.slice(4)),{
      tenantId:dossier.tenantId,facilityId:dossier.facilityId,
      issuerId:dossier.issuerId,eventId:idValue,dossierDigest:digest,
      action:'INSTITUTIONAL_EVIDENCE_VERDICT_RECORDED',
      recordedAt:now,immutable:true,clinicalUseAuthorized:false,
    });
    return {dossierId:idValue,replay:false,
      institutionalIdentityCommissioned:false,
      clinicalUseAuthorized:false,aiDraftingEligible:false};
  });
}
/**
 * This is a read-only qualification view. It deliberately returns NO GO
 * even for valid independent assertions: primary-source registry/licence,
 * contract, IAM and real steward verification are not connected.
 */
export async function inspectInstitutionalEvidenceDossier(args:Readonly<{
  tx:Transaction;tenant:DocumentReference;issuerId:string;
  tenantId:string;facilityId:string;
  independentVerifierPins:readonly PinnedInstitutionalVerifier[];
  now:number;
}>):Promise<InstitutionVerificationResult>{
  guard();
  const {tx,tenant,issuerId,tenantId,facilityId,independentVerifierPins,now}=args;
  if(!id(issuerId)||!id(tenantId)||!id(facilityId)||!stamp(now))
    return DENY('CI_EXT24_SCOPE_INVALID');
  const head=await tx.get(
    tenant.collection('externalClinicalInstitutionalVerificationHeads').doc(issuerId));
  if(!head.exists||head.get('status')!=='QUALIFIED_NON_PROMOTING')
    return DENY('CI_EXT24_DOSSIER_NOT_CURRENT');
  const eid=head.get('currentEventId') as unknown;
  if(!id(eid))return DENY('CI_EXT24_DOSSIER_EVENT_INVALID');
  const [event,cmd]=await tx.getAll(
    tenant.collection('externalClinicalInstitutionalVerificationEvents').doc(eid),
    tenant.collection('externalClinicalInstitutionalVerificationCommands').doc(eid));
  if(!event.exists||!cmd.exists||
    event.get('dossierDigest')!==head.get('dossierDigest')||
    cmd.get('dossierDigest')!==head.get('dossierDigest')||
    cmd.get('eventType')!=='INSTITUTIONAL_EVIDENCE_DOSSIER_ENROLLED')
    return DENY('CI_EXT24_DOSSIER_LINEAGE_INVALID');
  const dossier=event.get('dossier') as InstitutionalEvidenceDossier;
  const endorsements=event.get('endorsements') as InstitutionalEndorsement[];
  const assessed=verifyInstitutionalEvidence({dossier,endorsements,
    independentVerifierPins,tenantId,facilityId,issuerId,now});
  if(!assessed.valid||assessed.dossierDigest!==head.get('dossierDigest'))
    return DENY('CI_EXT24_CURRENT_VERDICT_INVALID');
  return assessed;
}
