import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('pre-CI7 repository cleanup regressions', () => {
  test('Patient 360 route enforces explicit full-chart authorization', () => {
    const source = read('app/api/clinical/patient360/[patientId]/route.ts');
    expect(source).toContain("from '@/lib/clinical/patient360/patient360-access'");
    expect(source).toContain('assertPatient360ReadAccess(context);');
  });

  test('Patient 360 projection stores remain server-only in Firestore rules', () => {
    const rules = read('firestore.rules');
    expect(rules).toContain('match /patient360Projections/{patientId}');
    expect(rules).toContain('match /patient360Timeline/{timelineItemId}');
    expect(rules).toContain('match /patient360ProjectionCheckpoints/{eventId}');
  });

  test('production OPD formulary no longer uses hard-coded stock', () => {
    const source = read('components/opd/OpdPharmacyPrescriptions.tsx');
    expect(source).not.toContain('const FORMULARY_DB');
    expect(source).toContain('const DEMO_FORMULARY');
    expect(source).toContain("NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO'");
    expect(source).toContain('/api/pharmacy/formulary');
  });

  test('formulary endpoint reads tenant-authoritative inventory', () => {
    const source = read('app/api/pharmacy/formulary/route.ts');
    expect(source).toContain('deriveAuthoritativeContext');
    expect(source).toContain('getAdminFirestore');
    expect(source).toContain("collection('items')");
    expect(source).toContain("collection('inventoryBalances')");
    expect(source).toContain("item.itemType === 'MEDICATION'");
  });

  test('cash receipts accumulate invoice settlement inside an atomic read-modify-write transaction', () => {
    const transactionManager = read('lib/backend/transactions/transaction-manager.ts');
    const cashReceipt = read('lib/backend/services/cash-receipt-domain-service.ts');
    expect(transactionManager).toContain('executeAtomicReadModifyMutation');
    expect(transactionManager).toContain("INVOICE_SETTLEMENT: 'invoiceSettlements'");
    expect(cashReceipt).toContain('executeAtomicReadModifyMutation');
    expect(cashReceipt).toContain('cumulativeCashReceivedMinorUnits');
    expect(cashReceipt).toContain("entityType: 'INVOICE_SETTLEMENT'");
  });
});
