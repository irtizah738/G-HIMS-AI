import { describe, expect, test } from 'bun:test';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  CIQP182_FIXTURE_TENANT, CIQP182_FIXTURE_PATIENT, CIQP182_FIXTURE_VERSION,
  assertCiqp182EmulatorOnly, seedCiqp182EmulatorFixture,
} from '@/scripts/ops/ciqp182-seed-hospital0-emulator';
import { inspectCiqpHostedStagingReadOnly } from '@/lib/clinical/patient360/ciqp-hosted-staging-readonly';
import { inspectCiqpSnapshotOutboxEvidence } from '@/lib/clinical/patient360/ciqp-snapshot-outbox-audit';
import { fingerprintCiqpImmutableTenant } from '@/lib/clinical/patient360/ciqp-immutable-cohort-fingerprint';

describe('CIQP-182 synthetic Hospital0 fixture (disposable Firestore emulator only)', () => {
  test('fail closed before Firebase init for hosted or ambiguous runtime', () => {
    const good: NodeJS.ProcessEnv = {
      GHIMS_RUNTIME_MODE: 'TEST', NODE_ENV: 'test',
      FIREBASE_PROJECT_ID: 'ghims-p4-ci',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    };
    expect(() => assertCiqp182EmulatorOnly(good)).not.toThrow();
    for (const changes of [
      { GHIMS_RUNTIME_MODE: 'STAGING' },
      { GHIMS_RUNTIME_MODE: 'PRODUCTION' },
      { NODE_ENV: 'production' },
      { FIREBASE_PROJECT_ID: 'studio-1130431360-48a05' },
      { FIRESTORE_EMULATOR_HOST: undefined },
      { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' },
      { VERCEL: '1' },
      { FIREBASE_PRIVATE_KEY: 'must-not-be-present' },
      { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/service-key.json' },
    ]) {
      expect(() => assertCiqp182EmulatorOnly({ ...good, ...changes }))
        .toThrow('CIQP182_FIXTURE_EMULATOR_ONLY_NO_HOSTED_FIRESTORE');
    }
  });

  test('seed produces canonical Patient 360, events, audit, snapshot and outbox lineage', async () => {
    assertCiqp182EmulatorOnly(process.env);
    const result = await seedCiqp182EmulatorFixture();
    expect(result).toMatchObject({
      fixtureVersion: CIQP182_FIXTURE_VERSION,
      registeredPatients: 1, projectionCount: 1,
      snapshotCount: 1, hostedWritesPerformed: false,
    });
    expect(result.eventCount).toBeGreaterThan(0);
    expect(result.outboxCount).toBeGreaterThan(0);
    const db = getAdminFirestore();
    if (!db) throw Error('CIQP182_FIXTURE_EMULATOR_UNAVAILABLE');
    const tenant = db.collection('tenants').doc(CIQP182_FIXTURE_TENANT);
    const tenantDoc = await tenant.get();
    expect(tenantDoc.data()).toMatchObject({
      syntheticOnly: true, clinicalUseAllowed: false,
      provenanceStatus: 'PENDING_REVIEW',
    });
    expect((await tenant.collection('patients').doc(CIQP182_FIXTURE_PATIENT).get()).exists).toBe(true);
    expect((await tenant.collection('audit_logs').get()).size).toBeGreaterThan(0);
    const sha = 'a'.repeat(40);
    const hmac = 'emulator-only-non-secret-key-material-for-tests';
    const report = await inspectCiqpHostedStagingReadOnly(db, {
      projectId: 'ghims-p4-ci', tenantId: CIQP182_FIXTURE_TENANT, expectedSha: sha,
    }, hmac);
    expect(report).toMatchObject({
      gate: 'COHORT_MATCHED_ONLY',
      registeredPatientsObserved: 1,
      cohortCoverage: 'MATCHED',
      missingPatientProjections: 0,
      orphanPatientProjections: 0,
      inspected: 1, failures: 0, truncated: false,
      writesPerformed: 0, releaseAuthorization: 'NOT_GRANTED',
    });
    expect(report.classificationCounts).toEqual({ CURRENT_POLICY_MATCH: 1 });
    const evidence = await inspectCiqpSnapshotOutboxEvidence(
      db, CIQP182_FIXTURE_TENANT, hmac
    );
    expect(evidence).toMatchObject({
      snapshotCount: 1, writesPerformed: 0, releaseAuthorization: 'NOT_GRANTED',
      duplicateDispatchEvidence: 'REQUIRES_INDEPENDENT_CONSUMER_REHEARSAL',
    });
    expect(evidence.outboxCount).toBeGreaterThan(0);
    const immutable = await fingerprintCiqpImmutableTenant(
      db, CIQP182_FIXTURE_TENANT, hmac
    );
    expect(immutable.eventCount).toBe(result.eventCount);
    expect(immutable.outboxCount).toBe(result.outboxCount);
    for (const serialized of [JSON.stringify(result), JSON.stringify(report), JSON.stringify(evidence)]) {
      expect(serialized).not.toContain(CIQP182_FIXTURE_PATIENT);
      expect(serialized).not.toContain(CIQP182_FIXTURE_TENANT);
    }
  });
});
