import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('Clinical Intelligence flagship demo', () => {
  test('provisioning is DEMO-only and requires explicit tenant confirmation', async () => {
    const script = await source(
      'scripts/demo/provision-clinical-intelligence-demo.ts'
    );

    expect(script).toContain("assertDemoRuntime('Clinical Intelligence demo provisioning')");
    expect(script).toContain('GHIMS_DEMO_CONFIRM_TENANT');
    expect(script).toContain('CI_DEMO_TENANT_CONFIRMATION_REQUIRED');
    expect(script).not.toContain("GHIMS_RUNTIME_MODE=PRODUCTION");
  });

  test('scenario represents the complete longitudinal Clinical Intelligence story', async () => {
    const script = await source(
      'scripts/demo/provision-clinical-intelligence-demo.ts'
    );

    for (const required of [
      "'clinicalConditions'",
      "'clinicalAllergies'",
      "'medicationOrders'",
      "'clinicalObservations'",
      "'canonicalDiagnosticOrders'",
      "'diagnosticReports'",
      "'clinicalProcedures'",
      "'carePlans'",
      "'clinicalDocuments'",
      "'patientClinicalKnowledgeStatus'",
      "Patient360ProjectionService.rebuildPatient",
    ]) {
      expect(script).toContain(required);
    }

    expect(script).toContain("demo-ci-creatinine-old");
    expect(script).toContain("demo-ci-creatinine-new");
    expect(script).toContain("demo-ci-potassium-new");
    expect(script).toContain("syntheticOnly: true");
  });

  test('demo narrative preserves clinician authority and provenance thesis', async () => {
    const guide = await source(
      'docs/clinical-intelligence/FLAGSHIP_DEMO.md'
    );

    expect(guide).toContain('evidence-grounded clinician intelligence');
    expect(guide).toContain('Evidence provenance is inspectable');
    expect(guide).toContain('clinician edit → approval attestation → qualified signature');
    expect(guide).toContain('AI never signs the chart');
    expect(guide).toContain('All records are synthetic');
    expect(guide).not.toContain('clinically validated');
  });

  test('package exposes deterministic demo provision and qualification commands', async () => {
    const pkg = JSON.parse(await source('package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.['demo:clinical-intelligence']).toBe(
      'bun scripts/demo/provision-clinical-intelligence-demo.ts'
    );
    expect(pkg.scripts?.['test:ci-demo']).toBe(
      'bun test tests/ci-flagship-demo.test.ts'
    );
  });
});
