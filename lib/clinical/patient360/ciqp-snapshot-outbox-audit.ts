/**
 * CIQP #182: read-only, bounded, keyed evidence collector for historical
 * governed Clinical Intelligence snapshots and outbox consumer status.
 *
 * Never exposes snapshot IDs, patient IDs, provenance, document bodies,
 * outbox IDs, Firestore paths or HMAC keys. Intended for independently scoped
 * synthetic G-HIMS-AI staging and restore qualification only.
 *
 * Counts and hashes are NOT duplicate-delivery proof or clinical sign-off.
 */
import { createHmac } from 'node:crypto';
import { FieldPath, type Firestore } from 'firebase-admin/firestore';
import { canonicalCiqpJson } from './ciqp-immutable-cohort-fingerprint';

const MAX_SNAPSHOTS = 5000;
const MAX_OUTBOX = 5000;
const ALLOWED_STATUS = new Set(['PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD_LETTER']);

export interface CiqpSnapshotOutboxAudit {
  operation: 'CIQP_SNAPSHOT_OUTBOX_READ_ONLY';
  snapshotCount: number;
  snapshotIdentifierHmac: string;
  snapshotProvenanceHmac: string;
  outboxCount: number;
  pendingOutboxCount: number;
  publishedOutboxCount: number;
  outboxStatusCounts: Record<string, number>;
  duplicateDispatchEvidence: 'REQUIRES_INDEPENDENT_CONSUMER_REHEARSAL';
  writesPerformed: 0;
  releaseAuthorization: 'NOT_GRANTED';
}

export async function inspectCiqpSnapshotOutboxEvidence(
  db: Firestore, tenantId: string, hmacKey: string
): Promise<CiqpSnapshotOutboxAudit> {
  if (!/^ciqp-synthetic-[a-z0-9-]{4,64}$/.test(tenantId) ||
      Buffer.byteLength(hmacKey, 'utf8') < 32) {
    throw new Error('CIQP_SNAPSHOT_AUDIT_SCOPE_DENIED');
  }
  const tenant = db.collection('tenants').doc(tenantId);
  const [snapshots, outbox] = await Promise.all([
    tenant.collection('clinicalIntelligenceEvidenceSnapshots')
      .orderBy(FieldPath.documentId()).limit(MAX_SNAPSHOTS + 1).get(),
    tenant.collection('outbox')
      .orderBy(FieldPath.documentId()).limit(MAX_OUTBOX + 1).get(),
  ]);
  if (snapshots.size === 0 || outbox.size === 0 ||
      snapshots.size > MAX_SNAPSHOTS || outbox.size > MAX_OUTBOX) {
    throw new Error('CIQP_SNAPSHOT_AUDIT_EMPTY_OR_TRUNCATED');
  }

  const identities = createHmac('sha256', hmacKey);
  identities.update('CIQP-182-SNAPSHOT-IDENTIFIERS');
  identities.update(tenantId);
  const provenance = createHmac('sha256', hmacKey);
  provenance.update('CIQP-182-SNAPSHOT-PROVENANCE');
  provenance.update(tenantId);
  for (const doc of snapshots.docs) {
    const snapshot = doc.data() as Record<string, unknown>;
    if (snapshot.snapshotId !== doc.id || snapshot.tenantId !== tenantId ||
        typeof snapshot.patientId !== 'string' || !snapshot.patientId ||
        snapshot.immutable !== true || typeof snapshot.snapshotHash !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(snapshot.snapshotHash)) {
      throw new Error('CIQP_SNAPSHOT_AUDIT_INVALID_PROVENANCE');
    }
    identities.update(canonicalCiqpJson([doc.id, snapshot.snapshotId,
      snapshot.tenantId, snapshot.patientId]));
    provenance.update(canonicalCiqpJson([doc.id, snapshot]));
  }

  const statusCounts: Record<string, number> = {};
  for (const doc of outbox.docs) {
    const record = doc.data() as { tenantId?: string; outboxId?: string; status?: string };
    if (record.tenantId !== tenantId ||
        (record.outboxId && record.outboxId !== doc.id) ||
        !ALLOWED_STATUS.has(String(record.status))) {
      throw new Error('CIQP_SNAPSHOT_AUDIT_INVALID_OUTBOX');
    }
    const status = String(record.status);
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  const published = statusCounts.PUBLISHED || 0;
  return {
    operation: 'CIQP_SNAPSHOT_OUTBOX_READ_ONLY',
    snapshotCount: snapshots.size,
    snapshotIdentifierHmac: identities.digest('hex'),
    snapshotProvenanceHmac: provenance.digest('hex'),
    outboxCount: outbox.size,
    pendingOutboxCount: outbox.size - published,
    publishedOutboxCount: published,
    outboxStatusCounts: statusCounts,
    duplicateDispatchEvidence: 'REQUIRES_INDEPENDENT_CONSUMER_REHEARSAL',
    writesPerformed: 0,
    releaseAuthorization: 'NOT_GRANTED',
  };
}
