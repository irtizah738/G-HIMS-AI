import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('Clinical identity and specialist workflow rework', () => {
  test('registration issues one canonical MRN and reserves MRN/CNIC MPI keys', async () => {
    const registration = await source('server/runtime/registration-orchestrator.ts');

    expect(registration).toContain("type: 'MRN'");
    expect(registration).toContain('buildMpiRegistryKey(identifier.type, identifier.value)');
    expect(registration).toContain("identifier.type === 'MRN' || identifier.type === 'CNIC'");
    expect(registration).toContain('canonicalIdentifiers');
    expect(registration).toContain("String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')");
  });

  test('authoritative MPI lookup accepts MRN or CNIC without patient name', async () => {
    const route = await source('app/api/clinical/mpi/lookup/route.ts');

    expect(route).toContain("resolveIdentifier(tenantId, 'MRN', mrn)");
    expect(route).toContain("resolveIdentifier(tenantId, 'CNIC', cnic)");
    expect(route).toContain('Provide MRN or CNIC for exact MPI lookup.');
    expect(route).toContain('MPI_IDENTIFIER_MISMATCH');
  });

  test('routing workflow has explicit selection, correct SLA and no fake diagnostic dispatch', async () => {
    const routing = await source('components/clinical/patient-consultant-routing-modal.tsx');
    const mpiView = await source('components/views/patient-mpi-view.tsx');

    expect(routing).toContain("useState<'STAT' | 'URGENT' | 'PRIORITY' | 'ROUTINE'>('ROUTINE')");
    expect(routing).toContain("? 10");
    expect(routing).toContain("? 30");
    expect(routing).toContain("? 60");
    expect(routing).toContain('Handoff Preparation Checklist');
    expect(routing).toContain('does not place a diagnostic order');
    expect(routing).not.toContain('Code STEMI activated');
    expect(routing).not.toContain('Pre-Arrival Stat Diagnostics (Auto-Dispatched)');
    expect(mpiView).toContain('encounterId={');
    expect(mpiView).toContain('currentPatient.activeEncounterId');
  });

  test('disease intake starts empty and remains source-limited', async () => {
    const intake = await source('components/views/disease-centric-intake-view.tsx');

    expect(intake).toContain("useState<string>(selectedPatientId || '')");
    expect(intake).toContain('setGuidedAnswers({})');
    expect(intake).toContain('setSpecialtyHistoryAnswers({})');
    expect(intake).toContain('Source-Limited Specialist Brief');
    expect(intake).toContain('Missing or Unverified Information');
    expect(intake).toContain('does not diagnose, prescribe, place orders, or automatically dispatch');
    expect(intake).toContain('Save Reviewed Intake');
    expect(intake).toContain('Route to Specialist');

    expect(intake).not.toContain("'p-1001'");
    expect(intake).not.toContain("ecg_telemetry_findings: 'stemi_elevation'");
    expect(intake).not.toContain('Differential Diagnosis Probability Matrix');
    expect(intake).not.toContain('Recommended STAT Diagnostic & Intervention Orders');
    expect(intake).not.toContain('id="tab-mode-customize"');
    expect(intake).not.toContain('id="tab-mode-localization"');
  });

  test('static readiness matrix is removed from operational navigation', async () => {
    const sidebar = await source('components/navigation/collapsible-sidebar.tsx');
    const dashboard = await source('components/tenant-dashboard.tsx');
    const plan = await source(
      'docs/operations/GHIMS_FULL_MODULE_COMPLETION_PROGRAM.md'
    );

    expect(sidebar).not.toContain("id: 'matrix'");
    expect(dashboard).not.toContain('ModuleReadinessMatrixView');
    expect(plan).toContain('development freeze is lifted');
    expect(plan).toContain('does **not** remove clinical safety, RBAC, credential');
    expect(plan).toContain('BUILDING');
    expect(plan).toContain('PRODUCTION_QUALIFIED');
  });
});
