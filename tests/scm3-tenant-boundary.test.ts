import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('SCM-3 tenant boundary hardening', () => {
  test('SCM route fails closed instead of falling back to a demo tenant', async () => {
    const page = await source('app/[tenantId]/scm/page.tsx');

    expect(page).toContain("resolvedParams.tenantId?.trim()");
    expect(page).toContain('TENANT_CONTEXT_REQUIRED');
    expect(page).not.toContain("resolvedParams.tenantId || 'metro-health'");
  });

  test('SCM view requires an explicit tenant contract', async () => {
    const view = await source('components/views/supply-chain-scm-view.tsx');

    expect(view).toContain('tenantId: string;');
    expect(view).toContain("if (!tenantId.trim())");
    expect(view).not.toContain("tenantId?: string;");
    expect(view).not.toContain("tenantId = 'metro-health'");
  });

  test('SCM writes remain bound to the authenticated active-tenant command client', async () => {
    const edge = await source('lib/supply-chain/scm-edge-adapter.ts');

    expect(edge).toContain("import { executeActiveTenantCommand }");
    expect(edge).toContain("executeActiveTenantCommand(\n    'RecordStockTransactionCommand'");
    expect(edge).toContain("executeActiveTenantCommand(\n    'RecordPatientConsumptionCommand'");
    expect(edge).toContain("executeActiveTenantCommand(\n    'SubmitPurchaseRequisitionCommand'");
  });

  test('offline SCM mutations reject cached-session tenant mismatch', async () => {
    const offline = await source('lib/supply-chain/scm-offline-store.ts');

    expect(offline).toContain('cached.user.tenantId !== mutation.tenantId');
    expect(offline).toContain('TENANT_MISMATCH');
  });

  test('server SCM stock mutations canonicalize tenant from command context', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );

    const start = service.indexOf(
      'public static async recordStockTransaction'
    );
    const end = service.indexOf(
      'public static async recordPatientConsumption',
      start
    );
    const method = service.slice(start, end);

    expect(method).toContain('tenantId: context.tenantId');
    expect(method).toContain('executeAtomicReadModifyMutation');
    expect(method).not.toContain('tenantId: txn.tenantId');
  });
});
