import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildBillingInvoiceReadModel } from '@/lib/billing/authoritative-read-model';
import type { EdgeSnapshot } from '@/lib/offline/hydration';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('OPD-RP22 obsolete and demo authority removal', () => {
  test('obsolete client billing mutation engines are deleted', () => {
    expect(
      existsSync(path.join(process.cwd(), 'lib/billing/charges.ts'))
    ).toBe(false);
    expect(
      existsSync(
        path.join(process.cwd(), 'lib/firebase/services/billing.ts')
      )
    ).toBe(false);
  });

  test('authoritative billing adapter excludes malformed and cross-tenant rows', () => {
    const validInvoice = {
      id: 'inv-rp22',
      tenantId: 'tenant-rp22',
      invoiceNumber: 'INV-RP22',
      patientId: 'patient-rp22',
      patientName: 'Synthetic RP22 Patient',
      mrn: 'MRN-RP22',
      encounterId: 'enc-rp22',
      tariffId: 'tariff-standard-cash',
      tariffName: 'Standard cash',
      planName: 'cash',
      totalGross: 100,
      totalDiscount: 0,
      totalTax: 0,
      totalCoverage: 0,
      totalPatientDue: 100,
      totalPaid: 0,
      balanceDue: 100,
      paymentStatus: 'pending',
      paymentMethod: 'cash',
      currency: 'PKR',
      billingPurpose: 'OPD_CONSULTATION',
      items: [
        {
          id: 'charge-rp22',
          entitySource: 'consultation',
          code: 'OPD-RP22',
          description: 'Synthetic RP22 consultation',
          quantity: 1,
          unitPrice: 100,
          grossAmount: 100,
          discountAmount: 0,
          tax: 0,
          netAmount: 100,
          insurancePortion: 0,
          patientPortion: 100,
          timestamp: '2026-10-06T00:00:00.000Z',
          status: 'billed',
        },
      ],
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
    };

    const snapshot: EdgeSnapshot = {
      tenantId: 'tenant-rp22',
      generatedAt: 1,
      snapshotVersion: 'rp22',
      source: 'SERVER',
      collections: {
        invoices: [
          validInvoice,
          { ...validInvoice, id: 'cross-tenant', tenantId: 'other-tenant' },
          { ...validInvoice, id: 'malformed', currency: '' },
          {
            ...validInvoice,
            id: 'monetary-mismatch',
            totalPaid: 25,
            balanceDue: 100,
          },
        ],
      },
    };

    const model = buildBillingInvoiceReadModel(snapshot);

    expect(model.invoices).toHaveLength(1);
    expect(model.invoices[0]?.id).toBe('inv-rp22');
    expect(model.invoices[0]?.currency).toBe('PKR');
    expect(model.invoices[0]?.billingPurpose).toBe('OPD_CONSULTATION');
    expect(model.rejectedRows).toBe(3);

    const waivedSnapshot: EdgeSnapshot = {
      ...snapshot,
      collections: {
        invoices: [
          {
            ...validInvoice,
            id: 'waived-rp22',
            paymentStatus: 'waived',
            totalPaid: 0,
            balanceDue: 0,
          },
        ],
      },
    };
    const waivedModel = buildBillingInvoiceReadModel(waivedSnapshot);
    expect(waivedModel.invoices).toHaveLength(1);
    expect(waivedModel.invoices[0]?.paymentStatus).toBe('waived');
  });

  test('invoice directory has no synthetic initial financial records', async () => {
    const page = await source('app/[tenantId]/billing/invoices/page.tsx');

    expect(page).toContain('hydrateEdgeSnapshot(tenantId)');
    expect(page).toContain('buildBillingInvoiceReadModel(snapshot)');
    expect(page).not.toContain("inv-enc-8092-441");
    expect(page).not.toContain("Robert Martinez");
    expect(page).not.toContain('useState<Invoice[]>([');
    expect(page).not.toContain('Create New Invoice');
    expect(page).toContain('outstandingByCurrency');
    expect(page).toContain('formatAuthoritativeMoney');
    expect(page).not.toContain('formatCurrency(invoice.balanceDue)');
  });

  test('invoice detail mutates only through governed cash receipt authority', async () => {
    const page = await source(
      'app/[tenantId]/billing/invoices/[invoiceId]/page.tsx'
    );

    expect(page).toContain("'RecordCashReceiptCommand'");
    expect(page).toContain('hydrateEdgeSnapshot(tenantId)');
    expect(page).not.toContain('calculateLineItem');
    expect(page).not.toContain('handleAddNewItem');
    expect(page).not.toContain("setInvoice((prev)");
    expect(page).not.toContain("paymentMethod === 'card'");
    expect(page).not.toContain('POS Copay Collection Terminal');
    expect(page).not.toContain('InvoicePosTerminalPage');
    expect(page).not.toContain('billing-pos-cash:');
    expect(page).toContain('InvoiceCashCollectionPage');
    expect(page).toContain('billing-cash-receipt:');
    expect(page).not.toContain("CASH-${new Date().toISOString()");
    expect(page).toContain("referenceNumber.trim()");
  });

  test('unsupported tariffs and insurance claims fail closed instead of simulating authority', async () => {
    const [tariffs, claims] = await Promise.all([
      source('app/[tenantId]/billing/tariffs/page.tsx'),
      source('app/[tenantId]/billing/claims/page.tsx'),
    ]);

    expect(tariffs).toContain('Fail-closed production boundary');
    expect(tariffs).toContain('Browser-side tariff creation');
    expect(tariffs).not.toContain('setTariffs');
    expect(tariffs).not.toContain('handleCreateTariff');
    expect(tariffs).not.toContain('BlueCross');

    expect(claims).toContain('Insurance Claims / EDI Is Not Enabled');
    expect(claims).toContain('No synthetic claims, EDI payloads');
    expect(claims).not.toContain('setClaims');
    expect(claims).not.toContain('handleSimulateSubmit');
    expect(claims).not.toContain('edi837Payload');
  });

  test('billing dashboard is a tenant-scoped non-authoritative launcher', async () => {
    const view = await source('components/views/billing-erp-view.tsx');

    expect(view).toContain('useAuth');
    expect(view).toContain("activeTenant?.tenantId || user?.tenantId || ''");
    expect(view).not.toContain('useTenant');
    expect(view).toContain('Authoritative invoices');
    expect(view).toContain('Financial authority remains in governed');
    expect(view).toContain('Production tariff mutation remains fail-closed');
    expect(view).toContain('Claims and clearinghouse workflows remain disabled');

    expect(view).not.toContain('Metropolitan Memorial Health System');
    expect(view).not.toContain('central-metro-hospital');
    expect(view).not.toContain('Performance-Share Financial Model');
    expect(view).not.toContain('80% clinical documentation');
    expect(view).not.toContain('estimatedRecoverableRevenue');
    expect(view).not.toContain('reconcileMismatch');
    expect(view).not.toContain('dismissMismatch');
  });

  test('Firestore remains server-write-only for billing authority collections', async () => {
    const rules = await source('firestore.rules');

    expect(rules).toContain('match /invoices/{id}');
    expect(rules).toContain('match /claims/{id}');
    expect(rules).toContain('match /encounterCharges/{id}');
    expect(rules).toContain('match /arOpenItems/{id}');

    const invoiceBlock = rules.slice(
      rules.indexOf('match /invoices/{id}'),
      rules.indexOf('match /claims/{id}')
    );
    expect(invoiceBlock).toContain('allow write: if false');

    const claimsStart = rules.indexOf('match /claims/{id}');
    expect(rules.slice(claimsStart, claimsStart + 180)).toContain(
      'allow write: if false'
    );
  });

  test('remaining OPD sample state is DEMO-gated and production initializes empty', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(workspace).toContain(
      "const IS_DEMO_RUNTIME = process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO'"
    );
    expect(workspace).toContain(
      'useState<PatientDemographics[]>(() => IS_DEMO_RUNTIME ? SEED_PATIENTS : [])'
    );
    expect(workspace).toContain(
      'useState<ComprehensiveOpdEncounter[]>(() => IS_DEMO_RUNTIME ? SEED_ENCOUNTERS : [])'
    );
    expect(workspace).toContain(
      'if (!IS_DEMO_RUNTIME) return;'
    );
  });
});
