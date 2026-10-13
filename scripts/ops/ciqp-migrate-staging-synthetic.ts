/**
 * CIQP #182 — hosted G-HIMS-AI STAGING, SYNTHETIC ONLY.
 *
 * DRY_RUN (default): zero Firestore writes. APPLY_SYNTHETIC: explicitly
 * approved, single-patient CAS migration with independently verified staging
 * IAM, synthetic provenance, change ticket and restore drill.
 *
 * NEVER run against a real clinical tenant or production project.
 * All output is aggregate; no IDs, names, PHI or source documents are logged.
 */
import { execFileSync } from 'node:child_process';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  assertCiqpHostedStagingReadOnlyScope,
  assertCiqpHostedStagingSyntheticApplyScope,
  assertCiqpStagingCheckout,
  inspectCiqpHostedStagingReadOnly,
} from '@/lib/clinical/patient360/ciqp-hosted-staging-readonly';
import { migratePatient360SyntheticHostedStaging } from '@/lib/clinical/patient360/ciqp-policy-migration';
import {
  fingerprintCiqpImmutableTenant, assertCiqpImmutableParity,
} from '@/lib/clinical/patient360/ciqp-immutable-cohort-fingerprint';

export async function runCiqpHostedStagingSyntheticQualification(): Promise<void> {
  // All project/tenant/approval checks must complete BEFORE Firebase init.
  const scope = assertCiqpHostedStagingReadOnlyScope(process.env);
  const mode = String(process.env.GHIMS_CIQP_STAGING_MIGRATION_MODE || 'DRY_RUN');
  if (!['DRY_RUN', 'APPLY_SYNTHETIC'].includes(mode)) {
    throw new Error('CIQP_STAGING_MODE_INVALID');
  }
  if (mode === 'APPLY_SYNTHETIC') {
    assertCiqpHostedStagingSyntheticApplyScope(process.env);
  }
  const head = execFileSync('git', ['rev-parse', 'HEAD'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const dirty = execFileSync('git', ['status', '--porcelain'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assertCiqpStagingCheckout(scope.expectedSha, head, dirty);

  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP_STAGING_FIRESTORE_UNAVAILABLE');
  const hmacKey = String(process.env.GHIMS_CIQP_STAGING_AUDIT_HMAC_KEY || '');
  const inventory = await inspectCiqpHostedStagingReadOnly(db, scope, hmacKey);
  if (inventory.gate === 'BLOCKED') {
    throw new Error('CIQP_STAGING_PREFLIGHT_BLOCKED');
  }
  const before = await fingerprintCiqpImmutableTenant(db, scope.tenantId, hmacKey);
  if (mode === 'DRY_RUN') {
    console.log(JSON.stringify({
      operation: 'CIQP_HOSTED_STAGING_SYNTHETIC_DRY_RUN',
      inventory, immutable: before,
      writesPerformed: 0,
      releaseAuthorization: 'NOT_GRANTED',
    }, null, 2));
    // A candidate is diagnosed, not automatically authorized to migrate.
    if (inventory.gate !== 'COHORT_MATCHED_ONLY') process.exitCode = 1;
    return;
  }

  const patientId = String(process.env.GHIMS_CIQP_STAGING_APPLY_PATIENT_ID || '');
  if (!/^[a-zA-Z0-9_-]{4,120}$/.test(patientId)) {
    throw new Error('CIQP_STAGING_APPLY_PATIENT_SCOPE_REQUIRED');
  }
  // This function enforces the staging authority independently and reuses
  // the exact emulator-tested policy-epoch compare-and-swap migration core.
  const result = await migratePatient360SyntheticHostedStaging(scope, patientId);
  const after = await fingerprintCiqpImmutableTenant(db, scope.tenantId, hmacKey);
  assertCiqpImmutableParity(before, after);
  const final = await inspectCiqpHostedStagingReadOnly(db, scope, hmacKey);
  const accepted = ['MIGRATED', 'RESUMED', 'ALREADY_CURRENT'].includes(result.status);
  console.log(JSON.stringify({
    operation: 'CIQP_HOSTED_STAGING_SYNTHETIC_SINGLE_PATIENT_APPLY',
    migrationStatus: result.status,
    inventoryBefore: inventory, inventoryAfter: final,
    immutableBefore: before, immutableAfter: after,
    releaseAuthorization: 'NOT_GRANTED',
    clinicalAuthorization: 'NOT_ESTABLISHED',
  }, null, 2));
  if (!accepted || final.gate === 'BLOCKED') process.exitCode = 1;
}

if (import.meta.main) {
  runCiqpHostedStagingSyntheticQualification().catch(() => {
    console.error('CIQP_STAGING_MIGRATION_FAILED_CLOSED_NO_IDENTIFIERS');
    process.exitCode = 1;
  });
}
