import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('OPD-RP11 pharmacy alignment', () => {
  test('prescribe schema accepts formulary code but rejects client medication identity and price authority', async () => {
    const schema = await source('lib/backend/commands/command-schema-registry.ts');
    const start = schema.indexOf('PrescribeMedicationCommand');
    const end = schema.indexOf('AdvanceStageCommand', start);
    const block = schema.slice(start, end);

    expect(block).toContain('drugCode: nonEmpty');
    expect(block).not.toContain('drugName:');
    expect(block).not.toContain('unitPriceMinorUnits');
    expect(block).not.toContain('inventoryItemId');
  });

  test('prescribing resolves active medication identity from authoritative Item Master', async () => {
    const service = await source(
      'lib/backend/services/clinical-order-domain-service.ts'
    );

    expect(service).toContain("'items'");
    expect(service).toContain("'itemCode'");
    expect(service).toContain("'FORMULARY_MEDICATION_NOT_FOUND'");
    expect(service).toContain('authoritativeDrugName');
    expect(service).toContain('medicationItem.itemId');
  });

  test('dispense revalidates item price and FEFO stock server-side', async () => {
    const service = await source(
      'lib/backend/services/clinical-order-domain-service.ts'
    );

    expect(service).toContain("'PHARMACY_ITEM_AUTHORITY_MISMATCH'");
    expect(service).toContain("'PHARMACY_PRICE_NOT_CONFIGURED'");
    expect(service).toContain('medicationItem.sellingPrice');
    expect(service).toContain('eligibleBalances');
    expect(service).toContain("'FEFO_BATCH_MISMATCH'");
    expect(service).toContain('expectedServerVersion');
  });

  test('dispense atomically posts pharmacy charge invoice AR and revenue journal', async () => {
    const service = await source(
      'lib/backend/services/clinical-order-domain-service.ts'
    );

    expect(service).toContain("billingPurpose: 'OPD_PHARMACY'");
    expect(service).toContain("entityType: 'ENCOUNTER_CHARGE'");
    expect(service).toContain("entityType: 'INVOICE'");
    expect(service).toContain("entityType: 'AR_OPEN_ITEM'");
    expect(service).toContain("entityType: 'JOURNAL_ENTRY'");
    expect(service).toContain("'4030'");
    expect(service).toContain("'PHARMACY_REVENUE_ACCOUNT_INVALID'");
  });

  test('pharmacy invoice is hydrated and routed to cashier after dispensing', async () => {
    const model = await source('lib/opd/workspace-read-model.ts');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(model).toContain("purpose === 'OPD_PHARMACY'");
    expect(model).toContain('pharmacyInvoicesByEncounter');
    expect(workspace).toContain('openPharmacyInvoice');
    expect(workspace).toContain("'RecordCashReceiptCommand'");
    expect(workspace).toContain('pharmacyInvoices');
  });

  test('client cannot invent pharmacy price or pharmacist identity', async () => {
    const api = await source('app/api/pharmacy/formulary/route.ts');
    const ui = await source('components/opd/OpdPharmacyPrescriptions.tsx');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(api).not.toContain('sellingPrice: item.sellingPrice');
    expect(ui).not.toContain('selectedDrug.unitCost');
    expect(ui).not.toContain('pharmacistName');
    expect(workspace).not.toContain('dispensedByName:');
    expect(workspace).not.toContain('unitPriceMinorUnits: item.unitPriceMinorUnits');
  });

  test('financially relevant pharmacy commands fail closed offline until RP15', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');
    const prescribeStart = workspace.indexOf("'PrescribeMedicationCommand'");
    const dispenseStart = workspace.indexOf("'DispensePrescriptionCommand'");
    const prescribeBlock = workspace.slice(prescribeStart, prescribeStart + 1800);
    const dispenseBlock = workspace.slice(dispenseStart, dispenseStart + 1600);

    expect(prescribeBlock).not.toContain('offlineQueue');
    expect(dispenseBlock).not.toContain('offlineQueue');
  });
});
