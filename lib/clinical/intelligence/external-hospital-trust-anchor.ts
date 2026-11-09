/**
 * CI-EXT-22: two-/three-steward hospital issuer trust-root lifecycle.
 *
 * This is an isolated, emulator-only proof of governance. Independently
 * pinned steward public keys MUST be provisioned out of band; neither the
 * hospital issuer key being enrolled nor Firestore tenant data can bootstrap
 * steward trust. Never expose an HTTP route or enable in production.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';
import type {Firestore,DocumentReference,Transaction} from 'firebase-admin/firestore';
import type {PinnedHospitalIssuerKey} from './external-hospital-issuer-attestation';

export type HospitalTrustOperation='ENROLL'|'ROTATE'|'REVOKE'|'RECOVER';
export type StewardRole='HOSPITAL_TRUSTEE'|'SECURITY_TRUSTEE'|'RECOVERY_TRUSTEE';
export type HospitalTrustCommand=Readonly<{
  schemaVersion:1;operation:HospitalTrustOperation;
  tenantId:string;facilityId:string;issuerId:string;
  commandId:string;expectedRevision:number;issuedAt:number;
  evidenceDigest:string;
  reasonCode:'INSTITUTIONAL_ONBOARDING'|'SCHEDULED_ROTATION'|
    'KEY_COMPROMISE'|'INSTITUTIONAL_RECOVERY';
  newPin:PinnedHospitalIssuerKey|null;
}>;
export type PinnedHospitalTrustSteward=Readonly<{
  stewardId:string;role:StewardRole;tenantId:string;facilityId:string;
  permittedIssuerIds:readonly string[];
  publicKeySpkiPem:string;sha256SpkiFingerprint:string;
  status:'ACTIVE'|'REVOKED';validFrom:number;validUntil:number;
}>;
export type HospitalTrustEndorsement=Readonly<{
  stewardId:string;signatureBase64Url:string;
}>;
export type HospitalTrustResult=Readonly<{
  eventId:string;revision:number;status:'ACTIVE'|'REVOKED';
  replay:boolean;clinicalUseAuthorized:false;aiDraftingEligible:false;
}>;
type Row=Record<string,unknown>;
type TrustEventPayload=Readonly<{
  schemaVersion:1;command:HospitalTrustCommand;
  revision:number;status:'ACTIVE'|'REVOKED';
  previousEventId:string|null;previousEventHash:string|null;
  stewardIds:readonly string[];
  recordedAt:number;
}>;
const ID=/^[A-Za-z0-9._-]{1,128}$/;
const HEX=/^[a-f0-9]{64}$/;
const B64=/^[A-Za-z0-9_-]{86}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function id(v:unknown):v is string{return typeof v==='string'&&ID.test(v)&&v!=='.'&&v!=='..';}
function time(v:unknown):v is number{return typeof v==='number'&&Number.isSafeInteger(v)&&v>0;}
function exact(v:unknown,fields:readonly string[]):v is Row{
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const a=Object.keys(v).sort(),b=[...fields].sort();
  return a.length===b.length&&a.every((x,i)=>x===b[i]);
}
function canonical(v:unknown):string{
  if(v===null||typeof v!=='object')return JSON.stringify(v)??'null';
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  const o=v as Row;return '{'+Object.keys(o).sort()
    .map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';
}
function sha(v:unknown):string{return createHash('sha256').update(canonical(v)).digest('hex');}
function fail(code:string):never{throw new Error('CI_EXT22_'+code);}
export function trustCommandBytes(command:HospitalTrustCommand):Buffer{
  return Buffer.from('HELIXIS_CI_EXT22_TRUST_COMMAND_V1\n'+canonical(command),'utf8');
}
export function trustCommandHash(command:HospitalTrustCommand):string{
  return createHash('sha256').update(trustCommandBytes(command)).digest('hex');
}
function eventHash(p:TrustEventPayload):string{
  return sha(['HELIXIS_CI_EXT22_TRUST_EVENT_V1',p]);
}
function testOnly():boolean{
  return process.env.GHIMS_RUNTIME_MODE==='TEST'&&
    process.env.FIRESTORE_EMULATOR_HOST==='127.0.0.1:8080'&&
    process.env.FIREBASE_PROJECT_ID==='ghims-p4-ci'&&
    process.env.GHIMS_CI_EXTERNAL_TRUST_LIFECYCLE_ENABLED==='true';
}
function requireTest():void{if(!testOnly())fail('EMULATOR_ONLY');}
function publicKey(pem:string,fingerprint:string){
  if(typeof pem!=='string'||pem.length>2048||!HEX.test(fingerprint))
    fail('PUBLIC_KEY_INVALID');
  try{
    const key=createPublicKey(pem);
    if(key.asymmetricKeyType!=='ed25519'||sha(key.export({type:'spki',format:'der'}))===fingerprint)
      { /* The actual SPKI fingerprint check below uses bytes, not JSON. */ }
    if(key.asymmetricKeyType!=='ed25519')fail('KEY_ALGORITHM_INVALID');
    const observed=createHash('sha256')
      .update(key.export({type:'spki',format:'der'})).digest('hex');
    if(observed!==fingerprint)fail('KEY_FINGERPRINT_MISMATCH');
    return key;
  }catch(e){
    if(e instanceof Error&&e.message.startsWith('CI_EXT22_'))throw e;
    fail('PUBLIC_KEY_INVALID');
  }
}
function verifiedPin(command:HospitalTrustCommand,now:number):void{
  const p=command.newPin;
  if(command.operation==='REVOKE'){
    if(p!==null)fail('REVOKE_CANNOT_SUPPLY_KEY');
    return;
  }
  if(!p||!exact(p,['issuerId','keyId','tenantId','facilityId',
    'publicKeySpkiPem','sha256SpkiFingerprint','permittedKinds',
    'status','keyRevision','validFrom','validUntil'])||
    p.issuerId!==command.issuerId||p.tenantId!==command.tenantId||
    p.facilityId!==command.facilityId||!id(p.keyId)||
    p.status!=='ACTIVE'||p.keyRevision!==command.expectedRevision+1||
    !time(p.validFrom)||!time(p.validUntil)||p.validFrom>now||
    p.validUntil<=now||
    !Array.isArray(p.permittedKinds)||p.permittedKinds.length===0||
    !p.permittedKinds.every(x=>['CLINICIAN','SITE','GOVERNANCE_GRANT'].includes(x))||
    new Set(p.permittedKinds).size!==p.permittedKinds.length)
    fail('NEW_PIN_INVALID');
  publicKey(p.publicKeySpkiPem,p.sha256SpkiFingerprint);
}
export function assertHospitalTrustCommand(input:unknown):asserts input is HospitalTrustCommand{
  if(!exact(input,['schemaVersion','operation','tenantId','facilityId',
    'issuerId','commandId','expectedRevision','issuedAt',
    'evidenceDigest','reasonCode','newPin']))fail('COMMAND_SCHEMA_INVALID');
  const c=input as HospitalTrustCommand;
  if(c.schemaVersion!==1||
    !['ENROLL','ROTATE','REVOKE','RECOVER'].includes(c.operation)||
    !id(c.tenantId)||!id(c.facilityId)||!id(c.issuerId)||
    typeof c.commandId!=='string'||!UUID.test(c.commandId)||
    !Number.isSafeInteger(c.expectedRevision)||c.expectedRevision<0||
    !time(c.issuedAt)||!HEX.test(c.evidenceDigest)||
    ({ENROLL:'INSTITUTIONAL_ONBOARDING',ROTATE:'SCHEDULED_ROTATION',
      REVOKE:'KEY_COMPROMISE',RECOVER:'INSTITUTIONAL_RECOVERY'} as
      Record<HospitalTrustOperation,string>)[c.operation]!==c.reasonCode)
    fail('COMMAND_FIELDS_INVALID');
}
function requiredRoles(op:HospitalTrustOperation):StewardRole[]{
  return op==='RECOVER'?
    ['HOSPITAL_TRUSTEE','SECURITY_TRUSTEE','RECOVERY_TRUSTEE']:
    op==='REVOKE'?
      ['SECURITY_TRUSTEE','RECOVERY_TRUSTEE']:
      ['HOSPITAL_TRUSTEE','SECURITY_TRUSTEE'];
}
function verifiedStewards(command:HospitalTrustCommand,
  endorsements:readonly HospitalTrustEndorsement[],
  stewards:readonly PinnedHospitalTrustSteward[],now:number):string[]{
  const roles=requiredRoles(command.operation);
  if(endorsements.length!==roles.length||
    new Set(endorsements.map(e=>e.stewardId)).size!==endorsements.length)
    fail('INDEPENDENT_QUORUM_REQUIRED');
  const found=new Set<StewardRole>();
  const signerIds:string[]=[];
  for(const endorsement of endorsements){
    if(!exact(endorsement,['stewardId','signatureBase64Url'])||
      !id(endorsement.stewardId)||!B64.test(endorsement.signatureBase64Url))
      fail('ENDORSEMENT_INVALID');
    const steward=stewards.find(x=>x.stewardId===endorsement.stewardId);
    if(!steward||steward.status!=='ACTIVE'||
      steward.tenantId!==command.tenantId||
      steward.facilityId!==command.facilityId||
      !Array.isArray(steward.permittedIssuerIds)||
      !steward.permittedIssuerIds.includes(command.issuerId)||
      !roles.includes(steward.role)||found.has(steward.role)||
      steward.stewardId===command.issuerId||
      !time(steward.validFrom)||!time(steward.validUntil)||
      now<steward.validFrom||now>=steward.validUntil)
      fail('STEWARDS_NOT_INDEPENDENT_CURRENT');
    const pub=publicKey(steward.publicKeySpkiPem,steward.sha256SpkiFingerprint);
    const sig=Buffer.from(endorsement.signatureBase64Url,'base64url');
    if(sig.length!==64||sig.toString('base64url')!==endorsement.signatureBase64Url||
      !verify(null,trustCommandBytes(command),pub,sig))
      fail('STEWARD_SIGNATURE_INVALID');
    signerIds.push(steward.stewardId);
    found.add(steward.role);
  }
  if(roles.some(r=>!found.has(r)))fail('INDEPENDENT_QUORUM_REQUIRED');
  return signerIds.sort();
}
function headFromEvent(p:TrustEventPayload,eid:string,hash:string):Row{
  return {
    schemaVersion:1,tenantId:p.command.tenantId,facilityId:p.command.facilityId,
    issuerId:p.command.issuerId,status:p.status,revision:p.revision,
    currentPin:p.status==='ACTIVE'?p.command.newPin:null,
    keyId:p.status==='ACTIVE'?p.command.newPin?.keyId:null,
    currentEventId:eid,currentEventHash:hash,
    previousEventId:p.previousEventId,previousEventHash:p.previousEventHash,
    immutableSourceEvent:true,clinicalUseAuthorized:false,
    aiDraftingEligible:false,
  };
}
export function verifyTrustHead(head:Row,event:Row,eventIdValue:string):boolean{
  const p=event.payload as TrustEventPayload|undefined;
  if(!p||p.schemaVersion!==1||!p.command||
    event.eventId!==eventIdValue||event.immutable!==true||
    event.clinicalUseAuthorized!==false||
    event.aiDraftingEligible!==false||
    event.eventHash!==eventHash(p)||head.currentEventId!==eventIdValue||
    head.currentEventHash!==event.eventHash)return false;
  const e=headFromEvent(p,eventIdValue,event.eventHash as string);
  return Object.keys(e).every(k=>canonical(head[k])===canonical(e[k]));
}
const commandKey=(c:HospitalTrustCommand)=>
  'htc_'+sha(['HELIXIS_CI_EXT22_COMMAND_ID_V1',c.tenantId,c.commandId.toLowerCase()]);
const eventKey=(cid:string)=>'hte_'+cid.slice(4);
function summary(p:TrustEventPayload,eid:string,replay:boolean):HospitalTrustResult{
  return {eventId:eid,revision:p.revision,status:p.status,replay,
    clinicalUseAuthorized:false,aiDraftingEligible:false};
}
export async function applyHospitalTrustLifecycle(args:Readonly<{
  db:Firestore;command:HospitalTrustCommand;
  endorsements:readonly HospitalTrustEndorsement[];
  independentlyPinnedStewards:readonly PinnedHospitalTrustSteward[];
  now?:()=>number;
}>):Promise<HospitalTrustResult>{
  requireTest();assertHospitalTrustCommand(args.command);
  const {db,command:c,endorsements,independentlyPinnedStewards}=args;
  const now=(args.now||Date.now)();
  if(!time(now)||Math.abs(now-c.issuedAt)>120_000)fail('COMMAND_TIME_STALE');
  verifiedPin(c,now);
  const signers=verifiedStewards(c,endorsements,independentlyPinnedStewards,now);
  const tenant=db.collection('tenants').doc(c.tenantId);
  const headRef=tenant.collection('externalClinicalHospitalTrustHeads').doc(c.issuerId);
  const cid=commandKey(c),eid=eventKey(cid),hash=trustCommandHash(c);
  const journalRef=tenant.collection('externalClinicalHospitalTrustCommands').doc(cid);
  const evtRef=tenant.collection('externalClinicalHospitalTrustEvents').doc(eid);
  return db.runTransaction(async(tx:Transaction)=>{
    const [headSnap,journalSnap,evtSnap]=await tx.getAll(headRef,journalRef,evtRef);
    if(journalSnap.exists){
      if(!headSnap.exists||!evtSnap.exists||
        journalSnap.get('requestHash')!==hash||
        journalSnap.get('eventId')!==eid||
        headSnap.get('currentEventId')!==eid||
        !verifyTrustHead(headSnap.data() as Row,evtSnap.data() as Row,eid))
        fail('IDEMPOTENCY_CONFLICT_OR_SUPERSEDED');
      return summary(evtSnap.get('payload') as TrustEventPayload,eid,true);
    }
    if(evtSnap.exists)fail('EVENT_EXISTS_WITHOUT_COMMAND');
    const prior=headSnap.exists?headSnap.data() as Row:undefined;
    if(c.operation==='ENROLL'){
      if(c.expectedRevision!==0||headSnap.exists)fail('TRUST_ALREADY_ONBOARDED');
    }else{
      if(!prior||prior.tenantId!==c.tenantId||
        prior.issuerId!==c.issuerId||prior.facilityId!==c.facilityId||
        prior.revision!==c.expectedRevision||!id(prior.currentEventId))
        fail('TRUST_REVISION_OR_SCOPE_CONFLICT');
      if(c.operation==='RECOVER'){
        if(prior.status!=='REVOKED')fail('RECOVERY_REQUIRES_REVOKED_ROOT');
      }else if(prior.status!=='ACTIVE')
        fail('ROOT_NOT_ACTIVE');
    }
    const prevRef=prior?
      tenant.collection('externalClinicalHospitalTrustEvents')
        .doc(prior.currentEventId as string):null;
    const newKeyRef=c.newPin?
      tenant.collection('externalClinicalHospitalTrustKeyUsage')
        .doc(c.newPin.keyId):null;
    const [oldEventSnap,keySnap]=await tx.getAll(
      ...(prevRef?[prevRef]:[]),...(newKeyRef?[newKeyRef]:[]));
    // The variable-length read set is unpacked by position.
    const previousSnap=prevRef?oldEventSnap:null;
    const usageSnap=newKeyRef?(prevRef?keySnap:oldEventSnap):null;
    if(prior&&(!previousSnap?.exists||
      !verifyTrustHead(prior,previousSnap.data() as Row,
        prior.currentEventId as string)))
      fail('PREVIOUS_EVENT_CHAIN_INVALID');
    if(newKeyRef&&usageSnap?.exists)fail('KEY_REUSE_FORBIDDEN');
    if(c.newPin&&prior?.currentPin&&
      (c.newPin.keyId===(prior.currentPin as PinnedHospitalIssuerKey).keyId||
       c.newPin.sha256SpkiFingerprint===
         (prior.currentPin as PinnedHospitalIssuerKey).sha256SpkiFingerprint))
      fail('NEW_KEY_NOT_DISTINCT');
    const revision=c.expectedRevision+1;
    const payload:TrustEventPayload={
      schemaVersion:1,command:c,revision,
      status:c.operation==='REVOKE'?'REVOKED':'ACTIVE',
      previousEventId:prior?.currentEventId as string||null,
      previousEventHash:prior?.currentEventHash as string||null,
      stewardIds:signers,recordedAt:now,
    };
    const ehash=eventHash(payload);
    const envelope={eventId:eid,eventHash:ehash,payload,endorsements,
      immutable:true,clinicalUseAuthorized:false,aiDraftingEligible:false};
    tx.create(evtRef,envelope);
    tx.create(journalRef,{
      tenantId:c.tenantId,commandId:cid,requestHash:hash,eventId:eid,
      status:payload.status,revision,immutable:true,
      clinicalUseAuthorized:false,aiDraftingEligible:false,
    });
    tx.create(tenant.collection('externalClinicalHospitalTrustOutbox').doc(eid),{
      ...envelope,status:'HELD',destination:'HOSPITAL_TRUST_GOVERNANCE',
    });
    tx.create(tenant.collection('auditLogs').doc('htaa_'+eid.slice(4)),{
      tenantId:c.tenantId,action:'HOSPITAL_TRUST_'+c.operation,
      actorId:signers.join('_'),issuerId:c.issuerId,facilityId:c.facilityId,
      eventId:eid,eventHash:ehash,recordedAt:now,immutable:true,
      clinicalUseAuthorized:false,
    });
    if(newKeyRef&&c.newPin)tx.create(newKeyRef,{
      tenantId:c.tenantId,issuerId:c.issuerId,
      keyId:c.newPin.keyId,spkiFingerprint:c.newPin.sha256SpkiFingerprint,
      firstEventId:eid,immutable:true,
    });
    const head=headFromEvent(payload,eid,ehash);
    if(prior)tx.update(headRef,head);
    else tx.create(headRef,head);
    return summary(payload,eid,false);
  });
}
/** Audit-only verification; does not supply a production trust root. */
export async function inspectCurrentHospitalTrust(args:Readonly<{
  tx:Transaction;tenant:DocumentReference;issuerId:string;
  tenantId:string;facilityId:string;now:number;
}>):Promise<{valid:boolean;reasonCode:string;pin:PinnedHospitalIssuerKey|null}>{
  if(!testOnly())return {valid:false,reasonCode:'CI_EXT22_NOT_COMMISSIONED',pin:null};
  const {tx,tenant,issuerId,tenantId,facilityId,now}=args;
  if(!id(issuerId)||!id(tenantId)||!id(facilityId)||!time(now))
    return {valid:false,reasonCode:'CI_EXT22_SCOPE_INVALID',pin:null};
  const h=await tx.get(tenant.collection('externalClinicalHospitalTrustHeads').doc(issuerId));
  if(!h.exists)return {valid:false,reasonCode:'CI_EXT22_ROOT_MISSING',pin:null};
  const data=h.data() as Row;
  if(data.tenantId!==tenantId||data.facilityId!==facilityId||
    !id(data.currentEventId)||data.status!=='ACTIVE')
    return {valid:false,reasonCode:'CI_EXT22_ROOT_REVOKED_OR_SCOPE_INVALID',pin:null};
  const e=await tx.get(tenant.collection('externalClinicalHospitalTrustEvents')
    .doc(data.currentEventId as string));
  if(!e.exists||!verifyTrustHead(data,e.data() as Row,data.currentEventId as string))
    return {valid:false,reasonCode:'CI_EXT22_ROOT_EVENT_TAMPERED',pin:null};
  const pin=data.currentPin as PinnedHospitalIssuerKey|null;
  if(!pin||pin.status!=='ACTIVE'||pin.tenantId!==tenantId||
    pin.facilityId!==facilityId||pin.issuerId!==issuerId||
    now<pin.validFrom||now>=pin.validUntil)
    return {valid:false,reasonCode:'CI_EXT22_ROOT_EXPIRED',pin:null};
  return {valid:true,reasonCode:'CI_EXT22_EVENT_BACKED_ROOT_NON_PROMOTING',pin};
}
