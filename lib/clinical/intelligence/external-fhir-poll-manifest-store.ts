/**
 * G3 Stage C — emulator-only Firestore manifest persistence and recovery.
 *
 * The operator must keep the G1/G2 production gates closed. This module
 * cannot access live Firestore or use a live FHIR HTTP adapter. The manifest
 * ciphertext, immutable event, audit row and HELD outbox row are written in
 * a single Firestore transaction. No browser route may import this module.
 */
import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import {
  assertPollWorkManifest, openPollWorkManifest, sealPollWorkManifest,
  sealedManifestPayloadEquals,
  type ManifestCipher, type PollWorkManifest, type SealedPollManifest,
} from './external-fhir-poll-manifest-seal';
import { runSyntheticFhirPoll, type SyntheticPollRead, type SyntheticPollResult } from
  './external-fhir-synthetic-poll-runner';
import type { FhirImportActor } from './external-fhir-import';
import { checkpointPersistedSyntheticPoll } from './external-fhir-poll-atomic-checkpoint';

export type NewPollWorkManifest = Omit<PollWorkManifest, 'sourceRevision'>;
export type StoredManifestResult = Readonly<{
  manifestId: string;
  sourceRevision: string;
  replay: boolean;
}>;

type Source = {
  tenantId?: string;
  sourceId?: string;
  facilityId?: string;
  status?: string;
  securityReviewStatus?: string;
  syncMode?: string;
  approvedResourceTypes?: string[];
  syntheticOnly?: boolean;
};

function guard(): void {
  if (process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED') {
    throw new Error('FHIR_POLL_PERSISTENCE_EMULATOR_ONLY');
  }
}
function snapshotRevision(snap: DocumentSnapshot): string {
  const at = snap.updateTime;
  if (!at || !Number.isSafeInteger(at.seconds) ||
      !Number.isSafeInteger(at.nanoseconds)) {
    throw new Error('FHIR_POLL_SOURCE_SERVER_REVISION_REQUIRED');
  }
  return `${at.seconds}.${String(at.nanoseconds).padStart(9, '0')}`;
}
function readTimeMs(snap: DocumentSnapshot): number {
  const at = snap.readTime?.toMillis();
  if (!at || !Number.isSafeInteger(at)) {
    throw new Error('FHIR_POLL_SERVER_CLOCK_REQUIRED');
  }
  return at;
}
function authorize(actor: FhirImportActor, m: NewPollWorkManifest, source: Source | undefined): void {
  if (!actor || !actor.actorId || actor.tenantId !== m.tenantId ||
      !actor.permissions.includes('FHIR_IMPORT') ||
      !actor.permissions.includes('FHIR_POLL_COORDINATE') ||
      !actor.facilityIds.includes(m.facilityId)) {
    throw new Error('FHIR_POLL_MANIFEST_ACTOR_DENIED');
  }
  if (!source || source.tenantId !== m.tenantId ||
      source.facilityId !== m.facilityId || source.sourceId !== m.sourceId ||
      source.status !== 'ACTIVE' || source.securityReviewStatus !== 'APPROVED' ||
      source.syncMode !== 'FENCED' || source.syntheticOnly !== true ||
      !Array.isArray(source.approvedResourceTypes) ||
      m.items.some(item => !source.approvedResourceTypes?.includes(item.resourceType))) {
    throw new Error('FHIR_POLL_MANIFEST_SOURCE_NOT_AUTHORIZED');
  }
}
function refs(db: Firestore, tenantId: string, sourceId: string, manifestId: string) {
  const tenant = db.collection('tenants').doc(tenantId);
  return {
    tenant,
    source: tenant.collection('fhirSources').doc(sourceId),
    manifest: tenant.collection('fhirPollWorkManifests').doc(manifestId),
  };
}

/** Idempotent, atomic manifest creation. Never replaces an existing document. */
export async function persistSealedSyntheticPollManifest(args: {
  db: Firestore;
  actor: FhirImportActor;
  manifest: NewPollWorkManifest;
  cipher: ManifestCipher;
}): Promise<StoredManifestResult> {
  guard();
  // Validate all user-supplied path elements BEFORE they reach Firestore refs.
  const draft: PollWorkManifest = { ...args.manifest, sourceRevision: '1000000000.000000000' };
  assertPollWorkManifest(draft);
  const { db, actor, manifest: input, cipher } = args;
  const r = refs(db, input.tenantId, input.sourceId, input.manifestId);
  return db.runTransaction(async tx => {
    const [sourceSnap, manifestSnap] = await tx.getAll(r.source, r.manifest);
    const source = sourceSnap.exists ? sourceSnap.data() as Source : undefined;
    authorize(actor, input, source);
    const manifest: PollWorkManifest = {
      ...input, sourceRevision: snapshotRevision(sourceSnap),
    };
    if (manifestSnap.exists) {
      const restored = openPollWorkManifest(
        manifestSnap.data() as SealedPollManifest, cipher, manifest,
      );
      if (!sealedManifestPayloadEquals(manifest, restored)) {
        throw new Error('FHIR_POLL_MANIFEST_REPLAY_CONFLICT');
      }
      return { manifestId: input.manifestId, sourceRevision: manifest.sourceRevision, replay: true };
    }
    const sealed = sealPollWorkManifest(manifest, cipher);
    const now = readTimeMs(sourceSnap);
    tx.create(r.manifest, { ...sealed, createdAtMs: now, createdBy: actor.actorId });
    const eventId = 'fpme_' + input.manifestId;
    const common = {
      tenantId: input.tenantId, sourceId: input.sourceId,
      facilityId: input.facilityId, manifestId: input.manifestId,
      sourceRevision: manifest.sourceRevision, eventId,
      recordedAtMs: now, clinicalAuthority: false,
      immutable: true,
    };
    tx.create(r.tenant.collection('fhirPollManifestEvents').doc(eventId), {
      ...common, eventType: 'FHIR_POLL_MANIFEST_SEALED',
    });
    tx.create(r.tenant.collection('auditLogs').doc('fpa_' + eventId), {
      ...common, action: 'FHIR_POLL_MANIFEST_SEALED', actorId: actor.actorId,
    });
    tx.create(r.tenant.collection('fhirPollManifestOutbox').doc('fpmo_' + eventId), {
      ...common, status: 'HELD', destination: 'CI_EXTERNAL_CONTEXT_QUALIFICATION',
    });
    return { manifestId: input.manifestId, sourceRevision: manifest.sourceRevision, replay: false };
  });
}

/** Server-only retrieval; source changes revoke a manifest until re-reviewed. */
export async function loadSealedSyntheticPollManifest(args: {
  db: Firestore;
  actor: FhirImportActor;
  tenantId: string;
  sourceId: string;
  manifestId: string;
  cipher: ManifestCipher;
}): Promise<PollWorkManifest> {
  guard();
  const placeholder: PollWorkManifest = {
    tenantId: args.tenantId, sourceId: args.sourceId,
    manifestId: args.manifestId, facilityId: 'synthetic-placeholder',
    sourceRevision: '1000000000.000000000', startCheckpointSequence: 0,
    items: [{workId: randomUUID(), resourceType: 'Patient', resourceId: 'synthetic', expectedVersionId: 'v1'}],
    vendorCursor: null,
  };
  assertPollWorkManifest(placeholder);
  const r = refs(args.db, args.tenantId, args.sourceId, args.manifestId);
  const [sourceSnap, manifestSnap] = await args.db.getAll(r.source, r.manifest);
  if (!manifestSnap.exists) throw new Error('FHIR_POLL_MANIFEST_NOT_FOUND');
  const row = manifestSnap.data() as SealedPollManifest;
  const scope = {
    tenantId: args.tenantId, sourceId: args.sourceId,
    facilityId: row.facilityId, manifestId: args.manifestId,
    sourceRevision: snapshotRevision(sourceSnap),
  };
  // First authenticate the plaintext-bound envelope and its associated data.
  const manifest = openPollWorkManifest(row, args.cipher, scope);
  const source = sourceSnap.exists ? sourceSnap.data() as Source : undefined;
  authorize(args.actor, manifest, source);
  return manifest;
}

/**
 * Fixture-only runner. The encrypted cursor is deliberately unused: the
 * synthetic reader has no HTTP capability, and checkpoints remain guarded by
 * the original CI-EXT-11/12 coordinator and immutable import transactions.
 */
export async function runPersistedSyntheticFhirPoll(args: {
  db: Firestore;
  actor: FhirImportActor;
  sourceId: string;
  manifestId: string;
  cipher: ManifestCipher;
  readFixture: SyntheticPollRead;
  afterImportCommitted?: (index: number, receiptId: string) => Promise<void>;
  leaseTtlMs?: number;
}): Promise<SyntheticPollResult> {
  guard();
  const manifest = await loadSealedSyntheticPollManifest({
    db: args.db, actor: args.actor, tenantId: args.actor.tenantId,
    sourceId: args.sourceId, manifestId: args.manifestId,
    cipher: args.cipher,
  });
  // Bind the running instance to the exact Firestore write-generation of the
  // immutable sealed manifest. Decryption/revision is rechecked IN the atomic
  // checkpoint transaction to reject a rewrite during the remote read.
  const manifestSnap = await args.db.collection('tenants').doc(manifest.tenantId)
    .collection('fhirPollWorkManifests').doc(manifest.manifestId).get();
  if (!manifestSnap.exists) throw new Error('FHIR_POLL_D_MANIFEST_DISAPPEARED');
  const opened = openPollWorkManifest(
    manifestSnap.data() as SealedPollManifest, args.cipher, manifest,
  );
  if (!sealedManifestPayloadEquals(opened, manifest)) {
    throw new Error('FHIR_POLL_D_MANIFEST_CHANGED_DURING_LOAD');
  }
  const manifestRevision = snapshotRevision(manifestSnap);
  return runSyntheticFhirPoll({
    db: args.db, actor: args.actor,
    manifest: {
      manifestId: manifest.manifestId,
      sourceId: manifest.sourceId,
      startCheckpointSequence: manifest.startCheckpointSequence,
      items: manifest.items,
    },
    readFixture: args.readFixture,
    afterImportCommitted: args.afterImportCommitted,
    leaseTtlMs: args.leaseTtlMs,
    checkpointWriter: async ({fence, sequence, workId, receiptId, digest}) => {
      await checkpointPersistedSyntheticPoll({
        db: args.db, actor: args.actor, cipher: args.cipher,
        manifest, manifestRevision, fence, sequence, workId, receiptId, digest,
      });
    },
  });
}
