import { describe, expect, test } from 'bun:test';
import type { Firestore } from 'firebase-admin/firestore';
import {
  assertCiqpHostedStagingReadOnlyScope, assertCiqpStagingCheckout,
  inspectCiqpHostedStagingReadOnly,
} from '@/lib/clinical/patient360/ciqp-hosted-staging-readonly';

const SHA = 'a'.repeat(40);
const good: NodeJS.ProcessEnv = {
  GHIMS_RUNTIME_MODE: 'STAGING',
  GHIMS_FIREBASE_PROJECT_ID_STAGING: 'ghims-ai-ciqp-staging',
  GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'g-hims-ai',
  FIREBASE_PROJECT_ID: 'ghims-ai-ciqp-staging',
  GHIMS_CIQP_STAGING_TENANT_ID: 'ciqp-synthetic-cohort01',
  GHIMS_CIQP_STAGING_CONFIRM_PROJECT: 'ghims-ai-ciqp-staging',
  GHIMS_CIQP_STAGING_CONFIRM_TENANT: 'ciqp-synthetic-cohort01',
  GHIMS_CIQP_STAGING_DATA_ACK: 'OPERATOR_ATTESTS_SYNTHETIC_ONLY',
  GHIMS_CIQP_STAGING_READONLY_ACK: 'STAGING_READ_ONLY_NO_WRITES',
  GHIMS_CIQP_STAGING_EXPECTED_SHA: SHA,
};

function fakeDb(size: number) {
  const actions: string[] = [];
  const db = {
    collection(name: string) {
      actions.push('collection');
      expect(name).toBe('tenants');
      return {
        doc() {
          actions.push('doc');
          return {
            collection() {
              actions.push('collection');
              return {
                orderBy() {
                  actions.push('orderBy');
                  return {
                    limit(n: number) {
                      actions.push('limit');
                      expect(n).toBe(26);
                      return {
                        async get() {
                          actions.push('get');
                          return { size, docs: Array.from({ length: size }, () => ({
                            id: 'not-inspected-when-truncated',
                          })) };
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
  return { db: db as unknown as Firestore, actions };
}

describe('CIQP #182 hosted staging READ-ONLY perimeter', () => {
  test('staging requires distinct Firebase projects, a synthetic tenant, and two confirmations', () => {
    expect(assertCiqpHostedStagingReadOnlyScope(good)).toEqual({
      projectId: 'ghims-ai-ciqp-staging',
      tenantId: 'ciqp-synthetic-cohort01',
      expectedSha: SHA,
    });
  });

  test.each([
    { GHIMS_RUNTIME_MODE: 'PRODUCTION' },
    { GHIMS_RUNTIME_MODE: 'TEST' },
    { GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: '' },
    { GHIMS_FIREBASE_PROJECT_ID_STAGING: 'g-hims-ai', FIREBASE_PROJECT_ID: 'g-hims-ai',
      GHIMS_CIQP_STAGING_CONFIRM_PROJECT: 'g-hims-ai' },
    { GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'ghims-ai-ciqp-staging' },
    { FIREBASE_PROJECT_ID: 'g-hims-ai' },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
    { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    { VERCEL: '1' },
    { GHIMS_CIQP_STAGING_TENANT_ID: 'real-patient-tenant' },
    { GHIMS_CIQP_STAGING_TENANT_ID: '../production' },
    { GHIMS_CIQP_STAGING_CONFIRM_TENANT: 'wrong-tenant' },
    { GHIMS_CIQP_STAGING_CONFIRM_PROJECT: 'wrong-project' },
    { GHIMS_CIQP_STAGING_DATA_ACK: '' },
    { GHIMS_CIQP_STAGING_READONLY_ACK: '' },
    { GHIMS_CIQP_STAGING_EXPECTED_SHA: 'main' },
    { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'g-hims-ai' },
  ])('rejects unsafe or ambiguous hosted inspection scope %j', changes => {
    expect(() => assertCiqpHostedStagingReadOnlyScope({
      ...good, ...changes,
    })).toThrow('CIQP_STAGING_READ_ONLY_SCOPE_DENIED');
  });

  test('source checkout must match the recorded exact SHA and contain no local edits', () => {
    expect(() => assertCiqpStagingCheckout(SHA, SHA + '\n', '')).not.toThrow();
    expect(() => assertCiqpStagingCheckout(SHA, 'b'.repeat(40), ''))
      .toThrow('CIQP_STAGING_SOURCE_CHECKOUT_NOT_FROZEN');
    expect(() => assertCiqpStagingCheckout(SHA, SHA, ' M src/file.ts'))
      .toThrow('CIQP_STAGING_SOURCE_CHECKOUT_NOT_FROZEN');
  });

  test('empty synthetic inventory cannot be called a clean release', async () => {
    const { db, actions } = fakeDb(0);
    const report = await inspectCiqpHostedStagingReadOnly(
      db, assertCiqpHostedStagingReadOnlyScope(good), 'secret'.repeat(9)
    );
    expect(report).toMatchObject({
      inspected: 0, truncated: false, failures: 0,
      gate: 'BLOCKED', writesPerformed: 0, migrationPerformed: false,
      releaseAuthorization: 'NOT_GRANTED',
    });
    expect(report.aggregateHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(actions).toEqual(['collection', 'doc', 'collection', 'orderBy', 'limit', 'get']);
    expect(JSON.stringify(report)).not.toContain('ciqp-synthetic-cohort01');
  });

  test('oversize cohort blocks without taking a partial 25-record sample', async () => {
    const { db, actions } = fakeDb(26);
    const report = await inspectCiqpHostedStagingReadOnly(
      db, assertCiqpHostedStagingReadOnlyScope(good), 'secret'.repeat(9)
    );
    expect(report).toMatchObject({
      inspected: 0, truncated: true, gate: 'BLOCKED',
      releaseAuthorization: 'NOT_GRANTED', writesPerformed: 0,
    });
    expect(actions).toEqual(['collection', 'doc', 'collection', 'orderBy', 'limit', 'get']);
  });

  test('audit HMAC must use a nontrivial secret; source has no Firestore write calls', async () => {
    const { db } = fakeDb(0);
    await expect(inspectCiqpHostedStagingReadOnly(
      db, assertCiqpHostedStagingReadOnlyScope(good), 'short'
    )).rejects.toThrow('CIQP_STAGING_HMAC_KEY_REQUIRED');
    const [scanner, runner] = await Promise.all([
      Bun.file('lib/clinical/patient360/ciqp-hosted-staging-readonly.ts').text(),
      Bun.file('scripts/ops/ciqp-inspect-staging-readonly.ts').text(),
    ]);
    for (const source of [scanner, runner]) {
      expect(source).not.toContain('.runTransaction(');
      expect(source).not.toContain('tx.set(');
      expect(source).not.toContain('tx.update(');
      expect(source).not.toContain('tx.delete(');
      expect(source).not.toContain('.rebuildPatient(');
      expect(source).not.toContain('migratePatient360LegacyPolicyEmulator(');
    }
    expect(runner).toContain('assertCiqpHostedStagingReadOnlyScope(process.env)');
    expect(runner).toContain('assertCiqpStagingCheckout(scope.expectedSha');
  });
});
