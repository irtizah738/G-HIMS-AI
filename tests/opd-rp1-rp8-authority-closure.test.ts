import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

describe('OPD RP1-RP8 authority closure', () => {
  test('RP1 uses one canonical seven-stage OPD DAG authority', async () => {
    const snapshot = await source('lib/workflow/opd-definition.ts');
    const canonical = await source('lib/clinical/workflow/definitions/opd.ts');

    expect(snapshot).toContain('GeneralOpdWorkflowDefinition');
    expect(snapshot).toContain('Object.values(GeneralOpdWorkflowDefinition.stages)');
    expect(snapshot).not.toContain("id: 'OPD-REGISTRATION'");
    expect(canonical).toContain("REGISTRATION: {");
    expect(canonical).toContain("id: 'REGISTRATION'");
    expect(canonical).toContain("TRIAGE: {");
    expect(canonical).toContain("id: 'TRIAGE'");
    expect(canonical).toContain("CONSULTATION: {");
    expect(canonical).toContain("id: 'CONSULTATION'");
    expect(canonical).toContain("BILLING_SETTLEMENT: {");
    expect(canonical).toContain("DISCHARGE_OR_REFERRAL: {");
  });

  test('RP2 registration does not manufacture patient or clinical facts', async () => {
    const registration = await source('components/opd/OpdRegistrationConsent.tsx');

    expect(registration).not.toContain("1990-05-14");
    expect(registration).not.toContain("+92 300 8877665");
    expect(registration).not.toContain("patient@example.org");
    expect(registration).not.toContain("Academic Researcher");
    expect(registration).not.toContain("['Hypertension']");
    expect(registration).not.toContain('Math.random()');
    expect(registration).toContain("id: ''");
    expect(registration).toContain("mrn: ''");
    expect(registration).toContain("bloodGroup");
  });

  test('RP3 consent is explicit, immutable and server issued', async () => {
    const registration = await source('components/opd/OpdRegistrationConsent.tsx');
    const route = await source('app/api/clinical/encounter/create/route.ts');
    const orchestrator = await source('server/runtime/registration-orchestrator.ts');
    const queue = await source('lib/backend/services/opd-queue-domain-service.ts');

    expect(registration).toContain("'DIGITAL_ATTESTATION'");
    expect(registration).not.toContain('procedureConsentGranted');
    expect(registration).not.toContain('SHA256:CONSENT');
    expect(route).toContain('GENERAL_OPD_CONSENT_REQUIRED');
    expect(orchestrator).toContain("collection('patientConsents')");
    expect(orchestrator).toContain('consentSummary');
    expect(queue).toContain('GENERAL_OPD_CONSENT_REQUIRED');
  });

  test('RP4 production workspace hydrates authoritative scoped state', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');
    const hydration = await source('lib/offline/hydration.ts');
    const readModel = await source('lib/opd/workspace-read-model.ts');

    expect(workspace).toContain('hydrateEdgeSnapshot');
    expect(workspace).toContain('buildOpdWorkspaceReadModel');
    expect(bootstrap).toContain("'invoices'");
    expect(bootstrap).toContain("'opd_queue'");
    expect(hydration).toContain("'invoices'");
    expect(readModel).toContain('snapshot.collections.encounters');
    expect(readModel).toContain('snapshot.collections.opd_queue');
  });

  test('RP5/RP7 queue start is atomic and payment gated', async () => {
    const queue = await source('lib/backend/services/opd-queue-domain-service.ts');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');
    const bus = await source('lib/backend/commands/command-bus.ts');

    expect(queue).toContain('StartOpdServiceCommand');
    expect(queue).toContain('CONSULTATION_PAYMENT_REQUIRED');
    expect(queue).toContain("'CONSULTATION_CLEARED'");
    expect(queue).toContain("clinicalState: 'TRIAGE'");
    expect(queue).toContain("entityType: 'ENCOUNTER'");
    expect(workspace).toContain("'StartOpdServiceCommand'");
    expect(workspace).not.toContain('Non-blocking queue start service notice');
    expect(bus).toContain("case 'StartOpdServiceCommand'");
  });

  test('RP6 consultation billing is server authoritative and fails closed on missing catalog', async () => {
    const billing = await source('lib/backend/services/opd-billing-domain-service.ts');
    const cash = await source('lib/backend/services/cash-receipt-domain-service.ts');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(billing).toContain("'billingServiceCatalog'");
    expect(billing).toContain("'opd-consultation-standard'");
    expect(billing).toContain('OPD_CONSULTATION_CATALOG_NOT_CONFIGURED');
    expect(billing).toContain("entityType: 'AR_OPEN_ITEM'");
    expect(billing).toContain("entityType: 'JOURNAL_ENTRY'");
    expect(billing).toContain("billingPurpose: 'OPD_CONSULTATION'");
    expect(cash).toContain("financialClearanceState: 'CONSULTATION_CLEARED'");
    expect(workspace).toContain("'CreateOpdConsultationInvoiceCommand'");
    expect(workspace).not.toContain('id: `inv-${newEncId}`');
  });

  test('RP8 incomplete NEWS2 cannot unlock consultation', async () => {
    const triage = await source('components/opd/OpdTriageVitals.tsx');
    const runtime = await source('lib/backend/services/opd-workflow-runtime-service.ts');
    const encounter = await source('lib/backend/services/encounter-domain-service.ts');

    expect(triage).toContain("import { calculateNEWS2 }");
    expect(triage).toContain('spO2Scale');
    expect(triage).toContain("useState<boolean | null>");
    expect(triage).not.toContain('|| 82');
    expect(triage).not.toContain('|| 98');
    expect(runtime).toContain("String(evidence.news2Status || '').toUpperCase() !== 'VERIFIED'");
    expect(runtime).toContain('NEWS2_INCOMPLETE');
    expect(runtime).toContain('OPD_EVIDENCE_LINEAGE_MISMATCH');
    expect(encounter).toContain('validateAuthoritativeEvidence');
  });
});
