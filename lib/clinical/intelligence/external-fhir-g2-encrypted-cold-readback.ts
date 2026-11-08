/**
 * Encrypted synthetic G2 evidence backup and read-back qualification.
 * This is deliberately NOT a Firestore restore or clinical release.
 *
 * The AES key, Stage F signer key, detached HMAC certificate and trusted
 * latest archive fingerprint must be retained outside the backup file.
 * No GCP/KMS/vendor request, token, PHI log or Firestore write exists here.
 */
import {createCipheriv,createDecipheriv,createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {
  assertStageFEmulatorOnly,assertStageFMultiRecoveryEvidence,
  stageFAnchorFingerprint,type EmulatorOnlyStageFRecoverySigner,
  type StageFMultiEvidence,
} from './external-fhir-poll-multi-recovery';
import {
  EmulatorOnlyG2DetachedRestoreSigner,g2RestoreCertificateFingerprint,
  type G2DetachedRestoreCertificate,
} from './external-fhir-g2-detached-restore-proof';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64=/^[0-9a-f]{64}$/;
const HEX24=/^[0-9a-f]{24}$/;
const HEX32=/^[0-9a-f]{32}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_PLAINTEXT=12_000_000;
const MAX_FILE=18_000_000;
function deny(code:string):never {throw new Error('G2_COLD_READBACK_'+code);}
function isRecord(value:unknown):value is Record<string,unknown>{
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function exact(value:unknown,keys:readonly string[]):boolean {
  if(!isRecord(value))return false;
  const actual=Object.keys(value).sort(), expected=[...keys].sort();
  return actual.length===expected.length&&actual.every((name,i)=>name===expected[i]);
}
function assertKey(key:Uint8Array):Buffer{
  if(!(key instanceof Uint8Array)||key.byteLength!==32)deny('AES_KEY_INVALID');
  return Buffer.from(key);
}
function canonical(value:unknown):string{
  if(value===null||typeof value!=='object'){
    const text=JSON.stringify(value);
    if(typeof text!=='string'||typeof value==='number'&&!Number.isFinite(value))
      deny('NON_JSON_VALUE');
    return text;
  }
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(!isRecord(value))deny('NON_JSON_VALUE');
  const keys=Object.keys(value).sort();
  return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
function serialize(value:unknown):string {
  let raw:string|undefined;
  try {
    raw=JSON.stringify(value,(_k,v)=>{
      if(typeof v==='bigint'||typeof v==='function'||typeof v==='symbol'||
         typeof v==='number'&&!Number.isFinite(v))deny('NON_JSON_VALUE');
      return v;
    });
  } catch(e) {
    if(e instanceof Error&&e.message.startsWith('G2_COLD_READBACK_'))throw e;
    deny('NON_JSON_VALUE');
  }
  if(!raw||Buffer.byteLength(raw,'utf8')>MAX_PLAINTEXT)deny('PAYLOAD_SIZE_INVALID');
  return canonical(JSON.parse(raw));
}
function sha256(text:string):string{
  return createHash('sha256').update(text,'utf8').digest('hex');
}
function fixedHexEqual(a:string,b:string):boolean{
  return HEX64.test(a)&&HEX64.test(b)&&
    timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}

export type G2SyntheticColdBackup=Readonly<{
  schemaVersion:1;
  kind:'SYNTHETIC_G2_ENCRYPTED_COLD_READBACK_V1';
  suite:'AES_256_GCM_TEST_ONLY';
  archiveId:string;
  tenantId:string;
  sourceId:string;
  facilityId:string;
  stageFAnchorFingerprint:string;
  detachedCertificateFingerprint:string;
  nonceHex:string;
  tagHex:string;
  ciphertextBase64:string;
}>;

function header(record:G2SyntheticColdBackup):unknown{
  return ['HELIXIS_G2_ENCRYPTED_COLD_READBACK_V1',record.schemaVersion,
    record.kind,record.suite,record.archiveId,record.tenantId,
    record.sourceId,record.facilityId,
    record.stageFAnchorFingerprint,record.detachedCertificateFingerprint];
}
function assertEnvelope(value:unknown):asserts value is G2SyntheticColdBackup{
  if(!exact(value,[
    'schemaVersion','kind','suite','archiveId','tenantId','sourceId',
    'facilityId','stageFAnchorFingerprint','detachedCertificateFingerprint',
    'nonceHex','tagHex','ciphertextBase64',
  ]))deny('ENVELOPE_INVALID');
  const v=value as G2SyntheticColdBackup;
  if(v.schemaVersion!==1||v.kind!=='SYNTHETIC_G2_ENCRYPTED_COLD_READBACK_V1'||
     v.suite!=='AES_256_GCM_TEST_ONLY'||!UUID.test(v.archiveId)||
     !ID.test(v.tenantId)||!ID.test(v.facilityId)||!ID.test(v.sourceId)||
     !HEX64.test(v.stageFAnchorFingerprint)||!HEX64.test(v.detachedCertificateFingerprint)||
     !HEX24.test(v.nonceHex)||!HEX32.test(v.tagHex)||
     typeof v.ciphertextBase64!=='string'||
     v.ciphertextBase64.length<1||v.ciphertextBase64.length>MAX_FILE||
     !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.ciphertextBase64)||
     Buffer.from(v.ciphertextBase64,'base64').toString('base64')!==v.ciphertextBase64
  )deny('ENVELOPE_INVALID');
}

export function fingerprintSyntheticG2ColdBackup(envelope:G2SyntheticColdBackup):string {
  assertStageFEmulatorOnly();
  assertEnvelope(envelope);
  return sha256(canonical(envelope));
}

export function encryptVerifiedSyntheticG2Evidence(args:Readonly<{
  evidence:StageFMultiEvidence;
  stageFSigner:EmulatorOnlyStageFRecoverySigner;
  detachedSigner:EmulatorOnlyG2DetachedRestoreSigner;
  detachedCertificate:G2DetachedRestoreCertificate;
  encryptionKey:Uint8Array;
  archiveId:string;
}>):Readonly<{envelope:G2SyntheticColdBackup;fingerprint:string}>{
  assertStageFEmulatorOnly();
  const key=assertKey(args.encryptionKey);
  if(!UUID.test(args.archiveId))deny('ARCHIVE_ID_INVALID');
  args.stageFSigner.verify(args.evidence.anchor);
  assertStageFMultiRecoveryEvidence(args.evidence);
  args.detachedSigner.verify(args.evidence,args.detachedCertificate);
  const certificateFingerprint=g2RestoreCertificateFingerprint(args.detachedCertificate);
  const e=args.evidence,nonce=randomBytes(12);
  const partial={
    schemaVersion:1 as const,kind:'SYNTHETIC_G2_ENCRYPTED_COLD_READBACK_V1' as const,
    suite:'AES_256_GCM_TEST_ONLY' as const,archiveId:args.archiveId,
    tenantId:e.anchor.tenantId,sourceId:e.anchor.sourceId,
    facilityId:e.anchor.facilityId,
    stageFAnchorFingerprint:stageFAnchorFingerprint(e.anchor),
    detachedCertificateFingerprint:certificateFingerprint,
  };
  const aad=serialize(header({...partial,nonceHex:'',tagHex:'',ciphertextBase64:''}));
  const payload=Buffer.from(serialize(e),'utf8');
  const cipher=createCipheriv('aes-256-gcm',key,nonce);
  cipher.setAAD(Buffer.from(aad,'utf8'));
  const ciphertext=Buffer.concat([cipher.update(payload),cipher.final()]);
  const envelope:G2SyntheticColdBackup={...partial,
    nonceHex:nonce.toString('hex'),tagHex:cipher.getAuthTag().toString('hex'),
    ciphertextBase64:ciphertext.toString('base64')};
  return {envelope,fingerprint:fingerprintSyntheticG2ColdBackup(envelope)};
}

/**
 * Reads an encrypted snapshot into an in-memory, NON-OPERATIONAL quarantine.
 * A trusted current fingerprint and HMAC certificate must come from custody
 * independent of this file. It never creates fresh Firestore revisions.
 */
export function coldReadbackVerifiedSyntheticG2Evidence(args:Readonly<{
  envelope:unknown;
  expectedArchiveFingerprint:string;
  expectedArchiveId:string;
  expectedTenantId:string;
  expectedSourceId:string;
  expectedFacilityId:string;
  trustedDetachedCertificate:G2DetachedRestoreCertificate;
  stageFSigner:EmulatorOnlyStageFRecoverySigner;
  detachedSigner:EmulatorOnlyG2DetachedRestoreSigner;
  decryptionKey:Uint8Array;
}>):Readonly<{
  status:'QUARANTINED_REQUIRES_FRESH_ANCHOR';
  clinicalAuthority:false;
  sourceDispatchAllowed:false;
  productionRelease:'NO_GO';
  validatedEvidence:StageFMultiEvidence;
  archiveFingerprint:string;
}> {
  assertStageFEmulatorOnly();
  const key=assertKey(args.decryptionKey);
  assertEnvelope(args.envelope);
  const e=args.envelope;
  if(!UUID.test(args.expectedArchiveId)||
     !ID.test(args.expectedTenantId)||!ID.test(args.expectedFacilityId)||
     !ID.test(args.expectedSourceId)||
     e.archiveId!==args.expectedArchiveId||
     e.tenantId!==args.expectedTenantId||
     e.facilityId!==args.expectedFacilityId||
     e.sourceId!==args.expectedSourceId)deny('EXPECTED_SCOPE_MISMATCH');
  const fingerprint=fingerprintSyntheticG2ColdBackup(e);
  if(!fixedHexEqual(fingerprint,args.expectedArchiveFingerprint))
    deny('INDEPENDENT_ARCHIVE_HEAD_MISMATCH');
  const certFingerprint=g2RestoreCertificateFingerprint(args.trustedDetachedCertificate);
  if(!fixedHexEqual(certFingerprint,e.detachedCertificateFingerprint))
    deny('DETACHED_CERTIFICATE_MISMATCH');
  const nonce=Buffer.from(e.nonceHex,'hex');
  const ciphertext=Buffer.from(e.ciphertextBase64,'base64');
  const decipher=createDecipheriv('aes-256-gcm',key,nonce);
  const aad=serialize(header(e));
  decipher.setAAD(Buffer.from(aad,'utf8'));
  decipher.setAuthTag(Buffer.from(e.tagHex,'hex'));
  let raw:Buffer;
  try{raw=Buffer.concat([decipher.update(ciphertext),decipher.final()]);}
  catch{deny('AUTHENTICATION_FAILED');}
  if(raw.byteLength>MAX_PLAINTEXT)deny('PAYLOAD_SIZE_INVALID');
  let parsed:unknown;
  try{parsed=JSON.parse(raw.toString('utf8'));}
  catch{deny('PAYLOAD_JSON_INVALID');}
  if(!exact(parsed,[
    'anchor','sourceRevision','source','lease','pages','steps',
    'abandonedReservations','reviews',
  ]))deny('PAYLOAD_SCHEMA_INVALID');
  const validatedEvidence=parsed as StageFMultiEvidence;
  if(validatedEvidence.anchor.tenantId!==e.tenantId||
     validatedEvidence.anchor.sourceId!==e.sourceId||
     validatedEvidence.anchor.facilityId!==e.facilityId||
     !fixedHexEqual(stageFAnchorFingerprint(validatedEvidence.anchor),
       e.stageFAnchorFingerprint))deny('PAYLOAD_SCOPE_OR_ANCHOR_MISMATCH');
  args.stageFSigner.verify(validatedEvidence.anchor);
  assertStageFMultiRecoveryEvidence(validatedEvidence);
  args.detachedSigner.verify(validatedEvidence,args.trustedDetachedCertificate);
  return {
    status:'QUARANTINED_REQUIRES_FRESH_ANCHOR',
    clinicalAuthority:false,sourceDispatchAllowed:false,
    productionRelease:'NO_GO',validatedEvidence,archiveFingerprint:fingerprint,
  };
}

/** Exclusive local file write. Interrupted/partial files fail closed on read. */
export async function writeSyntheticColdBackupFile(
  path:string,envelope:G2SyntheticColdBackup,
):Promise<void>{
  assertStageFEmulatorOnly();
  assertEnvelope(envelope);
  if(typeof path!=='string'||!path.endsWith('.g2-test.enc.json'))
    deny('BACKUP_FILE_PATH_INVALID');
  const data=Buffer.from(canonical(envelope)+'\n','utf8');
  if(data.byteLength>MAX_FILE)deny('BACKUP_FILE_SIZE_INVALID');
  const file=await open(path,constants.O_WRONLY|constants.O_CREAT|
    constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await file.writeFile(data);await file.sync();}
  finally{await file.close();}
}

export async function readSyntheticColdBackupFile(path:string):Promise<unknown>{
  assertStageFEmulatorOnly();
  if(typeof path!=='string'||!path.endsWith('.g2-test.enc.json'))
    deny('BACKUP_FILE_PATH_INVALID');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=await file.stat();
    if(!stat.isFile()||stat.size<1||stat.size>MAX_FILE)
      deny('BACKUP_FILE_SIZE_INVALID');
    const content=await file.readFile({encoding:'utf8'});
    try{return JSON.parse(content);}catch{deny('BACKUP_FILE_JSON_INVALID');}
  }finally{await file.close();}
}
