/**
 * CIQP-182: bounded, synthetic-only emulator export/import parity probe.
 *
 * Called in TWO independent firebase emulators:exec processes:
 *   capture -> emulator exports its database -> restored emulator imports it
 *   -> verify compares event/outbox, snapshot lineage and Patient360 hashes.
 *
 * Never suitable for hosted Firestore, patient data or clinical release.
 * Baseline file stays in the runner's temporary directory, never uploaded.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  assertCiqp182EmulatorOnly, CIQP182_FIXTURE_TENANT,
  CIQP182_FIXTURE_PATIENT, CIQP182_FIXTURE_VERSION,
} from './ciqp182-seed-hospital0-emulator';
import {
  fingerprintCiqpImmutableTenant, canonicalCiqpJson,
} from '@/lib/clinical/patient360/ciqp-immutable-cohort-fingerprint';
import { inspectCiqpSnapshotOutboxEvidence } from
  '@/lib/clinical/patient360/ciqp-snapshot-outbox-audit';
import { inspectCiqpHostedStagingReadOnly } from
  '@/lib/clinical/patient360/ciqp-hosted-staging-readonly';

const TEST_HMAC = 'CIQP182-EMULATOR-ONLY-NON-SECRET-FIXTURE-HMAC-KEY';
const TEST_SHA = 'a'.repeat(40);
type Phase = 'capture' | 'verify';

async function main() {
  // Guard before ANY Firebase initialization, disk work or network access.
  assertCiqp182EmulatorOnly(process.env);
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('CIQP182_EMULATOR_RESTORE_TEST_MODE_ONLY');
  }
  const phase = process.argv[2];
  const path = process.argv[3];
  if ((phase !== 'capture' && phase !== 'verify') ||
      !path || !path.startsWith('/tmp/') || !path.endsWith('.json')) {
    throw new Error('CIQP182_EMULATOR_RESTORE_ARGUMENTS_DENIED');
  }
  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP182_EMULATOR_RESTORE_FIRESTORE_UNAVAILABLE');
  const tenant = db.collection('tenants').doc(CIQP182_FIXTURE_TENANT);
  const [metadata, patients, projection, audit] = await Promise.all([
    tenant.get(),
    tenant.collection('patients').get(),
    tenant.collection('patient360Projections').doc(CIQP182_FIXTURE_PATIENT).get(),
    tenant.collection('audit_logs').get(),
  ]);
  if (!metadata.exists || metadata.data()?.syntheticOnly !== true ||
      metadata.data()?.clinicalUseAllowed !== false ||
      metadata.data()?.fixtureVersion !== CIQP182_FIXTURE_VERSION ||
      patients.size !== 1 || !projection.exists || audit.empty) {
    throw new Error('CIQP182_EMULATOR_RESTORE_FIXTURE_INCOMPLETE');
  }
  const chart = projection.data();
  if (chart?.patientId !== CIQP182_FIXTURE_PATIENT ||
      chart?.tenantId !== CIQP182_FIXTURE_TENANT ||
      chart?.timelineReady !== true ||
      !chart?.contentHash ||
      chart?.latestVitals?.length !== 1 ||
      chart?.allergies?.length !== 1 ||
      chart?.currentMedications?.length !== 1 ||
      chart?.recentDiagnosticOrders?.length !== 1 ||
      chart?.recentResults?.length !== 1 ||
      chart?.recentDocuments?.length !== 1) {
    throw new Error('CIQP182_EMULATOR_RESTORE_CLINICAL_CHART_INCOMPLETE');
  }
  const [immutable, lineage, inspection] = await Promise.all([
    fingerprintCiqpImmutableTenant(db, CIQP182_FIXTURE_TENANT, TEST_HMAC),
    inspectCiqpSnapshotOutboxEvidence(db, CIQP182_FIXTURE_TENANT, TEST_HMAC),
    inspectCiqpHostedStagingReadOnly(db, {
      projectId: 'ghims-p4-ci',
      tenantId: CIQP182_FIXTURE_TENANT,
      expectedSha: TEST_SHA,
    }, TEST_HMAC),
  ]);
  if (lineage.snapshotCount !== 1 ||
      inspection.gate !== 'COHORT_MATCHED_ONLY' ||
      inspection.cohortCoverage !== 'MATCHED' ||
      inspection.failures !== 0 ||
      inspection.inspected !== 1 ||
      immutable.eventCount < 1 || immutable.outboxCount < 1 ||
      immutable.outboxCount !== lineage.outboxCount) {
    throw new Error('CIQP182_EMULATOR_RESTORE_EVIDENCE_INCOMPLETE');
  }
  // Only aggregate, keyed hashes or non-identifying structural metadata.
  const chartHmac = createHmac('sha256', TEST_HMAC)
    .update(canonicalCiqpJson([
      chart.revision, chart.eventCheckpoint, chart.contentHash,
      chart.sourceCheckpoint, chart.sourceFingerprint,
      chart.timelineGeneration, chart.timelineReady, chart.counts,
    ])).digest('hex');
  const state = {
    protocol: 'CIQP182_LOCAL_EMULATOR_EXPORT_IMPORT_V1',
    project: 'ghims-p4-ci',
    fixtureVersion: CIQP182_FIXTURE_VERSION,
    registryCount: patients.size,
    auditCount: audit.size,
    immutableEventCount: immutable.eventCount,
    immutableEventHmac: immutable.eventHmac,
    immutableOutboxCount: immutable.outboxCount,
    immutableOutboxHmac: immutable.outboxHmac,
    snapshotCount: lineage.snapshotCount,
    snapshotIdentityHmac: lineage.snapshotIdentifierHmac,
    snapshotProvenanceHmac: lineage.snapshotProvenanceHmac,
    outboxStatusCounts: lineage.outboxStatusCounts,
    chartHmac,
    patient360Hmac: inspection.aggregateHmac,
    gate: inspection.gate,
    hostedWritesPerformed: false,
    releaseAuthorization: 'NOT_GRANTED',
  };
  if (phase === 'capture') {
    writeFileSync(path, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
  } else {
    const raw = readFileSync(path, 'utf8');
    const baseline = JSON.parse(raw) as unknown;
    // Canonical comparison avoids false differences due to object key order.
    if (canonicalCiqpJson(baseline) !== canonicalCiqpJson(state)) {
      throw new Error('CIQP182_EMULATOR_EXPORT_IMPORT_PARITY_FAILED');
    }
  }
  // No patient ID, source payload, MRN, key or per-patient evidence in logs.
  process.stdout.write(JSON.stringify({
    stage: phase === 'capture' ? 'EXPORT_BASELINE_CAPTURED' :
      'FRESH_EMULATOR_IMPORT_PARITY_PASS',
    fixture: 'FABRICATED_ONLY',
    eventCount: immutable.eventCount,
    outboxCount: immutable.outboxCount,
    snapshotCount: lineage.snapshotCount,
    clinicalReleaseAuthorization: 'NOT_GRANTED',
    hostedQualification: 'NOT_PERFORMED',
  }) + '\n');
}

main().catch(() => {
  // SDK failures may embed source identifiers: fail with fixed redacted code.
  console.error('CIQP182_EMULATOR_RESTORE_PARITY_DENIED');
  process.exitCode = 1;
});
