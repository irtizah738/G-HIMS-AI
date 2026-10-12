/**
 * CIQP-05 operator utility. READ ONLY, synthetic G-HIMS-AI hosted STAGING ONLY.
 *
 * Operator must use a project-scoped Firestore READ-ONLY IAM identity and
 * a reviewed synthetic-only tenant. Never run with production credentials.
 * No patient identifiers, PHI, source documents or keys are printed.
 */
import { execFileSync } from 'node:child_process';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  assertCiqpHostedStagingReadOnlyScope, assertCiqpStagingCheckout,
  inspectCiqpHostedStagingReadOnly,
} from '@/lib/clinical/patient360/ciqp-hosted-staging-readonly';

export async function runCiqpStagingReadOnlyInspection(): Promise<void> {
  // Scope/project checks happen before Firebase SDK initialization.
  const scope = assertCiqpHostedStagingReadOnlyScope(process.env);
  // A user-supplied "SHA" is not commit evidence. Verify an unmodified checkout.
  const checkout = execFileSync('git', ['rev-parse', 'HEAD'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const porcelain = execFileSync('git', ['status', '--porcelain'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assertCiqpStagingCheckout(scope.expectedSha, checkout, porcelain);

  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP_STAGING_FIRESTORE_UNAVAILABLE');
  const report = await inspectCiqpHostedStagingReadOnly(
    db, scope, String(process.env.GHIMS_CIQP_STAGING_AUDIT_HMAC_KEY || '')
  );
  console.log(JSON.stringify(report, null, 2));
  // A clean read-only inventory is NOT a migration or release approval.
  if (report.gate !== 'COHORT_MATCHED_ONLY') process.exitCode = 1;
}

if (import.meta.main) {
  runCiqpStagingReadOnlyInspection().catch(() => {
    // No exception stack, host, document path, MRN or identifier in logs.
    console.error('CIQP_STAGING_INSPECTION_FAILED_CLOSED_NO_IDENTIFIERS');
    process.exitCode = 1;
  });
}
