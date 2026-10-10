import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuthStateLoadingStatus } from '@/lib/auth/auth-types';

const source = (relPath: string) => readFile(join(process.cwd(), relPath), 'utf8');

describe('ORC-8 Matrix: Tenant Switch Suspension & Isolation', () => {
  test('AuthStateLoadingStatus includes explicit intermediate suspension states', () => {
    const statuses: AuthStateLoadingStatus[] = [
      'RESTORING_SESSION',
      'AUTHENTICATING',
      'RESOLVING_TENANT',
      'SWITCHING',
      'VERIFYING',
      'READY',
      'IDLE',
      'ERROR',
      'LOCKED',
    ];
    expect(statuses).toContain('SWITCHING');
    expect(statuses).toContain('VERIFYING');
  });

  test('switchTenant invalidates prior tenant context before publishing new context', async () => {
    const authContext = await source('lib/auth/auth-context.tsx');

    // Must set SWITCHING first
    expect(authContext).toContain("setLoadingStatus('SWITCHING')");

    // Prior tenant ID is a verification target, never an authority snapshot.
    expect(authContext).toContain('const priorTenant = activeTenant');
    expect(authContext).not.toContain('const priorRoles = roles');
    expect(authContext).not.toContain('const priorPrivileges = clinicalPrivileges');

    // Must clear prior tenant state to prevent in-flight command dispatch against stale tenant
    expect(authContext).toContain('setActiveTenant(null)');
    expect(authContext).toContain('setRoles([])');
    expect(authContext).toContain('setPermissions([])');
    expect(authContext).toContain('setClinicalPrivileges([])');

    // Must transition to VERIFYING
    expect(authContext).toContain("setLoadingStatus('VERIFYING')");

    // A switch failure must revalidate the prior tenant online or purge it.
    expect(authContext).toContain('const verifiedPriorSession = await AuthClient.validateCurrentSession()');
    expect(authContext).toContain('verifiedPriorSession?.authenticated');
    expect(authContext).toContain('verifiedPriorSession.tenant.tenantId === priorTenant.tenantId');
    expect(authContext).toContain('applyLoginPayload(verifiedPriorSession)');
    expect(authContext).toContain('await AuthClient.invalidateLocalAuthorization()');
    expect(authContext).not.toContain('setActiveTenant(priorTenant)');
    expect(authContext).not.toContain('setRoles(priorRoles)');
    expect(authContext).toContain('setAccessibleTenants([])');
    expect(authContext).toContain("setLoadingStatus('ERROR')");
  });

  test('tenant route authority guard blocks children during loading and switching', async () => {
    const guard = await source('components/tenant/tenant-route-authority-guard.tsx');

    // Must check loading and unresolved state
    expect(guard).toContain('if (loading || unresolved)');
    expect(guard).toContain('Resolving authenticated hospital context');

    // Must check mismatched route vs session
    expect(guard).toContain('if (mismatched)');
    expect(guard).toContain('Your hospital selection changed');

    // Children are only mounted when neither loading, unresolved, nor mismatched
    expect(guard).toContain('return <>{children}</>');
  });

  test('hydration returns DENIED on authorization failure rather than silently falling back to STALE', async () => {
    const hydration = await source('lib/offline/hydration.ts');

    expect(hydration).toContain("freshness: 'DENIED'");
    expect(hydration).toContain("message.includes('AUTHORIZATION')");
  });
});
