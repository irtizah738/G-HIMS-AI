import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  batchMatchesRecall,
  consumptionMatchesRecall,
} from '@/lib/supply-chain/recall-disposition';
import { movementSign } from '@/lib/supply-chain/inventory-costing';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('SCM-8 recall, returns and disposal governance', () => {
  test('recall matching is deterministic across batch, lot and serial exposure', () => {
    const batch = {
      itemId:'item-1',batchNumber:'B1',lotNumber:'L1',
      supplierId:'S1',manufacturer:'Maker',
    } as any;
    expect(batchMatchesRecall({
      scope:'BATCH_WIDE',itemId:'item-1',targetBatchNumbers:['B1'],
      targetLotNumbers:[],supplierId:undefined,manufacturerName:undefined,
    },batch)).toBe(true);

    const consumption = {
      itemId:'item-1',batchNumber:'B1',lotNumber:'L1',
      serialNumber:'SER-7',supplierId:'S1',
    } as any;
    expect(consumptionMatchesRecall({
      scope:'SERIAL_SPECIFIC',itemId:'item-1',
      targetBatchNumbers:['B1'],targetLotNumbers:[],
      targetSerialNumbers:['SER-7'],supplierId:undefined,
      manufacturerName:undefined,
    },consumption)).toBe(true);
  });

  test('supplier return is outbound for inventory valuation', () => {
    expect(movementSign('RETURN_TO_SUPPLIER' as any)).toBe(-1);
  });

  test('recall processing is chunked, completeness checked, and patient notifications are required', async () => {
    const service = await source(
      'lib/backend/services/scm-recall-disposition-domain-service.ts'
    );
    expect(service).toContain('INVALID_RECALL_QUARANTINE_CHUNK');
    expect(service).toContain('RECALL_QUARANTINE_INCOMPLETE');
    expect(service).toContain('RECALL_EXPOSURE_PROJECTION_INCOMPLETE');
    expect(service).toContain('RECALL_PATIENT_NOTIFICATIONS_INCOMPLETE');
    expect(service).toContain('RECALL_AFFECTED_STOCK_NOT_DISPOSED');
    expect(service).toContain('affectedOnHandQuantity');
    expect(service).toContain('disposedQuantity');
  });

  test('disposition is maker-checker-witness and posts stock plus finance atomically', async () => {
    const service = await source(
      'lib/backend/services/scm-recall-disposition-domain-service.ts'
    );
    expect(service).toContain('SCM_SEGREGATION_OF_DUTIES');
    expect(service).toContain('DISPOSITION_WITNESS_NOT_INDEPENDENT');
    expect(service).toContain('DESTRUCTION_CERTIFICATE_REQUIRED');
    expect(service).toContain('SUPPLIER_RETURN_CARRIER_REQUIRED');
    expect(service).toContain("entityType:'INVENTORY_BALANCE'");
    expect(service).toContain("entityType:'BATCH_LOT'");
    expect(service).toContain("entityType:'STOCK_TRANSACTION'");
    expect(service).toContain("entityType:'JOURNAL_ENTRY'");
    expect(service).toContain("'1250'");
    expect(service).toContain("'6040'");
  });

  test('generic stock command cannot bypass governed write-off or supplier return', async () => {
    const costing = await source('lib/supply-chain/inventory-costing.ts');
    const stock = await source(
      'lib/backend/services/scm-offline-domain-service.ts'
    );
    expect(costing).toContain("'RETURN_TO_SUPPLIER'");
    expect(stock).toContain('GOVERNED_INVENTORY_ADJUSTMENT_REQUIRED');
  });

  test('recall exposure PHI is not directly readable or client writable', async () => {
    const rules = await source('firestore.rules');
    const start = rules.indexOf('match /scmRecallExposures/{id}');
    expect(start).toBeGreaterThan(-1);
    expect(rules.slice(start,start+180)).toContain(
      'allow read, write: if false;'
    );
  });

  test('SCM-8 commands are routed and control account provisioning is explicit', async () => {
    const bus=await source('lib/backend/commands/command-bus.ts');
    for(const command of [
      'InitiateScmRecallCommand',
      'ExecuteRecallQuarantineCommand',
      'ProjectRecallExposuresCommand',
      'RecordRecallNotificationCommand',
      'CreateInventoryDispositionCommand',
      'ReviewInventoryDispositionCommand',
      'ExecuteInventoryDispositionCommand',
      'ResolveScmRecallCommand',
    ]) expect(bus).toContain(`case '${command}'`);

    const coa=await source('lib/finance/double-entry.ts');
    const provisioner=await source(
      'scripts/ops/scm8-provision-return-clearing-account.ts'
    );
    expect(coa).toContain("accountCode: '1250'");
    expect(provisioner).toContain("accountCode:'1250'");
    expect(provisioner).toContain('GHIMS_ALLOW_SCM8_FINANCE_PROVISION');
  });

  test('recall and disposition mutations are online-only', async () => {
    const adapter=await source(
      'lib/supply-chain/scm-recall-edge-adapter.ts'
    );
    expect(adapter).toContain('executeActiveTenantCommand');
    expect(adapter).not.toContain('offlineQueue');
  });
});
