/**
 * Stage G — synthetic-only vendor cursor continuity, with a detached local
 * Ed25519 witness.  This is a qualification contract, NOT a vendor signature,
 * a production trust root or a hosted recovery authority.
 *
 * Opaque cursors are NEVER persisted here.  The manifest itself is encrypted;
 * the rehearsal records only HMAC cursor tags and a signed certificate hash.
 */
import {
  createHash, createHmac, createPublicKey, sign, verify,
  type KeyObject,
} from 'node:crypto';
import type { StageFMultiAnchor, StageFMultiEvidence } from './external-fhir-poll-multi-recovery';
import { open, readFile, lstat, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEX = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[0-9a-f]{128}$/;
const REV = /^[1-9][0-9]{0,11}\.[0-9]{9}$/;
const MAX_TTL_MS = 300_000;
function fail(code: string): never { throw new Error('FHIR_POLL_G_' + code); }
function pos(n: unknown): n is number { return Number.isSafeInteger(n) && (n as number) > 0; }
function nn(n: unknown): n is number { return Number.isSafeInteger(n) && (n as number) >= 0; }
function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  return actual.length === keys.length && actual.every((key, i) => key === [...keys].sort()[i]);
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) fail('UNSERIALIZABLE');
    return encoded;
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const o = value as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}
function sha(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
export function assertStageGEmulatorOnly(): void {
  if (process.env.NODE_ENV !== 'test' || process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED') {
    fail('EMULATOR_ONLY');
  }
}
export type StageGPageCursorProof = Readonly<{
  manifestId: string;
  manifestRevision: string;
  startCheckpointSequence: number;
  endCheckpointSequence: number;
  /** HMAC-SHA256: no plaintext, no low-entropy unsalted SHA token hash. */
  requestCursorTag: string | null;
  nextCursorTag: string | null;
  /** Hash over the exact Stage F immutable operation/receipt/checkpoint proof IDs. */
  completedEvidenceDigest: string;
}>;
export type StageGCursorCertificate = Readonly<{
  schemaVersion: 1;
  kind: 'SYNTHETIC_VENDOR_CURSOR_CHAIN_LOCAL_WITNESS';
  witnessId: string;
  sequence: number;
  previousFingerprint: string | null;
  issuedAtMs: number;
  expiresAtMs: number;
  tenantId: string;
  sourceId: string;
  facilityId: string;
  sourceRevision: string;
  stageFAnchorFingerprint: string;
  pages: readonly StageGPageCursorProof[];
  signatureHex: string;
}>;
export type StageGTrustedHead = Readonly<{
  witnessId: string;
  sequence: number;
  certificateFingerprint: string;
  previousFingerprint: string | null;
}>;
export type StageGCursorAttestation = Readonly<{
  certificate: StageGCursorCertificate;
  verifier: EmulatorOnlyStageGWitnessVerifier;
  cursorTags: EmulatorOnlyStageGCursorTagger;
  /** Synthetic vendor response next-cursors, never stored in Firestore. */
  responseNextCursors: readonly (string | null)[];
  /** Stored in a separate local file outside the emulator and repository. */
  detachedWitness: Readonly<{readHead(): Promise<StageGTrustedHead | null>}>;
}>;

export class EmulatorOnlyStageGCursorTagger {
  private readonly key: Buffer;
  constructor(key: Uint8Array) {
    assertStageGEmulatorOnly();
    if (key.byteLength !== 32) fail('CURSOR_KEY_INVALID');
    this.key = Buffer.from(key);
  }
  tag(scope: {tenantId: string; sourceId: string; facilityId: string}, cursor: string | null): string | null {
    assertStageGEmulatorOnly();
    if (cursor === null) return null;
    if (typeof cursor !== 'string' || !cursor || Buffer.byteLength(cursor, 'utf8') > 4096) {
      fail('CURSOR_INVALID');
    }
    return createHmac('sha256', this.key).update(canonical([
      'HELIXIS_STAGE_G_PRIVATE_CURSOR_TAG_V1',
      scope.tenantId, scope.sourceId, scope.facilityId, cursor,
    ])).digest('hex');
  }
}

/** Exact immutable Stage F proof fields; no timestamps, PHI or vendor cursor. */
function pageEvidenceDigest(anchor: StageFMultiAnchor, manifestId: string): string {
  const steps = anchor.steps.filter(s => s.manifestId === manifestId);
  if (!steps.length) fail('PAGE_HAS_NO_STEPS');
  return sha(['HELIXIS_STAGE_G_PAGE_EVIDENCE_V1',anchor.tenantId,anchor.sourceId,
    anchor.sourceRevision,manifestId,steps.map(s => [
      s.sequence,s.index,s.epoch,s.operationSequence,s.workId,s.reservationEventId,
      s.checkpointEventId,s.receiptId,s.checkpointDigest,
    ])]);
}
export function deriveStageGPageProofs(args: {
  evidence: StageFMultiEvidence;
  responseNextCursors: readonly (string | null)[];
  cursorTags: EmulatorOnlyStageGCursorTagger;
}): StageGPageCursorProof[] {
  assertStageGEmulatorOnly();
  const { anchor, pages } = args.evidence;
  if (!Array.isArray(pages) || pages.length !== anchor.pages.length ||
      !Array.isArray(args.responseNextCursors) ||
      args.responseNextCursors.length !== pages.length) fail('PAGE_COUNT_MISMATCH');
  const scope = {tenantId: anchor.tenantId, sourceId:anchor.sourceId, facilityId:anchor.facilityId};
  const proofs = pages.map((page,i) => {
    const expected = anchor.pages[i];
    if (!page || page.manifest.manifestId !== expected.manifestId ||
        page.manifestRevision !== expected.manifestRevision ||
        page.manifest.startCheckpointSequence !== expected.startCheckpointSequence ||
        page.manifest.sourceRevision !== anchor.sourceRevision ||
        page.manifest.tenantId !== scope.tenantId ||
        page.manifest.sourceId !== scope.sourceId ||
        page.manifest.facilityId !== scope.facilityId ||
        page.manifest.items.length !== expected.itemCount) fail('PAGE_MANIFEST_CHANGED');
    for(let itemIndex=0;itemIndex<page.manifest.items.length;itemIndex++) {
      const item=page.manifest.items[itemIndex];
      const step=anchor.steps.find(x=>x.manifestId===page.manifest.manifestId && x.index===itemIndex);
      if(!step || step.workId!==item.workId ||
          step.checkpointDigest!==sha(['CI_EXT12_CHECKPOINT_V1',
            scope.tenantId,scope.sourceId,page.manifest.manifestId,
            page.manifest.startCheckpointSequence,itemIndex+1,
            item.workId,item.resourceType,item.resourceId,item.expectedVersionId])) {
        fail('PAGE_MANIFEST_CHANGED');
      }
    }
    return {
      manifestId: expected.manifestId,
      manifestRevision: expected.manifestRevision,
      startCheckpointSequence: expected.startCheckpointSequence,
      endCheckpointSequence: expected.startCheckpointSequence + expected.itemCount,
      requestCursorTag: args.cursorTags.tag(scope, page.manifest.vendorCursor),
      nextCursorTag: args.cursorTags.tag(scope, args.responseNextCursors[i]),
      completedEvidenceDigest: pageEvidenceDigest(anchor, expected.manifestId),
    };
  });
  const seen = new Set<string>();
  if (proofs[0].requestCursorTag !== null || proofs[proofs.length - 1].nextCursorTag !== null) {
    fail('INCOMPLETE_CURSOR_WINDOW');
  }
  for (let i=1; i<proofs.length; i++) {
    if (!proofs[i-1].nextCursorTag ||
        proofs[i-1].nextCursorTag !== proofs[i].requestCursorTag) fail('CURSOR_CHAIN_DISCONNECTED');
    if (seen.has(proofs[i].requestCursorTag!)) fail('CURSOR_REUSED');
    seen.add(proofs[i].requestCursorTag!);
  }
  return proofs;
}
const PAGE_KEYS = [
  'manifestId','manifestRevision','startCheckpointSequence','endCheckpointSequence',
  'requestCursorTag','nextCursorTag','completedEvidenceDigest',
];
const CERT_KEYS = [
  'schemaVersion','kind','witnessId','sequence','previousFingerprint',
  'issuedAtMs','expiresAtMs','tenantId','sourceId','facilityId','sourceRevision',
  'stageFAnchorFingerprint','pages','signatureHex',
];
function validateCertificate(cert: StageGCursorCertificate): void {
  if (!exactKeys(cert,CERT_KEYS) || cert.schemaVersion !== 1 ||
      cert.kind !== 'SYNTHETIC_VENDOR_CURSOR_CHAIN_LOCAL_WITNESS' ||
      !UUID.test(cert.witnessId) || !pos(cert.sequence) || cert.sequence > 1000 ||
      !(cert.previousFingerprint === null || HEX.test(cert.previousFingerprint)) ||
      (cert.sequence === 1) !== (cert.previousFingerprint === null) ||
      !pos(cert.issuedAtMs) || !pos(cert.expiresAtMs) ||
      cert.expiresAtMs <= cert.issuedAtMs ||
      cert.expiresAtMs - cert.issuedAtMs > MAX_TTL_MS ||
      ![cert.tenantId,cert.sourceId,cert.facilityId].every(v => typeof v==='string' && ID.test(v) && v!=='..') ||
      !REV.test(cert.sourceRevision) || !HEX.test(cert.stageFAnchorFingerprint) ||
      !Array.isArray(cert.pages) || cert.pages.length < 2 || cert.pages.length > 3 ||
      cert.pages[0].requestCursorTag !== null ||
      cert.pages[cert.pages.length-1].nextCursorTag !== null) fail('CERTIFICATE_INVALID');
  const ids=new Set<string>();
  const usedCursors=new Set<string>();
  let end: number | null = null;
  for(let i=0;i<cert.pages.length;i++) {
    const p=cert.pages[i];
    if (!exactKeys(p,PAGE_KEYS) || !UUID.test(p.manifestId) || ids.has(p.manifestId) ||
        !REV.test(p.manifestRevision) || !nn(p.startCheckpointSequence) ||
        !pos(p.endCheckpointSequence) ||
        p.endCheckpointSequence <= p.startCheckpointSequence ||
        p.endCheckpointSequence - p.startCheckpointSequence > 12 ||
        !HEX.test(p.completedEvidenceDigest) ||
        !(p.requestCursorTag===null || HEX.test(p.requestCursorTag)) ||
        !(p.nextCursorTag===null || HEX.test(p.nextCursorTag)) ||
        (end !== null && p.startCheckpointSequence !== end)) fail('PAGE_PROOF_INVALID');
    if (i && (p.requestCursorTag===null || p.requestCursorTag!==cert.pages[i-1].nextCursorTag ||
         usedCursors.has(p.requestCursorTag))) fail('CURSOR_CHAIN_DISCONNECTED');
    if (p.requestCursorTag) usedCursors.add(p.requestCursorTag);
    ids.add(p.manifestId);
    end=p.endCheckpointSequence;
  }
}
function unsigned(cert: StageGCursorCertificate): Omit<StageGCursorCertificate,'signatureHex'> {
  const { signatureHex: _unused, ...value } = cert;
  return value;
}
export function stageGCertificateFingerprint(cert: StageGCursorCertificate): string {
  validateCertificate(cert);
  if (!SIGNATURE.test(cert.signatureHex)) fail('SIGNATURE_INVALID');
  return sha(['HELIXIS_STAGE_G_CERTIFICATE_FINGERPRINT_V1',cert]);
}
function signaturePayload(cert: StageGCursorCertificate): Buffer {
  return Buffer.from(canonical(['HELIXIS_STAGE_G_CURSOR_CERTIFICATE_SIGNATURE_V1',unsigned(cert)]),'utf8');
}
/** Issuer operates with a private key in its separate synthetic trust process. */
export class EmulatorOnlyStageGWitnessIssuer {
  private readonly privateKey: KeyObject;
  constructor(privateKey: KeyObject) {
    assertStageGEmulatorOnly();
    if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') fail('ISSUER_KEY_INVALID');
    this.privateKey = privateKey;
  }
  sign(draft: Omit<StageGCursorCertificate,'signatureHex'>): StageGCursorCertificate {
    assertStageGEmulatorOnly();
    const candidate={...draft, signatureHex:'0'.repeat(128)} as StageGCursorCertificate;
    validateCertificate(candidate);
    return {...candidate,signatureHex:sign(null,signaturePayload(candidate),this.privateKey).toString('hex')};
  }
}
/** Verifier has only the detached public key, never the issuer private key. */
export class EmulatorOnlyStageGWitnessVerifier {
  private readonly publicKey: KeyObject;
  constructor(publicKey: KeyObject | string) {
    assertStageGEmulatorOnly();
    this.publicKey=typeof publicKey==='string' ? createPublicKey(publicKey) : publicKey;
    if (this.publicKey.type!=='public' || this.publicKey.asymmetricKeyType!=='ed25519') fail('VERIFIER_KEY_INVALID');
  }
  verify(cert: StageGCursorCertificate): void {
    assertStageGEmulatorOnly();
    validateCertificate(cert);
    if (!SIGNATURE.test(cert.signatureHex) ||
        !verify(null,signaturePayload(cert),this.publicKey,Buffer.from(cert.signatureHex,'hex'))) {
      fail('SIGNATURE_INVALID');
    }
  }
}
export function assertStageGCursorContinuity(args: {
  evidence: StageFMultiEvidence;
  certificate: StageGCursorCertificate;
  verifier: EmulatorOnlyStageGWitnessVerifier;
  cursorTags: EmulatorOnlyStageGCursorTagger;
  responseNextCursors: readonly (string | null)[];
  trustedHead: StageGTrustedHead | null;
  trustedStageFAnchorFingerprint: string;
  nowMs: number;
}): string {
  assertStageGEmulatorOnly();
  const cert=args.certificate;
  args.verifier.verify(cert);
  const fingerprint=stageGCertificateFingerprint(cert);
  const anchor=args.evidence.anchor;
  if (cert.tenantId!==anchor.tenantId || cert.sourceId!==anchor.sourceId ||
      cert.facilityId!==anchor.facilityId || cert.sourceRevision!==anchor.sourceRevision ||
      cert.stageFAnchorFingerprint!==args.trustedStageFAnchorFingerprint) fail('ANCHOR_SCOPE_CHANGED');
  if (!args.trustedHead || args.trustedHead.witnessId!==cert.witnessId ||
      args.trustedHead.sequence!==cert.sequence ||
      args.trustedHead.previousFingerprint!==cert.previousFingerprint ||
      args.trustedHead.certificateFingerprint!==fingerprint) fail('DETACHED_WITNESS_NOT_CURRENT');
  if (!pos(args.nowMs) || args.nowMs<cert.issuedAtMs || args.nowMs>=cert.expiresAtMs) {
    fail('CERTIFICATE_EXPIRED_OR_CLOCK_INVALID');
  }
  const expected=deriveStageGPageProofs({evidence:args.evidence,
    responseNextCursors:args.responseNextCursors,cursorTags:args.cursorTags});
  if (canonical(expected)!==canonical(cert.pages)) fail('CURSOR_OR_EVIDENCE_CHANGED');
  return fingerprint;
}

function witnessFail(code:string):never {throw new Error('FHIR_POLL_G_WITNESS_'+code);}
const MAX_FILE_BYTES=250_000;
const MAX_RECORDS=100;
export class EmulatorOnlyDetachedWitnessLedger {
  readonly verifier: EmulatorOnlyStageGWitnessVerifier;
  readonly filePath:string;
  constructor(filePath:string,verifier:EmulatorOnlyStageGWitnessVerifier) {
    assertStageGEmulatorOnly();
    if (!isAbsolute(filePath) || !filePath.endsWith('.ndjson')) witnessFail('PATH_INVALID');
    const normalized=resolve(filePath);
    const relation=relative(process.cwd(),normalized);
    if (!relation.startsWith('..') && !isAbsolute(relation)) witnessFail('INSIDE_APPLICATION_WORKTREE');
    this.filePath=normalized;
    this.verifier=verifier;
  }
  private async readAll():Promise<StageGCursorCertificate[]> {
    assertStageGEmulatorOnly();
    let content:string;
    try {
      const info=await lstat(this.filePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size>MAX_FILE_BYTES) witnessFail('FILE_INVALID');
      content=await readFile(this.filePath,'utf8');
    } catch(err) {
      if ((err as NodeJS.ErrnoException).code==='ENOENT') return [];
      throw err;
    }
    const lines=content.split('\n').filter(line=>line.length>0);
    if (lines.length>MAX_RECORDS) witnessFail('TOO_MANY_RECORDS');
    const records:StageGCursorCertificate[]=[];
    let previousFingerprint:string|null=null;
    let previous:StageGCursorCertificate|null=null;
    for(let i=0;i<lines.length;i++) {
      let cert:StageGCursorCertificate;
      try{cert=JSON.parse(lines[i]) as StageGCursorCertificate;}catch{witnessFail('RECORD_INVALID');}
      this.verifier.verify(cert);
      if(cert.sequence!==i+1 || cert.previousFingerprint!==previousFingerprint ||
        (previous!==null && (cert.witnessId!==previous.witnessId ||
        cert.tenantId!==previous.tenantId || cert.sourceId!==previous.sourceId ||
        cert.facilityId!==previous.facilityId || cert.issuedAtMs<previous.issuedAtMs ||
        cert.expiresAtMs<=previous.expiresAtMs))) witnessFail('CHAIN_ROLLBACK_OR_FORK');
      previousFingerprint=stageGCertificateFingerprint(cert);
      previous=cert;
      records.push(cert);
    }
    return records;
  }
  async readHead():Promise<StageGTrustedHead|null> {
    const records=await this.readAll();
    const last=records.at(-1);
    return last?{witnessId:last.witnessId,sequence:last.sequence,
      certificateFingerprint:stageGCertificateFingerprint(last),
      previousFingerprint:last.previousFingerprint}:null;
  }
  /** Local operator action; not called by any Firestore transaction. */
  async pin(cert:StageGCursorCertificate):Promise<StageGTrustedHead> {
    assertStageGEmulatorOnly();
    this.verifier.verify(cert);
    const lock=this.filePath+'.lock';
    let handle:Awaited<ReturnType<typeof open>>|undefined;
    try {
      handle=await open(lock,'wx',0o600);
      const head=await this.readHead();
      if(cert.sequence!==(head?.sequence??0)+1 ||
          cert.previousFingerprint!==(head?.certificateFingerprint??null) ||
          (head!==null && cert.witnessId!==head.witnessId)) witnessFail('NON_MONOTONIC_APPEND');
      const row=JSON.stringify(cert)+'\n';
      const out=await open(this.filePath,'a',0o600);
      try {await out.writeFile(row,'utf8');await out.sync();}
      finally {await out.close();}
      const updated=await this.readHead();
      if(!updated || updated.certificateFingerprint!==stageGCertificateFingerprint(cert)) witnessFail('APPEND_NOT_DURABLE');
      return updated;
    } finally {
      if(handle){await handle.close();await unlink(lock);}
    }
  }
}
