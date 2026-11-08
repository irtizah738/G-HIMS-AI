/**
 * G3 Stage H — TEST-ONLY contract for an external witness, signing key registry,
 * trusted-clock adapter and vendor provenance adapter.
 *
 * This module performs NO network I/O, NO Firestore writes, and NO IAM/KMS calls.
 * A passing contract is not proof of an independently operated service, actual
 * vendor-origin authenticity, disaster recovery, or production readiness.
 */
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import type { StageGCursorCertificate, StageGPageCursorProof, StageGTrustedHead } from './external-fhir-poll-vendor-cursor';
import type { EmulatorOnlyStageGWitnessVerifier } from './external-fhir-poll-vendor-cursor';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const MAX_PROOF_AGE = 120_000;
const MAX_REGISTRY_WINDOW = 86_400_000;
function failure(code: string): never { throw new Error('FHIR_POLL_H_' + code); }
function integer(value: unknown, min = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min;
}
function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((s, i) => s === expected[i]);
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) failure('UNSERIALIZABLE');
    return encoded;
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().map(k => JSON.stringify(k) + ':' + canonical(object[k])).join(',') + '}';
}
function sha(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}
export function assertStageHTestBoundary(): void {
  if (process.env.NODE_ENV !== 'test' || process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED') failure('TEST_ONLY');
}
export type StageHKeyPurpose = 'CLOCK' | 'WITNESS' | 'VENDOR_SIMULATOR';
export type StageHKeyEntry = Readonly<{
  keyId: string;
  purpose: StageHKeyPurpose;
  publicKeyPem: string;
  notBeforeMs: number;
  notAfterMs: number;
  revoked: boolean;
}>;
export type StageHKeyRegistry = Readonly<{
  schemaVersion: 1;
  revision: number;
  issuedAtMs: number;
  expiresAtMs: number;
  keys: readonly StageHKeyEntry[];
  rootSignatureHex: string;
}>;
export type StageHSigned<T> = Readonly<{
  payload: T;
  keyId: string;
  signatureHex: string;
}>;
export type StageHScope = Readonly<{
  tenantId: string;
  sourceId: string;
  facilityId: string;
  sourceRevision: string;
  configuredVendorEndpoint: string;
}>;
export type StageHClockProof = Readonly<{
  schemaVersion: 1;
  kind: 'SYNTHETIC_CLOCK_ATTESTATION';
  challenge: string;
  sequence: number;
  observedAtMs: number;
}>;
export type StageHWitnessProof = Readonly<{
  schemaVersion: 1;
  kind: 'SYNTHETIC_REMOTE_WITNESS_HEAD';
  challenge: string;
  issuedAtMs: number;
  scope: StageHScope;
  head: StageGTrustedHead;
}>;
export type StageHVendorProof = Readonly<{
  schemaVersion: 1;
  kind: 'SYNTHETIC_VENDOR_ORIGIN_ADAPTER';
  challenge: string;
  issuedAtMs: number;
  scope: StageHScope;
  stageGCertificateFingerprint: string;
  pageProofsDigest: string;
  sourceMode: 'TEST_SIGNED_FIXTURE_ONLY';
}>;
/** A production adapter must have independent identity and signing authority. */
export interface StageHClockPort {
  sample(challenge: string): Promise<StageHSigned<StageHClockProof>>;
}
export interface StageHWitnessPort {
  readCurrentHead(request: {challenge: string; scope: StageHScope}):
    Promise<StageHSigned<StageHWitnessProof>>;
}
export interface StageHVendorOriginPort {
  inspect(request: {challenge: string; scope: StageHScope; certificateFingerprint: string}):
    Promise<StageHSigned<StageHVendorProof>>;
}
export type StageHTrustFloors = Readonly<{
  /** Stored OUTSIDE Firestore; not supplied by a request body. */
  registryRevision: number;
  clockSequence: number;
  lastTrustedTimeMs: number;
  witnessSequence: number;
}>;
export type StageHInspection = Readonly<{
  status: 'LOCAL_INTEGRATION_CONTRACT_VALIDATED';
  productionRelease: 'NO_GO';
  registryRevision: number;
  observedAtMs: number;
  clockSequence: number;
  witnessSequence: number;
  stageGCertificateFingerprint: string;
  evidenceFingerprint: string;
  vendorOrigin: 'TEST_FIXTURE_ONLY_NOT_VENDOR_AUTHENTICATED';
  witnessAuthority: 'LOCAL_ADAPTER_ONLY_NOT_HOSTED';
}>;

/** Bind the exact ordered Stage G page proofs without cursor plaintext. */
export function stageHPageProofsDigest(pages: readonly StageGPageCursorProof[]): string {
  assertStageHTestBoundary();
  return sha(['HELIXIS_STAGE_G_PAGES_V1',pages]);
}
/** Domain separated message bytes, used by offline mocks as well as verifier. */
export function stageHSigningBytes(domain: 'REGISTRY' | StageHKeyPurpose, payload: unknown): Buffer {
  assertStageHTestBoundary();
  return Buffer.from(canonical(['HELIXIS_STAGE_H_OFFLINE_V1', domain, payload]), 'utf8');
}
function verifySignature(publicKeyPem: string, bytes: Buffer, signatureHex: string): boolean {
  if (typeof publicKeyPem !== 'string' || publicKeyPem.length > 4000 ||
      typeof signatureHex !== 'string' || !HEX128.test(signatureHex)) return false;
  try {
    const key = createPublicKey(publicKeyPem);
    return key.asymmetricKeyType === 'ed25519' && key.type === 'public' &&
      verify(null, bytes, key, Buffer.from(signatureHex, 'hex'));
  } catch { return false; }
}
function unsignedRegistry(registry: StageHKeyRegistry): Omit<StageHKeyRegistry,'rootSignatureHex'> {
  const { rootSignatureHex: _unused, ...rest } = registry;
  return rest;
}
function verifyRegistry(args: {
  registry: StageHKeyRegistry;
  rootPublicKeyPem: string;
  minimumRevision: number;
}): Map<string, StageHKeyEntry> {
  const r = args.registry;
  if (!exactKeys(r,['schemaVersion','revision','issuedAtMs','expiresAtMs','keys','rootSignatureHex']) ||
      r.schemaVersion !== 1 || !integer(r.revision, 1) ||
      !integer(args.minimumRevision, 1) || r.revision < args.minimumRevision ||
      !integer(r.issuedAtMs, 1) || !integer(r.expiresAtMs, 1) ||
      r.expiresAtMs <= r.issuedAtMs ||
      r.expiresAtMs-r.issuedAtMs > MAX_REGISTRY_WINDOW ||
      !Array.isArray(r.keys) || r.keys.length < 3 || r.keys.length > 16 ||
      !verifySignature(args.rootPublicKeyPem,stageHSigningBytes('REGISTRY',unsignedRegistry(r)),r.rootSignatureHex)) {
    failure('REGISTRY_SIGNATURE_OR_REVISION_INVALID');
  }
  const entries = new Map<string, StageHKeyEntry>();
  const purposes = new Set<StageHKeyPurpose>();
  for (const key of r.keys) {
    if (!exactKeys(key,['keyId','purpose','publicKeyPem','notBeforeMs','notAfterMs','revoked']) ||
        !ID.test(key.keyId) || entries.has(key.keyId) ||
        !['CLOCK','WITNESS','VENDOR_SIMULATOR'].includes(key.purpose) ||
        !integer(key.notBeforeMs,1) || !integer(key.notAfterMs,1) ||
        key.notAfterMs <= key.notBeforeMs || typeof key.revoked !== 'boolean' ||
        typeof key.publicKeyPem !== 'string' || key.publicKeyPem.length > 4000) {
      failure('KEY_REGISTRY_ENTRY_INVALID');
    }
    try {
      const pub=createPublicKey(key.publicKeyPem);
      if (pub.type!=='public' || pub.asymmetricKeyType!=='ed25519') failure('KEY_REGISTRY_ENTRY_INVALID');
    } catch { failure('KEY_REGISTRY_ENTRY_INVALID'); }
    entries.set(key.keyId,key);
    purposes.add(key.purpose);
  }
  if (purposes.size !== 3) failure('KEY_PURPOSE_MISSING');
  return entries;
}
function assertSigned<T>(args: {
  envelope: StageHSigned<T>;
  purpose: StageHKeyPurpose;
  payloadKeys: readonly string[];
  entries: Map<string, StageHKeyEntry>;
  observedAtMs: number;
  proofTimeMs: number;
}): void {
  const {envelope,purpose,entries,observedAtMs,proofTimeMs}=args;
  if (!exactKeys(envelope,['payload','keyId','signatureHex']) ||
      !exactKeys(envelope.payload,args.payloadKeys) ||
      typeof envelope.keyId !== 'string') failure('SIGNED_ENVELOPE_SHAPE_INVALID');
  const key = entries.get(envelope.keyId);
  // Prevent a compromised retired key from signing a backdated proof.
  if (!key || key.purpose !== purpose || key.revoked ||
      !integer(observedAtMs,1) || !integer(proofTimeMs,1) ||
      observedAtMs < key.notBeforeMs || observedAtMs >= key.notAfterMs ||
      proofTimeMs < key.notBeforeMs || proofTimeMs > observedAtMs ||
      observedAtMs-proofTimeMs > MAX_PROOF_AGE) failure('SIGNING_KEY_INACTIVE_OR_PROOF_STALE');
  if (!verifySignature(key.publicKeyPem,stageHSigningBytes(purpose,envelope.payload),envelope.signatureHex)) {
    failure('PROOF_SIGNATURE_INVALID');
  }
}
function sameScope(a:StageHScope,b:StageHScope):boolean {return canonical(a)===canonical(b);}
function validScope(scope:StageHScope):boolean {
  if (!exactKeys(scope,['tenantId','sourceId','facilityId','sourceRevision','configuredVendorEndpoint']) ||
      ![scope.tenantId,scope.sourceId,scope.facilityId].every(x=>typeof x==='string' && ID.test(x)) ||
      !/^[1-9][0-9]{0,11}\.[0-9]{9}$/.test(scope.sourceRevision) ||
      typeof scope.configuredVendorEndpoint!=='string' || scope.configuredVendorEndpoint.length > 2048) return false;
  try {
    const u = new URL(scope.configuredVendorEndpoint);
    return u.protocol==='https:' && !!u.hostname && !u.username && !u.password &&
      !u.hash && !u.search && !u.port;
  } catch { return false; }
}
function validHead(head:StageGTrustedHead):boolean {
  return exactKeys(head,['witnessId','sequence','certificateFingerprint','previousFingerprint']) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(head.witnessId) &&
    integer(head.sequence,1) && HEX64.test(head.certificateFingerprint) &&
    (head.previousFingerprint===null || HEX64.test(head.previousFingerprint));
}

/**
 * Inspection only. The caller must separately run Stage F/G Firestore atomic
 * evidence checks; this is NOT an authorization to emit or publish a clinical
 * event, advance checkpoint, or enable a hosted worker.
 *
 * The challenge and independently pinned key-root/floors MUST originate at
 * the verifier, not from a patient, browser, provider callback or Firestore.
 */
export async function inspectStageHOfflineBoundary(args: {
  scope: StageHScope;
  certificate: StageGCursorCertificate;
  stageGVerifier: EmulatorOnlyStageGWitnessVerifier;
  trustedStageFAnchorFingerprint: string;
  rootPublicKeyPem: string;
  registry: StageHKeyRegistry;
  floors: StageHTrustFloors;
  clock: StageHClockPort;
  witness: StageHWitnessPort;
  vendor: StageHVendorOriginPort;
  /** Nonce generator injectable ONLY inside this emulator qualification. */
  newChallenge?: () => string;
}): Promise<StageHInspection> {
  assertStageHTestBoundary();
  if (!validScope(args.scope) || !HEX64.test(args.trustedStageFAnchorFingerprint) ||
      !exactKeys(args.floors,['registryRevision','clockSequence','lastTrustedTimeMs','witnessSequence']) ||
      !integer(args.floors.clockSequence) || !integer(args.floors.lastTrustedTimeMs,1) ||
      !integer(args.floors.witnessSequence) ||
      !args.clock || !args.witness || !args.vendor) failure('SCOPE_OR_FLOOR_INVALID');
  const cert=args.certificate;
  args.stageGVerifier.verify(cert);
  const certFingerprint=sha(['HELIXIS_STAGE_G_CERTIFICATE_FINGERPRINT_V1',cert]);
  if (cert.tenantId!==args.scope.tenantId || cert.sourceId!==args.scope.sourceId ||
      cert.facilityId!==args.scope.facilityId || cert.sourceRevision!==args.scope.sourceRevision ||
      cert.stageFAnchorFingerprint!==args.trustedStageFAnchorFingerprint) failure('STAGE_G_SCOPE_CHANGED');
  const keys=verifyRegistry({registry:args.registry,rootPublicKeyPem:args.rootPublicKeyPem,
    minimumRevision:args.floors.registryRevision});
  const challenge=args.newChallenge?args.newChallenge():randomBytes(32).toString('hex');
  if (typeof challenge!=='string' || !HEX64.test(challenge) || challenge==='0'.repeat(64)) {
    failure('CHALLENGE_INVALID');
  }
  const time=await args.clock.sample(challenge);
  const c=time?.payload;
  if (!c || !exactKeys(c,['schemaVersion','kind','challenge','sequence','observedAtMs']) ||
      c.schemaVersion!==1 || c.kind!=='SYNTHETIC_CLOCK_ATTESTATION' ||
      c.challenge!==challenge || !integer(c.sequence,1) ||
      c.sequence<=args.floors.clockSequence || !integer(c.observedAtMs,1) ||
      c.observedAtMs < args.floors.lastTrustedTimeMs ||
      c.observedAtMs<args.registry.issuedAtMs || c.observedAtMs>=args.registry.expiresAtMs ||
      c.observedAtMs<cert.issuedAtMs || c.observedAtMs>=cert.expiresAtMs) failure('CLOCK_SEQUENCE_OR_WINDOW_INVALID');
  assertSigned({envelope:time,purpose:'CLOCK',payloadKeys:['schemaVersion','kind','challenge','sequence','observedAtMs'],
    entries:keys,observedAtMs:c.observedAtMs,proofTimeMs:c.observedAtMs});

  const witness=await args.witness.readCurrentHead({challenge,scope:args.scope});
  const w=witness?.payload;
  if (!w || !exactKeys(w,['schemaVersion','kind','challenge','issuedAtMs','scope','head']) ||
      w.schemaVersion!==1 || w.kind!=='SYNTHETIC_REMOTE_WITNESS_HEAD' ||
      w.challenge!==challenge || !sameScope(w.scope,args.scope) ||
      !validHead(w.head) || w.head.witnessId!==cert.witnessId ||
      w.head.sequence!==cert.sequence || w.head.sequence<args.floors.witnessSequence ||
      w.head.previousFingerprint!==cert.previousFingerprint ||
      w.head.certificateFingerprint!==certFingerprint) failure('REMOTE_WITNESS_MISMATCH');
  assertSigned({envelope:witness,purpose:'WITNESS',payloadKeys:['schemaVersion','kind','challenge','issuedAtMs','scope','head'],
    entries:keys,observedAtMs:c.observedAtMs,proofTimeMs:w.issuedAtMs});

  const vendor=await args.vendor.inspect({challenge,scope:args.scope,certificateFingerprint:certFingerprint});
  const v=vendor?.payload;
  const expectedPageDigest=stageHPageProofsDigest(cert.pages);
  if (!v || !exactKeys(v,['schemaVersion','kind','challenge','issuedAtMs','scope',
      'stageGCertificateFingerprint','pageProofsDigest','sourceMode']) ||
      v.schemaVersion!==1 || v.kind!=='SYNTHETIC_VENDOR_ORIGIN_ADAPTER' ||
      v.sourceMode!=='TEST_SIGNED_FIXTURE_ONLY' || v.challenge!==challenge ||
      !sameScope(v.scope,args.scope) || v.stageGCertificateFingerprint!==certFingerprint ||
      v.pageProofsDigest!==expectedPageDigest) failure('VENDOR_PROVENANCE_NOT_BOUND');
  assertSigned({envelope:vendor,purpose:'VENDOR_SIMULATOR',payloadKeys:['schemaVersion','kind','challenge',
    'issuedAtMs','scope','stageGCertificateFingerprint','pageProofsDigest','sourceMode'],
    entries:keys,observedAtMs:c.observedAtMs,proofTimeMs:v.issuedAtMs});
  // Only public metadata fingerprints. No FHIR bodies, cursors, PHI, credentials.
  const evidenceFingerprint=sha(['HELIXIS_STAGE_H_LOCAL_INTEGRATION_CONTRACT_V1',
    args.scope,certFingerprint,args.registry.revision,c.sequence,c.observedAtMs,
    w.head,v.pageProofsDigest,sha(witness),sha(vendor)]);
  return {status:'LOCAL_INTEGRATION_CONTRACT_VALIDATED',productionRelease:'NO_GO',
    registryRevision:args.registry.revision,observedAtMs:c.observedAtMs,
    clockSequence:c.sequence,witnessSequence:w.head.sequence,
    stageGCertificateFingerprint:certFingerprint,evidenceFingerprint,
    vendorOrigin:'TEST_FIXTURE_ONLY_NOT_VENDOR_AUTHENTICATED',
    witnessAuthority:'LOCAL_ADAPTER_ONLY_NOT_HOSTED'};
}
