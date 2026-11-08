/**
 * G3 Stage C: sealed, source-version-bound manifest payloads.
 *
 * The reference crypto implementation here is deliberately TEST-ONLY. A
 * production release MUST supply a separately reviewed KMS-backed envelope
 * cipher and satisfy G1/G2. No raw patient identity, resource IDs or vendor
 * cursors may appear in an unencrypted Firestore manifest document.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

export type PollResourceType = 'Patient' | 'Encounter' | 'Observation';
export type PollWorkItem = Readonly<{
  workId: string;
  resourceType: PollResourceType;
  resourceId: string;
  expectedVersionId: string;
}>;
export type PollWorkManifest = Readonly<{
  manifestId: string;
  tenantId: string;
  facilityId: string;
  sourceId: string;
  /** From Firestore source snapshot updateTime, never a caller's clock. */
  sourceRevision: string;
  startCheckpointSequence: number;
  items: readonly PollWorkItem[];
  /** Opaque vendor cursor; may contain PHI. Never execute as a URL. */
  vendorCursor: string | null;
}>;

export type SealedCiphertext = Readonly<{
  suite: 'LOCAL_TEST_AES_256_GCM_V1';
  keyId: string;
  nonceHex: string;
  tagHex: string;
  ciphertextBase64: string;
}>;
export type SealedPollManifest = Readonly<{
  schemaVersion: 1;
  tenantId: string;
  facilityId: string;
  sourceId: string;
  manifestId: string;
  sourceRevision: string;
  status: 'SEALED';
  immutable: true;
  clinicalAuthority: false;
  payload: SealedCiphertext;
}>;
export type ManifestCipher = Readonly<{
  seal(plaintextUtf8: string, aadUtf8: string): SealedCiphertext;
  open(ciphertext: SealedCiphertext, aadUtf8: string): string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REVISION = /^[1-9][0-9]{0,11}\.[0-9]{9}$/;
const HEX24 = /^[0-9a-f]{24}$/i;
const HEX32 = /^[0-9a-f]{32}$/i;
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value) && value !== '.' && value !== '..';
}
function validScope(manifest: PollWorkManifest): boolean {
  return validId(manifest.tenantId) && validId(manifest.facilityId) &&
    validId(manifest.sourceId) && UUID.test(manifest.manifestId) &&
    REVISION.test(manifest.sourceRevision);
}

export function assertPollWorkManifest(manifest: PollWorkManifest): void {
  if (!manifest || !validScope(manifest) ||
      !Number.isSafeInteger(manifest.startCheckpointSequence) ||
      manifest.startCheckpointSequence < 0 ||
      !Array.isArray(manifest.items) || manifest.items.length < 1 ||
      manifest.items.length > 12 ||
      manifest.startCheckpointSequence + manifest.items.length > Number.MAX_SAFE_INTEGER ||
      (manifest.vendorCursor !== null &&
        (typeof manifest.vendorCursor !== 'string' ||
         manifest.vendorCursor.length === 0 ||
         Buffer.byteLength(manifest.vendorCursor, 'utf8') > 4096))) {
    throw new Error('FHIR_POLL_SEALED_MANIFEST_INVALID');
  }
  const ids = new Set<string>();
  for (const item of manifest.items) {
    if (!item || typeof item !== 'object' || !UUID.test(item.workId) ||
        ids.has(item.workId) || !validId(item.resourceId) ||
        !validId(item.expectedVersionId) ||
        !['Patient', 'Encounter', 'Observation'].includes(item.resourceType)) {
      throw new Error('FHIR_POLL_SEALED_WORK_INVALID');
    }
    ids.add(item.workId);
  }
}

function aadFor(value: Pick<SealedPollManifest,
  'tenantId' | 'facilityId' | 'sourceId' | 'manifestId' | 'sourceRevision'>): string {
  // The same authenticated context is required for decryption. Different
  // tenant/source/facility/revision values cannot decrypt the payload.
  return JSON.stringify(['HELIXIS_FHIR_POLL_MANIFEST_V1', value.tenantId,
    value.facilityId, value.sourceId, value.manifestId, value.sourceRevision]);
}

function payloadOf(value: PollWorkManifest): object {
  return {
    startCheckpointSequence: value.startCheckpointSequence,
    items: value.items.map(item => ({ workId: item.workId,
      resourceType: item.resourceType, resourceId: item.resourceId,
      expectedVersionId: item.expectedVersionId })),
    vendorCursor: value.vendorCursor,
  };
}

export function sealedManifestPayloadEquals(a: PollWorkManifest, b: PollWorkManifest): boolean {
  assertPollWorkManifest(a);
  assertPollWorkManifest(b);
  return aadFor(a) === aadFor(b) && JSON.stringify(payloadOf(a)) === JSON.stringify(payloadOf(b));
}

export function sealPollWorkManifest(manifest: PollWorkManifest, cipher: ManifestCipher): SealedPollManifest {
  assertPollWorkManifest(manifest);
  const metadata = {
    schemaVersion: 1 as const,
    tenantId: manifest.tenantId,
    facilityId: manifest.facilityId,
    sourceId: manifest.sourceId,
    manifestId: manifest.manifestId,
    sourceRevision: manifest.sourceRevision,
    status: 'SEALED' as const,
    immutable: true as const,
    clinicalAuthority: false as const,
  };
  return { ...metadata, payload: cipher.seal(JSON.stringify(payloadOf(manifest)), aadFor(metadata)) };
}

export function openPollWorkManifest(
  document: SealedPollManifest,
  cipher: ManifestCipher,
  expected: Pick<PollWorkManifest, 'tenantId' | 'facilityId' | 'sourceId' | 'manifestId' | 'sourceRevision'>,
): PollWorkManifest {
  if (!document || document.schemaVersion !== 1 || document.status !== 'SEALED' ||
      document.immutable !== true || document.clinicalAuthority !== false ||
      !validId(document.tenantId) || !validId(document.sourceId) || !validId(document.facilityId) ||
      !UUID.test(document.manifestId) || !REVISION.test(document.sourceRevision) ||
      aadFor(document) !== aadFor(expected)) {
    throw new Error('FHIR_POLL_MANIFEST_SCOPE_OR_REVISION_MISMATCH');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cipher.open(document.payload, aadFor(document)));
  } catch {
    throw new Error('FHIR_POLL_MANIFEST_AUTHENTICATION_FAILED');
  }
  if (!isRecord(parsed)) throw new Error('FHIR_POLL_MANIFEST_PAYLOAD_INVALID');
  const recovered = {
    tenantId: expected.tenantId, facilityId: expected.facilityId,
    sourceId: expected.sourceId, manifestId: expected.manifestId,
    sourceRevision: expected.sourceRevision,
    startCheckpointSequence: parsed.startCheckpointSequence,
    items: parsed.items,
    vendorCursor: parsed.vendorCursor,
  } as PollWorkManifest;
  assertPollWorkManifest(recovered);
  return recovered;
}

/**
 * Uses a local, ephemeral AES key only in the isolated Firestore emulator.
 * Real keys must come from a separately qualified KMS envelope scheme; this
 * reference class deliberately cannot be instantiated for STAGING/LIVE.
 */
export class EmulatorOnlyAesGcmCipher implements ManifestCipher {
  private readonly key: Buffer;
  private readonly keyId: string;
  constructor(key: Uint8Array, keyId = 'local-synthetic-key-v1') {
    this.guard();
    if (key.byteLength !== 32 || !validId(keyId)) throw new Error('FHIR_POLL_CIPHER_KEY_INVALID');
    this.key = Buffer.from(key);
    this.keyId = keyId;
  }
  private guard(): void {
    if (process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
        process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
        process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
        process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
        process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED') {
      throw new Error('FHIR_POLL_CIPHER_EMULATOR_ONLY');
    }
  }
  seal(plaintextUtf8: string, aadUtf8: string): SealedCiphertext {
    this.guard();
    if (Buffer.byteLength(plaintextUtf8, 'utf8') > 100_000) {
      throw new Error('FHIR_POLL_MANIFEST_TOO_LARGE');
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce, { authTagLength: 16 });
    cipher.setAAD(Buffer.from(aadUtf8, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintextUtf8, 'utf8'), cipher.final()]);
    return { suite: 'LOCAL_TEST_AES_256_GCM_V1', keyId: this.keyId,
      nonceHex: nonce.toString('hex'), tagHex: cipher.getAuthTag().toString('hex'),
      ciphertextBase64: ciphertext.toString('base64') };
  }
  open(payload: SealedCiphertext, aadUtf8: string): string {
    this.guard();
    if (!payload || payload.suite !== 'LOCAL_TEST_AES_256_GCM_V1' ||
        typeof payload.keyId !== 'string' ||
        Buffer.byteLength(payload.keyId, 'utf8') !== Buffer.byteLength(this.keyId, 'utf8') ||
        !timingSafeEqual(Buffer.from(payload.keyId, 'utf8'), Buffer.from(this.keyId, 'utf8')) ||
        !HEX24.test(payload.nonceHex) || !HEX32.test(payload.tagHex) ||
        typeof payload.ciphertextBase64 !== 'string' ||
        payload.ciphertextBase64.length > 200_000 ||
        !B64.test(payload.ciphertextBase64)) {
      throw new Error('FHIR_POLL_CIPHER_PAYLOAD_INVALID');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key,
      Buffer.from(payload.nonceHex, 'hex'), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(aadUtf8, 'utf8'));
    decipher.setAuthTag(Buffer.from(payload.tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertextBase64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
