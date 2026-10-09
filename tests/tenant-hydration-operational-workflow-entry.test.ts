import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = (file: string) => readFile(join(process.cwd(), file), 'utf8');

describe('Tenant, consultant, ER, vitals and billing workflow entry regressions', () => {
  test('Tenant layout prevents all module hydration under mismatched route scope', async () => {
    const layout = await source('app/[tenantId]/layout.tsx');
    const guard = await source('components/tenant/tenant-route-authority-guard.tsx');
    expect(layout).toContain('<TenantRouteAuthorityGuard routeTenantId={tenantId}>');
    expect(guard).toContain('sessionTenant !== routeTenant');
    expect(guard).toContain('router.replace(segments.join');
    expect(guard).toContain('if (mismatched)');
  });

  test('Emergency intake route is functional and bound to an actual MPI patient', async () => {
    const page = await source('app/[tenantId]/clinical/emergency/page.tsx');
    const er = await source('components/emergency/governed-emergency-console.tsx');
    const mpi = await source('components/views/patient-mpi-view.tsx');
    expect(page).toContain('<GovernedEmergencyConsole />');
    expect(mpi).toContain('id="btn-direct-er-admission"');
    expect(mpi).toContain('/clinical/emergency?patientId=');
    expect(er).toContain("searchParams.get('patientId')");
    expect(er).toContain('activePatients.some(p => p.id === preselectedPatientId)');
    expect(er).toContain("'CreateEncounterCommand'");
    expect(er).toContain("encounterType: 'EMERGENCY'");
    expect(er).toContain("'REMOVED'");
  });

  test('MPI vitals requires explicit encounter and posts to authenticated clinical command', async () => {
    const mpi = await source('components/views/patient-mpi-view.tsx');
    expect(mpi).toContain('data-testid="mpi-vitals-encounter"');
    expect(mpi).toContain('currentPatient.encounters.find(item => item.id === vitalsEncounterId)');
    expect(mpi).toContain("'RecordVitalsCommand'");
    expect(mpi).toContain('patientId: currentPatient.id');
    expect(mpi).toContain('encounterId: encounter.id');
    expect(mpi).toContain('!result.success || result.queuedOffline');
    expect(mpi).toContain('disabled={!vitalsEncounterId || vitalsSaving}');
  });

  test('Billing has cashier entry and final reconcile after point-of-service settlement', async () => {
    const mpi = await source('components/views/patient-mpi-view.tsx');
    const opd = await source('components/opd/OpdMasterWorkspace.tsx');
    expect(mpi).toContain('id="btn-open-authoritative-billing"');
    expect(mpi).toContain('/billing/invoices');
    expect(opd).toContain('activeBillingInvoice.balanceDueMinorUnits === 0');
    expect(opd).toContain("'ReconcileOpdBillingCommand'");
    expect(opd).toContain('data-testid="opd-final-reconcile"');
  });

  test('Consultant shortage links to existing canonical HCM provisioning and never fabricates a doctor', async () => {
    const modal = await source('components/clinical/patient-consultant-routing-modal.tsx');
    const directory = await source('lib/clinical/intelligence/consultant-directory-service.ts');
    expect(modal).toContain('/hcm/workforce');
    expect(modal).toContain('/hcm/credentials');
    expect(modal).toContain('/hcm/roster');
    expect(directory).toContain('credentialsValid(');
    expect(directory).toContain('activePrivileges(');
    expect(directory).toContain('DomainStateRepository.listAllWithDocumentIds<EmployeeMaster>');
  });
});
