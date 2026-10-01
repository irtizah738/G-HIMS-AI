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

  test('synthetic analytics and compliance-like export claims cannot leak into staging', async () => {
    const analytics = await source('lib/analytics/hospital-kpi-data.ts');
    expect(analytics).toContain('AUTHORITATIVE_ANALYTICS_PROJECTION_REQUIRED');
    expect(analytics).toContain("runtime !== 'DEMO' && runtime !== 'TEST'");
    expect(analytics).not.toContain(
      'Certified Regulatory Compliance: Joint Commission & CMS'
    );
  });

  test('audit exports never treat missing verification evidence as cryptographically verified', async () => {
    const pdf = await source('lib/audit/generateAuditPdf.ts');
    expect(pdf).toContain("'NOT_VERIFIED'");
    expect(pdf).toContain('AUDIT CHAIN VERIFICATION: NOT PERFORMED');
    expect(pdf).not.toContain('verificationResult?.isValid ?? true');
    expect(pdf).not.toContain('SHA-256 FORWARD CHAIN INTEGRITY ATTESTATION');
  });

  test('medical director presentation does not normalize to cross-domain administrator', async () => {
    const rbac = await source('lib/auth/rbac.ts');
    expect(rbac).toContain("if (clean === 'medical_director') return 'doctor'");
    expect(rbac).not.toContain(
      "clean === 'system_admin' || clean === 'medical_director'"
    );
  });

  test('tenant dashboard branding is tenant-derived rather than a fixed hospital identity', async () => {
    const dashboard = await source('components/tenant-dashboard.tsx');
    expect(dashboard).not.toContain('Metropolitan Health');
  });

  test('pilot-facing Emergency is authoritative and the synthetic ED engine is retired', async () => {
    const [dashboard, emergency, encounter] = await Promise.all([
      source('components/tenant-dashboard.tsx'),
      source('components/emergency/governed-emergency-console.tsx'),
      source('lib/backend/services/encounter-domain-service.ts'),
    ]);

    expect(dashboard).toContain('GovernedEmergencyConsole');
    expect(dashboard).not.toContain('EmergencyTriageView');
    expect(emergency).toContain('hydrateEdgeSnapshot');
    expect(emergency).toContain("'CreateEncounterCommand'");
    expect(emergency).toContain("'RecordVitalsCommand'");
    expect(emergency).toContain('Open');
    expect(emergency).not.toContain('INITIAL_ED_OPTIMIZED_CASES');
    expect(emergency).not.toContain('Math.random');
    expect(emergency).not.toContain('STEMI');
    expect(encounter).toContain('crypto.randomUUID()');
    expect(encounter).toContain("'PATIENT_NOT_FOUND'");
    expect(encounter).toContain("'PATIENT_NOT_ACTIVE'");
    await expect(
      source('components/views/emergency-triage-view.tsx')
    ).rejects.toThrow();
    await expect(source('lib/clinical/emergency-service.ts')).rejects.toThrow();
  });

  test('OPD staging surface never auto-accepts synthetic diagnoses medications procedures or charges', async () => {
    const [view, context] = await Promise.all([
      source('components/views/opd-encounters-view.tsx'),
      source('lib/context/hospital-context.tsx'),
    ]);

    expect(view).toContain('diagnoses: []');
    expect(view).toContain('medicationsPrescribed: []');
    expect(view).toContain('recommendedProcedures: []');
    expect(view).toContain('billingCodes: []');
    expect(view).toContain('Save');
    expect(view).toContain('Open Diagnostic Orders');
    expect(view).not.toContain('Ticagrelor 90mg BID');
    expect(view).not.toContain('CPT 99214');
    expect(view).not.toContain('sampleId: Math.random');
    expect(context).toContain('Promise<void>');
    expect(context).toContain("'SignClinicalNoteCommand'");
    expect(context).toContain("'RecordVitalsCommand'");
    expect(context).toContain("'UpdateOpdQueueStatusCommand'");
  });

  test('MPI fails closed on patient scope and missing demographics instead of inventing patient facts', async () => {
    const [view, registration, commandClient] = await Promise.all([
      source('components/views/patient-mpi-view.tsx'),
      source('server/runtime/registration-orchestrator.ts'),
      source('lib/api/command-client.ts'),
    ]);

    expect(view).toContain("setNewBlood('Unknown')");
    expect(view).toContain('G-HIMS will not invent missing demographics');
    expect(view).not.toContain("activePatientId || 'p-1001'");
    expect(view).not.toContain("patients[0]");
    expect(view).not.toContain("'123 Main St, Metro City'");
    expect(view).not.toContain('@example.com');
    expect(view).not.toContain("useState('+1 (555) 000-0000')");
    expect(registration).toContain("bloodGroup: params.bloodGroup || 'Unknown'");
    expect(commandClient).toContain("bloodGroup: request.bloodGroup || 'Unknown'");
  });

  test('MPI AI extraction is draft-only and cannot directly become accepted clinical structure', async () => {
    const view = await source('components/views/patient-mpi-view.tsx');

    expect(view).toContain('AI draft — not accepted into the clinical record');
    expect(view).toContain('Generate AI Draft');
    expect(view).toContain('Save Clinician Narrative');
    expect(view).toContain('setAiDraft(data.structured');
    expect(view).not.toContain('aiStructuredData: data.structured');
  });

});
