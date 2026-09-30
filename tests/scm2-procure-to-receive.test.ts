import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('SCM-2 procure-to-receive integrity', () => {
  test('procurement aggregates are registered on the atomic transaction boundary', async () => {
    const tx = await source(
      'lib/backend/transactions/transaction-manager.ts'
    );

    expect(tx).toContain("PURCHASE_ORDER: 'scmPurchaseOrders'");
    expect(tx).toContain("GOODS_RECEIPT_NOTE: 'goodsReceiptNotes'");
    expect(tx).toContain("SUPPLIER_MASTER: 'suppliers'");
    expect(tx).toContain("THREE_WAY_MATCH: 'threeWayMatches'");
  });

  test('requisition approval is stateful and enforces segregation of duties', async () => {
    const service = await source(
      'lib/backend/services/scm-procurement-domain-service.ts'
    );
    const start = service.indexOf('approvePurchaseRequisition');
    const end = service.indexOf('createPurchaseOrder', start);
    const method = service.slice(start, end);

    expect(method).toContain('executeAtomicReadModifyMutation');
    expect(method).toContain("'PR_STATE_CONFLICT'");
    expect(method).toContain("'SCM_SEGREGATION_OF_DUTIES'");
    expect(method).toContain("'INVALID_PR_APPROVED_QUANTITY'");
    expect(method).toContain("'PR_APPROVED'");
    expect(method).toContain("'PR_REJECTED'");
  });

  test('purchase orders can only originate from an approved requisition and active supplier', async () => {
    const service = await source(
      'lib/backend/services/scm-procurement-domain-service.ts'
    );
    const start = service.indexOf('createPurchaseOrder');
    const end = service.indexOf('approvePurchaseOrder', start);
    const method = service.slice(start, end);

    expect(method).toContain("entityType: 'PURCHASE_REQUISITION'");
    expect(method).toContain("entityType: 'SUPPLIER_MASTER'");
    expect(method).toContain("entityType: 'INVENTORY_LOCATION'");
    expect(method).toContain("'PR_NOT_APPROVED'");
    expect(method).toContain("'PR_ALREADY_CONVERTED'");
    expect(method).toContain("'SUPPLIER_NOT_ACTIVE'");
    expect(method).toContain("'DUPLICATE_PO_ITEM'");
    expect(method).toContain("'PO_ITEM_NOT_IN_REQUISITION'");
    expect(method).toContain("status: 'PENDING_APPROVAL'");
    expect(method).toContain("status: 'CONVERTED_TO_PO'");
  });

  test('purchase order approval requires a different actor from the creator', async () => {
    const service = await source(
      'lib/backend/services/scm-procurement-domain-service.ts'
    );
    const start = service.indexOf('approvePurchaseOrder');
    const end = service.indexOf('recordGoodsReceipt', start);
    const method = service.slice(start, end);

    expect(method).toContain("'PO_STATE_CONFLICT'");
    expect(method).toContain("'SCM_SEGREGATION_OF_DUTIES'");
    expect(method).toContain("'PO_APPROVED'");
    expect(method).toContain("'PO_REJECTED'");
    expect(method).toContain('approvalSignatures');
  });

  test('goods receipt atomically updates PO, batch, balance and stock ledger', async () => {
    const service = await source(
      'lib/backend/services/scm-procurement-domain-service.ts'
    );
    const start = service.indexOf('recordGoodsReceipt');
    const method = service.slice(start);

    expect(method).toContain('executeAtomicReadModifyMutation');
    expect(method).toContain("entityType: 'PURCHASE_ORDER'");
    expect(method).toContain("entityType: 'INVENTORY_LOCATION'");
    expect(method).toContain("entityType: 'ITEM_MASTER'");
    expect(method).toContain("entityType: 'BATCH_LOT'");
    expect(method).toContain("entityType: 'INVENTORY_BALANCE'");
    expect(method).toContain("entityType: 'STOCK_TRANSACTION'");
    expect(method).toContain("'GRN_EXCEEDS_PO_REMAINDER'");
    expect(method).toContain("'GRN_DESTINATION_MISMATCH'");
    expect(method).toContain("'GRN_FACILITY_OR_LOCATION_MISMATCH'");
    expect(method).toContain("'GRN_BATCH_REQUIRED'");
    expect(method).toContain("'GRN_EXPIRY_REQUIRED'");
    expect(method).toContain("'GRN_TEMPERATURE_REQUIRED'");
    expect(method).toContain("'FAILED_INSPECTION_CANNOT_ACCEPT_STOCK'");
    expect(method).toContain("'GRN_INSPECTION_STATUS_CONFLICT'");
  });

  test('rejected or damaged receipt quantities do not close purchase demand', async () => {
    const service = await source(
      'lib/backend/services/scm-procurement-domain-service.ts'
    );

    expect(service).toContain(
      'const newReceived = alreadyReceived + accepted'
    );
    expect(service).toContain(
      'Rejected/damaged units remain open for replacement or supplier credit.'
    );
  });

  test('GRN event and document status preserve failed and quarantined outcomes', async () => {
    const service = await source(
      'lib/backend/services/scm-procurement-domain-service.ts'
    );

    expect(service).toContain("'GRN_INSPECTION_FAILED'");
    expect(service).toContain("'GRN_QUARANTINED'");
    expect(service).toContain("'GRN_RECORDED'");
    expect(service).toContain("? 'INSPECTED'");
    expect(service).toContain(": 'PUTAWAY_COMPLETED'");
  });

  test('receiving reads the existing balance before writing and never trusts client cost', async () => {
    const service = await source(
      'lib/backend/services/scm-procurement-domain-service.ts'
    );

    expect(service).toContain("key: `balance:${index}`");
    expect(service).toContain('current[`balance:${index}`]');
    expect(service).toContain('const poUnitCost = Number(poLine.unitPrice)');
    expect(service).toContain('const stockUnitCost');
    expect(service).toContain('conversionFactorToStockUom');
    expect(service).not.toContain('const unitCost = Number(line.unitCost)');
  });

  test('existing quarantine cannot be released by a later normal receipt', async () => {
    const service = await source(
      'lib/backend/services/scm-procurement-domain-service.ts'
    );

    expect(service).toContain(
      "existingBatch && existingBatch.status !== 'AVAILABLE'"
    );
    expect(service).toContain('existingBatch.status');
    expect(service).toContain("'QUARANTINED'");
  });

  test('SCM-2 command schemas fail malformed GRN and PO payloads before dispatch', () => {
    const badPo = validateCommandPayload({
      commandId: 'cmd-po',
      idempotencyKey: 'idem-po',
      tenantId: 'tenant',
      commandType: 'CreatePurchaseOrderCommand',
      schemaVersion: 1,
      payload: {
        poId: 'po-1',
        poNumber: 'PO-1',
        requisitionId: 'pr-1',
        supplierId: 'sup-1',
        currency: 'USD',
        paymentTerms: 'NET30',
        expectedDeliveryDate: '2026-10-05',
        destinationLocationId: 'loc-1',
        items: [],
      },
    });

    expect(badPo.success).toBe(false);
    expect(badPo.error?.code).toBe('COMMAND_PAYLOAD_INVALID');

    const badGrn = validateCommandPayload({
      commandId: 'cmd-grn',
      idempotencyKey: 'idem-grn',
      tenantId: 'tenant',
      commandType: 'RecordGoodsReceiptCommand',
      schemaVersion: 1,
      payload: {
        grnId: 'grn-1',
        grnNumber: 'GRN-1',
        purchaseOrderId: 'po-1',
        facilityId: 'fac-1',
        deliveryNoteNumber: 'DN-1',
        receivedAt: '2026-09-30T12:00:00Z',
        inspectionStatus: 'PASSED',
        destinationLocationId: 'loc-1',
        items: [],
      },
    });

    expect(badGrn.success).toBe(false);
    expect(badGrn.error?.code).toBe('COMMAND_PAYLOAD_INVALID');
  });

  test('command bus routes all SCM-2 mutations through governed services', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');

    expect(bus).toContain("'ApprovePurchaseRequisitionCommand'");
    expect(bus).toContain("'CreatePurchaseOrderCommand'");
    expect(bus).toContain("'ApprovePurchaseOrderCommand'");
    expect(bus).toContain("'RecordGoodsReceiptCommand'");
    expect(bus).toContain('ScmProcurementDomainService');
  });
});
