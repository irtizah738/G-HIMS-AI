import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DiagnosticRevenueGuard } from '@/lib/clinical/diagnostic-lock/revenue-guard';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('OPD-RP10 diagnostic payment gate', () => {
  test('diagnostic order schema rejects client pricing authority and governs STAT override', async () => {
    const schema = await source(
      'lib/backend/commands/command-schema-registry.ts'
    );

    const start = schema.indexOf('PlaceDiagnosticOrderCommand');
    const end = schema.indexOf('AdvanceDiagnosticWorklistCommand', start);
    const block = schema.slice(start, end);

    expect(block).toContain("catalogCode: nonEmpty");
    expect(block).toContain("priority: z.enum(['STAT','URGENT','ROUTINE'])");
    expect(block).toContain('statOverrideReason');
    expect(block).not.toContain('estimatedCostMinorUnits');
    expect(block).not.toContain('orderName:');
  });

  test('order placement creates server-priced invoice AR deferred revenue and payment lock', async () => {
    const service = await source(
      'lib/backend/services/clinical-order-domain-service.ts'
    );

    expect(service).toContain("'billingServiceCatalog'");
    expect(service).toContain("billingPurpose: 'OPD_DIAGNOSTIC'");
    expect(service).toContain("entityType: 'AR_OPEN_ITEM'");
    expect(service).toContain("entityType: 'ENCOUNTER_CHARGE'");
    expect(service).toContain("entityType: 'JOURNAL_ENTRY'");
    expect(service).toContain("'PENDING_PAYMENT_CLEARANCE'");
    expect(service).toContain("'BLOCKED_BY_REVENUE_GATE'");
    expect(service).toContain("'UNLOCKED_STAT_OVERRIDE'");
    expect(service).toContain('STAT_OVERRIDE_REASON_REQUIRED');
    expect(service).not.toContain('estimatedCostMinorUnits');
  });

  test('cash settlement alone releases routine diagnostic worklist', async () => {
    const cash = await source(
      'lib/backend/services/cash-receipt-domain-service.ts'
    );

    expect(cash).toContain("'OPD_DIAGNOSTIC'");
    expect(cash).toContain("'DIAGNOSTIC_ORDER'");
    expect(cash).toContain("'DIAGNOSTIC_PAYMENT_SCOPE_MISMATCH'");
    expect(cash).toContain("revenueLockStatus: 'PAID_SETTLED'");
    expect(cash).toContain("'BLOCKED_BY_REVENUE_GATE'");
    expect(cash).toContain("'READY_FOR_EXECUTION'");
    expect(cash).toContain('newBalanceMinorUnits === 0');
  });

  test('worklist transitions fail closed while payment remains locked', async () => {
    const service = await source(
      'lib/backend/services/clinical-order-domain-service.ts'
    );
    const bus = await source('lib/backend/commands/command-bus.ts');

    expect(service).toContain('advanceDiagnosticWorklist');
    expect(service).toContain("'DIAGNOSTIC_PAYMENT_REQUIRED'");
    expect(service).toContain("'SPECIMEN_COLLECTED'");
    expect(service).toContain("'IN_PROCESSING'");
    expect(service).toContain("'INVALID_DIAGNOSTIC_WORKLIST_TRANSITION'");
    expect(bus).toContain("case 'AdvanceDiagnosticWorklistCommand'");
  });

  test('result recording cannot bypass payment and recognizes completed service once', async () => {
    const service = await source(
      'lib/backend/services/diagnostic-result-domain-service.ts'
    );

    expect(service).toContain("'DIAGNOSTIC_PAYMENT_REQUIRED'");
    expect(service).toContain('allowedResultWorklistStates');
    expect(service).toContain("'IN_PROCESSING'");
    expect(service).toContain("'REVENUE_RECOGNITION'");
    expect(service).toContain('expectedServerVersion');
    expect(service).toContain('revenueRecognizedAt');
    expect(service).toContain('postFinalRevision');
    expect(service).toContain("['AMENDED', 'CORRECTED']");
    expect(service).toContain('Trusted LIS/RIS result ingestion');
  });

  test('legacy client unlock helper fails closed', () => {
    expect(() => DiagnosticRevenueGuard.unlockOrderAfterPayment()).toThrow(
      'SERVER_PAYMENT_AUTHORITY_REQUIRED'
    );
  });

  test('OPD UI no longer manufactures diagnostic prices barcodes consent or results', async () => {
    const ui = await source('components/opd/OpdDiagnosticOrdersPacs.tsx');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(ui).not.toContain('price: 1200');
    expect(ui).not.toContain('item.price');
    expect(ui).not.toContain('consentVerified: true');
    expect(ui).not.toContain('SPEC-${encounter.mrn');
    expect(ui).not.toContain('Findings: Normal sinus rhythm');
    expect(ui).not.toContain('onUpdateOrderStatus');
    expect(ui).toContain('onAdvanceOrderWorklist');
    expect(ui).toContain('IS_DEMO_RUNTIME && activeDicomViewerOrder');

    expect(workspace).not.toContain('estimatedCostMinorUnits:');
    expect(workspace).toContain("'AdvanceDiagnosticWorklistCommand'");
    expect(workspace).toContain('activeBillingInvoice');
    expect(workspace).toContain("'RecordCashReceiptCommand'");
    expect(workspace).not.toContain("offlineQueue: {\n          enabled: true,\n          collection: 'orders'");
  });

  test('hydration reconstructs diagnostic order and invoice authority for role handoffs', async () => {
    const model = await source('lib/opd/workspace-read-model.ts');
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');

    expect(model).toContain("purpose === 'OPD_DIAGNOSTIC'");
    expect(model).toContain('diagnosticInvoicesByEncounter');
    expect(model).toContain('adaptDiagnosticOrder');
    expect(model).toContain('billingInvoiceId');
    expect(model).toContain('revenueLockStatus');

    expect(bootstrap).toContain("'CASHIER'");
    expect(bootstrap).toContain("'FINANCE_MANAGER'");
    expect(bootstrap).toContain('billingEncounterIds');
    expect(bootstrap).toContain('billingOnlyRole');
    expect(bootstrap).toContain('collections.invoices');
    expect(bootstrap).toContain('scoped.journalEntries');
    expect(bootstrap).toContain('allowedReferences');
    expect(bootstrap).toContain('isFullFinanceRole');
  });

  test('billing UI does not invent journal account postings', async () => {
    const billing = await source('components/opd/OpdBillingLedger.tsx');

    expect(billing).toContain('Server-owned double-entry posting');
    expect(billing).not.toContain('1001 Cash on Hand');
    expect(billing).not.toContain('4001 OPD Consultation & Diagnostic Revenue');
    expect(billing).toContain("glJournalEntryId: ''");
  });
});
