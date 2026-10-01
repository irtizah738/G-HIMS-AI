import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';
import { calculateDerivedBalance } from '@/lib/supply-chain/scm-engine';
import type { InventoryBalance } from '@/types/scm-domain';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

function balance(overrides: Partial<InventoryBalance> = {}): InventoryBalance {
  return {
    balanceId: 'tenant_fac_loc_item_batch',
    tenantId: 'tenant',
    facilityId: 'fac',
    locationId: 'loc-a',
    locationName: 'Store A',
    itemId: 'item-1',
    itemCode: 'ITEM-1',
    itemName: 'Test Item',
    itemType: 'MEDICAL_CONSUMABLE',
    batchId: 'batch-1',
    batchNumber: 'LOT-1',
    expiryDate: '2027-12-31T00:00:00.000Z',
    onHand: 100,
    reserved: 10,
    quarantined: 5,
    damaged: 2,
    expired: 3,
    inTransit: 0,
    available: 80,
    uom: 'PIECE',
    minimumStock: 10,
    maximumStock: 200,
    reorderPoint: 30,
    unitCost: 2,
    totalValuation: 200,
    lastMovementAt: '2026-09-30T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('SCM-1 inventory integrity foundation', () => {
  test('stock mutations use atomic read-modify-write against authoritative balances', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );

    const methodStart = service.indexOf(
      'public static async recordStockTransaction'
    );
    const methodEnd = service.indexOf(
      'public static async recordPatientConsumption',
      methodStart
    );
    const method = service.slice(methodStart, methodEnd);

    expect(method).toContain('executeAtomicReadModifyMutation');
    expect(method).toContain("key: 'item'");
    expect(method).toContain("entityType: 'ITEM_MASTER'");
    expect(method).toContain("key: 'sourceBalance'");
    expect(method).toContain("key: 'destinationBalance'");
    expect(method).toContain('validateMovementAgainstBalance');
    expect(method).not.toContain('DomainStateRepository.getById');
  });

  test('a transfer is represented as one atomic source and destination movement', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );

    expect(service).toContain("'TRANSFER_OUT' as const");
    expect(service).toContain("'TRANSFER_IN' as const");
    expect(service).toContain('sourceBalanceId');
    expect(service).toContain('destinationBalanceId');
    expect(service).toContain("'STOCK_TRANSFER_COMMITTED'");
  });

  test('stock command schema rejects incomplete transfers', () => {
    const invalid = validateCommandPayload({
      commandId: 'cmd-transfer',
      idempotencyKey: 'idem-transfer',
      tenantId: 'tenant',
      commandType: 'RecordStockTransactionCommand',
      schemaVersion: 1,
      payload: {
        transactionId: 'txn-1',
        facilityId: 'fac',
        itemId: 'item-1',
        transactionType: 'TRANSFER_OUT',
        quantity: 5,
        uom: 'PIECE',
        fromLocationId: 'loc-a',
        referenceType: 'INTERNAL_REQUEST',
        referenceId: 'req-1',
      },
    });

    expect(invalid.success).toBe(false);
    expect(invalid.error?.code).toBe('COMMAND_PAYLOAD_INVALID');
  });

  test('patient consumption atomically depletes stock and verifies encounter ownership', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );
    const start = service.indexOf(
      'public static async recordPatientConsumption'
    );
    const end = service.indexOf(
      'public static async submitPurchaseRequisition',
      start
    );
    const method = service.slice(start, end);

    expect(method).toContain('executeAtomicReadModifyMutation');
    expect(method).toContain("entityType: 'PATIENT_MPI'");
    expect(method).toContain("entityType: 'ENCOUNTER'");
    expect(method).toContain("entityType: 'BATCH_LOT'");
    expect(method).toContain("entityType: 'INVENTORY_BALANCE'");
    expect(method).toContain("entityType: 'STOCK_TRANSACTION'");
    expect(method).toContain("'SCM_ENCOUNTER_PATIENT_MISMATCH'");
    expect(method).toContain("'PATIENT_CONSUMPTION_STOCK_COMMITTED'");
  });

  test('purchase requisitions are server-canonical and actor/facility scoped', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );
    const start = service.indexOf(
      'public static async submitPurchaseRequisition'
    );
    const method = service.slice(start);

    expect(method).toContain("status: 'SUBMITTED'");
    expect(method).toContain('userId: context.actorId');
    expect(method).toContain('estimatedTotalCost');
    expect(method).toContain("'FACILITY_SCOPE_MISMATCH'");
    expect(method).toContain("'INVALID_REQUISITION_LINE'");
  });

  test('production SCM reads use governed projections and contain no synthetic hospital defaults', async () => {
    const [view, adapter] = await Promise.all([
      source('components/views/supply-chain-scm-view.tsx'),
      source('lib/supply-chain/scm-edge-adapter.ts'),
    ]);

    expect(view).toContain('loadLocalScmEdgeData');
    expect(view).toContain('hydrateScmEdgeData');
    expect(view).not.toContain("from '@/lib/firebase/services/");
    expect(view).not.toContain('seedRealisticHospitalSCMData');
    expect(view).not.toContain('seedInitial');
    expect(view).not.toContain("useState('Pfizer BioPharma Ltd')");
    expect(view).not.toContain("useState('PO-2026-0041')");
    expect(view).not.toContain("useState('ICU Nurse Station B')");

    expect(adapter).toContain('executeActiveTenantCommand');
    expect(adapter).toContain('loadLocalEdgeSnapshot');
    expect(adapter).toContain('hydrateEdgeSnapshot');
    expect(adapter).not.toContain('seedRealisticHospitalSCMData');
    expect(adapter).not.toContain("firebase/firestore");
  });

  test('ward replenishment FEFO uses source-location balances and a true transfer', async () => {
    const view = await source(
      'components/views/supply-chain-scm-view.tsx'
    );

    expect(view).toContain("const sourceLocationId = 'loc-pharmacy-main'");
    expect(view).toContain('balance.locationId === sourceLocationId');
    expect(view).toContain("transactionType: 'TRANSFER_OUT'");
    expect(view).toContain('issueItem.stockUOM || issueItem.unitOfMeasure');
  });

  test('pure balance engine preserves the stock equation after issue', () => {
    const next = calculateDerivedBalance(balance(), {
      transactionType: 'ISSUE',
      quantity: 5,
    });

    expect(next.onHand).toBe(95);
    expect(next.available).toBe(
      next.onHand -
        next.reserved -
        next.quarantined -
        next.damaged -
        next.expired
    );
    expect(next.available).toBe(75);
  });
});
