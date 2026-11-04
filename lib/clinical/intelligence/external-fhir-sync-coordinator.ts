/**
 * CI-EXT-11 — Durable server-only source-poll coordination.
 *
 * A source can explicitly opt into FENCED mode. Every managed clinical import,
 * availability observation and history assessment then reads this lease inside
 * its OWN Firestore transaction before writing evidence.
 *
 * Monotonic epochs, not worker wall-clock timestamps, identify the active
 * poll attempt. Expiration uses Firestore's server-provided snapshot readTime.
 * An expired / replaced owner cannot commit even if its HTTP call succeeded.
 */
import { createHash } from 'node:crypto';
import type { Firestore, Transaction, DocumentReference, DocumentSnapshot } from 'firebase-admin/firestore';
import {
  assertFhirIdentifier, assertFhirSource, type FhirImportActor,
  type FhirSourceRecord,
} from './external-fhir-import';

export type FhirSourcePollFence = {
  tenantId: string;
  sourceId: string;
  workerId: string;
  claimId: string;
  epoch: number;
};

export type FhirSourcePollOperationFence = FhirSourcePollFence & {
  operationSequence: number;
};

export type FhirSourcePollLease = {
  tenantId: string;
  sourceId: string;
  facilityId: string;
  status: 'ACTIVE' | 'RELEASED';
  workerId: string;
  claimId: string;
  epoch: number;
  expiresAtMs: number;
  renewalSequence: number;
  /** Monotonic sequence assigned BEFORE an external request is made. */
  issuedSequence: number;
  checkpointSequence: number;
  checkpointDigest: string | null;
  checkpointWorkId: string | null;
  updatedAtMs: number;
};

export type FhirSourcePollAcquisition = {
  fence: FhirSourcePollFence;
  expiresAtMs: number;
  checkpointSequence: number;
  checkpointDigest: string | null;
  checkpointWorkId: string | null;
  replay: boolean;
};

type Operation = 'ACQUIRED' | 'RENEWED' | 'RELEASED' | 'CHECKPOINTED' | 'RESERVED';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
function sha(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
function serverReadMs(snapshot: DocumentSnapshot): number {
  const now = snapshot.readTime?.toMillis();
  if (!Number.isSafeInteger(now) || !now || now < 1) {
    throw new Error('FHIR_SYNC_SERVER_READ_TIME_REQUIRED');
  }
  return now;
}
function validateWorker(fence: Pick<FhirSourcePollFence, 'workerId'|'claimId'>): void {
  if (!UUID.test(fence.workerId) || !UUID.test(fence.claimId)) {
    throw new Error('FHIR_SYNC_WORKER_ID_INVALID');
  }
}
function leaseRef(db: Firestore, tenantId: string, sourceId: string): DocumentReference {
  return db.collection('tenants').doc(tenantId)
    .collection('fhirSourcePollLeases').doc(sourceId);
}
function validateRecord(
  record: FhirSourcePollLease | null, tenantId: string,
  source: FhirSourceRecord,
): void {
  if (record && (record.tenantId !== tenantId ||
      record.sourceId !== source.sourceId ||
      record.facilityId !== source.facilityId ||
      !['ACTIVE', 'RELEASED'].includes(record.status) ||
      !Number.isSafeInteger(record.epoch) || record.epoch < 1 ||
      !Number.isSafeInteger(record.renewalSequence) || record.renewalSequence < 0 ||
      !Number.isSafeInteger(record.issuedSequence) || record.issuedSequence < 0 ||
      !Number.isSafeInteger(record.checkpointSequence) || record.checkpointSequence < 0 ||
      !Number.isSafeInteger(record.expiresAtMs) ||
      !Number.isSafeInteger(record.updatedAtMs))) {
    throw new Error('FHIR_SYNC_LEASE_INTEGRITY_INVALID');
  }
}
function authorizeCoordinator(
  actor: FhirImportActor, source: FhirSourceRecord, sourceId: string,
): void {
  const approved = source.approvedResourceTypes.find(t =>
    t === 'Patient' || t === 'Encounter' || t === 'Observation');
  if (!approved) throw new Error('FHIR_SYNC_SOURCE_HAS_NO_SUPPORTED_TYPES');
  assertFhirSource(source, actor.tenantId, sourceId, actor, approved);
  if (source.syncMode !== 'FENCED' ||
      !actor.permissions.map(p => p.toUpperCase()).includes('FHIR_POLL_COORDINATE')) {
    throw new Error('FHIR_SYNC_COORDINATION_NOT_AUTHORIZED');
  }
}
/** A read must be part of the very transaction committing the clinical result. */
export async function assertSourcePollFenceInTransaction(args: {
  tx: Transaction;
  db: Firestore;
  source: FhirSourceRecord;
  fence?: FhirSourcePollFence;
}): Promise<void> {
  if (args.source.syncMode !== 'FENCED') {
    if (args.fence) throw new Error('FHIR_SYNC_UNEXPECTED_FENCE');
    return;
  }
  const fence = args.fence;
  if (!fence || !Number.isSafeInteger(fence.epoch) || fence.epoch < 1) {
    throw new Error('FHIR_SYNC_FENCE_REQUIRED');
  }
  validateWorker(fence);
  if (fence.tenantId !== args.source.tenantId ||
      fence.sourceId !== args.source.sourceId) {
    throw new Error('FHIR_SYNC_FENCE_SCOPE_DENIED');
  }
  const snapshot = await args.tx.get(
    leaseRef(args.db, fence.tenantId, fence.sourceId),
  );
  const lease = snapshot.exists ? snapshot.data() as FhirSourcePollLease : null;
  validateRecord(lease, fence.tenantId, args.source);
  if (!lease || lease.status !== 'ACTIVE' ||
      lease.workerId !== fence.workerId ||
      lease.claimId !== fence.claimId || lease.epoch !== fence.epoch ||
      lease.expiresAtMs <= serverReadMs(snapshot)) {
    throw new Error('FHIR_SYNC_FENCE_STALE_OR_EXPIRED');
  }
  if ('operationSequence' in fence &&
      (!Number.isSafeInteger(fence.operationSequence) ||
       (fence.operationSequence as number) < 1 ||
       (fence.operationSequence as number) > lease.issuedSequence)) {
    throw new Error('FHIR_SYNC_OPERATION_NOT_RESERVED');
  }
}
function auditEvent(args: {
  tx: Transaction; db: Firestore; tenantId: string; sourceId: string;
  epoch: number; sequence: number; type: Operation;
  actorId: string; recordedAtMs: number;
  workId?: string; digest?: string;
}): string {
  const root = args.db.collection('tenants').doc(args.tenantId);
  const id = 'fse_' + sha([args.tenantId, args.sourceId,
    args.epoch, args.type, args.sequence]);
  const common = {
    tenantId: args.tenantId, sourceId: args.sourceId,
    epoch: args.epoch, operation: args.type, sequence: args.sequence,
    workId: args.workId || null, checkpointDigest: args.digest || null,
    eventId: id, recordedAtMs: args.recordedAtMs,
    clinicalAuthority: false,
  };
  args.tx.create(root.collection('fhirSourcePollEvents').doc(id), {
    ...common, eventType: 'FHIR_SOURCE_POLL_' + args.type,
    immutable: true,
  });
  args.tx.create(root.collection('auditLogs').doc('fau_' + id), {
    ...common, actorId: args.actorId, action: 'FHIR_SOURCE_POLL_' + args.type,
    immutable: true,
  });
  args.tx.create(root.collection('fhirSourcePollOutbox').doc('fso_' + id), {
    ...common, status: 'HELD',
    destination: 'CI_EXTERNAL_CONTEXT_QUALIFICATION',
  });
  return id;
}
export async function acquireSourcePollLease(args: {
  db: Firestore; actor: FhirImportActor; sourceId: string;
  workerId: string; claimId: string; ttlMs: number;
}): Promise<FhirSourcePollAcquisition> {
  const { db, actor } = args;
  const tenantId = assertFhirIdentifier(actor.tenantId, 'FHIR_SYNC_TENANT_INVALID');
  const sourceId = assertFhirIdentifier(args.sourceId, 'FHIR_SYNC_SOURCE_INVALID');
  validateWorker(args);
  if (!Number.isSafeInteger(args.ttlMs) || args.ttlMs < 5_000 || args.ttlMs > 300_000) {
    throw new Error('FHIR_SYNC_LEASE_TTL_INVALID');
  }
  const ref = leaseRef(db, tenantId, sourceId);
  const sourceRef = db.collection('tenants').doc(tenantId)
    .collection('fhirSources').doc(sourceId);
  return db.runTransaction(async tx => {
    const [sourceSnap, leaseSnap] = await tx.getAll(sourceRef, ref);
    const source = sourceSnap.exists ? sourceSnap.data() as FhirSourceRecord : null;
    if (!source) throw new Error('FHIR_SYNC_SOURCE_NOT_FOUND');
    authorizeCoordinator(actor, source, sourceId);
    const old = leaseSnap.exists ? leaseSnap.data() as FhirSourcePollLease : null;
    validateRecord(old, tenantId, source);
    const now = serverReadMs(leaseSnap);
    if (old?.status === 'ACTIVE' && old.expiresAtMs > now) {
      if (old.workerId !== args.workerId || old.claimId !== args.claimId) {
        throw new Error('FHIR_SYNC_ALREADY_LEASED');
      }
      return {
        fence: { tenantId, sourceId, workerId: old.workerId,
          claimId: old.claimId, epoch: old.epoch },
        expiresAtMs: old.expiresAtMs,
        checkpointSequence: old.checkpointSequence,
        checkpointDigest: old.checkpointDigest,
        checkpointWorkId: old.checkpointWorkId,
        replay: true,
      };
    }
    // Expired claims must not be resurrected through the same idempotency ID.
    if (old && old.claimId === args.claimId && old.workerId === args.workerId) {
      throw new Error('FHIR_SYNC_EXPIRED_CLAIM_REPLAY');
    }
    const epoch = (old?.epoch || 0) + 1;
    if (!Number.isSafeInteger(epoch)) throw new Error('FHIR_SYNC_EPOCH_OVERFLOW');
    const expiresAtMs = now + args.ttlMs;
    const record: FhirSourcePollLease = {
      tenantId, sourceId, facilityId: source.facilityId,
      status: 'ACTIVE', workerId: args.workerId, claimId: args.claimId,
      epoch, expiresAtMs, renewalSequence: 0,
      issuedSequence: old?.issuedSequence || 0,
      checkpointSequence: old?.checkpointSequence || 0,
      checkpointDigest: old?.checkpointDigest || null,
      checkpointWorkId: old?.checkpointWorkId || null,
      updatedAtMs: now,
    };
    tx.set(ref, record);
    auditEvent({ tx, db, tenantId, sourceId, epoch,
      type: 'ACQUIRED', sequence: 0, actorId: actor.actorId, recordedAtMs: now });
    return {
      fence: { tenantId, sourceId, workerId: args.workerId,
        claimId: args.claimId, epoch },
      expiresAtMs,
      checkpointSequence: record.checkpointSequence,
      checkpointDigest: record.checkpointDigest,
      checkpointWorkId: record.checkpointWorkId,
      replay: false,
    };
  });
}
/**
 * Reserve one globally increasing source operation sequence before HTTP I/O.
 * A sequence is never reused, including after lease expiry/takeover.
 */
export async function reserveSourcePollOperation(args: {
  db: Firestore; actor: FhirImportActor; fence: FhirSourcePollFence;
  workId: string;
}): Promise<FhirSourcePollOperationFence> {
  const { db, actor, fence } = args;
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(args.workId)) {
    throw new Error('FHIR_SYNC_WORK_ID_INVALID');
  }
  const ref = leaseRef(db, fence.tenantId, fence.sourceId);
  return db.runTransaction(async tx => {
    const [sourceSnap, leaseSnap] = await tx.getAll(
      db.collection('tenants').doc(fence.tenantId)
        .collection('fhirSources').doc(fence.sourceId), ref,
    );
    const source = sourceSnap.exists ? sourceSnap.data() as FhirSourceRecord : null;
    if (!source) throw new Error('FHIR_SYNC_SOURCE_NOT_FOUND');
    authorizeCoordinator(actor, source, fence.sourceId);
    if (actor.tenantId !== fence.tenantId) {
      throw new Error('FHIR_SYNC_FENCE_SCOPE_DENIED');
    }
    await assertSourcePollFenceInTransaction({ tx, db, source, fence });
    const lease = leaseSnap.data() as FhirSourcePollLease;
    const operationSequence = lease.issuedSequence + 1;
    if (!Number.isSafeInteger(operationSequence)) {
      throw new Error('FHIR_SYNC_SEQUENCE_OVERFLOW');
    }
    const now = serverReadMs(leaseSnap);
    tx.update(ref, { issuedSequence: operationSequence, updatedAtMs: now });
    auditEvent({ tx, db, tenantId: fence.tenantId, sourceId: fence.sourceId,
      epoch: fence.epoch, type: 'RESERVED', sequence: operationSequence,
      actorId: actor.actorId, recordedAtMs: now, workId: args.workId });
    return { ...fence, operationSequence };
  });
}

export async function renewSourcePollLease(args: {
  db: Firestore; actor: FhirImportActor; fence: FhirSourcePollFence;
  ttlMs: number;
}): Promise<{ expiresAtMs: number; renewalSequence: number }> {
  if (!Number.isSafeInteger(args.ttlMs) || args.ttlMs < 5_000 || args.ttlMs > 300_000) {
    throw new Error('FHIR_SYNC_LEASE_TTL_INVALID');
  }
  const { db, actor, fence } = args;
  const ref = leaseRef(db, fence.tenantId, fence.sourceId);
  return db.runTransaction(async tx => {
    const [sourceSnap, leaseSnap] = await tx.getAll(
      db.collection('tenants').doc(fence.tenantId)
        .collection('fhirSources').doc(fence.sourceId), ref,
    );
    const source = sourceSnap.exists ? sourceSnap.data() as FhirSourceRecord : null;
    if (!source) throw new Error('FHIR_SYNC_SOURCE_NOT_FOUND');
    authorizeCoordinator(actor, source, fence.sourceId);
    if (actor.tenantId !== fence.tenantId) throw new Error('FHIR_SYNC_FENCE_SCOPE_DENIED');
    await assertSourcePollFenceInTransaction({ tx, db, source, fence });
    const lease = leaseSnap.data() as FhirSourcePollLease;
    const now = serverReadMs(leaseSnap);
    const renewalSequence = lease.renewalSequence + 1;
    if (!Number.isSafeInteger(renewalSequence)) throw new Error('FHIR_SYNC_RENEWAL_OVERFLOW');
    const expiresAtMs = now + args.ttlMs;
    tx.update(ref, { expiresAtMs, renewalSequence, updatedAtMs: now });
    auditEvent({ tx, db, tenantId: fence.tenantId, sourceId: fence.sourceId,
      epoch: fence.epoch, type: 'RENEWED', sequence: renewalSequence,
      actorId: actor.actorId, recordedAtMs: now });
    return { expiresAtMs, renewalSequence };
  });
}
export async function checkpointSourcePollLease(args: {
  db: Firestore; actor: FhirImportActor; fence: FhirSourcePollFence;
  sequence: number; workId: string; digest: string;
}): Promise<{ checkpointSequence: number; replay: boolean }> {
  const { db, actor, fence } = args;
  if (!Number.isSafeInteger(args.sequence) || args.sequence < 1 ||
      !/^[A-Za-z0-9._-]{1,96}$/.test(args.workId) ||
      !DIGEST.test(args.digest)) {
    throw new Error('FHIR_SYNC_CHECKPOINT_INVALID');
  }
  const ref = leaseRef(db, fence.tenantId, fence.sourceId);
  return db.runTransaction(async tx => {
    const [sourceSnap, leaseSnap] = await tx.getAll(
      db.collection('tenants').doc(fence.tenantId)
        .collection('fhirSources').doc(fence.sourceId), ref,
    );
    const source = sourceSnap.exists ? sourceSnap.data() as FhirSourceRecord : null;
    if (!source) throw new Error('FHIR_SYNC_SOURCE_NOT_FOUND');
    authorizeCoordinator(actor, source, fence.sourceId);
    if (actor.tenantId !== fence.tenantId) throw new Error('FHIR_SYNC_FENCE_SCOPE_DENIED');
    await assertSourcePollFenceInTransaction({ tx, db, source, fence });
    const lease = leaseSnap.data() as FhirSourcePollLease;
    const eventId = 'fse_' + sha([fence.tenantId, fence.sourceId,
      fence.epoch, 'CHECKPOINTED', args.sequence]);
    const eventSnap = await tx.get(db.collection('tenants').doc(fence.tenantId)
      .collection('fhirSourcePollEvents').doc(eventId));
    if (eventSnap.exists) {
      if (eventSnap.get('checkpointDigest') !== args.digest ||
          eventSnap.get('workId') !== args.workId) {
        throw new Error('FHIR_SYNC_CHECKPOINT_REPLAY_CONFLICT');
      }
      return { checkpointSequence: args.sequence, replay: true };
    }
    if (args.sequence !== lease.checkpointSequence + 1) {
      throw new Error('FHIR_SYNC_CHECKPOINT_OUT_OF_ORDER');
    }
    const now = serverReadMs(leaseSnap);
    tx.update(ref, { checkpointSequence: args.sequence,
      checkpointDigest: args.digest, checkpointWorkId: args.workId,
      updatedAtMs: now });
    auditEvent({ tx, db, tenantId: fence.tenantId, sourceId: fence.sourceId,
      epoch: fence.epoch, type: 'CHECKPOINTED', sequence: args.sequence,
      actorId: actor.actorId, recordedAtMs: now,
      workId: args.workId, digest: args.digest });
    return { checkpointSequence: args.sequence, replay: false };
  });
}
export async function releaseSourcePollLease(args: {
  db: Firestore; actor: FhirImportActor; fence: FhirSourcePollFence;
}): Promise<void> {
  const { db, actor, fence } = args;
  const ref = leaseRef(db, fence.tenantId, fence.sourceId);
  await db.runTransaction(async tx => {
    const [sourceSnap, leaseSnap] = await tx.getAll(
      db.collection('tenants').doc(fence.tenantId)
        .collection('fhirSources').doc(fence.sourceId), ref,
    );
    const source = sourceSnap.exists ? sourceSnap.data() as FhirSourceRecord : null;
    if (!source) throw new Error('FHIR_SYNC_SOURCE_NOT_FOUND');
    authorizeCoordinator(actor, source, fence.sourceId);
    if (actor.tenantId !== fence.tenantId) throw new Error('FHIR_SYNC_FENCE_SCOPE_DENIED');
    await assertSourcePollFenceInTransaction({ tx, db, source, fence });
    const lease = leaseSnap.data() as FhirSourcePollLease;
    const now = serverReadMs(leaseSnap);
    tx.update(ref, { status: 'RELEASED', expiresAtMs: 0, updatedAtMs: now });
    auditEvent({ tx, db, tenantId: fence.tenantId, sourceId: fence.sourceId,
      epoch: fence.epoch, type: 'RELEASED', sequence: lease.renewalSequence,
      actorId: actor.actorId, recordedAtMs: now });
  });
}
