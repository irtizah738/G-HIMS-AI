/**
 * CIQP-05 read-only immutable-event/outbox fingerprint for source or independently
 * restored SYNTHETIC G-HIMS-AI staging tenant. Same HMAC key required across
 * before/after/restore runs; do not log or store the secret.
 */
import { execFileSync } from 'node:child_process';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  assertCiqpHostedStagingReadOnlyScope, assertCiqpStagingCheckout,
} from '@/lib/clinical/patient360/ciqp-hosted-staging-readonly';
import { fingerprintCiqpImmutableTenant } from '@/lib/clinical/patient360/ciqp-immutable-cohort-fingerprint';

export async function runCiqpImmutableEvidence(): Promise<void> {
  const scope = assertCiqpHostedStagingReadOnlyScope(process.env);
  const checkout = execFileSync('git', ['rev-parse', 'HEAD'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const dirty = execFileSync('git', ['status', '--porcelain'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  assertCiqpStagingCheckout(scope.expectedSha, checkout, dirty);

  const db = getAdminFirestore();
  if (!db) throw new Error('CIQP_STAGING_FIRESTORE_UNAVAILABLE');
  const fingerprint = await fingerprintCiqpImmutableTenant(
    db, scope.tenantId,
    String(process.env.GHIMS_CIQP_STAGING_AUDIT_HMAC_KEY || '')
  );
  console.log(JSON.stringify({
    operation: 'CIQP_IMMUTABLE_READ_ONLY_EVIDENCE',
    expectedSourceSha: scope.expectedSha,
    ...fingerprint,
  }, null, 2));
}

if (import.meta.main) {
  runCiqpImmutableEvidence().catch(() => {
    console.error('CIQP_IMMUTABLE_EVIDENCE_FAILED_CLOSED_NO_IDENTIFIERS');
    process.exitCode = 1;
  });
}
