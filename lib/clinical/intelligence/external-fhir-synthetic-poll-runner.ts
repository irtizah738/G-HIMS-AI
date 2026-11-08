/**
 * CI-EXT-12 — synthetic-only FHIR poll orchestration.
 *
 * This module MUST NOT be exposed through a browser or deployed as a live
 * hospital job. It uses an injected synthetic fixture reader and refuses
 * execution without the isolated ghims-p4-ci Firestore emulator.
 *
 * This is an end-to-end qualification harness for the exact existing
 * source-scoped lease, immutable FHIR import and availability contracts.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import {
  assertFhirIdentifier, fhirImportHeadId, ingestExternalFhirResource,
  type ExternalFhirImportType, type FhirImportActor,
} from './external-fhir-import';
import {
  acquireSourcePollLease, reserveSourcePollOperation,
  checkpointSourcePollLease, releaseSourcePollLease,
  type FhirSourcePollOperationFence,
} from './external-fhir-sync-coordinator';
import { reconcileFhirReadAvailability } from './external-fhir-availability';

export type SyntheticPollItem = {
  /** Opaque, stable across crash/retry; MUST NOT contain patient identity. */
  workId: string;
  resourceType: ExternalFhirImportType;
  resourceId: string;
  /** Opaque source FHIR version, never interpreted as a number. */
  expectedVersionId: string;
};
export type SyntheticPollManifest = {
  manifestId: string;
  sourceId: string;
  /** Durable previous checkpoint when this manifest was approved. */
  startCheckpointSequence: number;
  items: readonly SyntheticPollItem[];
};
export type SyntheticPollResult = {
  status: 'COMPLETED';
  processed: number;
  checkpointSequence: number;
  replayedImports: number;
  fencingEpoch: number;
};
export type SyntheticPollRead = (item: Readonly<SyntheticPollItem>) => Promise<unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// UUID-only work IDs prevent storing free-form patient identifiers in poll events.
const WORK_ID = UUID;
function sha(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
function checkpointDigest(args: {
  tenantId: string; manifest: SyntheticPollManifest;
  index: number; item: SyntheticPollItem;
}): string {
  // Metadata-only digest, stable across retry and across lease epochs.
  return sha(['CI_EXT12_CHECKPOINT_V1', args.tenantId, args.manifest.sourceId,
    args.manifest.manifestId, args.manifest.startCheckpointSequence,
    args.index, args.item.workId, args.item.resourceType,
    args.item.resourceId, args.item.expectedVersionId]);
}
function assertSyntheticIsolation(): void {
  if (process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false') {
    throw new Error('FHIR_POLL_SYNTHETIC_EMULATOR_ONLY');
  }
}
function validateManifest(manifest: SyntheticPollManifest): void {
  if (!UUID.test(manifest.manifestId) ||
      !Number.isSafeInteger(manifest.startCheckpointSequence) ||
      manifest.startCheckpointSequence < 0 ||
      !Array.isArray(manifest.items) || manifest.items.length < 1 ||
      manifest.items.length > 12 ||
      manifest.startCheckpointSequence + manifest.items.length > Number.MAX_SAFE_INTEGER) {
    throw new Error('FHIR_POLL_MANIFEST_INVALID');
  }
  assertFhirIdentifier(manifest.sourceId, 'FHIR_POLL_SOURCE_INVALID');
  const uniqueWorkIds = new Set<string>();
  for (const item of manifest.items) {
    if (!WORK_ID.test(item.workId) || uniqueWorkIds.has(item.workId) ||
        !['Patient', 'Encounter', 'Observation'].includes(item.resourceType)) {
      throw new Error('FHIR_POLL_WORK_INVALID');
    }
    assertFhirIdentifier(item.resourceId, 'FHIR_POLL_RESOURCE_INVALID');
    assertFhirIdentifier(item.expectedVersionId, 'FHIR_POLL_VERSION_INVALID');
    uniqueWorkIds.add(item.workId);
  }
}
function verifyReturnedResource(input: unknown, item: SyntheticPollItem): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('FHIR_POLL_FIXTURE_INVALID');
  }
  const value = input as Record<string, unknown>;
  const meta = value.meta && typeof value.meta === 'object' &&
    !Array.isArray(value.meta) ? value.meta as Record<string, unknown> : null;
  if (value.resourceType !== item.resourceType ||
      value.id !== item.resourceId ||
      meta?.versionId !== item.expectedVersionId) {
    throw new Error('FHIR_POLL_FIXTURE_VERSION_OR_SCOPE_MISMATCH');
  }
}

export async function runSyntheticFhirPoll(args: {
  db: Firestore;
  actor: FhirImportActor;
  manifest: SyntheticPollManifest;
  readFixture: SyntheticPollRead;
  /** Test-only crash injection after immutable import, before checkpoint. */
  afterImportCommitted?: (index: number, receiptId: string) => Promise<void>;
  leaseTtlMs?: number;
  /** Stage D sealed-manifest checkpoint. Only the emulator-only persisted runner supplies this. */
  checkpointWriter?: (input: {
    fence: FhirSourcePollOperationFence;
    sequence: number; workId: string; receiptId: string; digest: string;
  }) => Promise<void>;
}): Promise<SyntheticPollResult> {
  assertSyntheticIsolation();
  validateManifest(args.manifest);
  if (typeof args.readFixture !== 'function') {
    throw new Error('FHIR_POLL_READER_REQUIRED');
  }
  const { db, actor, manifest } = args;
  if (!actor.actorId || !actor.tenantId ||
      !actor.permissions.includes('FHIR_POLL_COORDINATE') ||
      !actor.permissions.includes('FHIR_IMPORT')) {
    throw new Error('FHIR_POLL_SERVER_AUTHORIZATION_REQUIRED');
  }
  const claim = await acquireSourcePollLease({
    db, actor, sourceId: manifest.sourceId, workerId: randomUUID(),
    claimId: randomUUID(), ttlMs: args.leaseTtlMs ?? 120_000,
  });
  const start = manifest.startCheckpointSequence;
  const completed = claim.checkpointSequence - start;
  if (completed < 0 || completed > manifest.items.length) {
    throw new Error('FHIR_POLL_CHECKPOINT_OUTSIDE_MANIFEST');
  }
  if (completed > 0) {
    const previousItem = manifest.items[completed - 1];
    const digest = checkpointDigest({
      tenantId: actor.tenantId, manifest,
      index: completed, item: previousItem,
    });
    if (claim.checkpointDigest !== digest ||
        claim.checkpointWorkId !== previousItem.workId) {
      // The worker must not run a different manifest over a prior checkpoint.
      throw new Error('FHIR_POLL_MANIFEST_CHECKPOINT_CONFLICT');
    }
  }

  let processed = 0;
  let replayedImports = 0;
  // Do not catch and silently skip errors: leave the lease to expire as if
  // the worker crashed, preserving the last durable checkpoint for takeover.
  for (let i = completed; i < manifest.items.length; i++) {
    const item = manifest.items[i];
    const operation = await reserveSourcePollOperation({
      db, actor, fence: claim.fence, workId: item.workId,
    });
    const tenant = db.collection('tenants').doc(actor.tenantId);
    const headRef = tenant.collection('fhirResourceHeads')
      .doc(fhirImportHeadId(manifest.sourceId, item.resourceType, item.resourceId));
    const headBeforeRead = await headRef.get();
    const previousReceipt = headBeforeRead.exists
      ? String(headBeforeRead.get('receiptId') || '') : null;
    const probeStartedAt = Date.now();
    const probeId = randomUUID();
    let resource: unknown;
    try {
      resource = await args.readFixture(item);
    } catch (error) {
      const matched = error instanceof Error
        ? /^FHIR_HTTP_(404|410):/.exec(error.message) : null;
      if (matched && previousReceipt) {
        await reconcileFhirReadAvailability({
          db, actor, sourceId: manifest.sourceId,
          resourceType: item.resourceType, resourceId: item.resourceId,
          expectedHeadReceiptId: previousReceipt, syncFence: operation,
          probeId, probeStartedAt,
          httpStatus: matched[1] === '404' ? 404 : 410,
        });
        throw new Error('FHIR_POLL_SOURCE_UNAVAILABLE_HELD');
      }
      throw error;
    }
    verifyReturnedResource(resource, item);
    const imported = await ingestExternalFhirResource({
      db, actor, sourceId: manifest.sourceId, resource,
      syncFence: operation,
    });
    if (imported.status !== 'CURRENT') {
      throw new Error('FHIR_POLL_IMPORT_RECONCILIATION_REQUIRED');
    }
    // Persist the erroneous version and its audit/outbox first, but never
    // checkpoint it as a qualified clinical observation.
    if ((item.resourceType === 'Observation' || item.resourceType === 'Encounter') &&
        (resource as Record<string, unknown>).status === 'entered-in-error') {
      throw new Error('FHIR_POLL_ERRONEOUS_RESOURCE_REQUIRES_REVIEW');
    }
    const headAfterImport = await headRef.get();
    if (!headAfterImport.exists ||
        headAfterImport.get('receiptId') !== imported.receiptId) {
      throw new Error('FHIR_POLL_CURRENT_HEAD_CHANGED');
    }
    const availability = await reconcileFhirReadAvailability({
      db, actor, sourceId: manifest.sourceId,
      resourceType: item.resourceType, resourceId: item.resourceId,
      expectedHeadReceiptId: imported.receiptId, syncFence: operation,
      probeId, probeStartedAt, httpStatus: 200,
    });
    if (availability.status === 'STALE_IGNORED') {
      throw new Error('FHIR_POLL_AVAILABILITY_NOT_CURRENT');
    }
    await args.afterImportCommitted?.(i, imported.receiptId);
    const sequence = start + i + 1;
    const digest = checkpointDigest({
      tenantId: actor.tenantId, manifest, index: i + 1, item,
    });
    if (args.checkpointWriter) {
      await args.checkpointWriter({
        fence: operation, sequence, workId: item.workId,
        receiptId: imported.receiptId, digest,
      });
    } else {
      await checkpointSourcePollLease({
        db, actor, fence: claim.fence, sequence, workId: item.workId, digest,
      });
    }
    processed++;
    if (imported.replay) replayedImports++;
  }
  await releaseSourcePollLease({ db, actor, fence: claim.fence });
  return {
    status: 'COMPLETED',
    processed,
    checkpointSequence: start + manifest.items.length,
    replayedImports,
    fencingEpoch: claim.fence.epoch,
  };
}
