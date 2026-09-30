import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('SCM final UI authority and branch-cleanup regression', () => {
  test('primary SCM screens do not call legacy browser mutation services', async () => {
    const procurement = await source(
      'components/supply-chain/scm-procurement-module.tsx'
    );
    const view = await source(
      'components/views/supply-chain-scm-view.tsx'
    );

    for (const file of [procurement, view]) {
      expect(file).not.toContain(
        "from '@/lib/firebase/services/scm-firestore-service'"
      );
    }

    expect(procurement).toContain('submitPurchaseRequisitionEdge');
    expect(procurement).toContain('approvePurchaseRequisitionEdge');
    expect(procurement).toContain('createPurchaseOrderEdge');
    expect(procurement).toContain('supplierContracts');
    expect(procurement).toContain('SUPPLIER_CONTRACT_REQUIRED');
  });

  test('SCM edge adapter exposes governed procurement mutations', async () => {
    const adapter = await source('lib/supply-chain/scm-edge-adapter.ts');

    for (const command of [
      'ApprovePurchaseRequisitionCommand',
      'CreatePurchaseOrderCommand',
      'ApprovePurchaseOrderCommand',
      'RecordGoodsReceiptCommand',
    ]) {
      expect(adapter).toContain(command);
    }

    expect(adapter).toContain("'scmSupplierContracts'");
    expect(adapter).toContain('executeActiveTenantCommand');
  });

  test('recall and PAR actions use governed SCM-8 and SCM-7 commands', async () => {
    const view = await source(
      'components/views/supply-chain-scm-view.tsx'
    );

    expect(view).toContain('initiateScmRecallEdge');
    expect(view).toContain('executeRecallQuarantineEdge');
    expect(view).toContain('upsertReplenishmentPolicyEdge');
    expect(view).not.toContain('executeBatchRecall(');
    expect(view).not.toContain('updateBalanceReorderParameters(');
  });

  test('supplier contracts are part of offline read hydration', async () => {
    const hydration = await source('lib/offline/hydration.ts');
    expect(hydration).toContain("'scmSupplierContracts'");
  });

  test('cold-chain disposal command accepts authoritative excursion identity', async () => {
    const schema = await source(
      'lib/backend/commands/command-schema-registry.ts'
    );
    const start = schema.indexOf('CreateInventoryDispositionCommand');
    expect(start).toBeGreaterThan(-1);
    const block = schema.slice(start, start + 1400);
    expect(block).toContain('TEMPERATURE_EXCURSION');
    expect(block).toContain('excursionId');
  });
});
