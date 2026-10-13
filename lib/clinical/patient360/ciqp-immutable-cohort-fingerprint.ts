/**
 * CIQP-05 read-only immutable record fingerprint for staging/restore evidence.
 *
 * Only keyed aggregate HMACs and counts are returned; no event payloads,
 * patient identifiers or document identifiers leave the operator process.
 * HMAC keys must be supplied externally and never written to Git/logs.
 */
import { createHmac } from 'node:crypto';
import { FieldPath, type Firestore } from 'firebase-admin/firestore';

const MAX_IMMUTABLE_ROWS = 5000;

/** Canonical JSON representation remains stable across object key ordering. */
export function canonicalCiqpJson(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value) || 'null';
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('CIQP_NONFINITE_SOURCE_VALUE');
  }
  if (typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  // Firestore timestamps are independent of runtime object identity/order.
  const time = value as { seconds?: unknown; nanoseconds?: unknown };
  if (typeof time.seconds === 'number' && typeof time.nanoseconds === 'number') {
    return JSON.stringify([time.seconds, time.nanoseconds]);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalCiqpJson).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).sort()
    .map(key => JSON.stringify(key) + ':' + canonicalCiqpJson(obj[key]))
    .join(',') + '}';
}

export interface CiqpImmutableFingerprint {
  eventCount: number;
  eventHmac: string;
  outboxCount: number;
  outboxHmac: string;
  writesPerformed: 0;
  releaseAuthorization: 'NOT_GRANTED';
}

async function fingerprintCollection(
  db: Firestore, tenantId: string, collectionName: 'events' | 'outbox',
  hmacKey: string
): Promise<{ count: number; hmac: string }> {
  const snap = await db.collection('tenants').doc(tenantId)
    .collection(collectionName)
    .orderBy(FieldPath.documentId())
    .limit(MAX_IMMUTABLE_ROWS + 1)
    .get();
  if (snap.size > MAX_IMMUTABLE_ROWS) {
    throw new Error('CIQP_IMMUTABLE_COHORT_TRUNCATED');
  }
  const hash = createHmac('sha256', hmacKey);
  hash.update('CIQP-05-IMMUTABLE-' + collectionName);
  hash.update(tenantId);
  for (const doc of snap.docs) {
    hash.update(canonicalCiqpJson([doc.id, doc.data()]));
  }
  return { count: snap.size, hmac: hash.digest('hex') };
}

export async function fingerprintCiqpImmutableTenant(
  db: Firestore, tenantId: string, hmacKey: string
): Promise<CiqpImmutableFingerprint> {
  if (!/^ciqp-synthetic-[a-z0-9-]{4,64}$/.test(tenantId) ||
      Buffer.byteLength(hmacKey, 'utf8') < 32) {
    throw new Error('CIQP_IMMUTABLE_FINGERPRINT_SCOPE_DENIED');
  }
  const [events, outbox] = await Promise.all([
    fingerprintCollection(db, tenantId, 'events', hmacKey),
    fingerprintCollection(db, tenantId, 'outbox', hmacKey),
  ]);
  if (events.count === 0 || outbox.count === 0) {
    throw new Error('CIQP_IMMUTABLE_EMPTY_COHORT');
  }
  return {
    eventCount: events.count, eventHmac: events.hmac,
    outboxCount: outbox.count, outboxHmac: outbox.hmac,
    writesPerformed: 0, releaseAuthorization: 'NOT_GRANTED',
  };
}

/** Apply cannot be declared successful if the immutable evidence changes. */
export function assertCiqpImmutableParity(
  before: CiqpImmutableFingerprint, after: CiqpImmutableFingerprint
): void {
  if (before.eventCount !== after.eventCount ||
      before.eventHmac !== after.eventHmac ||
      before.outboxCount !== after.outboxCount ||
      before.outboxHmac !== after.outboxHmac) {
    throw new Error('CIQP_IMMUTABLE_EVENT_OR_OUTBOX_CHANGED');
  }
}
