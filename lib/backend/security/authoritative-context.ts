/**
 * G-HIMS authoritative server-side command context.
 * Authentication, active session and authorization are resolved server-side.
 * Client-supplied identity, role, privilege, credential, facility and department fields are ignored.
 */

import { NextRequest } from 'next/server';
import { BaseCommand, CommandContext } from '../types';
import { AuthError } from '@/lib/auth/auth-errors';
import { extractBearerToken, verifyFirebaseToken } from '@/server/auth/verify-token';
import { resolveAuthorizationContext } from '@/server/auth/authorization-context';
import { validateSession } from '@/server/auth/session-service';

export interface AuthoritativeUserDirectoryRecord {
  userId: string;
  email: string;
  tenantId: string;
  roles: string[];
  permissions: string[];
  departmentIds: string[];
  facilityIds: string[];
  clinicalPrivileges: string[];
  accountStatus: string;
}

/**
 * Resolve an authoritative CommandContext from a verified Firebase ID token,
 * an existing ACTIVE tenant membership and an existing server session.
 */
export interface DeriveAuthoritativeContextOptions {
  /**
   * Background status probes may validate an existing session without extending
   * clinician inactivity. Normal protected commands keep the default true.
   */
  touchSessionActivity?: boolean;
}

export async function deriveAuthoritativeContext(
  req: NextRequest,
  clientDeclaredTenantId?: string,
  options: DeriveAuthoritativeContextOptions = {}
): Promise<{ context: CommandContext; userProfile: AuthoritativeUserDirectoryRecord }> {
  const token = extractBearerToken(req.headers.get('authorization'));
  const verifiedToken = await verifyFirebaseToken(token, true);

  const targetTenant =
    (clientDeclaredTenantId || req.headers.get('x-ghims-tenant-id') || verifiedToken.claims.tenantId || '')
      .trim()
      .toLowerCase();

  if (!targetTenant) {
    throw new AuthError({
      code: 'TENANT_ACCESS_DENIED',
      message: 'Explicit tenant context is required.',
      statusCode: 403,
    });
  }

  const sessionId = String(req.headers.get('x-ghims-session-id') || '').trim();
  if (!sessionId) {
    throw new AuthError({
      code: 'SESSION_NOT_FOUND',
      message: 'An active G-HIMS session is required for protected commands.',
      statusCode: 401,
    });
  }

  const session = await validateSession(
    targetTenant,
    sessionId,
    verifiedToken.uid,
    { touchActivity: options.touchSessionActivity !== false }
  );
  const requestedDeviceId = String(req.headers.get('x-ghims-device-id') || '').trim();

  if (requestedDeviceId && session.deviceId && requestedDeviceId !== session.deviceId) {
    throw new AuthError({
      code: 'DEVICE_REVOKED',
      message: 'Request device does not match the authenticated clinical session.',
      statusCode: 403,
    });
  }

  const authContext = await resolveAuthorizationContext(
    verifiedToken,
    targetTenant,
    session.sessionId,
    session.deviceId || requestedDeviceId || undefined
  );

  const context: CommandContext = {
    actorId: authContext.uid,
    tenantId: authContext.tenantId,
    roles: authContext.roles.map((role) => role.toUpperCase()),
    permissions: authContext.permissions.map((permission) => permission.toUpperCase()),
    departmentId: authContext.departmentIds[0],
    clinicalPrivileges: authContext.clinicalPrivileges.map((privilege) => privilege.toUpperCase()),
    correlationId: req.headers.get('x-correlation-id') || `corr_${crypto.randomUUID()}`,
    requestId: req.headers.get('x-request-id') || `req_${crypto.randomUUID()}`,
    deviceId: authContext.deviceId,
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
    userAgent: req.headers.get('user-agent') || undefined,
  };

  const userProfile: AuthoritativeUserDirectoryRecord = {
    userId: authContext.uid,
    email: authContext.email,
    tenantId: authContext.tenantId,
    roles: authContext.roles.map((role) => role.toUpperCase()),
    permissions: authContext.permissions.map((permission) => permission.toUpperCase()),
    departmentIds: [...authContext.departmentIds],
    facilityIds: [...authContext.facilityIds],
    clinicalPrivileges: authContext.clinicalPrivileges.map((privilege) => privilege.toUpperCase()),
    accountStatus: authContext.accountStatus,
  };

  return { context, userProfile };
}

export function verifyCommandIntegrity(context: CommandContext, command: BaseCommand): void {
  if (!command.commandId || !command.idempotencyKey) {
    throw new Error('COMMAND_INTEGRITY_VIOLATION: Missing commandId or idempotencyKey.');
  }

  if (!command.tenantId) {
    throw new Error('COMMAND_INTEGRITY_VIOLATION: Command tenantId is required.');
  }

  if (command.tenantId.trim().toLowerCase() !== context.tenantId.trim().toLowerCase()) {
    throw new Error(
      `TENANT_ISOLATION_VIOLATION: Command tenant '${command.tenantId}' does not match authenticated tenant '${context.tenantId}'.`
    );
  }
}
