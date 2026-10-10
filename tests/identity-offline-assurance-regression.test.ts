import { describe, expect, test } from 'bun:test';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { AuthenticatedUser, UserSessionRecord } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';
import {
  assertVerifiedIdentityAssurance,
  assertPrivilegedSecondFactor,
} from '@/server/auth/identity-assurance';
import { canResumeOfflineIdentity } from '@/lib/auth/offline-session-policy';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const now = new Date('2026-10-10T12:00:00.000Z').getTime();
const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

const identity: AuthenticatedUser = {
  uid: 'clinician-1',
  email: 'doctor@example.invalid',
  tenantId: 'hospital-a',
  roles: ['doctor'],
  permissions: ['SIGN_CLINICAL_NOTES'],
  clinicalPrivileges: ['SIGN_CLINICAL_NOTES'],
  departmentIds: ['medicine'],
  facilityIds: ['ward-1'],
  accountStatus: 'ACTIVE',
  sessionId: 'session-1',
  lastAuthenticatedAt: new Date(now - 10_000).toISOString(),
};
const session: UserSessionRecord = {
  sessionId: 'session-1',
  userId: identity.uid,
  tenantId: identity.tenantId,
  status: 'ACTIVE',
  createdAt: new Date(now - 20_000).toISOString(),
  authenticatedAt: new Date(now - 10_000).toISOString(),
  lastSeenAt: new Date(now - 10_000).toISOString(),
  lastActivityAt: new Date(now - 10_000).toISOString(),
  expiresAt: new Date(now + 60_000).toISOString(),
};
const token = (claims: Record<string, unknown> = {}) => ({
  email: 'doctor@example.invalid',
  email_verified: true,
  firebase: { sign_in_provider: 'password', ...claims },
} as unknown as DecodedIdToken);

describe('Production identity assurance', () => {
  test('production refuses unverified email and missing identity, but tests remain isolated', () => {
    expect(() => assertVerifiedIdentityAssurance({ email: 'doctor@example.invalid', email_verified: false }, 'PRODUCTION'))
      .toThrow(AuthError);
    expect(() => assertVerifiedIdentityAssurance({ email: '', email_verified: true }, 'PRODUCTION'))
      .toThrow('Production-like staff identity has no verified email claim');
    expect(() => assertVerifiedIdentityAssurance({ email: 'doctor@example.invalid', email_verified: false }, 'TEST'))
      .not.toThrow();
    expect(() => assertVerifiedIdentityAssurance({ email: 'doctor@example.invalid', email_verified: true }, 'PRODUCTION'))
      .not.toThrow();
  });

  test('privileged production users require claim-proven MFA, without SSO provider bypass', () => {
    expect(() => assertPrivilegedSecondFactor(token(), ['doctor'], 'PRODUCTION'))
      .toThrow('requires verified MFA');
    expect(() => assertPrivilegedSecondFactor(token({ sign_in_provider: 'oidc.hospital' }), ['SYSTEM_ADMIN'], 'PRODUCTION'))
      .toThrow(AuthError);
    expect(() => assertPrivilegedSecondFactor(token({ sign_in_second_factor: 'totp' }), ['nurse'], 'PRODUCTION'))
      .not.toThrow();
    for (const role of ['admin', 'SuperAdmin', 'RECEPTIONIST', 'billing_clerk', 'FINANCE_MANAGER', 'unknown_staff_alias']) {
      expect(() => assertPrivilegedSecondFactor(token(), [role], 'PRODUCTION'))
        .toThrow('Hospital staff session requires verified MFA');
    }
    expect(() => assertPrivilegedSecondFactor(token(), ['PATIENT'], 'PRODUCTION'))
      .not.toThrow();
    expect(() => assertPrivilegedSecondFactor(token(), ['patient', 'doctor'], 'PRODUCTION'))
      .toThrow(AuthError);
    expect(() => assertPrivilegedSecondFactor(token(), ['receptionist'], 'STAGING'))
      .toThrow(AuthError);
    expect(() => assertVerifiedIdentityAssurance({ email: 'staff@example.invalid', email_verified: false }, 'STAGING'))
      .toThrow(AuthError);
    expect(() => assertPrivilegedSecondFactor(token(), ['doctor'], 'TEST'))
      .not.toThrow();
  });
});

describe('Offline cached identity is not authoritative', () => {
  test('permits bounded local continuity only for matching active Firebase identity', () => {
    expect(canResumeOfflineIdentity('clinician-1', { user: identity, session }, now)).toBe(true);
    expect(canResumeOfflineIdentity(undefined, { user: identity, session }, now)).toBe(false);
    expect(canResumeOfflineIdentity('intruder', { user: identity, session }, now)).toBe(false);
    expect(canResumeOfflineIdentity('clinician-1', { user: identity, session: { ...session, userId: 'intruder' } }, now)).toBe(false);
    expect(canResumeOfflineIdentity('clinician-1', { user: identity, session: { ...session, tenantId: 'hospital-b' } }, now)).toBe(false);
    expect(canResumeOfflineIdentity('clinician-1', { user: identity, session: { ...session, sessionId: 'other' } }, now)).toBe(false);
  });

  test('rejects suspended, revoked, expired, future-issued and old offline sessions', () => {
    expect(canResumeOfflineIdentity('clinician-1', { user: { ...identity, accountStatus: 'SUSPENDED' }, session }, now)).toBe(false);
    expect(canResumeOfflineIdentity('clinician-1', { user: identity, session: { ...session, status: 'REVOKED' } }, now)).toBe(false);
    expect(canResumeOfflineIdentity('clinician-1', { user: identity, session: { ...session, expiresAt: new Date(now - 1).toISOString() } }, now)).toBe(false);
    expect(canResumeOfflineIdentity('clinician-1', { user: identity, session: { ...session, authenticatedAt: new Date(now + 30_000).toISOString() } }, now)).toBe(false);
    expect(canResumeOfflineIdentity('clinician-1', { user: identity, session: { ...session, authenticatedAt: new Date(now - 13 * 60 * 60 * 1000).toISOString() } }, now)).toBe(false);
  });

  test('tenant switch requires canonical identity assurance and a bound device before claim changes', async () => {
    const [route, client] = await Promise.all([
      source('app/api/auth/tenant-selection/route.ts'),
      source('lib/auth/auth-client.ts'),
    ]);
    const switchPost = route.split('export async function POST')[1] || '';
    const policyIndex = switchPost.indexOf('await resolveAuthorizationContext(verifiedToken, targetTenantId)');
    const claimsIndex = switchPost.indexOf('await adminAuth.setCustomUserClaims(');
    const sessionIndex = switchPost.indexOf('const session = await createSession(');
    expect(policyIndex).toBeGreaterThan(-1);
    expect(claimsIndex).toBeGreaterThan(policyIndex);
    expect(sessionIndex).toBeGreaterThan(policyIndex);
    expect(switchPost).toContain("mode === 'STAGING' || mode === 'PRODUCTION'");
    expect(switchPost).toContain('if (deviceRequired && !String(deviceData.deviceId ||');
    expect(switchPost).toContain('await registerOrUpdateDevice({');
    expect(switchPost).toContain('deviceId: registeredDevice?.deviceId');
    expect(switchPost).toContain('deviceId: session.deviceId');
    expect(switchPost).not.toContain("role: membership.roles[0] || 'doctor'");
    expect(switchPost).not.toContain("|| 'general_medicine'");
    expect(client).toContain('body: JSON.stringify({ tenantId: targetTenantId, device })');
    expect(client).toContain('const device = generateDeviceMetadata()');
  });

  test('session refresh refuses revoked and mismatched device bindings', async () => {
    const route = await source('app/api/auth/session/route.ts');
    const getRoute = route.split('export async function GET')[1]?.split('export async function DELETE')[0] || '';
    expect(getRoute).toContain('validateSession(tenantId, sessionId, verifiedToken.uid)');
    expect(getRoute).toContain('assertDeviceActive(tenantId, session.deviceId, verifiedToken.uid)');
    expect(getRoute).toContain('requestedDeviceId !== session.deviceId');
    expect(getRoute).toContain("code: 'DEVICE_REVOKED'");
    expect(getRoute).toContain('resolveAuthorizationContext(verifiedToken, tenantId, session.sessionId');
  });

  test('client never claims cached offline identity as server authentication or privilege authority', async () => {
    const [client, context, guard] = await Promise.all([
      source('lib/auth/auth-client.ts'),
      source('lib/auth/auth-context.tsx'),
      source('components/auth/auth-guard.tsx'),
    ]);
    expect(client).toContain('canResumeOfflineIdentity(currentUser?.uid, cached)');
    expect(client).toContain('offlineContinuity: true');
    expect(client).toContain('offlineContinuityAuthenticatedAt: cached.session.authenticatedAt');
    expect(context).toContain('payload.offlineContinuityAuthenticatedAt || new Date(0).toISOString()');
    expect(client).toContain('authenticated: false');
    expect(client).toContain('clinicalPrivileges: []');
    expect(client).toContain('permissions: []');
    expect(client).toContain('currentUser.uid !== cached.session.userId');
    expect(context).toContain('payload.offlineContinuity === true');
    const refreshStart = context.indexOf('const refreshAuth = useCallback');
    const refreshEnd = context.indexOf('const userRef = useRef', refreshStart);
    const refreshBody = context.slice(refreshStart, refreshEnd);
    expect(refreshBody).toContain("console.warn('Session restoration notice:', err)");
    expect(refreshBody).toContain('setUser(null)');
    expect(refreshBody).toContain('setSession(null)');
    expect(refreshBody).toContain('setClinicalPrivileges([])');
    expect(refreshBody).toContain('setIsOfflineContinuity(false)');
    expect(context).toContain('!isOfflineContinuity && checkPermission');
    expect(context).toContain('!isOfflineContinuity && checkRole');
    expect(context).toContain('setRoles(payload.offlineContinuity ? [] : payload.authorization.roles)');
    // Prior tenant discovery is sensitive identity metadata and must not
    // remain visible when a server session is denied or the user signs out.
    const refreshSource = context.split('const refreshAuth = useCallback')[1]?.split('const userRef')[0] || '';
    expect(refreshSource.match(/setAccessibleTenants\(\[\]\)/g)?.length).toBe(2);
    const logoutSource = context.split('const signOut = useCallback')[1]?.split('// Tenant Switching Action')[0] || '';
    expect(logoutSource).toContain('setAccessibleTenants([])');
    expect(context).toContain('!isOfflineContinuity && checkPrivilege');
    expect(guard).toContain('Offline cached identity only');
    expect(client).toContain('Protected server actions require an online authoritative session');
  });
});
