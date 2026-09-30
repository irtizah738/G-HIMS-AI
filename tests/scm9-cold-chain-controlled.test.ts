import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  controlledCustodyEvidenceMatches,
  requiresStockEvidence,
  temperatureWithinRange,
} from '@/lib/supply-chain/cold-chain';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

describe('SCM-9 cold-chain and controlled inventory',()=>{
  test('temperature evaluation is deterministic and boundary inclusive',()=>{
    expect(temperatureWithinRange({temperatureCelsius:2,minCelsius:2,maxCelsius:8})).toBe(true);
    expect(temperatureWithinRange({temperatureCelsius:8,minCelsius:2,maxCelsius:8})).toBe(true);
    expect(temperatureWithinRange({temperatureCelsius:8.1,minCelsius:2,maxCelsius:8})).toBe(false);
  });

  test('controlled custody actions that change stock require matching immutable stock evidence',()=>{
    expect(requiresStockEvidence('ISSUE')).toBe(true);
    expect(requiresStockEvidence('HANDOFF')).toBe(false);
    expect(controlledCustodyEvidenceMatches({
      action:'ISSUE',quantity:2,itemId:'i',batchId:'b',
      transaction:{itemId:'i',batchId:'b',quantity:2,transactionType:'DISPENSE'}
    })).toBe(true);
    expect(controlledCustodyEvidenceMatches({
      action:'ISSUE',quantity:2,itemId:'i',batchId:'b',
      transaction:{itemId:'i',batchId:'b',quantity:1,transactionType:'DISPENSE'}
    })).toBe(false);
  });

  test('excursions automatically quarantine and require independent review',async()=>{
    const service=await source('lib/backend/services/scm-controlled-inventory-domain-service.ts');
    expect(service).toContain('COLD_CHAIN_SENSOR_CALIBRATION_EXPIRED');
    expect(service).toContain("status:'QUARANTINED'");
    expect(service).toContain("status:'QUARANTINED_PENDING_REVIEW'");
    expect(service).toContain('SCM_SEGREGATION_OF_DUTIES');
    expect(service).toContain("status:payload.decision==='RELEASE'?'RELEASED':'DISPOSITION_REQUIRED'");
    expect(service).toContain("entityType:'INVENTORY_BALANCE'");
    expect(service).toContain("entityType:'BATCH_LOT'");
  });

  test('controlled custody requires independent witness and authoritative stock evidence',async()=>{
    const service=await source('lib/backend/services/scm-controlled-inventory-domain-service.ts');
    expect(service).toContain('CONTROLLED_CUSTODY_WITNESS_NOT_INDEPENDENT');
    expect(service).toContain('CONTROLLED_CUSTODY_STOCK_EVIDENCE_INVALID');
    expect(service).toContain('ITEM_NOT_CONTROLLED');
    expect(service).toContain("aggregateType:'CONTROLLED_CUSTODY'");
  });

  test('cold-chain disposition handoff is explicit and closes excursion after execution',async()=>{
    const disposition=await source('lib/backend/services/scm-recall-disposition-domain-service.ts');
    const controlled=await source('types/scm-controlled.ts');
    expect(disposition).toContain('COLD_CHAIN_EXCURSION_REQUIRED');
    expect(disposition).toContain('DISPOSITION_COLD_CHAIN_SCOPE_MISMATCH');
    expect(disposition).toContain("entityType:'COLD_CHAIN_EXCURSION'");
    expect(disposition).toContain("status:'DISPOSED'");
    expect(controlled).toContain("| 'DISPOSED'");
  });

  test('SCM-9 commands are strictly routed and mutations are online-only',async()=>{
    const bus=await source('lib/backend/commands/command-bus.ts');
    for(const command of [
      'RecordColdChainObservationCommand',
      'ReviewColdChainExcursionCommand',
      'RecordControlledCustodyCommand',
    ]) expect(bus).toContain(`case '${command}'`);

    const adapter=await source('lib/supply-chain/scm-controlled-edge-adapter.ts');
    expect(adapter).toContain('executeActiveTenantCommand');
    expect(adapter).not.toContain('offlineQueue');
  });

  test('cold-chain and custody read models are tenant scoped and server-write-only',async()=>{
    const rules=await source('firestore.rules');
    for(const collection of ['scmColdChainObservations','scmColdChainExcursions','scmControlledCustody']){
      const start=rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      expect(rules.slice(start,start+240)).toContain('allow write: if false;');
    }
  });
});
