import { describe, expect, test } from 'bun:test';
import type { Firestore } from 'firebase-admin/firestore';
import {
  inspectCiqpSnapshotOutboxEvidence,
} from '@/lib/clinical/patient360/ciqp-snapshot-outbox-audit';

const tenantId = 'ciqp-synthetic-cohort01';
const key = 'only-for-bounded-synthetic-testing'.repeat(2);

function fixture(options: {
  changedSnapshotId?: boolean;
  changedProvenance?: boolean;
  foreignTenant?: boolean;
  noSnapshots?: boolean;
  noOutbox?: boolean;
  badOutbox?: boolean;
} = {}) {
  const calls: string[] = [];
  const snapshots = options.noSnapshots ? [] : [{
    id: 'snapshot-01',
    data: () => ({
      snapshotId: options.changedSnapshotId ? 'different-id' : 'snapshot-01',
      tenantId: options.foreignTenant ? 'other-tenant' : tenantId,
      patientId: 'synthetic-patient-01',
      immutable: true, snapshotHash: 'a'.repeat(64),
      evidenceRefs: [{ sourceEventIds: ['event-a'] }],
      patient360SourceCheckpoint: options.changedProvenance ? 'changed-checkpoint' : 'original',
    }),
  }];
  const outbox = options.noOutbox ? [] : [
    { id: 'outbox-a', data: () => ({
      outboxId: 'outbox-a', tenantId,
      status: options.badOutbox ? 'UNRECOGNIZED' : 'PUBLISHED',
    }) },
    { id: 'outbox-b', data: () => ({
      outboxId: 'outbox-b', tenantId, status: 'PENDING',
    }) },
  ];
  const db = {
    collection(col: string) {
      calls.push('collection:' + col);
      return {
        doc(tenant: string) {
          calls.push('tenant:' + tenant);
          return {
            collection(name: string) {
              calls.push('collection:' + name);
              return {
                orderBy() {
                  calls.push('orderBy');
                  return {
                    limit(n: number) {
                      calls.push('limit:' + n);
                      return {
                        async get() {
                          calls.push('get');
                          const docs = name === 'clinicalIntelligenceEvidenceSnapshots'
                            ? snapshots : outbox;
                          return { size: docs.length, docs };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as Firestore, calls };
}

describe('CIQP-182 historic evidence and outbox inspector', () => {
  test('emits only keyed aggregate counts and marks consumer duplication unverified', async () => {
    const { db, calls } = fixture();
    const report = await inspectCiqpSnapshotOutboxEvidence(db, tenantId, key);
    expect(report).toMatchObject({
      snapshotCount: 1, outboxCount: 2,
      pendingOutboxCount: 1, publishedOutboxCount: 1,
      outboxStatusCounts: { PUBLISHED: 1, PENDING: 1 },
      duplicateDispatchEvidence: 'REQUIRES_INDEPENDENT_CONSUMER_REHEARSAL',
      writesPerformed: 0, releaseAuthorization: 'NOT_GRANTED',
    });
    expect(report.snapshotIdentifierHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(report.snapshotProvenanceHmac).toMatch(/^[a-f0-9]{64}$/);
    const safe = JSON.stringify(report);
    for (const hidden of ['snapshot-01', 'synthetic-patient-01', 'event-a', tenantId, key]) {
      expect(safe).not.toContain(hidden);
    }
    expect(calls).toEqual([
      'collection:tenants', 'tenant:' + tenantId,
      'collection:clinicalIntelligenceEvidenceSnapshots', 'orderBy', 'limit:5001', 'get',
      'collection:outbox', 'orderBy', 'limit:5001', 'get',
    ]);
  });

  test('altered snapshot provenance changes keyed HMAC, not identifier HMAC', async () => {
    const a = await inspectCiqpSnapshotOutboxEvidence(fixture().db, tenantId, key);
    const b = await inspectCiqpSnapshotOutboxEvidence(
      fixture({ changedProvenance: true }).db, tenantId, key
    );
    expect(a.snapshotIdentifierHmac).toBe(b.snapshotIdentifierHmac);
    expect(a.snapshotProvenanceHmac).not.toBe(b.snapshotProvenanceHmac);
  });

  test('missing snapshot or outbox evidence is blocked, not silently approved', async () => {
    for (const options of [{ noSnapshots: true }, { noOutbox: true }]) {
      await expect(inspectCiqpSnapshotOutboxEvidence(
        fixture(options).db, tenantId, key
      )).rejects.toThrow('CIQP_SNAPSHOT_AUDIT_EMPTY_OR_TRUNCATED');
    }
  });

  test('rejects cross-tenant snapshot, corrupt identity and unknown status', async () => {
    for (const options of [{ foreignTenant: true }, { changedSnapshotId: true }]) {
      await expect(inspectCiqpSnapshotOutboxEvidence(
        fixture(options).db, tenantId, key
      )).rejects.toThrow('CIQP_SNAPSHOT_AUDIT_INVALID_PROVENANCE');
    }
    await expect(inspectCiqpSnapshotOutboxEvidence(
      fixture({ badOutbox: true }).db, tenantId, key
    )).rejects.toThrow('CIQP_SNAPSHOT_AUDIT_INVALID_OUTBOX');
  });

  test('refuses non-synthetic tenant and weak HMAC key before Firestore reads', async () => {
    const { db, calls } = fixture();
    await expect(inspectCiqpSnapshotOutboxEvidence(db, 'real-hospital', key))
      .rejects.toThrow('CIQP_SNAPSHOT_AUDIT_SCOPE_DENIED');
    await expect(inspectCiqpSnapshotOutboxEvidence(db, tenantId, 'weak'))
      .rejects.toThrow('CIQP_SNAPSHOT_AUDIT_SCOPE_DENIED');
    expect(calls).toEqual([]);
  });

  test('source remains read-only and gated by frozen checkout', async () => {
    const [audit, entry] = await Promise.all([
      Bun.file('lib/clinical/patient360/ciqp-snapshot-outbox-audit.ts').text(),
      Bun.file('scripts/ops/ciqp-inspect-snapshot-outbox-readonly.ts').text(),
    ]);
    expect(entry).toContain('assertCiqpHostedStagingReadOnlyScope(process.env)');
    expect(entry).toContain('assertCiqpStagingCheckout(scope.expectedSha');
    for (const source of [audit, entry]) {
      for (const forbidden of ['.runTransaction(', '.set(', '.update(', '.delete(']) {
        expect(source).not.toContain(forbidden);
      }
    }
  });
});
