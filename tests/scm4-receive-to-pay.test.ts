import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';
import { evaluateSupplierInvoiceMatch } from '@/lib/supply-chain/receive-to-pay';
import type { GoodsReceiptNote, PurchaseOrderRecord } from '@/types/scm-domain';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

function po(overrides: Partial<PurchaseOrderRecord> = {}): PurchaseOrderRecord {
  return {
    poId: 'po-1',
    tenantId: 'tenant',
    facilityId: 'fac-1',
    poNumber: 'PO-1',
    supplierId: 'sup-1',
    supplierName: 'Supplier One',
    items: [
      {
        lineId: 'line-1',
        itemId: 'item-1',
        itemCode: 'ITEM-1',
        itemName: 'Item One',
        quantityOrdered: 10,
        quantityReceived: 6,
        quantityRemaining: 4,
        quantityInvoiced: 0,
        quantityPendingInvoice: 0,
        uom: 'PIECE',
        unitPrice: 100,
        discount: 0,
        taxPercent: 0,
        lineTotal: 1000,
      },
    ],
    currency: 'PKR',
    totalAmount: 1000,
    paymentTerms: 'Net 30',
    expectedDeliveryDate: '2026-10-15',
    status: 'PARTIALLY_RECEIVED',
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

function grn(): GoodsReceiptNote {
  return {
    grnId: 'grn-1',
    tenantId: 'tenant',
    facilityId: 'fac-1',
    grnNumber: 'GRN-1',
    purchaseOrderId: 'po-1',
    poNumber: 'PO-1',
    supplierId: 'sup-1',
    supplierName: 'Supplier One',
    receivedBy: { userId: 'receiver', userName: 'Receiver' },
    receivedAt: '2026-09-30T00:00:00.000Z',
    deliveryNoteNumber: 'DN-1',
    items: [
      {
        itemId: 'item-1',
        itemCode: 'ITEM-1',
        itemName: 'Item One',
        quantityOrdered: 10,
        quantityReceived: 6,
        quantityAccepted: 6,
        quantityRejected: 0,
        quantityDamaged: 0,
        uom: 'PIECE',
        batchNumber: 'LOT-1',
        expiryDate: '2027-12-31T00:00:00.000Z',
        manufactureDate: '2026-01-01T00:00:00.000Z',
        manufacturer: 'Maker',
        temperatureExcursion: false,
        inspectionPassed: true,
        unitCost: 100,
      },
    ],
    inspectionStatus: 'PASSED',
    status: 'PUTAWAY_COMPLETED',
  };
}

describe('SCM-4 receive-to-pay financial integrity', () => {
  test('partial invoices are valid when they do not exceed accepted stock', () => {
    const result = evaluateSupplierInvoiceMatch({
      po: po(),
      grns: [grn()],
      invoiceLines: [
        {
          lineId: 'inv-line-1',
          itemId: 'item-1',
          billedQuantity: 4,
          uom: 'PIECE',
          unitPriceMinorUnits: 10_000,
          discountMinorUnits: 0,
          taxMinorUnits: 0,
        },
      ],
      shippingMinorUnits: 0,
      priceToleranceBasisPoints: 100,
      quantityTolerance: 0,
    });

    expect(result.fullyMatched).toBe(true);
    expect(result.exceptions).toEqual([]);
    expect(result.expectedAccrualMinorUnits).toBe(40_000);
    expect(result.invoiceTotalMinorUnits).toBe(40_000);
  });

  test('over-invoicing is detected against authoritative received and already-reserved quantity', () => {
    const result = evaluateSupplierInvoiceMatch({
      po: po(),
      grns: [grn()],
      invoiceLines: [
        {
          lineId: 'inv-line-1',
          itemId: 'item-1',
          billedQuantity: 7,
          uom: 'PIECE',
          unitPriceMinorUnits: 10_000,
        },
      ],
      shippingMinorUnits: 0,
      priceToleranceBasisPoints: 100,
      quantityTolerance: 0,
    });

    expect(result.exceptions).toContain('OVER_INVOICED');
    expect(result.exceptions).toContain('QUANTITY_VARIANCE');
    expect(result.fullyMatched).toBe(false);
  });

  test('price variance outside tolerance is routed to exception review', () => {
    const result = evaluateSupplierInvoiceMatch({
      po: po(),
      grns: [grn()],
      invoiceLines: [
        {
          lineId: 'inv-line-1',
          itemId: 'item-1',
          billedQuantity: 6,
          uom: 'PIECE',
          unitPriceMinorUnits: 10_200,
        },
      ],
      shippingMinorUnits: 0,
      priceToleranceBasisPoints: 100,
      quantityTolerance: 0,
    });

    expect(result.exceptions).toContain('PRICE_VARIANCE');
    expect(result.fullyMatched).toBe(false);
  });

  test('receive-to-pay commands have strict versioned schemas', () => {
    const valid = validateCommandPayload({
      commandId: 'cmd-1',
      idempotencyKey: 'idem-1',
      tenantId: 'tenant',
      commandType: 'RecordSupplierInvoiceCommand',
      schemaVersion: 1,
      payload: {
        facilityId: 'fac-1',
        supplierId: 'sup-1',
        invoiceNumber: 'INV-1',
        poId: 'po-1',
        grnIds: ['grn-1'],
        issueDate: '2026-09-30',
        dueDate: '2026-10-30',
        currency: 'PKR',
        lines: [
          {
            lineId: 'line-1',
            itemId: 'item-1',
            billedQuantity: 4,
            uom: 'PIECE',
            unitPriceMinorUnits: 10_000,
          },
        ],
      },
    });
    expect(valid.success).toBe(true);

    const invalidPayment = validateCommandPayload({
      commandId: 'cmd-2',
      idempotencyKey: 'idem-2',
      tenantId: 'tenant',
      commandType: 'RecordSupplierPaymentCommand',
      schemaVersion: 1,
      payload: {
        authorizationId: 'auth-1',
        invoiceId: 'inv-1',
        paymentReference: 'BANK-REF-1',
        paymentMethod: 'WIRE',
        sourceAccountId: 'bank-1010',
        settledAt: '2026-09-30T00:00:00.000Z',
        fiscalYear: 2026,
        postingPeriod: 9,
      },
    });
    expect(invalidPayment.success).toBe(false);
  });

  test('GRN acceptance atomically creates inventory-to-GRNI journal state', async () => {
    const service = await source(
      'lib/backend/services/scm-procurement-domain-service.ts'
    );

    expect(service).toContain('grniAccrualMinorUnits');
    expect(service).toContain('je_grni_');
    expect(service).toContain("glAccountId: '1210'");
    expect(service).toContain("glAccountId: '2030'");
    expect(service).toContain("entityType: 'JOURNAL_ENTRY'");
  });

  test('supplier invoice capture is duplicate-safe and reserves invoicing capacity atomically', async () => {
    const service = await source(
      'lib/backend/services/scm-payables-domain-service.ts'
    );

    expect(service).toContain('DUPLICATE_SUPPLIER_INVOICE');
    expect(service).toContain('SUPPLIER_INVOICE_OVER_INVOICED');
    expect(service).toContain('quantityPendingInvoice');
    expect(service).toContain("entityType: 'SUPPLIER_INVOICE_MATCH'");
    expect(service).toContain("entityType: 'PURCHASE_ORDER'");
    expect(service).toContain('executeAtomicReadModifyMutation');
  });

  test('exception approval, AP recognition, and payment enforce maker-checker controls', async () => {
    const service = await source(
      'lib/backend/services/scm-payables-domain-service.ts'
    );

    expect(service).toContain('SCM_FINANCE_SEGREGATION_OF_DUTIES');
    expect(service).toContain("'SUPPLIER_INVOICE_PAYABLE_RECOGNIZED'");
    expect(service).toContain("'SUPPLIER_PAYMENT_AUTHORIZATION_REQUESTED'");
    expect(service).toContain("'SUPPLIER_PAYMENT_AUTHORIZED'");
    expect(service).toContain("'SUPPLIER_PAYMENT_RECORDED'");
    expect(service).toContain("glAccountId: AP_ACCOUNT.id");
    expect(service).toContain("glAccountId: GRNI_ACCOUNT.id");
    expect(service).toContain("id: '2010'");
    expect(service).toContain("id: '2030'");
    expect(service).toContain("id: '1230'");
    expect(service).toContain("id: '1240'");
    expect(service).toContain("id: '6030'");
  });

  test('payables aggregates are tenant-scoped on the transaction boundary', async () => {
    const tx = await source('lib/backend/transactions/transaction-manager.ts');
    expect(tx).toContain("SUPPLIER_INVOICE: 'scmSupplierInvoices'");
    expect(tx).toContain("SUPPLIER_INVOICE_MATCH: 'scmSupplierInvoiceMatches'");
    expect(tx).toContain("AP_PAYMENT_AUTHORIZATION: 'scmPaymentAuthorizations'");
    expect(tx).toContain("SUPPLIER_PAYMENT: 'scmSupplierPayments'");
    expect(tx).toContain("GL_ACCOUNT: 'accounts'");
  });

  test('payment authorization reserves balance and settlement locks the authoritative GL account', async () => {
    const service = await source(
      'lib/backend/services/scm-payables-domain-service.ts'
    );

    const requestStart = service.indexOf(
      'public static async requestSupplierPaymentAuthorization'
    );
    const approvalStart = service.indexOf(
      'public static async approveSupplierPaymentAuthorization',
      requestStart
    );
    const requestMethod = service.slice(requestStart, approvalStart);
    expect(requestMethod).toContain('pendingPaymentMinorUnits');
    expect(requestMethod).toContain('PAYMENT_AMOUNT_EXCEEDS_AVAILABLE_BALANCE');
    expect(requestMethod).not.toContain("key: 'sourceAccount'");

    const paymentStart = service.indexOf(
      'public static async recordSupplierPayment'
    );
    const paymentMethod = service.slice(paymentStart);
    expect(paymentMethod).toContain("key: 'sourceAccount'");
    expect(paymentMethod).toContain("entityType: 'GL_ACCOUNT'");
    expect(paymentMethod).toContain('INVALID_PAYMENT_SETTLEMENT_DATE');
    expect(paymentMethod).toContain('sourceAccount.category');
    expect(paymentMethod).toContain('sourceAccount.normalBalance');
    expect(paymentMethod).toContain('sourceAccount.allowSupplierPayments');
    expect(paymentMethod).toContain('sourceAccount.currency');
  });

  test('SCM-4 financial control accounts are explicit and tenant-scoped for existing deployments', async () => {
    const coa = await source('lib/finance/double-entry.ts');
    const provisioner = await source(
      'scripts/ops/scm4-provision-financial-control-accounts.ts'
    );
    const pkg = await source('package.json');

    for (const code of ['1230', '1240', '2030', '6030']) {
      expect(coa).toContain(`accountCode: '${code}'`);
      expect(provisioner).toContain(`code: '${code}'`);
    }
    expect(provisioner).toContain('GHIMS_SCM4_PROVISION_TENANT');
    expect(provisioner).toContain('GHIMS_BOOTSTRAP_CONFIRM_PROJECT');
    expect(provisioner).toContain('GHIMS_ALLOW_PRODUCTION_SCM4_FINANCE_PROVISION');
    expect(provisioner).toContain('SCM4_COA_DUPLICATE_CODE');
    expect(provisioner).toContain('const writeBatch = db.batch()');
    expect(provisioner).toContain('await writeBatch.commit()');
    expect(provisioner).toContain("code: '1010'");
    expect(provisioner).toContain('allowSupplierPayments: true');
    expect(coa).toContain('allowSupplierPayments: true');
    expect(pkg).toContain('"ops:scm4:provision-finance"');
  });

  test('AP read models are finance-scoped, server-write-only, and excluded from generic offline hydration', async () => {
    const rules = await source('firestore.rules');
    const hydration = await source('lib/offline/hydration.ts');
    const adapter = await source(
      'lib/supply-chain/scm-payables-edge-adapter.ts'
    );

    for (const collection of [
      'scmSupplierInvoices',
      'scmSupplierInvoiceMatches',
      'scmPaymentAuthorizations',
      'scmSupplierPayments',
    ]) {
      const start = rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      const block = rules.slice(start, start + 180);
      expect(block).toContain('allow read: if canReadFinance(tenantId);');
      expect(block).toContain('allow write: if false;');
      expect(hydration).not.toContain(`'${collection}'`);
    }

    expect(adapter).not.toContain('offlineQueue');
    expect(adapter).toContain('executeActiveTenantCommand');
  });

  test('master command bus routes the complete receive-to-pay workflow', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');
    for (const command of [
      'RecordSupplierInvoiceCommand',
      'ResolveSupplierInvoiceMatchCommand',
      'RecognizeSupplierInvoicePayableCommand',
      'RequestSupplierPaymentAuthorizationCommand',
      'ApproveSupplierPaymentAuthorizationCommand',
      'RecordSupplierPaymentCommand',
    ]) {
      expect(bus).toContain(`case '${command}'`);
    }
  });
});
