import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

describe('ORC-5 cash receipt retry and encounter context', () => {
  test('cashier reuses receipt intent on network ambiguity', async () => {
    const invoice = await source('app/[tenantId]/billing/invoices/[invoiceId]/page.tsx');
    expect(invoice).toContain('receiptAttempt.current = attempt');
    expect(invoice).toContain('const receiptId = attempt.receiptId');
    expect(invoice).toContain('idempotencyKey: `billing-cash-receipt:${receiptId}`');
    expect(invoice).toContain('CASH_RECEIPT_UNCONFIRMED');
    expect(invoice).toContain('receiptAttempt.current = null');
    expect(invoice).toContain("snapshotSource !== 'SERVER'");
  });
  test('MPI opens cashier in current encounter context', async () => {
    const mpi = await source('components/views/patient-mpi-view.tsx');
    const invoices = await source('app/[tenantId]/billing/invoices/page.tsx');
    expect(mpi).toContain('encounterId=${encodeURIComponent(activeEncounter.id)}');
    expect(invoices).toContain("new URLSearchParams(window.location.search).get('encounterId')");
  });
  test('receipt posting and final reconciliation remain separate authoritative commands', async () => {
    const cashier = await source('app/[tenantId]/billing/invoices/[invoiceId]/page.tsx');
    const opd = await source('components/opd/OpdMasterWorkspace.tsx');
    const reconciler = await source('lib/backend/services/opd-billing-reconciliation-domain-service.ts');
    expect(cashier).toContain("'RecordCashReceiptCommand'");
    expect(opd).toContain("'ReconcileOpdBillingCommand'");
    expect(reconciler).toContain('OPD_BILLING_SNAPSHOT_CHANGED');
    expect(reconciler).toContain("'OPD_FINAL_BILLING_RECONCILED'");
  });
});
