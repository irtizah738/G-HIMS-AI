import { describe, expect, test } from 'bun:test';
import type { Firestore } from 'firebase-admin/firestore';
import {
  canonicalCiqpJson, fingerprintCiqpImmutableTenant, assertCiqpImmutableParity,
} from '@/lib/clinical/patient360/ciqp-immutable-cohort-fingerprint';

function fakeImmutableDb(replacement = false, empty = false) {
  const calls: string[] = [];
  const data: Record<string, Array<{ id: string; data: () => unknown }>> = {
    events: [
      { id: 'event-a', data: () => replacement
        ? { type: 'UNEXPECTED_CHANGED_EVENT', details: { b: 2, a: 1 } }
        : { details: { a: 1, b: 2 }, type: 'CLINICAL_DRAFT_SIGNED' } },
    ],
    outbox: [
      { id: 'outbox-a', data: () => ({ eventId: 'event-a', status: 'PENDING' }) },
    ],
  };
  if (empty) { data.events = []; data.outbox = []; }
  const db = {
    collection(name: string) {
      calls.push(name);
      return {
        doc(tenantId: string) {
          calls.push('tenant:' + tenantId);
          return {
            collection(collectionName: string) {
              calls.push(collectionName);
              return {
                orderBy() {
                  return {
                    limit(n: number) {
                      expect(n).toBe(5001);
                      return {
                        async get() {
                          return { docs: data[collectionName], size: data[collectionName].length };
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

describe('CIQP-05 immutable source and outbox evidence', () => {
  test('canonical JSON is independent of object property ordering', () => {
    const a = canonicalCiqpJson({ z: [1, 2], a: { b: true, a: 'value' } });
    const b = canonicalCiqpJson({ a: { a: 'value', b: true }, z: [1, 2] });
    expect(a).toBe(b);
  });

  test('read-only fingerprint is bounded, keyed, and contains no row/identifier fields', async () => {
    const { db, calls } = fakeImmutableDb();
    const result = await fingerprintCiqpImmutableTenant(
      db, 'ciqp-synthetic-cohort01', 'staging-secret'.repeat(4)
    );
    expect(result).toMatchObject({
      eventCount: 1, outboxCount: 1,
      writesPerformed: 0, releaseAuthorization: 'NOT_GRANTED',
    });
    expect(result.eventHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(result.outboxHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain('event-a');
    expect(calls).toEqual([
      'tenants', 'tenant:ciqp-synthetic-cohort01', 'events',
      'tenants', 'tenant:ciqp-synthetic-cohort01', 'outbox',
    ]);
  });

  test('mutation of an immutable event is detected and blocks parity', async () => {
    const scope = 'ciqp-synthetic-cohort01', key = 'staging-secret'.repeat(4);
    const clean = await fingerprintCiqpImmutableTenant(fakeImmutableDb().db, scope, key);
    const changed = await fingerprintCiqpImmutableTenant(fakeImmutableDb(true).db, scope, key);
    expect(() => assertCiqpImmutableParity(clean, clean)).not.toThrow();
    expect(() => assertCiqpImmutableParity(clean, changed))
      .toThrow('CIQP_IMMUTABLE_EVENT_OR_OUTBOX_CHANGED');
  });

  test('empty immutable event/outbox cohorts cannot establish a restore baseline', async () => {
    const scope = 'ciqp-synthetic-cohort01';
    await expect(fingerprintCiqpImmutableTenant(
      fakeImmutableDb(false, true).db, scope, 'staging-secret'.repeat(4)
    )).rejects.toThrow('CIQP_IMMUTABLE_EMPTY_COHORT');
  });

  test('rejects non-synthetic scope, empty key and invalid numbers', async () => {
    const { db } = fakeImmutableDb();
    await expect(fingerprintCiqpImmutableTenant(db, 'real-tenant', 'key'.repeat(15)))
      .rejects.toThrow('CIQP_IMMUTABLE_FINGERPRINT_SCOPE_DENIED');
    await expect(fingerprintCiqpImmutableTenant(db, 'ciqp-synthetic-cohort01', 'short'))
      .rejects.toThrow('CIQP_IMMUTABLE_FINGERPRINT_SCOPE_DENIED');
    expect(() => canonicalCiqpJson({ bad: Infinity }))
      .toThrow('CIQP_NONFINITE_SOURCE_VALUE');
  });
});
