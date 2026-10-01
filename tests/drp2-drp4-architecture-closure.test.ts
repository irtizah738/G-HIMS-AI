import { describe, expect, test } from 'bun:test';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

const removedAuthorityPaths = [
  'functions/src/index.ts',
  'functions/src/registerPatientAndEncounter.ts',
  'lib/runtime/registration-orchestrator.ts',
  'lib/clinical/encounter/creation-planner.ts',
  'lib/clinical/mpi/mpi-creation-flow.ts',
  'lib/clinical/transactions/encounter-creation-transaction.ts',
  'lib/events/outbox.ts',
  'lib/firebase/services/erp-finance.ts',
  'lib/firebase/services/hcm.ts',
  'lib/firebase/services/scm-firestore-service.ts',
  'lib/firebase/services/supply-chain.ts',
  'lib/firebase/services/inpatient-or.ts',
];

describe('DRP-2/3/4 architecture and production-data closure', () => {
  test('Generation-1 authority implementations remain deleted', async () => {
    for (const file of removedAuthorityPaths) {
      await expect(access(path.join(process.cwd(), file))).rejects.toThrow();
    }
  });

  test('pilot-facing domain screens do not import retired Firebase mutation services', async () => {
    const files = [
      'app/[tenantId]/erp/page.tsx',
      'app/[tenantId]/scm/purchase-orders/page.tsx',
      'app/[tenantId]/scm/par-management/page.tsx',
      'app/[tenantId]/scm/cssd/page.tsx',
      'app/[tenantId]/or/schedule/page.tsx',
      'app/[tenantId]/or/cases/page.tsx',
      'app/[tenantId]/or/cases/[caseId]/page.tsx',
      'components/views/hr-management-view.tsx',
      'components/views/surgery-theater-view.tsx',
      'components/supply-chain/scm-audit-compliance-view.tsx',
      'components/supply-chain/scm-batch-tracking-ledger.tsx',
      'components/supply-chain/scm-expiry-dashboard.tsx',
      'components/supply-chain/scm-mobile-barcode-scanner.tsx',
      'components/supply-chain/scm-par-notification-system.tsx',
    ];

    for (const file of files) {
      const content = await source(file);
      expect(content).not.toContain('@/lib/firebase/services/');
    }
  });

  test('perioperative UI is projection-driven and surgical mutations use governed commands', async () => {
    const [edge, schedule, cases, caseDetail, theater, hydration, bootstrap, rules] =
      await Promise.all([
        source('lib/clinical/surgical-edge-adapter.ts'),
        source('app/[tenantId]/or/schedule/page.tsx'),
        source('app/[tenantId]/or/cases/page.tsx'),
        source('app/[tenantId]/or/cases/[caseId]/page.tsx'),
        source('components/views/surgery-theater-view.tsx'),
        source('lib/offline/hydration.ts'),
        source('app/api/offline/bootstrap/route.ts'),
        source('firestore.rules'),
      ]);

    expect(edge).toContain('executeActiveTenantCommand');
    expect(edge).toContain("'ScheduleSurgicalCaseCommand'");
    expect(edge).toContain("'RecordSurgicalSafetyChecklistCommand'");
    expect(edge).toContain("'AdvanceSurgicalCaseCommand'");
    expect(edge).toContain("'CancelSurgicalCaseCommand'");
    expect(edge).toContain("rows<GovernedSurgicalCase>(snapshot, 'surgicalCases')");

    for (const page of [schedule, cases, caseDetail, theater]) {
      expect(page).toContain('SurgicalOperationsConsole');
      expect(page).not.toContain('Surgical Cases Mock Data');
      expect(page).not.toContain('Dr. Sarah Jenkins');
      expect(page).not.toContain('Arthur Pendelton');
    }

    expect(hydration).toContain("'surgicalCases'");
    expect(hydration).toContain("'orRoomSchedules'");
    expect(bootstrap).toContain("'surgicalCases'");
    expect(bootstrap).toContain("'orRoomSchedules'");
    expect(rules).toContain('match /surgicalCases/{caseId}');
    expect(rules).toContain('match /orRoomSchedules/{roomId}');
  });

  test('registration UI does not invent tenant, actor, patient identifiers or demographic fixtures', async () => {
    const registration = await source(
      'components/mpi/PatientSearchAndRegistrationPanel.tsx'
    );
    expect(registration).toContain("RegistrationRequest");
    expect(registration).not.toContain("tenantId: 'metro_general'");
    expect(registration).not.toContain("actorId: 'usr_frontdesk_1'");
    expect(registration).not.toContain('Alice Green');
    expect(registration).not.toContain('42101-9876543-1');
    expect(registration).not.toContain('+1 (555) 234-5678');
  });

  test('SCM browser components use command edges and never accept authorizer identity', async () => {
    const [audit, batches, expiry, scanner, par, edge] = await Promise.all([
      source('components/supply-chain/scm-audit-compliance-view.tsx'),
      source('components/supply-chain/scm-batch-tracking-ledger.tsx'),
      source('components/supply-chain/scm-expiry-dashboard.tsx'),
      source('components/supply-chain/scm-mobile-barcode-scanner.tsx'),
      source('components/supply-chain/scm-par-notification-system.tsx'),
      source('lib/supply-chain/scm-edge-adapter.ts'),
    ]);

    expect(audit).toContain('recordStockAdjustmentEdge');
    expect(audit).not.toContain('setAdjAuthorizerId');
    expect(audit).not.toContain('setAdjSecondAuthorizerId');
    expect(batches).toContain('recordStockTransactionEdge');
    expect(batches).toContain('Standalone batch creation is disabled');
    expect(expiry).toContain('quarantineBatchEdge');
    expect(scanner).toContain('recordStockTransactionEdge');
    expect(par).toContain('submitPurchaseRequisitionEdge');

    expect(edge).toContain('performedBy: _performedBy');
    expect(edge).toContain('authorizedBy: _authorizedBy');
    expect(edge).toContain('optimisticCache: false');
  });

  test('tenant dashboard branding is tenant-derived rather than a fixed hospital identity', async () => {
    const dashboard = await source('components/tenant-dashboard.tsx');
    expect(dashboard).not.toContain('Metropolitan Health');
  });
});
