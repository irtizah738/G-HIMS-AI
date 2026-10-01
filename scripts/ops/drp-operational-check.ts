import { getAdminFirestore } from '../../server/firebase/admin';

const tenantId = String(process.env.GHIMS_OPS_TENANT_ID || '').trim();
const maxPendingAgeMs = Number(process.env.GHIMS_OUTBOX_MAX_PENDING_AGE_MS || 5 * 60 * 1000);
const failOnFailed = String(process.env.GHIMS_OUTBOX_FAIL_ON_FAILED || 'false').toLowerCase() === 'true';

if (!tenantId) throw new Error('GHIMS_OPS_TENANT_ID is required.');
if (!Number.isFinite(maxPendingAgeMs) || maxPendingAgeMs < 1000) {
  throw new Error('GHIMS_OUTBOX_MAX_PENDING_AGE_MS must be at least 1000.');
}

const db = getAdminFirestore();
if (!db) throw new Error('FIRESTORE_ADMIN_UNAVAILABLE');

const now = Date.now();
const snapshot = await db
  .collection('tenants')
  .doc(tenantId)
  .collection('outbox')
  .where('status', 'in', ['PENDING', 'PROCESSING', 'FAILED', 'DEAD_LETTER'])
  .get();

let pending = 0;
let processing = 0;
let failed = 0;
let deadLetter = 0;
let expiredLeases = 0;
let oldestPendingAgeMs = 0;

for (const document of snapshot.docs) {
  const data = document.data() as Record<string, unknown>;
  const status = String(data.status || '');
  const createdAt = Number(data.createdAt || 0);
  const leaseExpiresAt = Number(data.leaseExpiresAt || 0);

  if (status === 'PENDING') {
    pending += 1;
    if (createdAt > 0) {
      oldestPendingAgeMs = Math.max(oldestPendingAgeMs, now - createdAt);
    }
  } else if (status === 'PROCESSING') {
    processing += 1;
    if (leaseExpiresAt > 0 && leaseExpiresAt < now) expiredLeases += 1;
  } else if (status === 'FAILED') {
    failed += 1;
  } else if (status === 'DEAD_LETTER') {
    deadLetter += 1;
  }
}

const blockers: string[] = [];
if (deadLetter > 0) blockers.push('OUTBOX_DEAD_LETTER_PRESENT');
if (expiredLeases > 0) blockers.push('OUTBOX_PROCESSING_LEASE_EXPIRED');
if (oldestPendingAgeMs > maxPendingAgeMs) blockers.push('OUTBOX_BACKLOG_TOO_OLD');
if (failOnFailed && failed > 0) blockers.push('OUTBOX_FAILED_RECORD_PRESENT');

const evidence = {
  success: blockers.length === 0,
  tenantId,
  outbox: {
    pending,
    processing,
    failed,
    deadLetter,
    expiredLeases,
    oldestPendingAgeMs,
    maxPendingAgeMs,
  },
  blockers,
  checkedAt: new Date(now).toISOString(),
};

process.stdout.write(JSON.stringify(evidence, null, 2) + '\n');
if (blockers.length > 0) process.exit(2);
