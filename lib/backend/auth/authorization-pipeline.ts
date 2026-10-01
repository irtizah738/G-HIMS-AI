/**
 * G-HIMS Multi-Layered Authorization Pipeline
 * Enforces tenant identity, explicit RBAC, permissions, department scope,
 * credential-gated clinical privileges and explicit financial authority.
 *
 * Security posture: fail closed. No clinical or administrative title is an
 * implicit cross-domain superuser. A role only satisfies a requirement when it
 * is explicitly listed by the calling domain service.
 */

import { CommandContext } from '../types';

export interface AuthorizationRequirement {
  requiredRoles?: string[];
  /**
   * Every listed permission is required. Use '*' on the membership only for an
   * explicitly provisioned tenant administrator; clients cannot supply it.
   */
  requiredPermissions?: string[];
  requiredPrivilege?: string;
  requiredDepartment?: string;
  /**
   * Minimum minor-unit authority required for this action. Example:
   * 250000 = actor must be authorized for at least 2,500.00 in a 2-decimal currency.
   */
  financialLimitMinorUnits?: number;
  /**
   * Break-glass can bypass only the credential-gated clinical privilege check.
   * It never bypasses roles, permissions, department scope, tenant scope or
   * financial authority.
   */
  allowBreakGlass?: boolean;
  /** @deprecated Emergency override state is resolved from CommandContext. */
  isEmergencyOverride?: boolean;
}

export interface AuthorizationDecision {
  authorized: boolean;
  code?: string;
  reason?: string;
  evaluatedContext: {
    tenantId: string;
    actorId: string;
    roles: string[];
    permissions: string[];
    privileges: string[];
    departmentIds: string[];
    financialAuthorityMinorUnits?: number;
    breakGlassActive: boolean;
  };
}

function normalize(values: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => String(value || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

export class AuthorizationPipeline {
  /**
   * Executes the zero-trust authorization pipeline on a server-derived context.
   */
  public static evaluate(
    context: CommandContext,
    requirement: AuthorizationRequirement
  ): AuthorizationDecision {
    const roles = normalize(context.roles);
    const permissions = normalize(context.permissions);
    const privileges = normalize(context.clinicalPrivileges);
    const departmentIds = normalize([
      ...(context.departmentIds || []),
      ...(context.departmentId ? [context.departmentId] : []),
    ]);
    const breakGlassActive = Boolean(
      requirement.allowBreakGlass &&
        context.isEmergencyOverride &&
        context.breakGlassGrantId
    );

    const evaluatedContext = {
      tenantId: String(context.tenantId || ''),
      actorId: String(context.actorId || ''),
      roles,
      permissions,
      privileges,
      departmentIds,
      financialAuthorityMinorUnits: context.financialAuthorityMinorUnits,
      breakGlassActive,
    };

    // 1. Tenant + authoritative actor are mandatory.
    if (!context.tenantId || context.tenantId.trim() === '') {
      return {
        authorized: false,
        code: 'TENANT_ISOLATION_ERROR',
        reason: 'Command context is missing an authenticated tenant identifier.',
        evaluatedContext,
      };
    }

    if (!context.actorId || context.actorId.trim() === '') {
      return {
        authorized: false,
        code: 'UNAUTHENTICATED_ACTOR',
        reason: 'Command context does not contain an authoritative actor ID.',
        evaluatedContext,
      };
    }

    // 2. Explicit RBAC only. No implicit MEDICAL_DIRECTOR/SYSTEM_ADMIN bypass.
    const requiredRoles = normalize(requirement.requiredRoles);
    if (
      requiredRoles.length > 0 &&
      !requiredRoles.some((requiredRole) => roles.includes(requiredRole))
    ) {
      return {
        authorized: false,
        code: 'INSUFFICIENT_ROLE',
        reason:
          `Actor lacks an explicitly authorized role. Required: [${requiredRoles.join(', ')}]. Current: [${roles.join(', ')}].`,
        evaluatedContext,
      };
    }

    // 3. Permission layer. Every requested permission is mandatory.
    const requiredPermissions = normalize(requirement.requiredPermissions);
    if (requiredPermissions.length > 0 && !permissions.includes('*')) {
      const missing = requiredPermissions.filter(
        (permission) => !permissions.includes(permission)
      );
      if (missing.length > 0) {
        return {
          authorized: false,
          code: 'INSUFFICIENT_PERMISSION',
          reason: `Actor lacks required permissions: [${missing.join(', ')}].`,
          evaluatedContext,
        };
      }
    }

    // 4. Department scope is fail-closed when a department is required.
    if (requirement.requiredDepartment) {
      const requiredDepartment = String(requirement.requiredDepartment)
        .trim()
        .toUpperCase();

      if (!requiredDepartment || !departmentIds.includes(requiredDepartment)) {
        return {
          authorized: false,
          code: 'DEPARTMENT_SCOPE_MISMATCH',
          reason:
            departmentIds.length === 0
              ? `Action requires department ${requiredDepartment}, but the actor has no authoritative department assignment.`
              : `Actor departments [${departmentIds.join(', ')}] do not include required department ${requiredDepartment}.`,
          evaluatedContext,
        };
      }
    }

    // 5. Explicit financial authority. Missing authority never means unlimited.
    if (requirement.financialLimitMinorUnits !== undefined) {
      const requiredAmount = requirement.financialLimitMinorUnits;
      const actorLimit = context.financialAuthorityMinorUnits;

      if (
        !Number.isSafeInteger(requiredAmount) ||
        requiredAmount < 0
      ) {
        return {
          authorized: false,
          code: 'AUTHORIZATION_REQUIREMENT_INVALID',
          reason: 'Financial authority requirement must be a non-negative safe integer.',
          evaluatedContext,
        };
      }

      if (
        !Number.isSafeInteger(actorLimit) ||
        Number(actorLimit) < requiredAmount
      ) {
        return {
          authorized: false,
          code: 'FINANCIAL_AUTHORITY_EXCEEDED',
          reason:
            `Action requires financial authority of at least ${requiredAmount} minor units; actor authority is ${Number.isSafeInteger(actorLimit) ? actorLimit : 0}.`,
          evaluatedContext,
        };
      }
    }

    // 6. Credential-gated clinical privilege. Break-glass may bypass only this layer.
    if (requirement.requiredPrivilege && !breakGlassActive) {
      const requiredPrivilege = String(requirement.requiredPrivilege)
        .trim()
        .toUpperCase();
      const hasPrivilege =
        privileges.includes(requiredPrivilege) ||
        privileges.includes('UNRESTRICTED_CLINICAL_CHIEF');

      if (!hasPrivilege) {
        return {
          authorized: false,
          code: 'CLINICAL_PRIVILEGE_DENIED',
          reason:
            `Actor lacks active, verified clinical privilege: ${requiredPrivilege}.`,
          evaluatedContext,
        };
      }
    }

    return {
      authorized: true,
      evaluatedContext,
    };
  }
}
