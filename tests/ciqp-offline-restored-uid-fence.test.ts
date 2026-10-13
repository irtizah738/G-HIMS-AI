import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { canReadOfflineClinicalSnapshot } from '@/lib/offline/clinical-offline-identity-policy';
import type { AuthenticatedUser, UserSessionRecord } from '@/lib/auth/auth-types';

const NOW = Date.UTC(2026, 9, 11, 15, 0, 0);
const user: AuthenticatedUser = {
  uid: 'synthetic-clinician-A',
  email: 'synthetic-A@example.invalid',
  tenantId: 'hospital-A',
  sessionId: 'synthetic-session-A',
  roles: ['DOCTOR'],
  permissions: [],
  departmentIds: ['general-medicine'],
  facilityIds: ['facility-A'],
  accountStatus: 'ACTIVE',
  lastAuthenticatedAt: new Date(NOW - 3000).toISOString(),
};
const session: UserSessionRecord = {
  sessionId: 'synthetic-session-A',
  userId: 'synthetic-clinician-A',
  tenantId: 'hospital-A',
  status: 'ACTIVE',
  createdAt: new Date(NOW - 2000).toISOString(),
  lastSeenAt: new Date(NOW - 2000).toISOString(),
  authenticatedAt: new Date(NOW - 2000).toISOString(),
  lastActivityAt: new Date(NOW - 2000).toISOString(),
  expiresAt: new Date(NOW + 900_000).toISOString(),
};
const cached = () => ({ user: { ...user }, session: { ...session } });

describe('CIQP-07 protected offline Patient 360 access', () => {
  test('only restored Firebase UID and active, matching cached session allow stale read continuity', () => {
    expect(canReadOfflineClinicalSnapshot('synthetic-clinician-A', cached(), 'hospital-a', NOW)).toBe(true);
  });

  test('a switched, absent or different Firebase user cannot open cached patient data', () => {
    expect(canReadOfflineClinicalSnapshot(null, cached(), 'hospital-a', NOW)).toBe(false);
    expect(canReadOfflineClinicalSnapshot('synthetic-clinician-B', cached(), 'hospital-a', NOW)).toBe(false);
  });

  test('cross-tenant access, expired session and revoked or suspended cached identity fail closed', () => {
    expect(canReadOfflineClinicalSnapshot(user.uid, cached(), 'hospital-b', NOW)).toBe(false);
    expect(canReadOfflineClinicalSnapshot(user.uid, { user, session: { ...session, status: 'REVOKED' } }, 'hospital-a', NOW)).toBe(false);
    expect(canReadOfflineClinicalSnapshot(user.uid, { user: { ...user, accountStatus: 'SUSPENDED' }, session }, 'hospital-a', NOW)).toBe(false);
    expect(canReadOfflineClinicalSnapshot(user.uid, { user, session: { ...session, expiresAt: new Date(NOW - 1).toISOString() } }, 'hospital-a', NOW)).toBe(false);
    expect(canReadOfflineClinicalSnapshot(user.uid, { user, session: { ...session, expiresAt: 'not-a-date' } }, 'hospital-a', NOW)).toBe(false);
  });

  test('forged or replaced session pointer cannot restore earlier actor context', () => {
    expect(canReadOfflineClinicalSnapshot(user.uid, { user, session: { ...session, sessionId: 'new' } }, 'hospital-a', NOW)).toBe(false);
    expect(canReadOfflineClinicalSnapshot(user.uid, { user, session: { ...session, userId: 'synthetic-clinician-B' } }, 'hospital-a', NOW)).toBe(false);
  });

  test('actual edge source checks restored identity both before reading and after async reads', async () => {
    const source = await readFile('lib/offline/hydration.ts', 'utf8');
    const before = source.indexOf('if (!canReadOfflineClinicalSnapshot(restoredUid, cached, normalizedTenantId))');
    const authorityRead = source.indexOf("const authority = await getEdgeSyncMetadata(normalizedTenantId, 'edge-authority')");
    const encryptedRead = source.indexOf('await listSecureEdgeEntities(tenantId, actorId, collection)');
    const post = source.indexOf('if (!canReadOfflineClinicalSnapshot(auth.currentUser?.uid, latest, normalizedTenantId)');
    const exposed = source.indexOf('collections: Object.fromEntries(entries)');
    const persisted = source.indexOf('await replaceSecureTenantEdgeSnapshot(');
    const postWrite = source.indexOf('if (!canReadOfflineClinicalSnapshot(auth.currentUser?.uid, afterWrite, normalizedTenantId)');
    const serverReturn = source.indexOf("freshness: 'CURRENT'");
    expect(before).toBeGreaterThan(0);
    expect(authorityRead).toBeGreaterThan(before);
    expect(encryptedRead).toBeGreaterThan(before);
    expect(post).toBeGreaterThan(encryptedRead);
    expect(exposed).toBeGreaterThan(post);
    expect(postWrite).toBeGreaterThan(persisted);
    expect(serverReturn).toBeGreaterThan(postWrite);
    expect(source).toContain('OFFLINE_IDENTITY_NOT_VERIFIED');
  });
});
