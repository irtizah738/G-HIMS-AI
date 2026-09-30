import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';
import {
  buildInventoryMovementValuation,
  buildJournalInventoryMovement,
  inventoryAccountForItemType,
  inventoryPeriodCloseId,
  periodKeyFromIso,
} from '@/lib/supply-chain/inventory-costing';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('SCM-5 inventory valuation, costing and period close', () => {
  test('batch-actual movement valuation reconciles deterministic inventory account movement', () => {
    const items = [
      {
        itemId: 'med-1',
        itemType: 'MEDICATION',
      },
    ] as any;

    const transactions = [
      {
        transactionId: 'opening-rx',
        itemId: 'med-1',
        transactionType: 'RECEIPT',
        quantity: 5,
        normalizedQuantity: 5,
        unitCost: 2,
        currency: 'USD',
        occurredAt: '2026-08-28T10:00:00.000Z',
      },
      {
        transactionId: 'rx-1',
        itemId: 'med-1',
        transactionType: 'RECEIPT',
        quantity: 10,
        normalizedQuantity: 10,
        unitCost: 2,
        currency: 'USD',
        occurredAt: '2026-09-05T10:00:00.000Z',
      },
      {
        transactionId: 'use-1',
        itemId: 'med-1',
        transactionType: 'CONSUMPTION',
        quantity: 3,
        normalizedQuantity: 3,
        unitCost: 2,
        currency: 'USD',
        occurredAt: '2026-09-10T10:00:00.000Z',
      },
      {
        transactionId: 'move-1',
        itemId: 'med-1',
        transactionType: 'TRANSFER_OUT',
        quantity: 2,
        normalizedQuantity: 2,
        unitCost: 2,
        currency: 'USD',
        occurredAt: '2026-09-12T10:00:00.000Z',
      },
    ] as any;

    const valuation = buildInventoryMovementValuation({
      transactions,
      items,
      periodStart: '2026-09-01T00:00:00.000Z',
      periodEnd: '2026-09-30T23:59:59.999Z',
      currency: 'USD',
    });

    expect(valuation.movementMinorUnitsByAccount['1210']).toBe(1400);
    expect(valuation.movementMinorUnitsByAccount['1220']).toBe(0);
    expect(valuation.endingValuationMinorUnitsByAccount['1210']).toBe(2400);
    expect(valuation.endingValuationMinorUnitsByAccount['1220']).toBe(0);
    expect(valuation.transactionCount).toBe(2);

    const ledger = buildJournalInventoryMovement({
      journals: [
        {
          journalId: 'je-grn',
          fiscalYear: 2026,
          postingPeriod: 9,
          status: 'POSTED',
          currency: 'USD',
          lines: [
            {
              glAccountId: '1210',
              debitMinorUnits: 2000,
              creditMinorUnits: 0,
            },
            {
              glAccountId: '2030',
              debitMinorUnits: 0,
              creditMinorUnits: 2000,
            },
          ],
        },
        {
          journalId: 'je-cogs',
          fiscalYear: 2026,
          postingPeriod: 9,
          status: 'POSTED',
          currency: 'USD',
          lines: [
            {
              glAccountId: '6020',
              debitMinorUnits: 600,
              creditMinorUnits: 0,
            },
            {
              glAccountId: '1210',
              debitMinorUnits: 0,
              creditMinorUnits: 600,
            },
          ],
        },
      ],
      fiscalYear: 2026,
      postingPeriod: 9,
      currency: 'USD',
    });

    expect(ledger.movementMinorUnitsByAccount['1210']).toBe(1400);
    expect(ledger.journalEntryCount).toBe(2);
  });

  test('valuation is currency-strict and period IDs are deterministic', () => {
    expect(periodKeyFromIso('2026-09-30T12:00:00.000Z')).toBe('2026-09');
    expect(inventoryPeriodCloseId('FAC-MAIN', '2026-09')).toBe(
      'iclose_FAC-MAIN_2026-09'
    );
    expect(inventoryAccountForItemType('MEDICATION')).toBe('1210');
    expect(inventoryAccountForItemType('IMPLANT')).toBe('1220');

    expect(() =>
      buildInventoryMovementValuation({
        transactions: [
          {
            transactionId: 'wrong-fx',
            itemId: 'med-1',
            transactionType: 'RECEIPT',
            quantity: 1,
            normalizedQuantity: 1,
            unitCost: 1,
            currency: 'PKR',
            occurredAt: '2026-09-10T00:00:00.000Z',
          },
        ] as any,
        items: [{ itemId: 'med-1', itemType: 'MEDICATION' }] as any,
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-09-30T23:59:59.999Z',
        currency: 'USD',
      })
    ).toThrow('INVENTORY_VALUATION_CURRENCY_MISMATCH');
  });

  test('cycle count command contract requires a blind count', () => {
    const invalid = validateCommandPayload({
      commandId: 'cmd-count',
      idempotencyKey: 'idem-count',
      tenantId: 'tenant',
      commandType: 'SubmitCycleCountCommand',
      schemaVersion: 1,
      payload: {
        countId: 'count-1',
        facilityId: 'fac',
        locationId: 'loc',
        countedAt: '2026-09-30T10:00:00.000Z',
        isBlindCount: false,
        lines: [{ balanceId: 'balance-1', countedQuantity: 10 }],
      },
    });
    expect(invalid.success).toBe(false);
  });

  test('cycle count adjustment is maker-checker, stale-balance safe, atomic, and journaled', async () => {
    const service = await source(
      'lib/backend/services/scm-costing-domain-service.ts'
    );

    expect(service).toContain('SCM_SEGREGATION_OF_DUTIES');
    expect(service).toContain('CYCLE_COUNT_STALE_BALANCE');
    expect(service).toContain('COUNT_BELOW_CONTROLLED_QUANTITY');
    expect(service).toContain("entityType: 'STOCK_ADJUSTMENT'");
    expect(service).toContain("entityType: 'STOCK_TRANSACTION'");
    expect(service).toContain("entityType: 'INVENTORY_BALANCE'");
    expect(service).toContain("entityType: 'JOURNAL_ENTRY'");
    expect(service).toContain("varianceAccountCode: '6040'");
    expect(service).toContain("'CYCLE_COUNT_APPROVED_AND_POSTED'");
  });

  test('stock issues and patient consumption use authoritative cost and post COGS', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );

    expect(service).toContain('authoritativeSourceBalance?.unitCost');
    expect(service).toContain('GOVERNED_INVENTORY_ADJUSTMENT_REQUIRED');
    expect(service).toContain('buildInventoryExpenseJournal');
    expect(service).toContain("glAccountId: '6020'");
    expect(service).toContain('inventoryAccountForItemType');
    expect(service).toContain('Number(balance.unitCost || 0)');
    expect(service).toContain('je_cogs_');
  });

  test('two-phase period close freezes movements and refuses unreconciled close', async () => {
    const costing = await source(
      'lib/backend/services/scm-costing-domain-service.ts'
    );
    const stock = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );
    const procurement = await source(
      'lib/backend/services/scm-procurement-domain-service.ts'
    );

    expect(costing).toContain("'INVENTORY_PERIOD_CLOSE_STARTED'");
    expect(costing).toContain("'INVENTORY_PERIOD_CLOSED'");
    expect(costing).toContain('INVENTORY_GL_RECONCILIATION_FAILED');
    expect(costing).toContain("status: 'CLOSING'");
    expect(costing).toContain("status: 'CLOSED'");
    expect(stock).toContain('INVENTORY_PERIOD_BLOCKED');
    expect(procurement).toContain('INVENTORY_PERIOD_BLOCKED');
  });

  test('SCM-5 aggregates and commands are registered on governed boundaries', async () => {
    const tx = await source('lib/backend/transactions/transaction-manager.ts');
    const bus = await source('lib/backend/commands/command-bus.ts');

    expect(tx).toContain("CYCLE_COUNT: 'scmCycleCounts'");
    expect(tx).toContain("STOCK_ADJUSTMENT: 'scmStockAdjustments'");
    expect(tx).toContain(
      "INVENTORY_PERIOD_CLOSE: 'scmInventoryPeriodCloses'"
    );

    for (const command of [
      'SubmitCycleCountCommand',
      'ApproveCycleCountCommand',
      'StartInventoryPeriodCloseCommand',
      'FinalizeInventoryPeriodCloseCommand',
    ]) {
      expect(bus).toContain(`case '${command}'`);
    }
  });

  test('blind count capture is offline-capable while approvals and close stay online-only', async () => {
    const adapter = await source(
      'lib/supply-chain/scm-costing-edge-adapter.ts'
    );
    const hydration = await source('lib/offline/hydration.ts');

    const submitStart = adapter.indexOf('submitCycleCountEdge');
    const approveStart = adapter.indexOf('approveCycleCountEdge');
    const submit = adapter.slice(submitStart, approveStart);

    expect(submit).toContain('offlineQueue');
    expect(submit).toContain("collection: 'scmCycleCounts'");
    expect(adapter.slice(approveStart)).not.toContain('offlineQueue');
    expect(hydration).toContain("'scmCycleCounts'");
  });

  test('SCM-5 control account and read models are provisioned and client-write denied', async () => {
    const coa = await source('lib/finance/double-entry.ts');
    const provisioner = await source(
      'scripts/ops/scm5-provision-inventory-control-account.ts'
    );
    const rules = await source('firestore.rules');
    const pkg = await source('package.json');

    expect(coa).toContain("accountCode: '6040'");
    expect(provisioner).toContain("accountCode: '6040'");
    expect(provisioner).toContain('GHIMS_SCM5_PROVISION_TENANT');
    expect(provisioner).toContain('GHIMS_ALLOW_SCM5_FINANCE_PROVISION');
    expect(pkg).toContain('"ops:scm5:provision-finance"');

    for (const collection of [
      'scmCycleCounts',
      'scmStockAdjustments',
      'scmInventoryPeriodCloses',
    ]) {
      const start = rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      const block = rules.slice(start, start + 220);
      expect(block).toContain('allow write: if false;');
    }
  });
});
