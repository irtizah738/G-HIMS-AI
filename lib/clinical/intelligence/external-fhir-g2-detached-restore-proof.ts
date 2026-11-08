/**
 * Local-only detached recovery inventory, layered ON TOP of the full Stage F
 * clinical/consent/manifest proof. Does not back up FHIR data, release clinical
 * facts, or establish an independently hosted backup/witness service.
 *
 * An external custodian must retain the returned opaque certificate and its
 * HMAC key outside the Firestore restore domain. NEVER persist either there.
 */
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {
  assertStageFEmulatorOnly,assertStageFMultiRecoveryEvidence,
  stageFAnchorFingerprint,type StageFMultiEvidence,
} from './external-fhir-poll-multi-recovery';

type Entry=Readonly<{slot:string;tagHex:string}>;
export type G2DetachedRestoreCertificate=Readonly<{
  schemaVersion:1;
  kind:'SYNTHETIC_DETACHED_RESTORE_DATA_INVENTORY';
  stageFAnchorFingerprint:string;
  entries:readonly Entry[];
  macHex:string;
}>;
const HEX=/^[a-f0-9]{64}$/;
const MAX_SLOTS=256;
const MAX_SLOT_BYTES=512_000;
const MAX_BYTES=12_000_000;
function deny(code:string):never{throw new Error('G2_DETACHED_RESTORE_'+code);}
function exactFields(value:unknown,keys:readonly string[]):boolean{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const present=Object.keys(value).sort();
  const expected=[...keys].sort();
  return present.length===expected.length&&
    present.every((field,i)=>field===expected[i]);
}
function canonical(value:unknown):string{
  if(value===null||typeof value!=='object'){
    const encoded=JSON.stringify(value);
    if(encoded===undefined||typeof value==='number'&&!Number.isFinite(value))
      deny('NON_JSON_VALUE');
    return encoded;
  }
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const o=value as Record<string,unknown>;
  const keys=Object.keys(o).sort();
  return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}';
}
function normalized(value:unknown):string{
  let raw:string|undefined;
  try{raw=JSON.stringify(value,(_k,v)=>{
    if(typeof v==='bigint'||typeof v==='function'||typeof v==='symbol'||
       typeof v==='number'&&!Number.isFinite(v))deny('NON_JSON_VALUE');
    return v;
  });}catch(e){
    if(e instanceof Error&&e.message.startsWith('G2_DETACHED_RESTORE_'))throw e;
    deny('NON_JSON_VALUE');
  }
  if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>MAX_SLOT_BYTES)
    deny('SLOT_SIZE_INVALID');
  return canonical(JSON.parse(raw));
}
function contentSlots(e:StageFMultiEvidence):readonly [string,unknown][]{
  const slots:[string,unknown][]=[
    ['source',e.source],['lease',e.lease],
  ];
  e.pages.forEach((p,i)=>{
    slots.push(
      ['page:'+i+':manifest',p.manifest],
      ['page:'+i+':revision',p.manifestRevision],
      ['page:'+i+':sealed',p.sealed],
      ['page:'+i+':event',p.manifestEvent],
      ['page:'+i+':audit',p.manifestAudit],
      ['page:'+i+':outbox',p.manifestOutbox],
    );
  });
  const STEP_KEYS=[
    'reservation','checkpoint','checkpointAudit','checkpointOutbox',
    'receipt','head','importEvent','importAudit','importOutbox',
    'availability','link','patient',
  ] as const;
  e.steps.forEach((p,i)=>{
    STEP_KEYS.forEach(k=>slots.push(['step:'+i+':'+k,p[k]]));
  });
  e.abandonedReservations.forEach((r,i)=>slots.push(['abandoned:'+i,r]));
  slots.push(['review:security',e.reviews.find(r=>r.role==='SECURITY_REVIEWER')??null]);
  slots.push(['review:clinical',e.reviews.find(r=>r.role==='CLINICAL_REVIEWER')??null]);
  if(!slots.length||slots.length>MAX_SLOTS||
     new Set(slots.map(s=>s[0])).size!==slots.length)deny('INVENTORY_CARDINALITY_INVALID');
  return slots;
}
export function g2RestoreCertificateFingerprint(cert:G2DetachedRestoreCertificate):string{
  if(!exactFields(cert,['schemaVersion','kind','stageFAnchorFingerprint','entries','macHex'])||
     cert.schemaVersion!==1||
     cert.kind!=='SYNTHETIC_DETACHED_RESTORE_DATA_INVENTORY'||
     !HEX.test(cert.macHex)||!HEX.test(cert.stageFAnchorFingerprint)||
     !Array.isArray(cert.entries)||cert.entries.length<1||
     cert.entries.length>MAX_SLOTS||
     cert.entries.some(e=>!exactFields(e,['slot','tagHex'])||
       typeof e.slot!=='string'||e.slot.length>64||
       !/^[A-Za-z0-9:]+$/.test(e.slot)||!HEX.test(e.tagHex))||
     new Set(cert.entries.map(e=>e.slot)).size!==cert.entries.length)
    deny('CERTIFICATE_INVALID');
  return createHash('sha256').update(canonical(cert),'utf8').digest('hex');
}
function certificateContent(cert:G2DetachedRestoreCertificate):unknown{
  return ['HELIXIS_G2_DETACHED_RESTORE_CERTIFICATE_V1',cert.schemaVersion,
    cert.kind,cert.stageFAnchorFingerprint,cert.entries];
}
/** Ephemeral TEST key. HMAC prevents trivial offline guesses of clinical data. */
export class EmulatorOnlyG2DetachedRestoreSigner{
  private readonly key:Buffer;
  constructor(key:Uint8Array){
    assertStageFEmulatorOnly();
    if(key.byteLength!==32)deny('KEY_LENGTH_INVALID');
    this.key=Buffer.from(key);
  }
  private tag(domain:string,content:unknown):string{
    return createHmac('sha256',this.key)
      .update(canonical(['HELIXIS_G2_RESTORE_V1',domain,content]),'utf8')
      .digest('hex');
  }
  sign(evidence:StageFMultiEvidence):G2DetachedRestoreCertificate{
    assertStageFEmulatorOnly();
    assertStageFMultiRecoveryEvidence(evidence);
    const fp=stageFAnchorFingerprint(evidence.anchor);
    let total=0;
    const entries=contentSlots(evidence).map(([slot,body])=>{
      const text=normalized(body);
      total+=Buffer.byteLength(text,'utf8');
      if(total>MAX_BYTES)deny('TOTAL_SIZE_INVALID');
      return {slot,tagHex:this.tag('SLOT:'+slot,[fp,text])};
    });
    const partial={
      schemaVersion:1 as const,
      kind:'SYNTHETIC_DETACHED_RESTORE_DATA_INVENTORY' as const,
      stageFAnchorFingerprint:fp,
      entries,
    };
    const macHex=this.tag('CERTIFICATE',certificateContent({...partial,macHex:''}));
    return {...partial,macHex};
  }
  verify(evidence:StageFMultiEvidence,cert:G2DetachedRestoreCertificate):void{
    assertStageFEmulatorOnly();
    g2RestoreCertificateFingerprint(cert);
    const expected=this.sign(evidence);
    if(cert.stageFAnchorFingerprint!==expected.stageFAnchorFingerprint||
       cert.entries.length!==expected.entries.length||
       cert.entries.some((entry,i)=>
         entry.slot!==expected.entries[i].slot||
         !timingSafeEqual(Buffer.from(entry.tagHex,'hex'),
           Buffer.from(expected.entries[i].tagHex,'hex')))||
       !timingSafeEqual(Buffer.from(cert.macHex,'hex'),
         Buffer.from(expected.macHex,'hex')))deny('INVENTORY_OR_SIGNATURE_MISMATCH');
  }
}
