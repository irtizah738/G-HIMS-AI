/**
 * CI-EXT-24: signed trust-distribution handoff contract.
 *
 * STAGING ONLY: never actually publishes a public key to a hospital,
 * app, browser, device or HIS. No offline client can accept this object
 * as an authorization. A producer/consumer with an independent trust
 * distribution and rollback/revocation service has NOT been commissioned.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';
import type {Firestore,Transaction} from 'firebase-admin/firestore';
import {inspectCurrentHospitalTrust,
  type PinnedHospitalTrustSteward} from './external-hospital-trust-anchor';
import {inspectInstitutionalEvidenceDossier,
  type PinnedInstitutionalVerifier} from './external-institutional-verification';

export type DistributionSignerRole=
  'TRUST_DISTRIBUTION_OPERATOR'|'INDEPENDENT_SECURITY_AUDITOR';
export type PinnedDistributionSigner=Readonly<{
  signerId:string;keyId:string;role:DistributionSignerRole;
  tenantId:string;facilityId:string;issuerId:string;
  publicKeySpkiPem:string;sha256SpkiFingerprint:string;
  status:'ACTIVE'|'REVOKED';validFrom:number;validUntil:number;
}>;
export type TrustDistributionManifest=Readonly<{
  schemaVersion:1;tenantId:string;facilityId:string;issuerId:string;
  destinationId:string;distributionId:string;sequence:number;
  anchorEventId:string;anchorEventHash:string;
  anchorRevision:number;issuerKeyId:string;issuerSpkiFingerprint:string;
  institutionalDossierId:string;institutionalDossierDigest:string;
  issuedAt:number;validUntil:number;deliveryMode:'HELD_NOT_DELIVERED';
}>;
export type DistributionSignature=Readonly<{
  signerId:string;keyId:string;role:DistributionSignerRole;
  signatureBase64Url:string;
}>;
export type DistributionVerificationResult=Readonly<{
  valid:boolean;reasonCode:string;manifestDigest:string|null;
  delivered:false;clinicalUseAuthorized:false;aiDraftingEligible:false;
}>;
const ID=/^[A-Za-z0-9._-]{1,128}$/;
const HEX=/^[a-f0-9]{64}$/;
const B64=/^[A-Za-z0-9_-]{86}$/;
const MAX_TTL=10*60_000;
type Row=Record<string,unknown>;
function id(v:unknown):v is string{
  return typeof v==='string'&&ID.test(v)&&v!=='.'&&v!=='..';
}
function stamp(v:unknown):v is number{
  return typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
}
function exact(v:unknown,keys:readonly string[]):v is Row{
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const a=Object.keys(v).sort(),b=[...keys].sort();
  return a.length===b.length&&a.every((k,i)=>k===b[i]);
}
function canonical(v:unknown):string{
  if(v===null||typeof v!=='object')return JSON.stringify(v)??'null';
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  const row=v as Row;
  return '{'+Object.keys(row).sort()
    .map(k=>JSON.stringify(k)+':'+canonical(row[k])).join(',')+'}';
}
function sha(v:unknown):string{
  return createHash('sha256').update(canonical(v)).digest('hex');
}
function deny(reasonCode:string):DistributionVerificationResult{
  return {valid:false,reasonCode,manifestDigest:null,
    delivered:false,clinicalUseAuthorized:false,aiDraftingEligible:false};
}
function testOnly():void{
  if(process.env.GHIMS_RUNTIME_MODE!=='TEST'||
    process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080'||
    process.env.FIREBASE_PROJECT_ID!=='ghims-p4-ci'||
    process.env.GHIMS_CI_EXTERNAL_TRUST_DISTRIBUTION_ENABLED!=='true')
    throw Error('CI_EXT24_DISTRIBUTION_EMULATOR_ONLY');
}
export function distributionSigningBytes(m:TrustDistributionManifest,
  role:DistributionSignerRole,signerId:string,keyId:string):Buffer{
  return Buffer.from('HELIXIS_CI_EXT24_TRUST_HANDOFF_V1\n'+
    canonical({manifest:m,role,signerId,keyId}),'utf8');
}
export function distributionManifestDigest(m:TrustDistributionManifest):string{
  return sha(['HELIXIS_CI_EXT24_MANIFEST_V1',m]);
}
export function verifyTrustDistributionManifest(args:Readonly<{
  manifest:unknown;signatures:readonly DistributionSignature[];
  independentlyPinnedSigners:readonly PinnedDistributionSigner[];
  tenantId:string;facilityId:string;issuerId:string;
  now:number;minimumNextSequence:number;
}>):DistributionVerificationResult{
  const {manifest,signatures,independentlyPinnedSigners:pins,
    tenantId,facilityId,issuerId,now,minimumNextSequence}=args;
  if(!exact(manifest,['schemaVersion','tenantId','facilityId','issuerId',
    'destinationId','distributionId','sequence',
    'anchorEventId','anchorEventHash','anchorRevision','issuerKeyId',
    'issuerSpkiFingerprint','institutionalDossierId',
    'institutionalDossierDigest','issuedAt','validUntil','deliveryMode']))
    return deny('CI_EXT24_MANIFEST_SCHEMA_INVALID');
  const m=manifest as TrustDistributionManifest;
  if(m.schemaVersion!==1||m.tenantId!==tenantId||m.facilityId!==facilityId||
    m.issuerId!==issuerId||![tenantId,facilityId,issuerId,
      m.destinationId,m.distributionId,m.anchorEventId,m.issuerKeyId,
      m.institutionalDossierId].every(id)||
    !HEX.test(m.anchorEventHash)||!HEX.test(m.issuerSpkiFingerprint)||
    !HEX.test(m.institutionalDossierDigest)||
    !stamp(m.anchorRevision)||!stamp(m.sequence)||!stamp(minimumNextSequence)||
    m.sequence<minimumNextSequence||!stamp(now)||
    !stamp(m.issuedAt)||!stamp(m.validUntil)||
    now<m.issuedAt-120_000||now>=m.validUntil||
    m.validUntil<=m.issuedAt||
    m.validUntil-m.issuedAt>MAX_TTL||
    m.deliveryMode!=='HELD_NOT_DELIVERED')
    return deny('CI_EXT24_MANIFEST_SCOPE_TIME_OR_ROLLBACK');
  const roles:DistributionSignerRole[]=[
    'TRUST_DISTRIBUTION_OPERATOR','INDEPENDENT_SECURITY_AUDITOR'];
  if(!Array.isArray(signatures)||signatures.length!==2||
    !Array.isArray(pins)||pins.length<2||
    new Set(signatures.map(x=>x.signerId)).size!==2||
    new Set(signatures.map(x=>x.role)).size!==2)
    return deny('CI_EXT24_DISTRIBUTION_QUORUM_REQUIRED');
  const observed=new Set<string>();
  for(const role of roles){
    const signature=signatures.find(x=>x.role===role);
    if(!exact(signature,['signerId','keyId','role','signatureBase64Url'])||
      !id(signature.signerId)||!id(signature.keyId)||
      typeof signature.signatureBase64Url!=='string'||
      !B64.test(signature.signatureBase64Url))
      return deny('CI_EXT24_DISTRIBUTION_SIGNATURE_SCHEMA_INVALID');
    const pin=pins.find(x=>x.role===role&&
      x.signerId===signature.signerId&&x.keyId===signature.keyId);
    if(!pin||pin.status!=='ACTIVE'||pin.tenantId!==tenantId||
      pin.facilityId!==facilityId||pin.issuerId!==issuerId||
      pin.signerId===issuerId||pin.signerId===m.destinationId||
      !stamp(pin.validFrom)||!stamp(pin.validUntil)||
      now<pin.validFrom||now>=pin.validUntil||
      m.issuedAt<pin.validFrom||m.validUntil>pin.validUntil||
      observed.has(pin.sha256SpkiFingerprint))
      return deny('CI_EXT24_DISTRIBUTION_SIGNER_UNTRUSTED');
    try{
      if(typeof pin.publicKeySpkiPem!=='string'||
        pin.publicKeySpkiPem.length>2048||!HEX.test(pin.sha256SpkiFingerprint))
        return deny('CI_EXT24_DISTRIBUTION_PIN_INVALID');
      const key=createPublicKey(pin.publicKeySpkiPem);
      if(key.asymmetricKeyType!=='ed25519'||createHash('sha256')
        .update(key.export({type:'spki',format:'der'})).digest('hex')!==
          pin.sha256SpkiFingerprint)
        return deny('CI_EXT24_DISTRIBUTION_PIN_INVALID');
      const sig=Buffer.from(signature.signatureBase64Url,'base64url');
      if(sig.length!==64||sig.toString('base64url')!==signature.signatureBase64Url||
        !verify(null,distributionSigningBytes(m,role,
          signature.signerId,signature.keyId),key,sig))
        return deny('CI_EXT24_DISTRIBUTION_SIGNATURE_INVALID');
    }catch{return deny('CI_EXT24_DISTRIBUTION_SIGNATURE_INVALID');}
    observed.add(pin.sha256SpkiFingerprint);
  }
  return {valid:true,reasonCode:'CI_EXT24_SIGNED_QUARANTINED_HANDOFF',
    manifestDigest:distributionManifestDigest(m),
    delivered:false,clinicalUseAuthorized:false,aiDraftingEligible:false};
}
export async function stageTrustDistributionHandoff(args:Readonly<{
  db:Firestore;manifest:TrustDistributionManifest;
  signatures:readonly DistributionSignature[];
  independentDistributionPins:readonly PinnedDistributionSigner[];
  independentInstitutionPins:readonly PinnedInstitutionalVerifier[];
  independentStewardPins:readonly PinnedHospitalTrustSteward[];
  now?:()=>number;
}>):Promise<Readonly<{
  staged:boolean;replay:boolean;manifestDigest:string;
  delivered:false;clinicalUseAuthorized:false;aiDraftingEligible:false;
}>>{
  testOnly();
  const {db,manifest:m,signatures,independentDistributionPins,
    independentInstitutionPins,independentStewardPins}=args;
  const now=(args.now||Date.now)();
  const tenant=db.collection('tenants').doc(m.tenantId);
  const handoffRef=tenant.collection('externalClinicalTrustDistributionHandoffs')
    .doc(m.distributionId);
  const journalRef=tenant.collection('externalClinicalTrustDistributionCommands')
    .doc(m.distributionId);
  const outboxRef=tenant.collection('externalClinicalTrustDistributionOutbox')
    .doc(m.distributionId);
  const headId='tdh_'+sha([m.tenantId,m.issuerId,m.destinationId]);
  const headRef=tenant.collection('externalClinicalTrustDistributionHeads')
    .doc(headId);
  return db.runTransaction(async(tx:Transaction)=>{
    const [latest,record,journal,rootHead,institutionHead]=await tx.getAll(
      headRef,handoffRef,journalRef,
      tenant.collection('externalClinicalHospitalTrustHeads').doc(m.issuerId),
      tenant.collection('externalClinicalInstitutionalVerificationHeads')
        .doc(m.issuerId),
    );
    const prevSequence=latest.exists?latest.get('sequence') as unknown:0;
    if(typeof prevSequence!=='number'||!Number.isSafeInteger(prevSequence)||
      prevSequence<0)throw Error('CI_EXT24_DISTRIBUTION_SEQUENCE_CORRUPT');
    const assessed=verifyTrustDistributionManifest({
      manifest:m,signatures,independentlyPinnedSigners:independentDistributionPins,
      tenantId:m.tenantId,facilityId:m.facilityId,issuerId:m.issuerId,
      now,minimumNextSequence:record.exists?m.sequence:prevSequence+1,
    });
    if(!assessed.valid||!assessed.manifestDigest)
      throw Error(assessed.reasonCode);
    const digest=assessed.manifestDigest;
    if(record.exists||journal.exists){
      if(!record.exists||!journal.exists||!latest.exists||
        record.get('manifestDigest')!==digest||
        journal.get('manifestDigest')!==digest||
        latest.get('currentDistributionId')!==m.distributionId||
        latest.get('sequence')!==m.sequence)
        throw Error('CI_EXT24_DISTRIBUTION_REPLAY_CONFLICT');
      return {staged:true,replay:true,manifestDigest:digest,
        delivered:false,clinicalUseAuthorized:false,aiDraftingEligible:false};
    }
    const trust=await inspectCurrentHospitalTrust({
      tx,tenant,issuerId:m.issuerId,tenantId:m.tenantId,
      facilityId:m.facilityId,now,
      independentlyPinnedStewards:independentStewardPins,
    });
    if(!trust.valid||!trust.pin)
      throw Error('CI_EXT24_CURRENT_ISSUER_ROOT_REQUIRED');
    const institution=await inspectInstitutionalEvidenceDossier({
      tx,tenant,issuerId:m.issuerId,tenantId:m.tenantId,
      facilityId:m.facilityId,now,
      independentVerifierPins:independentInstitutionPins,
    });
    if(!institution.valid||!institution.dossierDigest)
      throw Error('CI_EXT24_CURRENT_INSTITUTIONAL_DOSSIER_REQUIRED');
    if(!rootHead.exists||!institutionHead.exists||
      rootHead.get('currentEventId')!==m.anchorEventId||
      rootHead.get('currentEventHash')!==m.anchorEventHash||
      rootHead.get('revision')!==m.anchorRevision||
      trust.pin.keyId!==m.issuerKeyId||
      trust.pin.sha256SpkiFingerprint!==m.issuerSpkiFingerprint||
      institutionHead.get('currentEventId')!==m.institutionalDossierId||
      institution.dossierDigest!==m.institutionalDossierDigest)
      throw Error('CI_EXT24_HANDOFF_ROOT_OR_DOSSIER_STALE');
    const common={
      schemaVersion:1,tenantId:m.tenantId,facilityId:m.facilityId,
      issuerId:m.issuerId,destinationId:m.destinationId,
      distributionId:m.distributionId,manifestDigest:digest,
      sequence:m.sequence,anchorRevision:m.anchorRevision,
      issuedAt:m.issuedAt,validUntil:m.validUntil,
      immutable:true,delivered:false,clinicalUseAuthorized:false,
      aiDraftingEligible:false,
    };
    tx.create(handoffRef,{...common,manifest:m,signatures,
      state:'QUARANTINED_HELD'});
    tx.create(journalRef,{...common,
      eventType:'TRUST_HANDOFF_STAGED_NON_PROMOTING'});
    tx.create(outboxRef,{...common,status:'HELD',
      destination:'NON_PUBLISHING_TRUST_DISTRIBUTION'});
    const nextHead={...common,currentDistributionId:m.distributionId,
      status:'HELD_NOT_DELIVERED'};
    if(latest.exists)tx.update(headRef,nextHead);
    else tx.create(headRef,nextHead);
    tx.create(tenant.collection('auditLogs')
      .doc('tda_'+sha([m.tenantId,m.distributionId])),{
        tenantId:m.tenantId,facilityId:m.facilityId,issuerId:m.issuerId,
        action:'TRUST_HANDOFF_QUARANTINED',distributionId:m.distributionId,
        manifestDigest:digest,recordedAt:now,
        immutable:true,clinicalUseAuthorized:false,
      });
    return {staged:true,replay:false,manifestDigest:digest,
      delivered:false,clinicalUseAuthorized:false,aiDraftingEligible:false};
  });
}
