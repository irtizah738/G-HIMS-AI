import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuthenticatedUser, UserSessionRecord } from '@/lib/auth/auth-types';
import { canResumeOfflineIdentity } from '@/lib/auth/offline-session-policy';

const now = Date.parse('2026-10-10T12:00:00.000Z');
const user: AuthenticatedUser = {
  uid: 'clinician-a',
  tenantId: 'tenant-a',
  sessionId: 'session-a',
  email: 'doctor@example.invalid',
  roles: ['doctor'],
  permissions: ['SIGN_CLINICAL_NOTES'],
  clinicalPrivileges: ['SIGN_CLINICAL_NOTES'],
  facilityIds: ['facility-a'],
  departmentIds: ['medicine'],
  accountStatus: 'ACTIVE',
  lastAuthenticatedAt: new Date(now - 1000).toISOString(),
};
const session: UserSessionRecord = {
  sessionId: user.sessionId,
  userId: user.uid,
  tenantId: user.tenantId,
  status: 'ACTIVE',
  createdAt: new Date(now - 1000).toISOString(),
  authenticatedAt: new Date(now - 1000).toISOString(),
  lastSeenAt: new Date(now - 1000).toISOString(),
  lastActivityAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 1000 * 60 * 20).toISOString(),
};

describe('Offline cached edge identity isolation', () => {
  test('only the persisted Firebase identity can unlock the bounded local session', () => {
    const cached = { user, session };
    expect(canResumeOfflineIdentity('clinician-a', cached, now)).toBe(true);
    expect(canResumeOfflineIdentity(undefined, cached, now)).toBe(false);
    expect(canResumeOfflineIdentity('clinician-b', cached, now)).toBe(false);
    expect(canResumeOfflineIdentity('clinician-a', { user, session: { ...session, status: 'REVOKED' } }, now)).toBe(false);
    expect(canResumeOfflineIdentity('clinician-a', { user, session: { ...session, userId: 'clinician-b' } }, now)).toBe(false);
    expect(canResumeOfflineIdentity('clinician-a', { user, session: { ...session, tenantId: 'tenant-b' } }, now)).toBe(false);
    expect(canResumeOfflineIdentity('clinician-a', { user, session: { ...session, expiresAt: new Date(now - 1).toISOString() } }, now)).toBe(false);
  });

  test('all edge surfaces guard encrypted local reads before opening tenant data', async () => {
    const src = await readFile(path.join(process.cwd(), 'lib/offline/hydration.ts'), 'utf8');
    const fn = src.split('export async function loadLocalEdgeSnapshot(')[1]
      ?.split('export async function hydrateEdgeSnapshot(')[0] || '';
    expect(fn).toContain('canResumeOfflineIdentity(auth.currentUser?.uid, cached)');
    expect(fn).toContain("errorCode: 'OFFLINE_IDENTITY_NOT_VERIFIED'");
    expect(fn).toContain("throw new Error('EDGE_HYDRATION_TENANT_MISMATCH')");
    expect(fn).toContain('await listSecureEdgeEntities(normalizedTenantId, actorId, collection)');
    expect(fn.indexOf('canResumeOfflineIdentity(')).toBeGreaterThan(-1);
    expect(fn.indexOf('canResumeOfflineIdentity(')).toBeLessThan(fn.indexOf('getEdgeSyncMetadata('));
    expect(fn.indexOf('canResumeOfflineIdentity(')).toBeLessThan(fn.indexOf('listSecureEdgeEntities('));
    expect(fn).not.toContain('await listSecureEdgeEntities(tenantId, actorId, collection)');
  });
});
