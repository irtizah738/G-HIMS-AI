import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';
import type { BaseCommand, CommandContext } from '@/lib/backend/types';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

const baseContext: CommandContext = {
  actorId: 'actor-1',
  tenantId: 'tenant-drp',
  roles: ['DOCTOR'],
  permissions: ['PATIENT_RECORDS:VIEW'],
  departmentId: 'dept-a',
  departmentIds: ['dept-a'],
  facilityIds: ['fac-a'],
  clinicalPrivileges: ['ORDER_LAB'],
  financialAuthorityMinorUnits: 0,
  correlationId: 'corr-d',
  requestId: 'req-d',
};

describe('DRP-1 trust-boundary closure', () => {
  test('MEDICAL_DIRECTOR is not an implicit cross-domain superuser', () => {
    const decision = AuthorizationPipeline.evaluate(
      {
        ...baseContext,
        roles: ['MEDICAL_DIRECTOR'],
        permissions: ['CLINICAL_NOTES:VIEW'],
      },
      {
        requiredRoles: ['FINANCE_MANAGER', 'ACCOUNTANT'],
      }
    );

    expect(decision.authorized).toBe(false);
    expect(decision.code).toBe('INSUFFICIENT_ROLE');
  });

  test('roles are explicit; SYSTEM_ADMIN is not an unlisted business-role bypass', () => {
    const decision = AuthorizationPipeline.evaluate(
      { ...baseContext, roles: ['SYSTEM_ADMIN'] },
      { requiredRoles: ['CFO'] }
    );

    expect(decision.authorized).toBe(false);
    expect(decision.code).toBe('INSUFFICIENT_ROLE');
  });

  test('required permissions fail closed and wildcard permission is explicit', () => {
    const denied = AuthorizationPipeline.evaluate(
      { ...baseContext, roles: ['ACCOUNTANT'] },
      {
        requiredRoles: ['ACCOUNTANT'],
        requiredPermissions: ['ERP_GL:CREATE'],
      }
    );
    expect(denied.authorized).toBe(false);
    expect(denied.code).toBe('INSUFFICIENT_PERMISSION');

    const wildcard = AuthorizationPipeline.evaluate(
      { ...baseContext, roles: ['ACCOUNTANT'], permissions: ['*'] },
      {
        requiredRoles: ['ACCOUNTANT'],
        requiredPermissions: ['ERP_GL:CREATE'],
      }
    );
    expect(wildcard.authorized).toBe(true);
  });

  test('required department fails closed when actor has no matching assignment', () => {
    const missing = AuthorizationPipeline.evaluate(
      {
        ...baseContext,
        departmentId: undefined,
        departmentIds: [],
      },
      {
        requiredRoles: ['DOCTOR'],
        requiredDepartment: 'dept-a',
      }
    );
    expect(missing.authorized).toBe(false);
    expect(missing.code).toBe('DEPARTMENT_SCOPE_MISMATCH');

    const mismatch = AuthorizationPipeline.evaluate(
      baseContext,
      {
        requiredRoles: ['DOCTOR'],
        requiredDepartment: 'dept-b',
      }
    );
    expect(mismatch.authorized).toBe(false);
    expect(mismatch.code).toBe('DEPARTMENT_SCOPE_MISMATCH');
  });

  test('financial authority is explicit and missing/insufficient authority never means unlimited', () => {
    const missing = AuthorizationPipeline.evaluate(
      {
        ...baseContext,
        roles: ['FINANCE_MANAGER'],
        permissions: ['ERP_GL:CREATE'],
        financialAuthorityMinorUnits: undefined,
      },
      {
        requiredRoles: ['FINANCE_MANAGER'],
        requiredPermissions: ['ERP_GL:CREATE'],
        financialLimitMinorUnits: 100_000,
      }
    );
    expect(missing.authorized).toBe(false);
    expect(missing.code).toBe('FINANCIAL_AUTHORITY_EXCEEDED');

    const low = AuthorizationPipeline.evaluate(
      {
        ...baseContext,
        roles: ['FINANCE_MANAGER'],
        permissions: ['ERP_GL:CREATE'],
        financialAuthorityMinorUnits: 99_999,
      },
      {
        requiredRoles: ['FINANCE_MANAGER'],
        requiredPermissions: ['ERP_GL:CREATE'],
        financialLimitMinorUnits: 100_000,
      }
    );
    expect(low.authorized).toBe(false);

    const exact = AuthorizationPipeline.evaluate(
      {
        ...baseContext,
        roles: ['FINANCE_MANAGER'],
        permissions: ['ERP_GL:CREATE'],
        financialAuthorityMinorUnits: 100_000,
      },
      {
        requiredRoles: ['FINANCE_MANAGER'],
        requiredPermissions: ['ERP_GL:CREATE'],
        financialLimitMinorUnits: 100_000,
      }
    );
    expect(exact.authorized).toBe(true);
  });

  test('break-glass bypasses only clinical privilege, not role/permission/scope/financial authority', () => {
    const emergency: CommandContext = {
      ...baseContext,
      roles: ['DOCTOR'],
      permissions: ['CLINICAL_ORDER:CREATE'],
      clinicalPrivileges: [],
      isEmergencyOverride: true,
      breakGlassGrantId: 'bg-1',
    };

    const privilegeBypass = AuthorizationPipeline.evaluate(emergency, {
      requiredRoles: ['DOCTOR'],
      requiredPermissions: ['CLINICAL_ORDER:CREATE'],
      requiredPrivilege: 'ORDER_LAB',
      requiredDepartment: 'dept-a',
      allowBreakGlass: true,
    });
    expect(privilegeBypass.authorized).toBe(true);

    const roleDenied = AuthorizationPipeline.evaluate(emergency, {
      requiredRoles: ['FINANCE_MANAGER'],
      allowBreakGlass: true,
    });
    expect(roleDenied.authorized).toBe(false);
    expect(roleDenied.code).toBe('INSUFFICIENT_ROLE');

    const permissionDenied = AuthorizationPipeline.evaluate(emergency, {
      requiredRoles: ['DOCTOR'],
      requiredPermissions: ['ERP_GL:CREATE'],
      allowBreakGlass: true,
    });
    expect(permissionDenied.authorized).toBe(false);
    expect(permissionDenied.code).toBe('INSUFFICIENT_PERMISSION');

    const financialDenied = AuthorizationPipeline.evaluate(emergency, {
      requiredRoles: ['DOCTOR'],
      financialLimitMinorUnits: 1,
      allowBreakGlass: true,
    });
    expect(financialDenied.authorized).toBe(false);
    expect(financialDenied.code).toBe('FINANCIAL_AUTHORITY_EXCEEDED');
  });

  test('every CommandBus handler has a versioned command schema', async () => {
    const [bus, registry] = await Promise.all([
      source('lib/backend/commands/command-bus.ts'),
      source('lib/backend/commands/command-schema-registry.ts'),
    ]);

    const handlers = Array.from(
      bus.matchAll(/case\s+'([^']+Command)'\s*:/g),
      (match) => match[1]
    );
    const schemas = Array.from(
      registry.matchAll(/^\s{2}([A-Za-z0-9_]+Command):\s*\{/gm),
      (match) => match[1]
    );

    expect(new Set(handlers).size).toBe(155);
    expect(new Set(schemas).size).toBe(new Set(handlers).size);
    expect(
      [...new Set(handlers)].filter((command) => !new Set(schemas).has(command))
    ).toEqual([]);
  });

  test('unregistered command types and unknown payload fields fail closed', () => {
    const unknown = validateCommandPayload({
      commandId: 'cmd-x',
      idempotencyKey: 'idem-x',
      tenantId: 'tenant-drp',
      commandType: 'FutureUnreviewedCommand',
      schemaVersion: 1,
      payload: {},
    });
    expect(unknown.success).toBe(false);
    expect(unknown.error?.code).toBe('COMMAND_SCHEMA_NOT_REGISTERED');

    const injected: BaseCommand = {
      commandId: 'cmd-clinical',
      idempotencyKey: 'idem-clinical',
      tenantId: 'tenant-drp',
      commandType: 'PlaceDiagnosticOrderCommand',
      schemaVersion: 1,
      payload: {
        encounterId: 'enc-1',
        patientId: 'pat-1',
        orderType: 'LAB',
        catalogCode: 'CBC',
        orderName: 'CBC',
        priority: 'ROUTINE',
        clinicalIndication: 'Clinical indication',
        estimatedCostMinorUnits: 1000,
        forgedRole: 'SYSTEM_ADMIN',
      },
    };
    const result = validateCommandPayload(injected);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_PAYLOAD_INVALID');
  });

  test('high-risk financial mutations activate permission and amount-aware authority', async () => {
    const [gl, procurement, payables] = await Promise.all([
      source('lib/backend/services/finance-gl-domain-service.ts'),
      source('lib/backend/services/scm-procurement-domain-service.ts'),
      source('lib/backend/services/scm-payables-domain-service.ts'),
    ]);

    const postStart = gl.indexOf('public static async postJournal');
    const reverseStart = gl.indexOf('public static async reverseJournal', postStart);
    const post = gl.slice(postStart, reverseStart);
    expect(post).toContain("requiredPermissions: ['ERP_GL:CREATE']");
    expect(post).toContain('financialLimitMinorUnits: requestedAuthorityMinorUnits');

    const poStart = procurement.indexOf('public static async approvePurchaseOrder');
    const grnStart = procurement.indexOf('public static async recordGoodsReceipt', poStart);
    expect(procurement.slice(poStart, grnStart)).toContain(
      "requiredPermissions: ['SCM_PURCHASE_ORDER:APPROVE']"
    );

    const approvalStart = payables.indexOf(
      'public static async approveSupplierPaymentAuthorization'
    );
    const paymentStart = payables.indexOf(
      'public static async recordSupplierPayment',
      approvalStart
    );
    const approval = payables.slice(approvalStart, paymentStart);
    expect(approval).toContain("requiredPermissions: ['SCM_AP:APPROVE_PAYMENT']");
    expect(approval).toContain(
      'financialLimitMinorUnits: authorization.amountMinorUnits'
    );
  });

  test('financial authority is resolved only from authoritative tenant membership', async () => {
    const [membership, authority] = await Promise.all([
      source('server/auth/tenant-membership.ts'),
      source('lib/backend/security/authoritative-context.ts'),
    ]);
    expect(membership).toContain('data.financialAuthorityMinorUnits');
    expect(authority).toContain(
      'financialAuthorityMinorUnits: authContext.financialAuthorityMinorUnits'
    );
    expect(authority).not.toContain('x-financial-authority');
  });
});
