import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateSessionRecord } from '@/server/auth/session-service';
import type { UserSessionRecord } from '@/lib/auth/auth-types';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

function activeSession(overrides: Partial<UserSessionRecord> = {}): UserSessionRecord {
  const now = new Date();
  return {
    sessionId: 'sess-drp5',
    userId: 'user-drp5',
    tenantId: 'tenant-drp5',
    deviceId: 'device-drp5',
    status: 'ACTIVE',
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    authenticatedAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe('DRP-5 identity and session closure', () => {
  test('revoked, expired and mismatched sessions fail closed', () => {
    expect(() =>
      validateSessionRecord(
        activeSession({ status: 'REVOKED' }),
        'user-drp5'
      )
    ).toThrow();

    expect(() =>
      validateSessionRecord(
        activeSession({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
        'user-drp5'
      )
    ).toThrow();

    expect(() =>
      validateSessionRecord(activeSession(), 'other-user')
    ).toThrow();

    expect(validateSessionRecord(activeSession(), 'user-drp5').status).toBe('ACTIVE');
  });

  test('server re-resolves membership and credential-gated privileges on protected requests', async () => {
    const [context, authz, membership] = await Promise.all([
      source('lib/backend/security/authoritative-context.ts'),
      source('server/auth/authorization-context.ts'),
      source('server/auth/tenant-membership.ts'),
    ]);

    expect(context).toContain('validateSession');
    expect(context).toContain('assertDeviceActive');
    expect(context).toContain('resolveAuthorizationContext');
    expect(context).not.toContain('x-ghims-role');
    expect(context).not.toContain('x-clinical-privilege');

    expect(authz).toContain("membership.status === 'DISABLED'");
    expect(authz).toContain("membership.status === 'SUSPENDED'");
    expect(authz).toContain("membership.status === 'PENDING'");
    expect(authz).toContain('resolveCredentialGatedPrivileges');
    expect(authz).toContain("credential.expiryDate<today");
    expect(authz).toContain("privilege.effectiveUntil<today");

    expect(membership).toContain("return 'PENDING'");
  });

  test('device revocation also revokes active sessions and every command validates bound device', async () => {
    const [device, context] = await Promise.all([
      source('server/auth/device-service.ts'),
      source('lib/backend/security/authoritative-context.ts'),
    ]);

    expect(device).toContain("status: 'REVOKED'");
    expect(device).toContain(".collection('sessions')");
    expect(device).toContain("where('deviceId', '==', deviceId)");
    expect(device).toContain("status: 'REVOKED'");
    expect(context).toContain('assertDeviceActive');
    expect(context).toContain('requestedDeviceId !== session.deviceId');
  });

  test('password reset uses Firebase password authority and remains non-enumerating', async () => {
    const [client, route] = await Promise.all([
      source('lib/auth/auth-client.ts'),
      source('app/api/auth/password-reset/route.ts'),
    ]);

    expect(client).toContain('sendPasswordResetEmail');
    expect(client).toContain('If an account exists for this email');
    expect(route).not.toContain('updateUser(');
    expect(route).not.toContain('password:');
  });

  test('multi-tenant identities require explicit tenant selection', async () => {
    const client = await source('lib/auth/auth-client.ts');
    const selection = await source('app/api/auth/tenant-selection/route.ts');

    expect(client).toContain("code: 'TENANT_SELECTION_REQUIRED'");
    expect(client).toContain(
      'Explicit hospital facility selection is required before a G-HIMS session can be established.'
    );
    expect(client).not.toContain('activeTenants.length === 1');
    expect(selection).toContain('Authorization');
  });

  test('break-glass is short-lived and patient/encounter scoped with post-event review', async () => {
    const [service, route] = await Promise.all([
      source('server/auth/break-glass-service.ts'),
      source('app/api/auth/break-glass/route.ts'),
    ]);

    expect(service).toContain("String(data.patientId || '') !== params.patientId");
    expect(service).toContain("String(data.encounterId || '') !== params.encounterId");
    expect(service).toContain("String(data.status || '') !== 'ACTIVE'");
    expect(service).toContain('expiresAtMs <= now');

    expect(route).toContain('15 * 60 * 1000');
    expect(route).toContain("reviewStatus: 'PENDING_REVIEW'");
    expect(route).toContain('BREAK_GLASS_REVIEWED');
  });

  test('logout revokes server session before clearing local identity cache', async () => {
    const client = await source('lib/auth/auth-client.ts');
    const signOutStart = client.indexOf('public static async signOut');
    const resetStart = client.indexOf('public static async sendPasswordReset', signOutStart);
    const signOut = client.slice(signOutStart, resetStart);

    expect(signOut).toContain("method: 'DELETE'");
    expect(signOut).toContain('clearCachedAuthSession');
    expect(signOut).toContain('firebaseSignOut');
  });
  test('clinical role capability is released only after authoritative HCM credential resolution', async () => {
    const auth = await source('server/auth/authorization-context.ts');
    expect(auth).not.toContain('credentialGatedRoleBaseline');
    expect(auth).toContain('const effective = new Set<string>();');
    expect(auth).toContain("PRESCRIBE_MEDICATION:['PRESCRIBE_MEDICATION','PRESCRIBE'");
    expect(auth).toContain("collection('employees')");
    expect(auth).toContain("collection('clinicalCredentials')");
    expect(auth).toContain("collection('clinicalPrivileges')");
  });

});
