/**
 * G-HIMS authoritative server-side command context.
 * Authentication and authorization are resolved from Firebase + explicit tenant membership.
 * Client-supplied identity, role, privilege, credential, facility and department fields are ignored.
 */

import { NextRequest } from 'next/server';
import { BaseCommand, CommandContext } from '../types';
import { extractBearerToken, verifyFirebaseToken } from '@/server/auth/verify-token';
import { resolveAuthorizationContext } from '@/server/auth/authorization-context';

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
 * Resolve an authoritative CommandContext from a verified Firebase ID token and
 * an existing tenant membership. There are no default users, proxy-header actors,
 * or bearer-token string shortcuts.
 */
export async function deriveAuthoritativeContext(
  req: NextRequest,
  clientDeclaredTenantId?: string
): Promise<{ context: CommandContext; userProfile: AuthoritativeUserDirectoryRecord }> {
  const token = extractBearerToken(req.headers.get('authorization'));
  const verifiedToken = await verifyFirebaseToken(token, true);

  const targetTenant =
    (clientDeclaredTenantId || req.headers.get('x-ghims-tenant-id') || verifiedToken.claims.tenantId || '')
      .trim()
      .toLowerCase();

  if (!targetTenant) {
    throw new Error('AUTHORIZATION_FAILURE: Explicit tenant context is required.');
  }

  const authContext = await resolveAuthorizationContext(
    verifiedToken,
    targetTenant,
    req.headers.get('x-ghims-session-id') || undefined,
    req.headers.get('x-ghims-device-id') || undefined
  );

  const context: CommandContext = {
    actorId: authContext.uid,
    tenantId: authContext.tenantId,
    roles: [...authContext.roles],
    permissions: [...authContext.permissions],
    departmentId: authContext.departmentIds[0],
    clinicalPrivileges: [...authContext.clinicalPrivileges],
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
    roles: [...authContext.roles],
    permissions: [...authContext.permissions],
    departmentIds: [...authContext.departmentIds],
    facilityIds: [...authContext.facilityIds],
    clinicalPrivileges: [...authContext.clinicalPrivileges],
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
