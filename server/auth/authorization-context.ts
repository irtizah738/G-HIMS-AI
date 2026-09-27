/**
 * G-HIMS Server-Side Authorization Context Resolver
 * Resolves complete RBAC, ABAC, Department & Facility Scopes, Clinical Privileges.
 */

import { AuthorizationContext } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';
import { VerifiedTokenResult } from './verify-token';
import { getTenantMembership } from './tenant-membership';

export async function resolveAuthorizationContext(
  verifiedToken: VerifiedTokenResult,
  targetTenantId?: string,
  sessionId?: string,
  deviceId?: string
): Promise<AuthorizationContext> {
  const tenantId = (targetTenantId || verifiedToken.claims.tenantId || '').toLowerCase().trim();

  if (!tenantId) {
    throw new AuthError({
      code: 'TENANT_ACCESS_DENIED',
      message: 'Explicit tenant scope is required to resolve authorization.',
      statusCode: 403,
    });
  }

  const membership = await getTenantMembership(
    tenantId,
    verifiedToken.uid,
    verifiedToken.email,
    verifiedToken.name
  );

  if (membership.status === 'DISABLED') {
    throw new AuthError({
      code: 'ACCOUNT_DISABLED',
      message: `User account ${verifiedToken.uid} is disabled in tenant ${tenantId}`,
      statusCode: 403,
      userMessage: 'Your clinical account has been disabled by the Hospital IT Security Administrator.',
    });
  }

  if (membership.status === 'SUSPENDED') {
    throw new AuthError({
      code: 'ACCOUNT_SUSPENDED',
      message: `User account ${verifiedToken.uid} is suspended in tenant ${tenantId}`,
      statusCode: 403,
      userMessage: 'Your clinical account is currently suspended pending credential re-verification.',
    });
  }

  if (membership.status === 'PENDING') {
    throw new AuthError({
      code: 'ACCOUNT_PENDING',
      message: `User account ${verifiedToken.uid} is pending approval in tenant ${tenantId}`,
      statusCode: 403,
      userMessage: 'Your account registration is pending departmental administrator approval.',
    });
  }

  return {
    uid: verifiedToken.uid,
    email: verifiedToken.email,
    tenantId: membership.tenantId,
    roles: membership.roles,
    permissions: membership.permissions,
    departmentIds: membership.departmentIds,
    facilityIds: membership.facilityIds,
    clinicalPrivileges: membership.clinicalPrivileges,
    accountStatus: membership.status,
    sessionId: sessionId || '',
    deviceId,
    isEmergencyOverride: false,
  };
}
