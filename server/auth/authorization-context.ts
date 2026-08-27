/**
 * G-HIMS Server-Side Authorization Context Resolver
 * Resolves complete RBAC, ABAC, Department & Facility Scopes, Clinical Privileges
 */

import { AuthorizationContext, AccountStatus } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';
import { VerifiedTokenResult } from './verify-token';
import { getTenantMembership } from './tenant-membership';

export async function resolveAuthorizationContext(
  verifiedToken: VerifiedTokenResult,
  targetTenantId?: string,
  sessionId?: string,
  deviceId?: string
): Promise<AuthorizationContext> {
  const tenantId = (targetTenantId || verifiedToken.claims.tenantId || 'central-metro-hospital').toLowerCase().trim();

  // 1. Resolve membership in target tenant
  const membership = await getTenantMembership(
    tenantId,
    verifiedToken.uid,
    verifiedToken.email,
    verifiedToken.name
  );

  // 2. Validate Account Status (Crucial zero-trust guard)
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
    sessionId: sessionId || `sess_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`,
    deviceId: deviceId,
    isEmergencyOverride: false,
  };
}
