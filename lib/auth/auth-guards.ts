/**
 * G-HIMS Master Authorization Guards
 * Evaluates Role, Permissions, Clinical Privileges, Department Scopes, and Account Status
 */

import { AuthenticatedUser, AuthorizationContext, AccountStatus } from './auth-types';

export function isAccountActive(status?: AccountStatus): boolean {
  return status === 'ACTIVE';
}

export function hasPermission(
  user: AuthenticatedUser | AuthorizationContext | null,
  requiredPermission: string
): boolean {
  if (!user || !isAccountActive(user.accountStatus)) return false;

  // Administrators bypass specific permissions
  if (user.roles.includes('administrator') || user.roles.includes('admin') || user.roles.includes('SuperAdmin')) {
    return true;
  }

  // Emergency override check
  if (user.isEmergencyOverride && (user.roles.includes('doctor') || user.roles.includes('nurse') || user.roles.includes('surgeon'))) {
    return true;
  }

  return user.permissions.includes(requiredPermission) || user.permissions.includes('*');
}

export function hasAnyPermission(
  user: AuthenticatedUser | AuthorizationContext | null,
  requiredPermissions: string[]
): boolean {
  if (!user || !isAccountActive(user.accountStatus)) return false;
  return requiredPermissions.some((perm) => hasPermission(user, perm));
}

export function hasAllPermissions(
  user: AuthenticatedUser | AuthorizationContext | null,
  requiredPermissions: string[]
): boolean {
  if (!user || !isAccountActive(user.accountStatus)) return false;
  return requiredPermissions.every((perm) => hasPermission(user, perm));
}

export function hasRole(
  user: AuthenticatedUser | AuthorizationContext | null,
  requiredRole: string
): boolean {
  if (!user || !isAccountActive(user.accountStatus)) return false;
  if (user.roles.includes('administrator') || user.roles.includes('admin') || user.roles.includes('SuperAdmin')) {
    return true;
  }
  return user.roles.includes(requiredRole);
}

export function hasAnyRole(
  user: AuthenticatedUser | AuthorizationContext | null,
  requiredRoles: string[]
): boolean {
  if (!user || !isAccountActive(user.accountStatus)) return false;
  return requiredRoles.some((role) => hasRole(user, role));
}

export function hasClinicalPrivilege(
  user: AuthenticatedUser | AuthorizationContext | null,
  requiredPrivilege: string
): boolean {
  if (!user || !isAccountActive(user.accountStatus)) return false;

  // Emergency override
  if (user.isEmergencyOverride) return true;

  const privileges = user.clinicalPrivileges || [];
  return privileges.includes(requiredPrivilege) || privileges.includes('*');
}

export function isDepartmentScoped(
  user: AuthenticatedUser | AuthorizationContext | null,
  targetDepartmentId?: string
): boolean {
  if (!user || !isAccountActive(user.accountStatus)) return false;
  if (user.roles.includes('administrator') || user.roles.includes('admin')) return true;
  if (!targetDepartmentId) return true;
  return user.departmentIds.includes(targetDepartmentId) || user.departmentIds.includes('*');
}

export function isFacilityScoped(
  user: AuthenticatedUser | AuthorizationContext | null,
  targetFacilityId?: string
): boolean {
  if (!user || !isAccountActive(user.accountStatus)) return false;
  if (user.roles.includes('administrator') || user.roles.includes('admin')) return true;
  if (!targetFacilityId) return true;
  return user.facilityIds.includes(targetFacilityId) || user.facilityIds.includes('*');
}
