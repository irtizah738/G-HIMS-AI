/**
 * G3 Stage D — atomic, source-revision- and manifest-bound checkpoint writer.
 * SYNTHETIC ONLY. No hospital network, credentials, hosted Firestore, or
 * production enablement. Every evidence read occurs inside one transaction.
 */
import { createHash } from 'node:crypto';
import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
import { assertStageDCheckpointEvidence } from './external-fhir-poll-checkpoint-policy';
import { assertPollWorkManifest, openPollWorkManifest,
  sealedManifestPayloadEquals, type ManifestCipher, type PollWorkManifest,
  type SealedPollManifest, type PollWorkItem,
} from './external-fhir-poll-manifest-seal';
import { fhirImportHeadId, fhirPatientLinkId,
  type FhirImportActor,
} from './external-fhir-import';
import type { FhirSourcePollOperationFence } from './external-fhir-sync-coordinator';

const SHA = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function revision(snap: DocumentSnapshot): string {
  const v = snap.updateTime;
  if (!snap.exists || !v || !Number.isSafeInteger(v.seconds) ||
      !Number.isSafeInteger(v.nanoseconds)) {
    throw new Error('FHIR_POLL_D_DOCUMENT_REVISION_MISSING');
  }
  return `${v.seconds}.${String(v.nanoseconds).padStart(9, '0')}`;
}
function emulatorGuard(): void {
  if (process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED') {
    throw new Error('FHIR_POLL_D_EMULATOR_ONLY');
  }
}

/**
 * Identifies the exact registered manifest and one work item, with no HTTP
 * statuses or client-supplied acceptance flags as proof of completion.
 */
export async function checkpointPersistedSyntheticPoll(args: {
  db: Firestore;
  actor: FhirImportActor;
  cipher: ManifestCipher;
  manifest: PollWorkManifest;
  manifestRevision: string;
  fence: FhirSourcePollOperationFence;
  sequence: number;
  workId: string;
  receiptId: string;
  digest: string;
}): Promise<{checkpointSequence: number; replay: boolean}> {
  emulatorGuard();
  const {db, actor, manifest: m, fence} = args;
  assertPollWorkManifest(m);
  if (actor.tenantId !== m.tenantId || !actor.actorId ||
      !actor.facilityIds.includes(m.facilityId) ||
      !actor.permissions.includes('FHIR_IMPORT') ||
      !actor.permissions.includes('FHIR_POLL_COORDINATE') ||
      fence.tenantId !== m.tenantId || fence.sourceId !== m.sourceId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fence.workerId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fence.claimId) ||
      !Number.isSafeInteger(fence.epoch) || fence.epoch < 1 ||
      !Number.isSafeInteger(fence.operationSequence) || fence.operationSequence < 1 ||
      !Number.isSafeInteger(args.sequence) || args.sequence < 1 ||
      !/^[a-f0-9]{64}$/.test(args.digest) ||
      !/^fir_[0-9a-f]{64}$/.test(args.receiptId)) {
    throw new Error('FHIR_POLL_D_UNTRUSTED_CHECKPOINT_ARGS');
  }
  const index = args.sequence - m.startCheckpointSequence - 1;
  const item: PollWorkItem | undefined = m.items[index];
  if (!item || args.workId !== item.workId) {
    throw new Error('FHIR_POLL_D_WORK_OUTSIDE_MANIFEST');
  }
  const expectedDigest = SHA([
    'CI_EXT12_CHECKPOINT_V1', m.tenantId, m.sourceId,
    m.manifestId, m.startCheckpointSequence,
    index + 1, item.workId, item.resourceType,
    item.resourceId, item.expectedVersionId,
  ]);
  if (args.digest !== expectedDigest) {
    throw new Error('FHIR_POLL_D_CHECKPOINT_DIGEST_INVALID');
  }
  const expectedReceiptId = 'fir_' + SHA([
    m.sourceId, item.resourceType, item.resourceId, item.expectedVersionId,
  ]);
  if (args.receiptId !== expectedReceiptId) {
    throw new Error('FHIR_POLL_D_RECEIPT_NOT_EXPECTED_VERSION');
  }
  const root = db.collection('tenants').doc(m.tenantId);
  const headId = fhirImportHeadId(m.sourceId, item.resourceType, item.resourceId);
  const opId = 'fse_' + SHA([
    m.tenantId, m.sourceId, fence.epoch, 'RESERVED', fence.operationSequence,
  ]);
  const checkpointEventId = 'fse_' + SHA([
    m.tenantId, m.sourceId, fence.epoch, 'CHECKPOINTED', args.sequence,
  ]);
  const receiptSuffix = expectedReceiptId.slice(4);
  const paths = {
    source: root.collection('fhirSources').doc(m.sourceId),
    manifest: root.collection('fhirPollWorkManifests').doc(m.manifestId),
    lease: root.collection('fhirSourcePollLeases').doc(m.sourceId),
    operation: root.collection('fhirSourcePollEvents').doc(opId),
    checkpoint: root.collection('fhirSourcePollEvents').doc(checkpointEventId),
    receipt: root.collection('fhirImportedVersions').doc(expectedReceiptId),
    head: root.collection('fhirResourceHeads').doc(headId),
    importEvent: root.collection('fhirImportEvents').doc('fev_' + receiptSuffix),
    importAudit: root.collection('auditLogs').doc('fau_' + receiptSuffix),
    importOutbox: root.collection('fhirImportOutbox').doc('fob_' + receiptSuffix),
    availability: root.collection('fhirAvailabilityStates').doc(headId),
  };
  return db.runTransaction(async tx => {
    // Strictly read all mutable and immutable evidence BEFORE any writes.
    const [source, sealed, lease, op, checkpoint, receipt, head,
      importEvent, importAudit, importOutbox, availability] = await tx.getAll(
      paths.source, paths.manifest, paths.lease, paths.operation, paths.checkpoint,
      paths.receipt, paths.head, paths.importEvent, paths.importAudit,
      paths.importOutbox, paths.availability,
    );
    if (!source.exists || !sealed.exists || !lease.exists || !receipt.exists) {
      throw new Error('FHIR_POLL_D_REQUIRED_DOCUMENT_MISSING');
    }
    // The GCM ciphertext must be valid and represent the exact originally
    // loaded manifest. A document rewrite is rejected even if contents match.
    const stored = openPollWorkManifest(
      sealed.data() as SealedPollManifest, args.cipher, m,
    );
    if (!sealedManifestPayloadEquals(stored, m)) {
      throw new Error('FHIR_POLL_D_MANIFEST_PAYLOAD_CHANGED');
    }
    const linkId = (receipt.get('provenance') as {mappedByVerifiedLink?: string} | undefined)
      ?.mappedByVerifiedLink;
    if (typeof linkId !== 'string' || !/^fpl_[0-9a-f]{64}$/.test(linkId)) {
      throw new Error('FHIR_POLL_D_VERIFIED_LINK_REFERENCE_MISSING');
    }
    const patientId = receipt.get('patientId');
    if (typeof patientId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(patientId)) {
      throw new Error('FHIR_POLL_D_PATIENT_REFERENCE_INVALID');
    }
    const [link, patient] = await tx.getAll(
      root.collection('fhirPatientLinks').doc(linkId),
      root.collection('patients').doc(patientId),
    );
    if (!link.exists || !patient.exists ||
        typeof link.get('externalPatientId') !== 'string' ||
        fhirPatientLinkId(m.sourceId, link.get('externalPatientId')) !== linkId) {
      throw new Error('FHIR_POLL_D_VERIFIED_LINK_REVOKED');
    }
    const now = lease.readTime?.toMillis();
    assertStageDCheckpointEvidence({
      expected: {
        tenantId: m.tenantId, sourceId: m.sourceId, facilityId: m.facilityId,
        manifestId: m.manifestId, sourceRevision: m.sourceRevision,
        manifestRevision: args.manifestRevision,
        epoch: fence.epoch, workerId: fence.workerId, claimId: fence.claimId,
        operationSequence: fence.operationSequence, sequence: args.sequence,
        previousSequence: args.sequence - 1, workId: item.workId,
        resourceType: item.resourceType, resourceId: item.resourceId,
        expectedVersionId: item.expectedVersionId, receiptId: expectedReceiptId,
        headId,
      },
      sourceRevision: revision(source),
      manifestRevision: revision(sealed),
      source: source.data() || null, manifest: sealed.data() || null,
      lease: lease.data() || null, operation: op.data() || null,
      receipt: receipt.data() || null, head: head.data() || null,
      importEvent: importEvent.data() || null,
      importAudit: importAudit.data() || null,
      importOutbox: importOutbox.data() || null,
      availability: availability.data() || null,
      patientLink: link.data() || null, patient: patient.data() || null,
      nowServerMs: now || 0,
    });
    if (checkpoint.exists) {
      // A second callback is not allowed to fabricate a successful commit.
      // Whole-manifest retries skip committed work via the durable lease.
      throw new Error('FHIR_POLL_D_CHECKPOINT_ALREADY_COMMITTED');
    }
    // A reserved operation must have been committed in a prior transaction.
    // Never use a network HTTP 200 or a caller-side boolean as this evidence.
    const common = {
      tenantId: m.tenantId, sourceId: m.sourceId, facilityId: m.facilityId,
      epoch: fence.epoch, operation: 'CHECKPOINTED', sequence: args.sequence,
      operationSequence: fence.operationSequence, workId: item.workId,
      manifestId: m.manifestId, manifestRevision: args.manifestRevision,
      manifestSourceRevision: m.sourceRevision, receiptId: expectedReceiptId,
      checkpointDigest: args.digest, recordedAtMs: now,
      clinicalAuthority: false, eventId: checkpointEventId,
      immutable: true,
    };
    tx.update(paths.lease, {
      checkpointSequence: args.sequence, checkpointDigest: args.digest,
      checkpointWorkId: item.workId, updatedAtMs: now,
    });
    tx.create(paths.checkpoint, {
      ...common, eventType: 'FHIR_SOURCE_POLL_CHECKPOINTED',
    });
    tx.create(root.collection('auditLogs').doc('fau_' + checkpointEventId), {
      ...common, actorId: actor.actorId, action: 'FHIR_SOURCE_POLL_CHECKPOINTED',
    });
    tx.create(root.collection('fhirSourcePollOutbox').doc('fso_' + checkpointEventId), {
      ...common, status: 'HELD', destination: 'CI_EXTERNAL_CONTEXT_QUALIFICATION',
    });
    return { checkpointSequence: args.sequence, replay: false };
  });
}
