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

  test('edge hydration checks both current identity policies before and after asynchronous PHI reads', async () => {
    const source = await readFile('lib/offline/hydration.ts', 'utf8');
    const local = source.split('export async function loadLocalEdgeSnapshot(')[1]
      ?.split('export async function hydrateEdgeSnapshot(')[0] || '';
    const server = source.split('export async function hydrateEdgeSnapshot(')[1] || '';
    const before = local.indexOf('canResumeOfflineIdentity(auth.currentUser?.uid, cached)');
    const policyBefore = local.indexOf('canReadOfflineClinicalSnapshot(restoredUid, cached, normalizedTenantId)');
    const authorityRead = local.indexOf("const authority = await getEdgeSyncMetadata(normalizedTenantId, 'edge-authority')");
    const encryptedRead = local.indexOf('await listSecureEdgeEntities(normalizedTenantId, actorId, collection)');
    const post = local.indexOf('canResumeOfflineIdentity(auth.currentUser?.uid, afterRead)');
    const postClinical = local.indexOf('canReadOfflineClinicalSnapshot(auth.currentUser?.uid, afterRead, normalizedTenantId)');
    const exposed = local.indexOf('collections: Object.fromEntries(entries)');
    const persisted = server.indexOf('await replaceSecureTenantEdgeSnapshot(');
    const postWrite = server.indexOf('canResumeOfflineIdentity(auth.currentUser?.uid, afterPersist)');
    const postClinicalWrite = server.indexOf('canReadOfflineClinicalSnapshot(auth.currentUser?.uid, afterPersist, normalizedTenantId)');
    const serverReturn = server.lastIndexOf("freshness: 'CURRENT'");
    expect(before).toBeGreaterThan(-1);
    expect(policyBefore).toBeGreaterThan(before);
    expect(authorityRead).toBeGreaterThan(policyBefore);
    expect(encryptedRead).toBeGreaterThan(authorityRead);
    expect(post).toBeGreaterThan(encryptedRead);
    expect(postClinical).toBeGreaterThan(post);
    expect(exposed).toBeGreaterThan(postClinical);
    expect(postWrite).toBeGreaterThan(persisted);
    expect(postClinicalWrite).toBeGreaterThan(postWrite);
    expect(serverReturn).toBeGreaterThan(postClinicalWrite);
    expect(source).toContain('OFFLINE_IDENTITY_NOT_VERIFIED');
  });
});
