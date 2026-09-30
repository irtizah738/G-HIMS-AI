import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('SCM-1 authoritative inventory and procurement foundation', () => {
  test('stock movement derives balance inside the atomic transaction', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );
    expect(service).toContain('executeAtomicReadModifyMutation');
    expect(service).toContain("key: 'balance'");
    expect(service).toContain("'INVENTORY_STATE_CONFLICT'");
    expect(service).toContain('calculateDerivedBalance(base, authoritativeTxn)');
    expect(service).not.toContain(
      "DomainStateRepository.getById<InventoryBalance>"
    );
  });

  test('batch lot and inventory balance move atomically under authoritative item data', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );
    const tx = await source(
      'lib/backend/transactions/transaction-manager.ts'
    );

    expect(tx).toContain("BATCH_LOT: 'batches'");
    expect(service).toContain("key: 'item'");
    expect(service).toContain("key: 'batch'");
    expect(service).toContain("'BATCH_ITEM_MISMATCH'");
    expect(service).toContain("'BATCH_NOT_AVAILABLE'");
    expect(service).toContain("'BATCH_EXPIRED'");
    expect(service).toContain("'BATCH_QUANTITY_CONFLICT'");
    expect(service).toContain("entityType: 'BATCH_LOT'");
    expect(service).toContain('quantityRemaining -= authoritativeTxn.quantity');
  });

  test('stock balance location follows movement direction', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );
    expect(service).toContain('inventoryLocationForTransaction');
    expect(service).toContain("'TRANSFER_IN'");
    expect(service).toContain('txn.toLocationId');
    expect(service).toContain('txn.fromLocationId');
  });

  test('purchase requisition authority comes from item master and authenticated actor', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );
    expect(service).toContain("entityType: 'ITEM_MASTER'");
    expect(service).toContain('requestedBy: {');
    expect(service).toContain('userId: context.actorId');
    expect(service).toContain("status: 'PENDING_APPROVAL'");
    expect(service).toContain('estimatedUnitCost: unitCost');
  });

  test('requisition approval is a guarded state transition', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );
    expect(service).toContain('reviewPurchaseRequisition');
    expect(service).toContain("'REQUISITION_STATE_CONFLICT'");
    expect(service).toContain("'PR_APPROVED'");
    expect(service).toContain("'PR_REJECTED'");
  });

  test('PR conversion creates a PO but never self-approves it', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );
    expect(service).toContain('convertPurchaseRequisitionToOrder');
    expect(service).toContain("status: 'PENDING_APPROVAL'");
    expect(service).toContain('PO_APPROVAL_REQUIRED_BEFORE_VENDOR_DISPATCH');
    expect(service).not.toContain(
      "approvalTier: 'SCM_APPROVED_PR_CONVERSION'"
    );
  });

  test('goods receiving requires an authoritative receivable PO', async () => {
    const service = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );
    expect(service).toContain('receivePurchaseOrder');
    expect(service).toContain("'PURCHASE_ORDER_NOT_RECEIVABLE'");
    expect(service).toContain("'GOODS_RECEIPT_ITEM_NOT_ORDERED'");
    expect(service).toContain("'GOODS_RECEIPT_QUANTITY_INVALID'");
    expect(service).toContain(
      'PUTAWAY_AND_RELEASE_REQUIRED_BEFORE_STOCK_BECOMES_AVAILABLE'
    );
  });

  test('SCM procurement UI uses governed edge commands', async () => {
    const procurement = await source(
      'components/supply-chain/scm-procurement-module.tsx'
    );
    expect(procurement).toContain('submitPurchaseRequisitionEdge');
    expect(procurement).toContain('reviewPurchaseRequisitionEdge');
    expect(procurement).toContain(
      'convertPurchaseRequisitionToOrderEdge'
    );
    expect(procurement).not.toContain(
      "@/lib/firebase/services/scm-firestore-service"
    );
  });

  test('legacy standalone PO browser mutation surface is retired', async () => {
    const page = await source(
      'app/[tenantId]/scm/purchase-orders/page.tsx'
    );
    expect(page).toContain("redirect(");
    expect(page).not.toContain('createPurchaseOrder');
    expect(page).not.toContain('receivePOItems');
  });

  test('SCM command bus and schemas cover authoritative procurement transitions', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');
    const schemas = await source(
      'lib/backend/commands/command-schema-registry.ts'
    );
    for (const command of [
      'RecordStockTransactionCommand',
      'SubmitPurchaseRequisitionCommand',
      'ReviewPurchaseRequisitionCommand',
      'ConvertPurchaseRequisitionToOrderCommand',
      'ReceivePurchaseOrderCommand',
    ]) {
      expect(bus).toContain(command);
      expect(schemas).toContain(command);
    }
  });
});
