/**
 * Operator-only, hosted STAGING, synthetic-only, read-only.
 * Same independent IAM and exact clean checkout requirements as the
 * CIQP-182 hosted staging inventory utility.
 */
import { execFileSync } from 'node:child_process';
import { getAdminFirestore } from '@/server/firebase/admin';
import { assertCiqpHostedStagingReadOnlyScope, assertCiqpStagingCheckout }
  from '@/lib/clinical/patient360/ciqp-hosted-staging-readonly';
import { inspectCiqpSnapshotOutboxEvidence }
  from '@/lib/clinical/patient360/ciqp-snapshot-outbox-audit';

export async function runCiqpSnapshotOutboxInspection(): Promise<void> {
  const scope = assertCiqpHostedStagingReadOnlyScope(process.env);
  const head = execFileSync('git', ['rev-parse', 'HEAD'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const dirty = execFileSync('git', ['status', '--porcelain'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assertCiqpStagingCheckout(scope.expectedSha, head, dirty);

  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP_SNAPSHOT_STAGING_FIRESTORE_UNAVAILABLE');
  const result = await inspectCiqpSnapshotOutboxEvidence(
    db, scope.tenantId, String(process.env.GHIMS_CIQP_STAGING_AUDIT_HMAC_KEY || '')
  );
  console.log(JSON.stringify({
    ...result, expectedSourceSha: scope.expectedSha,
  }, null, 2));
}

if (import.meta.main) {
  runCiqpSnapshotOutboxInspection().catch(() => {
    console.error('CIQP_SNAPSHOT_OUTBOX_INSPECTION_FAILED_CLOSED_NO_IDENTIFIERS');
    process.exitCode = 1;
  });
}
