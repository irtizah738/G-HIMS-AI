import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildOperationalAlerts,
  buildScmInputFingerprint,
  calculateOperationalMetrics,
} from '@/lib/supply-chain/scm-intelligence';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

describe('SCM-11 operational SCM intelligence',()=>{
  test('input fingerprint is deterministic',()=>{
    expect(buildScmInputFingerprint({b:2,a:1})).toBe(
      buildScmInputFingerprint({a:1,b:2})
    );
  });

  test('metrics are deterministic and exclude transfer-only movement from usage cost',()=>{
    const metrics=calculateOperationalMetrics({
      asOf:'2026-09-30T23:59:59.999Z',
      lookbackDays:30,
      expiryHorizonDays:90,
      balances:[
        {balanceId:'b1',itemId:'i1',batchId:'lot1',locationId:'loc',onHand:10,available:0,unitCost:2,lastMovementAt:'2026-09-29T00:00:00Z'} as any,
        {balanceId:'b2',itemId:'i2',batchId:'lot2',locationId:'loc',onHand:5,available:5,unitCost:4,lastMovementAt:'2026-01-01T00:00:00Z'} as any,
      ],
      batches:[
        {batchId:'lot1',expiryDate:'2026-10-15T00:00:00Z',quantityRemaining:10,unitCost:2} as any,
        {batchId:'lot2',expiryDate:'2027-10-15T00:00:00Z',quantityRemaining:5,unitCost:4} as any,
      ],
      transactions:[
        {transactionId:'t1',itemId:'i1',batchId:'lot1',fromLocationId:'loc',transactionType:'CONSUMPTION',quantity:2,normalizedQuantity:2,unitCost:2,occurredAt:'2026-09-20T00:00:00Z'} as any,
        {transactionId:'t2',itemId:'i2',batchId:'lot2',fromLocationId:'loc',toLocationId:'loc2',transactionType:'TRANSFER_OUT',quantity:1,normalizedQuantity:1,unitCost:4,occurredAt:'2026-09-21T00:00:00Z'} as any,
      ],
      purchaseOrders:[],
      goodsReceipts:[],
      matches:[],
      recalls:[],
      excursions:[],
      consignmentLots:[],
      consignmentUsages:[],
      custody:[],
    });
    expect(metrics.distinctStockedItems).toBe(2);
    expect(metrics.stockoutItemCount).toBe(1);
    expect(metrics.stockoutRatePercent).toBe(50);
    expect(metrics.endingInventoryValuationMinorUnits).toBe(4000);
    expect(metrics.expiryExposureMinorUnits).toBe(2000);
    expect(metrics.deadStockExposureMinorUnits).toBe(2000);
    expect(metrics.usageCostMinorUnits).toBe(400);
  });

  test('alerts are explainable threshold outputs',()=>{
    const alerts=buildOperationalAlerts({
      distinctStockedItems:10,
      stockoutItemCount:2,
      stockoutRatePercent:20,
      endingInventoryValuationMinorUnits:100000,
      expiryExposureMinorUnits:5000,
      deadStockExposureMinorUnits:0,
      usageCostMinorUnits:50000,
      annualizedInventoryTurns:6,
      supplierOtifPercent:70,
      deliveredPoCount:10,
      purchaseVarianceMinorUnits:1000,
      openRecallCount:1,
      unresolvedColdChainExcursionCount:1,
      consignmentAvailableMinorUnits:10000,
      consignmentPendingInvoiceMinorUnits:2000,
      controlledCustodyEventCount:5,
    });
    expect(alerts.some(a=>a.code==='STOCKOUT_EXPOSURE'&&a.severity==='CRITICAL')).toBe(true);
    expect(alerts.some(a=>a.code==='OPEN_RECALL'&&a.severity==='CRITICAL')).toBe(true);
    expect(alerts.every(a=>a.explanation.length>10)).toBe(true);
  });

  test('snapshot service is facility-scoped, currency-strict and immutable',async()=>{
    const service=await source('lib/backend/services/scm-intelligence-domain-service.ts');
    expect(service).toContain('FACILITY_SCOPE_MISMATCH');
    expect(service).toContain('SCM_INTELLIGENCE_CURRENCY_MISMATCH');
    expect(service).toContain('buildScmInputFingerprint');
    expect(service).toContain('SCM_OPERATIONAL_INTELLIGENCE_SNAPSHOT_GENERATED');
    expect(service).toContain("aggregateType:'SCM_INTELLIGENCE_SNAPSHOT'");
  });

  test('SCM-11 never mutates stock, procurement, supplier or finance source state',async()=>{
    const service=await source('lib/backend/services/scm-intelligence-domain-service.ts');
    expect(service).not.toContain("entityType:'INVENTORY_BALANCE'");
    expect(service).not.toContain("entityType:'STOCK_TRANSACTION'");
    expect(service).not.toContain("entityType:'PURCHASE_ORDER'");
    expect(service).not.toContain("entityType:'JOURNAL_ENTRY'");
  });

  test('snapshot command is routed, read-only to clients and hydratable offline',async()=>{
    const bus=await source('lib/backend/commands/command-bus.ts');
    const rules=await source('firestore.rules');
    const hydration=await source('lib/offline/hydration.ts');
    expect(bus).toContain("case 'GenerateScmIntelligenceSnapshotCommand'");
    const start=rules.indexOf('match /scmOperationalSnapshots/{id}');
    expect(start).toBeGreaterThan(-1);
    expect(rules.slice(start,start+220)).toContain('allow write: if false;');
    expect(hydration).toContain("'scmOperationalSnapshots'");
  });

  test('SCM-11 adapter is online-only generation over offline-consumable projection',async()=>{
    const adapter=await source('lib/supply-chain/scm-intelligence-edge-adapter.ts');
    expect(adapter).toContain('executeActiveTenantCommand');
    expect(adapter).not.toContain('offlineQueue');
  });
});
