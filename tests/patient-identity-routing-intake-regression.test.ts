import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('Patient identity, specialist routing and intake workflow closure', () => {
  test('institutional MRN is server-owned, immutable in registration, and indexed with CNIC', async () => {
    const orchestrator = await source('server/runtime/registration-orchestrator.ts');

    expect(orchestrator).toContain('PATIENT_MRN_SERVER_OWNED');
    expect(orchestrator).toContain("type: 'MRN'");
    expect(orchestrator).toContain("issuer: 'G-HIMS'");
    expect(orchestrator).toContain("type: 'CNIC' as const");
    expect(orchestrator).toContain("type: 'MRN' as const");
    expect(orchestrator).toContain('mpiRegistryKey');
    expect(orchestrator).not.toContain('Math.random()');
  });

  test('patient lookup surfaces only MRN and CNIC as MPI search keys', async () => {
    const panel = await source('components/mpi/PatientSearchAndRegistrationPanel.tsx');
    const opdSearch = await source('components/opd/OpdPatientSearchMpi.tsx');
    const patientIndex = await source('components/views/patient-mpi-view.tsx');

    expect(panel).toContain("useState<'ALL' | 'CNIC' | 'MRN'>");
    expect(panel).not.toContain("['ALL', 'CNIC', 'MRN', 'PHONE']");
    expect(panel).not.toContain('<option value="MRN">Ext MRN</option>');

    expect(opdSearch).toContain("useState<'ALL' | 'MRN' | 'CNIC'>");
    expect(opdSearch).not.toContain('<option value="PHONE">Primary Contact Phone</option>');
    expect(opdSearch).not.toContain('<option value="NAME">Legal / Preferred Name</option>');

    expect(patientIndex).toContain('Search by institutional MRN or CNIC');
  });

  test('authoritative MPI lookup resolves only MRN/CNIC registry keys and has an offline exact-match fallback', async () => {
    const route = await source('app/api/clinical/mpi/lookup/route.ts');
    const client = await source('lib/clinical/mpi/mpi-lookup-client.ts');
    const opdSearch = await source('components/opd/OpdPatientSearchMpi.tsx');
    const backfill = await source('scripts/ops/backfill-mpi-identities.ts');

    expect(route).toContain("mpiRegistryKey('MRN', value)");
    expect(route).toContain("mpiRegistryKey('CNIC', value)");
    expect(route).toContain('legacyCnicRegistryKey(value)');
    expect(route).toContain('MPI_REGISTRY_INTEGRITY_FAILURE');
    expect(client).toContain('/api/clinical/mpi/lookup');
    expect(opdSearch).toContain('OFFLINE_FALLBACK');
    expect(opdSearch).toContain('lookupPatientByMpi');
    expect(backfill).toContain('GHIMS_MPI_BACKFILL_CONFIRM_TENANT');
    expect(backfill).toContain('MPI_BACKFILL_REGISTRY_CONFLICT');
  });

  test('specialist routing has no fabricated STEMI handoff or automatic diagnostic ordering', async () => {
    const routing = await source('components/clinical/patient-consultant-routing-modal.tsx');

    expect(routing).toContain("useState<string>(initialClinicalQuestion)");
    expect(routing).not.toContain('Code STEMI activated');
    expect(routing).not.toContain('Pre-Arrival Stat Diagnostics (Auto-Dispatched)');
    expect(routing).not.toContain('setPreOrders');
    expect(routing).toContain("? 10");
    expect(routing).toContain("? 30");
    expect(routing).toContain("? 60");
    expect(routing).toContain('Diagnostic orders must be placed through the governed ordering workflow');
    expect(routing).toContain('No eligible consultants match this filter');
  });

  test('disease intake does not fabricate production patient context or auto-dispatch specialist actions', async () => {
    const intake = await source('components/views/disease-centric-intake-view.tsx');

    expect(intake).toContain("IS_DEMO_RUNTIME ? 'p-1001' : ''");
    expect(intake).toContain("IS_DEMO_RUNTIME ? patients[0] : undefined");
    expect(intake).not.toContain('autoDispatchOnCritical');
    expect(intake).toContain('Suggested Diagnostics — Not Ordered');
    expect(intake).toContain('no consultation or diagnostic order was auto-dispatched');
    expect(intake).toContain('Continue to Specialist Routing');
    expect(intake).toContain('PatientConsultantRoutingModal');
  });

  test('stale hard-coded readiness matrix is not exposed as a product module', async () => {
    const sidebar = await source('components/navigation/collapsible-sidebar.tsx');
    const command = await source('components/navigation/command-palette.tsx');
    const dashboard = await source('components/tenant-dashboard.tsx');

    expect(sidebar).not.toContain("id: 'matrix'");
    expect(command).not.toContain("setActiveTab('matrix')");
    expect(dashboard).not.toContain('ModuleReadinessMatrixView');
  });
});
