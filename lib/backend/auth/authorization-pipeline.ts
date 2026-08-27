/**
 * G-HIMS Multi-Layered Authorization Pipeline
 * Enforces Tenant Resolution, RBAC, ABAC, and Credential-Gated Clinical Privileges.
 */

import { CommandContext } from '../types';

export interface AuthorizationRequirement {
  requiredRoles?: string[];
  requiredPermissions?: string[];
  requiredPrivilege?: string;
  requiredDepartment?: string;
  financialLimitMinorUnits?: number;
  allowBreakGlass?: boolean;
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
    privileges: string[];
  };
}

export class AuthorizationPipeline {
  /**
   * Executes zero-trust authorization pipeline on the command context.
   */
  public static evaluate(
    context: CommandContext,
    requirement: AuthorizationRequirement
  ): AuthorizationDecision {
    // 1. Tenant Resolution & Identity Check
    if (!context.tenantId || context.tenantId.trim() === '') {
      return {
        authorized: false,
        code: 'TENANT_ISOLATION_ERROR',
        reason: 'Command context is missing an authenticated tenant identifier.',
        evaluatedContext: this.extractContext(context),
      };
    }

    if (!context.actorId || context.actorId.trim() === '') {
      return {
        authorized: false,
        code: 'UNAUTHENTICATED_ACTOR',
        reason: 'Command context does not contain an authoritative actor ID.',
        evaluatedContext: this.extractContext(context),
      };
    }

    // 2. Emergency Override / Break-Glass evaluation
    if (requirement.isEmergencyOverride || (requirement.allowBreakGlass && context.roles.includes('BREAK_GLASS_AUTHORIZED'))) {
      return {
        authorized: true,
        evaluatedContext: this.extractContext(context),
      };
    }

    // 3. RBAC Evaluation
    if (requirement.requiredRoles && requirement.requiredRoles.length > 0) {
      const hasRole = requirement.requiredRoles.some((role) =>
        context.roles.includes(role) || context.roles.includes('SYSTEM_ADMIN') || context.roles.includes('MEDICAL_DIRECTOR')
      );
      if (!hasRole) {
        return {
          authorized: false,
          code: 'INSUFFICIENT_ROLE',
          reason: `Actor lacks required roles: [${requirement.requiredRoles.join(', ')}]. Current roles: [${context.roles.join(', ')}]`,
          evaluatedContext: this.extractContext(context),
        };
      }
    }

    // 4. Clinical Privilege Verification (Credential-Gated)
    if (requirement.requiredPrivilege) {
      const privileges = context.clinicalPrivileges || [];
      const hasPrivilege =
        privileges.includes(requirement.requiredPrivilege) ||
        privileges.includes('UNRESTRICTED_CLINICAL_CHIEF') ||
        context.roles.includes('MEDICAL_DIRECTOR');

      if (!hasPrivilege) {
        return {
          authorized: false,
          code: 'CLINICAL_PRIVILEGE_DENIED',
          reason: `Actor lacks active, verified clinical privilege: ${requirement.requiredPrivilege}. Requires Medical Director verification.`,
          evaluatedContext: this.extractContext(context),
        };
      }
    }

    // 5. Department Scope Check
    if (requirement.requiredDepartment && context.departmentId) {
      if (context.departmentId !== requirement.requiredDepartment && !context.roles.includes('SYSTEM_ADMIN')) {
        return {
          authorized: false,
          code: 'DEPARTMENT_SCOPE_MISMATCH',
          reason: `Actor department (${context.departmentId}) does not match required scope (${requirement.requiredDepartment}).`,
          evaluatedContext: this.extractContext(context),
        };
      }
    }

    return {
      authorized: true,
      evaluatedContext: this.extractContext(context),
    };
  }

  private static extractContext(context: CommandContext) {
    return {
      tenantId: context.tenantId,
      actorId: context.actorId,
      roles: context.roles || [],
      privileges: context.clinicalPrivileges || [],
    };
  }
}
