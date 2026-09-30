import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  consignmentUsageCostMinorUnits,
  validateHighValueIdentity,
} from '@/lib/supply-chain/consignment';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

describe('SCM-10 consignment and high-value inventory',()=>{
  test('serialized high-value identity rules are strict',()=>{
    expect(()=>validateHighValueIdentity({
      quantity:2,requiresSerial:true,requiresUdi:true,
      serialNumbers:['S1','S2'],udis:['U1','U2']
    })).not.toThrow();
    expect(()=>validateHighValueIdentity({
      quantity:2,requiresSerial:true,requiresUdi:false,
      serialNumbers:['S1'],udis:[]
    })).toThrow('HIGH_VALUE_SERIAL_COUNT_MISMATCH');
    expect(consignmentUsageCostMinorUnits(2,125000)).toBe(250000);
  });

  test('vendor-owned receipt remains off hospital inventory assets',async()=>{
    const service=await source('lib/backend/services/scm-consignment-domain-service.ts');
    const receiveStart=service.indexOf('public static async receiveStock');
    const usageStart=service.indexOf('public static async recordUsage');
    const receive=service.slice(receiveStart,usageStart);
    expect(receive).toContain('CONSIGNMENT_STOCK_RECEIVED_OFF_BALANCE_SHEET');
    expect(receive).not.toContain("entityType:'INVENTORY_BALANCE'");
    expect(receive).not.toContain("entityType:'JOURNAL_ENTRY'");
  });

  test('implant and prosthesis usage requires patient/procedure traceability',async()=>{
    const service=await source('lib/backend/services/scm-consignment-domain-service.ts');
    expect(service).toContain('HIGH_VALUE_TRACEABILITY_REQUIRED');
    expect(service).toContain('HIGH_VALUE_PATIENT_TRACEABILITY_REQUIRED');
    expect(service).toContain('CONSIGNMENT_ENCOUNTER_PATIENT_MISMATCH');
  });

  test('serial and UDI identities are tenant-wide reserved and one-time consumable',async()=>{
    const service=await source('lib/backend/services/scm-consignment-domain-service.ts');
    const tx=await source('lib/backend/transactions/transaction-manager.ts');
    expect(service).toContain('CONSIGNMENT_SERIAL_ALREADY_REGISTERED');
    expect(service).toContain('CONSIGNMENT_UDI_ALREADY_REGISTERED');
    expect(service).toContain('CONSIGNMENT_SERIAL_NOT_AVAILABLE');
    expect(service).toContain('CONSIGNMENT_UDI_NOT_AVAILABLE');
    expect(service).toContain("status:'CONSUMED'");
    expect(tx).toContain("CONSIGNMENT_IDENTITY: 'scmConsignmentIdentities'");
  });

  test('consignment usage accrues expense and GRNI atomically at point of use',async()=>{
    const service=await source('lib/backend/services/scm-consignment-domain-service.ts');
    expect(service).toContain("glAccountId:'6020'");
    expect(service).toContain("glAccountId:'2030'");
    expect(service).toContain("entityType:'CONSIGNMENT_LOT'");
    expect(service).toContain("entityType:'JOURNAL_ENTRY'");
    expect(service).toContain('ACCRUED_AWAITING_SUPPLIER_INVOICE');
  });

  test('agreement approval is maker-checker and receipt enforces commercial ceilings',async()=>{
    const service=await source('lib/backend/services/scm-consignment-domain-service.ts');
    expect(service).toContain('SCM_SEGREGATION_OF_DUTIES');
    expect(service).toContain('CONSIGNMENT_COST_CEILING_EXCEEDED');
    expect(service).toContain('CONSIGNMENT_AGREEMENT_OUT_OF_TERM');
    expect(service).toContain('CONSIGNMENT_COMMERCIAL_MISMATCH');
  });

  test('consignment accrual clears into standard AP before existing payment authorization',async()=>{
    const service=await source('lib/backend/services/scm-consignment-domain-service.ts');
    const payables=await source('lib/backend/services/scm-payables-domain-service.ts');
    expect(service).toContain('CONSIGNMENT_SUPPLIER_INVOICE_CAPTURED');
    expect(service).toContain('CONSIGNMENT_PAYABLE_RECOGNIZED');
    expect(service).toContain("glAccountId:'2030'");
    expect(service).toContain("glAccountId:'2010'");
    expect(service).toContain("status:'PAYABLE_RECOGNIZED'");
    expect(service).toContain('SCM_FINANCE_SEGREGATION_OF_DUTIES');
    expect(payables).toContain("'PAYABLE_RECOGNIZED'");
  });

  test('SCM-10 commands are routed and client writes are denied',async()=>{
    const bus=await source('lib/backend/commands/command-bus.ts');
    for(const command of [
      'CreateConsignmentAgreementCommand',
      'ApproveConsignmentAgreementCommand',
      'ReceiveConsignmentStockCommand',
      'RecordConsignmentUsageCommand',
      'CaptureConsignmentSupplierInvoiceCommand',
      'ReviewConsignmentSupplierInvoiceCommand',
    ]) expect(bus).toContain(`case '${command}'`);

    const rules=await source('firestore.rules');
    for(const collection of [
      'scmConsignmentAgreements',
      'scmConsignmentLots',
      'scmConsignmentUsages',
      'scmConsignmentIdentities',
    ]){
      const start=rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      expect(rules.slice(start,start+240)).toContain('allow write: if false;');
    }
  });

  test('consignment mutations are online-only',async()=>{
    const adapter=await source('lib/supply-chain/scm-consignment-edge-adapter.ts');
    expect(adapter).toContain('executeActiveTenantCommand');
    expect(adapter).not.toContain('offlineQueue');
  });
});
