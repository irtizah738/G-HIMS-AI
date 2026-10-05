import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('OPD-RP12 final billing reconciliation', () => {
  test('reconciliation is a server command, not a client aggregate invoice generator', async () => {
    const schema = await source('lib/backend/commands/command-schema-registry.ts');
    const bus = await source('lib/backend/commands/command-bus.ts');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(schema).toContain('ReconcileOpdBillingCommand');
    expect(bus).toContain('OpdBillingReconciliationDomainService.reconcile');
    expect(workspace).toContain(
      'production OPD closes through authoritative final billing reconciliation'
    );
    expect(workspace).toContain(
      'return IS_DEMO_RUNTIME ? activeEncounter.invoice : undefined'
    );
  });

  test('final reconciliation rejects open invoices, AR, orphan charges and legacy final invoices', async () => {
    const service = await source(
      'lib/backend/services/opd-billing-reconciliation-domain-service.ts'
    );

    expect(service).toContain("'OPD_OUTSTANDING_INVOICE'");
    expect(service).toContain("'OPD_AR_NOT_SETTLED'");
    expect(service).toContain("'OPD_CHARGE_INVOICE_CARDINALITY_INVALID'");
    expect(service).toContain("'OPD_INVOICE_CHARGE_ORPHANED'");
    expect(service).toContain("'LEGACY_FINAL_INVOICE_AUTHORITY_PRESENT'");
    expect(service).toContain("'OPD_MULTI_CURRENCY_RECONCILIATION_BLOCKED'");
    expect(service).toContain("'OPD_BILLING_JOURNAL_CARDINALITY_INVALID'");
    expect(service).toContain("'OPD_BILLING_JOURNAL_INVALID'");
    expect(service).toContain("'OPD_RECONCILIATION_TOO_LARGE'");
    expect(service).toContain("'OPD_REVENUE_INTEGRITY_PENDING_REVIEW'");
    expect(service).toContain("'OPD_REVENUE_INTEGRITY_CHARGE_MISSING'");
  });

  test('reconciliation validates service completion behind diagnostic and pharmacy invoices', async () => {
    const service = await source(
      'lib/backend/services/opd-billing-reconciliation-domain-service.ts'
    );

    expect(service).toContain("'OPD_DIAGNOSTIC_NOT_FINALIZED'");
    expect(service).toContain("String(order.worklistStatus || '') !== 'FINALIZED'");
    expect(service).toContain('revenueRecognizedAt');
    expect(service).toContain("'OPD_PHARMACY_NOT_DISPENSED'");
    expect(service).toContain("String(prescription.status || '') !== 'DISPENSED'");
  });

  test('signed-note Revenue Integrity candidates participate in billing mutation sequencing', async () => {
    const documentation = await source(
      'lib/backend/services/clinical-documentation-domain-service.ts'
    );

    expect(documentation).toContain(
      'revenueIntegrityFindings.length > 0 && billingEncounter'
    );
    expect(documentation).toContain(
      'Number(billingEncounter.billingMutationSequence || 0) + 1'
    );
    expect(documentation).toContain(
      'A signed note may not introduce new billing candidates after final OPD billing reconciliation.'
    );
  });

  test('billing mutation sequencing prevents phantom late charges during reconciliation', async () => {
    const service = await source(
      'lib/backend/services/opd-billing-reconciliation-domain-service.ts'
    );
    const billing = await source(
      'lib/backend/services/opd-billing-domain-service.ts'
    );
    const clinical = await source(
      'lib/backend/services/clinical-order-domain-service.ts'
    );

    expect(service).toContain('billingMutationSequence');
    expect(service).toContain("'OPD_BILLING_CHANGED_DURING_RECONCILIATION'");
    expect(service).toContain("'OPD_BILLING_SNAPSHOT_CHANGED'");
    expect(billing).toContain(
      'Number(currentEncounter.billingMutationSequence || 0) + 1'
    );
    expect(clinical).toContain(
      'Number(currentEncounter.billingMutationSequence || 0) + 1'
    );
    expect(clinical).toContain(
      'Number(encounter.billingMutationSequence || 0) + 1'
    );
  });

  test('Revenue Integrity charge acceptance participates in the OPD billing sequence', async () => {
    const revenue = await source(
      'lib/backend/services/revenue-integrity-domain-service.ts'
    );

    expect(revenue).toContain("'OPD_BILLING_ALREADY_RECONCILED'");
    expect(revenue).toContain('billingMutationSequence');
    expect(revenue).toContain(
      'Number(encounter.billingMutationSequence || 0) + 1'
    );
    expect(revenue).toContain("entityType: 'ENCOUNTER'");
    expect(revenue).toContain('expectedServerVersion');
    expect(revenue).toContain('chargeId,');
  });

  test('reconciled encounters are frozen against new billable OPD state', async () => {
    const billing = await source(
      'lib/backend/services/opd-billing-domain-service.ts'
    );
    const clinical = await source(
      'lib/backend/services/clinical-order-domain-service.ts'
    );

    expect(billing).toContain("'OPD_BILLING_ALREADY_RECONCILED'");
    expect(clinical).toContain(
      'No new diagnostic billing may be created after final billing reconciliation.'
    );
    expect(clinical).toContain(
      'Medication cannot be dispensed after final OPD billing reconciliation.'
    );
    expect(clinical).toContain(
      'New prescriptions cannot be created after final OPD billing reconciliation.'
    );
  });

  test('billing roles are least-scoped to billing workflow edges', async () => {
    const encounter = await source(
      'lib/backend/services/encounter-domain-service.ts'
    );

    expect(encounter).toContain("'BILLING_STAGE_AUTHORITY_SCOPE_VIOLATION'");
    expect(encounter).toContain("persistedOpdStage !== 'BILLING_SETTLEMENT'");
    expect(encounter).toContain("targetOpdStage !== 'BILLING_SETTLEMENT'");
    expect(encounter).toContain('currentStage: targetWorkflowStage');
    expect(encounter).toContain('clinicalState: targetClinicalState');
  });

  test('billing to disposition requires authoritative cleared reconciliation evidence', async () => {
    const runtime = await source(
      'lib/backend/services/opd-workflow-runtime-service.ts'
    );
    const encounter = await source(
      'lib/backend/services/encounter-domain-service.ts'
    );

    expect(runtime).toContain("'opdBillingReconciliations'");
    expect(runtime).toContain("'OPD_BILLING_RECONCILIATION_NOT_FOUND'");
    expect(runtime).toContain("'OPD_BILLING_RECONCILIATION_INVALID'");
    expect(encounter).toContain("'OPD_FINAL_BILLING_RECONCILIATION_REQUIRED'");
    expect(runtime).toContain("'OPD_BILLING_RECONCILIATION_STALE'");
    expect(runtime).toContain('billingMutationSequence');
  });

  test('OPD hydration preserves workflow currentStage over canonical clinicalState', async () => {
    const model = await source('lib/opd/workspace-read-model.ts');

    expect(model).toContain(
      "encounter.currentStage ||\n            encounter.currentStageId ||\n            encounter.clinicalState"
    );
  });

  test('pharmacy invoice cash settlement is first class and final reconciliation follows it', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(workspace).toContain('const pharmacyInvoice =');
    expect(workspace).toContain('opd-pharmacy-cash-receipt:');
    expect(workspace).toContain("'ReconcileOpdBillingCommand'");
    expect(workspace).toContain('Reconcile & unlock disposition');
  });

  test('reconciliation persistence is immutable and mapped as server domain state', async () => {
    const service = await source(
      'lib/backend/services/opd-billing-reconciliation-domain-service.ts'
    );
    const tx = await source('lib/backend/transactions/transaction-manager.ts');
    const type = await source('types/opd-billing-reconciliation.ts');

    expect(tx).toContain(
      "OPD_BILLING_RECONCILIATION: 'opdBillingReconciliations'"
    );
    expect(service).toContain("aggregateType: 'OPD_BILLING_RECONCILIATION'");
    expect(service).toContain('snapshotFingerprint');
    expect(service).toContain("'OPD_BILLING_ALREADY_RECONCILED'");
    expect(type).toContain("status: OpdBillingReconciliationStatus");
    expect(type).toContain('billingMutationSequence: number');
    expect(type).toContain('revenueIntegrityFindingIds: string[]');
    expect(type).toContain("schemaVersion: 1");
  });
});
