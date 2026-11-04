/**
 * CI-EXT-13 — encrypted, durable, tenant/source-scoped FHIR poll manifest.
 *
 * This is a persistence/authentication contract, not an activated production
 * polling service. The production cipher MUST be backed by Cloud KMS envelope
 * encryption; only a synthetic, isolated emulator may use a test cipher.
 *
 * Clinical fields, remote IDs and cursor tokens are confined to authenticated
 * AEAD ciphertext. No network, KMS operation or plaintext read occurs inside
 * a Firestore transaction. Every server-side read revalidates source/tenant/
 * facility approval and requires an explicit poll-coordinate grant.
 */
import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import {
  assertFhirIdentifier, assertFhirSource,
  type FhirImportActor, type FhirSourceRecord,
} from './external-fhir-import';
import type { SyntheticPollManifest } from './external-fhir-synthetic-poll-runner';
import { siteApprovalDocId, validateFhirSiteApproval, type FhirSiteApproval } from '@/lib/interop/fhir-site-approval';

export type FhirManifestCipherEnvelope = {
  suite: 'AES-256-GCM';
  ivB64: string; tagB64: string; ciphertextB64: string;
  wrappedDekB64: string;
  keyVersion: string;
};
export interface FhirPollManifestCipher {
  /** Test cipher is rejected outside the isolated emulator. */
  readonly provider: 'CLOUD_KMS_ENVELOPE_V1' | 'SYNTHETIC_EMULATOR_ONLY';
  encrypt(cleartext: Uint8Array, aad: Uint8Array): Promise<FhirManifestCipherEnvelope>;
  decrypt(envelope: FhirManifestCipherEnvelope, aad: Uint8Array): Promise<Uint8Array>;
}
export type StoredFhirPollManifest = {
  tenantId: string; sourceId: string; manifestId: string;
  schemaVersion: 1;
  status: 'SEALED';
  sourceFacilityId: string;
  startCheckpointSequence: number;
  itemCount: number;
  resourceTypes: string[];
  plaintextDigest: string;
  ciphertextDigest: string;
  cipherProvider: FhirPollManifestCipher['provider'];
  encrypted: FhirManifestCipherEnvelope;
  createdBy: string;
  createdAt: number;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const KMS_VERSION = /^projects\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+\/cryptoKeyVersions\/[1-9]\d*$/;
const MAX_BYTES = 32_768;
function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
function byteLengthB64(value: string): number {
  if (!value || value.length > 180_000 || !B64.test(value) ||
      value.length % 4 !== 0) return -1;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.toString('base64') === value ? decoded.length : -1;
  } catch { return -1; }
}
function assertCipherProvider(cipher: FhirPollManifestCipher): void {
  if (!cipher || typeof cipher.encrypt !== 'function' ||
      typeof cipher.decrypt !== 'function') {
    throw new Error('FHIR_MANIFEST_CIPHER_REQUIRED');
  }
  if (cipher.provider === 'SYNTHETIC_EMULATOR_ONLY') {
    if (process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
        process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
        process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
        process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED' ||
        process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false') {
      throw new Error('FHIR_MANIFEST_TEST_CIPHER_PROHIBITED');
    }
  } else if (cipher.provider !== 'CLOUD_KMS_ENVELOPE_V1') {
    throw new Error('FHIR_MANIFEST_CIPHER_PROVIDER_UNSUPPORTED');
  }
}
function validateEnvelope(
  envelope: FhirManifestCipherEnvelope,
  provider: FhirPollManifestCipher['provider'],
): void {
  if (!envelope || envelope.suite !== 'AES-256-GCM' ||
      byteLengthB64(envelope.ivB64) !== 12 ||
      byteLengthB64(envelope.tagB64) !== 16 ||
      byteLengthB64(envelope.ciphertextB64) < 1 ||
      byteLengthB64(envelope.ciphertextB64) > MAX_BYTES + 16 ||
      byteLengthB64(envelope.wrappedDekB64) < 16 ||
      byteLengthB64(envelope.wrappedDekB64) > 4096 ||
      (provider === 'CLOUD_KMS_ENVELOPE_V1'
        ? !KMS_VERSION.test(envelope.keyVersion)
        : envelope.keyVersion !== 'synthetic-emulator-only')) {
    throw new Error('FHIR_MANIFEST_ENVELOPE_INVALID');
  }
}
function encodeManifest(manifest: SyntheticPollManifest): Uint8Array {
  if (!manifest || !UUID.test(manifest.manifestId) ||
      !Number.isSafeInteger(manifest.startCheckpointSequence) ||
      manifest.startCheckpointSequence < 0 || !Array.isArray(manifest.items) ||
      manifest.items.length < 1 || manifest.items.length > 12 ||
      manifest.startCheckpointSequence + manifest.items.length > Number.MAX_SAFE_INTEGER) {
    throw new Error('FHIR_MANIFEST_INVALID');
  }
  assertFhirIdentifier(manifest.sourceId, 'FHIR_MANIFEST_SOURCE_INVALID');
  const ids = new Set<string>();
  for (const item of manifest.items) {
    if (!item || !UUID.test(item.workId) || ids.has(item.workId) ||
        !['Patient', 'Encounter', 'Observation'].includes(item.resourceType)) {
      throw new Error('FHIR_MANIFEST_ITEM_INVALID');
    }
    ids.add(item.workId);
    assertFhirIdentifier(item.resourceId, 'FHIR_MANIFEST_RESOURCE_INVALID');
    assertFhirIdentifier(item.expectedVersionId, 'FHIR_MANIFEST_VERSION_INVALID');
  }
  // Construct a canonical, bounded payload so no caller-supplied extra
  // fields or prototypes are encrypted, stored or later interpreted.
  const normalized = {
    manifestId: manifest.manifestId,
    sourceId: manifest.sourceId,
    startCheckpointSequence: manifest.startCheckpointSequence,
    items: manifest.items.map(item => ({
      workId: item.workId, resourceType: item.resourceType,
      resourceId: item.resourceId, expectedVersionId: item.expectedVersionId,
    })),
  };
  const data = Buffer.from(JSON.stringify(normalized), 'utf8');
  if (data.length > MAX_BYTES) throw new Error('FHIR_MANIFEST_TOO_LARGE');
  return data;
}
function aad(input: { tenantId: string; sourceId: string; manifestId: string; start: number }): Uint8Array {
  return Buffer.from(JSON.stringify(['helixis.fhir.poll.manifest.v1',
    input.tenantId, input.sourceId, input.manifestId, input.start]), 'utf8');
}
function manifestRef(db: Firestore, tenantId: string, manifestId: string) {
  return db.collection('tenants').doc(tenantId)
    .collection('fhirPollManifests').doc(manifestId);
}
function authorize(actor: FhirImportActor, source: FhirSourceRecord | null, sourceId: string) {
  if (!actor?.actorId || !actor.tenantId ||
      !actor.permissions?.map(p => p.toUpperCase()).includes('FHIR_POLL_COORDINATE')) {
    throw new Error('FHIR_MANIFEST_COORDINATION_PERMISSION_REQUIRED');
  }
  const permitted = source?.approvedResourceTypes?.find(t =>
    ['Patient', 'Encounter', 'Observation'].includes(t));
  if (!permitted) throw new Error('FHIR_MANIFEST_SOURCE_RESOURCE_UNAPPROVED');
  const active = assertFhirSource(source, actor.tenantId, sourceId, actor, permitted);
  if (active.syncMode !== 'FENCED') throw new Error('FHIR_MANIFEST_SOURCE_NOT_FENCED');
  return active;
}
async function verifyApprovals(tx: Transaction, db: Firestore,
  source: FhirSourceRecord, resourceTypes: readonly string[]) {
  if (!source.oauth) return;
  if (!source.siteApprovalId) throw new Error('FHIR_MANIFEST_SITE_APPROVAL_MISSING');
  const ref = db.collection('tenants').doc(source.tenantId)
    .collection('fhirSiteApprovals').doc(siteApprovalDocId(source));
  const snap = await tx.get(ref);
  for (const resourceType of new Set(resourceTypes)) {
    validateFhirSiteApproval(source,
      snap.exists ? snap.data() as FhirSiteApproval : null,
      resourceType, Date.now());
  }
}
/** Authorize source at commit time. Cipher encrypts externally, before tx. */
export async function sealFhirPollManifest(args: {
  db: Firestore; actor: FhirImportActor;
  manifest: SyntheticPollManifest; cipher: FhirPollManifestCipher;
}): Promise<{ manifestId: string; replay: boolean; plaintextDigest: string }> {
  assertCipherProvider(args.cipher);
  const { db, actor, manifest, cipher } = args;
  const data = encodeManifest(manifest);
  const tenantId = assertFhirIdentifier(actor.tenantId, 'FHIR_MANIFEST_TENANT_INVALID');
  const sourceId = manifest.sourceId;
  const digest = hash(Buffer.concat([Buffer.from('CI_EXT13_MANIFEST_V1:'), Buffer.from(data)]));
  const additionalData = aad({tenantId,sourceId,manifestId:manifest.manifestId,start:manifest.startCheckpointSequence});
  const envelope = await cipher.encrypt(data, additionalData);
  validateEnvelope(envelope, cipher.provider);
  const ciphertextDigest = hash(Buffer.from(envelope.ciphertextB64, 'base64'));
  const root = db.collection('tenants').doc(tenantId);
  const ref = manifestRef(db, tenantId, manifest.manifestId);
  const headRef = root.collection('fhirPollManifestHeads').doc(sourceId);
  return db.runTransaction(async tx => {
    const [sourceSnap, existing, leaseSnap, headSnap] = await tx.getAll(
      root.collection('fhirSources').doc(sourceId), ref,
      root.collection('fhirSourcePollLeases').doc(sourceId), headRef,
    );
    const source = authorize(actor,
      sourceSnap.exists ? sourceSnap.data() as FhirSourceRecord : null, sourceId);
    await verifyApprovals(tx, db, source, manifest.items.map(i => i.resourceType));
    if (existing.exists) {
      const previous = existing.data() as StoredFhirPollManifest;
      if (previous.tenantId !== tenantId || previous.sourceId !== sourceId ||
          previous.manifestId !== manifest.manifestId ||
          previous.plaintextDigest !== digest ||
          previous.startCheckpointSequence !== manifest.startCheckpointSequence ||
          previous.itemCount !== manifest.items.length ||
          previous.status !== 'SEALED') {
        throw new Error('FHIR_MANIFEST_REPLAY_CONFLICT');
      }
      return { manifestId: manifest.manifestId, replay: true, plaintextDigest: digest };
    }
    const seq = leaseSnap.exists ? leaseSnap.get('checkpointSequence') : 0;
    if (!Number.isSafeInteger(seq) || seq !== manifest.startCheckpointSequence) {
      throw new Error('FHIR_MANIFEST_CHECKPOINT_START_INVALID');
    }
    if (headSnap.exists) {
      const previousHead = headSnap.data()!;
      if (previousHead.tenantId !== tenantId || previousHead.sourceId !== sourceId ||
          !UUID.test(previousHead.manifestId) ||
          !Number.isSafeInteger(previousHead.startCheckpointSequence) ||
          !Number.isSafeInteger(previousHead.itemCount) ||
          previousHead.itemCount < 1 ||
          previousHead.startCheckpointSequence + previousHead.itemCount > seq) {
        throw new Error('FHIR_MANIFEST_PREVIOUS_WORK_NOT_COMPLETE');
      }
    }
    const createdAt = Date.now();
    const record: StoredFhirPollManifest = {
      tenantId, sourceId, manifestId: manifest.manifestId,
      schemaVersion: 1, status: 'SEALED', sourceFacilityId: source.facilityId,
      startCheckpointSequence: manifest.startCheckpointSequence,
      itemCount: manifest.items.length,
      resourceTypes: [...new Set(manifest.items.map(i => i.resourceType))],
      plaintextDigest: digest, ciphertextDigest,
      cipherProvider: cipher.provider,
      encrypted: envelope, createdBy: actor.actorId, createdAt,
    };
    tx.create(ref, record);
    tx.set(headRef, {
      tenantId, sourceId, manifestId: manifest.manifestId,
      startCheckpointSequence: manifest.startCheckpointSequence,
      itemCount: manifest.items.length, manifestDigest: digest,
      updatedAt: createdAt,
    });
    const eventId = 'fpm_' + manifest.manifestId;
    const event = {
      tenantId, sourceId, manifestId: manifest.manifestId, eventId,
      eventType: 'FHIR_POLL_MANIFEST_SEALED',
      plaintextDigest: digest, itemCount: manifest.items.length,
      startCheckpointSequence: manifest.startCheckpointSequence,
      recordedAt: createdAt, immutable: true, clinicalAuthority: false,
    };
    tx.create(root.collection('fhirPollManifestEvents').doc(eventId), event);
    tx.create(root.collection('auditLogs').doc('fau_' + eventId), {
      ...event, action: 'FHIR_POLL_MANIFEST_SEALED', actorId: actor.actorId,
    });
    tx.create(root.collection('fhirPollManifestOutbox').doc('fpo_' + eventId), {
      ...event, status: 'HELD',
      destination: 'CI_EXTERNAL_CONTEXT_QUALIFICATION',
    });
    return { manifestId: manifest.manifestId, replay: false, plaintextDigest: digest };
  });
}
/**
 * This reader verifies authorization inside a Firestore tx; envelope
 * decryption runs *after* tx. The importing transaction must separately
 * recheck the source lease, head, consent, source/site grants.
 */
export async function openFhirPollManifest(args: {
  db: Firestore; actor: FhirImportActor;
  manifestId: string; sourceId: string;
  cipher: FhirPollManifestCipher;
}): Promise<SyntheticPollManifest> {
  assertCipherProvider(args.cipher);
  if (!UUID.test(args.manifestId)) throw new Error('FHIR_MANIFEST_ID_INVALID');
  const tenantId = assertFhirIdentifier(args.actor.tenantId, 'FHIR_MANIFEST_TENANT_INVALID');
  const sourceId = assertFhirIdentifier(args.sourceId, 'FHIR_MANIFEST_SOURCE_INVALID');
  const root = args.db.collection('tenants').doc(tenantId);
  const record = await args.db.runTransaction(async tx => {
    const [sourceSnap, manifestSnap, headSnap] = await tx.getAll(
      root.collection('fhirSources').doc(sourceId),
      manifestRef(args.db, tenantId, args.manifestId),
      root.collection('fhirPollManifestHeads').doc(sourceId),
    );
    const source = authorize(args.actor,
      sourceSnap.exists ? sourceSnap.data() as FhirSourceRecord : null, sourceId);
    const saved = manifestSnap.exists ? manifestSnap.data() as StoredFhirPollManifest : null;
    if (!headSnap.exists || headSnap.get('tenantId') !== tenantId ||
        headSnap.get('sourceId') !== sourceId ||
        headSnap.get('manifestId') !== args.manifestId) {
      throw new Error('FHIR_MANIFEST_NOT_ACTIVE_FOR_SOURCE');
    }
    if (!saved || !Array.isArray(saved.resourceTypes) ||
        saved.resourceTypes.length < 1 ||
        saved.resourceTypes.some(t => !['Patient', 'Encounter', 'Observation'].includes(t) ||
          !source.approvedResourceTypes.includes(t))) {
      throw new Error('FHIR_MANIFEST_RESOURCE_SCOPE_INVALID');
    }
    await verifyApprovals(tx, args.db, source, saved.resourceTypes);
    if (!saved || saved.schemaVersion !== 1 || saved.status !== 'SEALED' ||
        saved.tenantId !== tenantId || saved.sourceId !== sourceId ||
        saved.sourceFacilityId !== source.facilityId ||
        saved.manifestId !== args.manifestId ||
        saved.cipherProvider !== args.cipher.provider ||
        !/^[a-f0-9]{64}$/.test(saved.plaintextDigest) ||
        !/^[a-f0-9]{64}$/.test(saved.ciphertextDigest)) {
      throw new Error('FHIR_MANIFEST_SCOPE_OR_INTEGRITY_INVALID');
    }
    validateEnvelope(saved.encrypted, args.cipher.provider);
    if (hash(Buffer.from(saved.encrypted.ciphertextB64, 'base64')) !== saved.ciphertextDigest) {
      throw new Error('FHIR_MANIFEST_CIPHERTEXT_DIGEST_INVALID');
    }
    return saved;
  });
  const additionalData = aad({tenantId,sourceId,
    manifestId:record.manifestId,start:record.startCheckpointSequence});
  const plaintext = await args.cipher.decrypt(record.encrypted, additionalData);
  if (plaintext.byteLength > MAX_BYTES ||
      hash(Buffer.concat([Buffer.from('CI_EXT13_MANIFEST_V1:'),
        Buffer.from(plaintext)])) !== record.plaintextDigest) {
    throw new Error('FHIR_MANIFEST_PLAINTEXT_DIGEST_INVALID');
  }
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(plaintext).toString('utf8')); }
  catch { throw new Error('FHIR_MANIFEST_PLAINTEXT_INVALID'); }
  const manifest = decoded as SyntheticPollManifest;
  const canonical = encodeManifest(manifest);
  if (hash(Buffer.concat([Buffer.from('CI_EXT13_MANIFEST_V1:'),
        Buffer.from(canonical)])) !== record.plaintextDigest ||
      manifest.manifestId !== record.manifestId ||
      manifest.sourceId !== record.sourceId ||
      manifest.startCheckpointSequence !== record.startCheckpointSequence ||
      manifest.items.length !== record.itemCount ||
      JSON.stringify([...new Set(manifest.items.map(i => i.resourceType))]) !==
        JSON.stringify(record.resourceTypes)) {
    throw new Error('FHIR_MANIFEST_PLAINTEXT_SCOPE_INVALID');
  }
  return manifest;
}
