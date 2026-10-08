import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('OPD-SQ1 deployed cross-role staging qualification contract', () => {
  test('login no longer hardcodes hospital tenant authority', async () => {
    const login = await source('components/auth/login-portal.tsx');

    expect(login).not.toContain('const TENANTS =');
    expect(login).toContain("const [tenantId, setTenantId] = useState('')");
    expect(login).toContain("fetch('/api/auth/facilities'");
    expect(login).toContain('facilities.map((facility)');
    expect(login).not.toContain('NEXT_PUBLIC_GHIMS_HOSPITAL0_TENANT_ID');
    expect(login).not.toContain('NEXT_PUBLIC_GHIMS_HOSPITAL0_NAME');
    expect(login).not.toContain('NEXT_PUBLIC_GHIMS_HOSPITAL0_FACILITY_CODE');
    expect(login).toContain('Select hospital facility');
    expect(login).toContain('<select');
    expect(login).not.toContain('<datalist');
    expect(login).toContain('required');
    expect(login).toContain('data-testid="login-tenant-id"');
    expect(login).toContain('data-testid="login-email"');
    expect(login).toContain('data-testid="login-password"');
    expect(login).toContain('data-testid="login-submit"');
  });

  test('registration persists server-authorized facility and clinical department scope', async () => {
    const route = await source('app/api/clinical/encounter/create/route.ts');
    const orchestrator = await source(
      'server/runtime/registration-orchestrator.ts'
    );
    const runtimeType = await source('types/encounter-runtime.ts');

    expect(route).toContain('authorizedFacilityIds');
    expect(route).toContain("'FACILITY_ACCESS_DENIED'");
    expect(route).toContain("'FACILITY_SELECTION_REQUIRED'");
    expect(route).toContain('facilityId,');
    expect(route).toContain('departmentId,');

    const registration = await source(
      'components/opd/OpdRegistrationConsent.tsx'
    );
    expect(registration).toContain(
      'data-testid="opd-registration-facility"'
    );
    expect(registration).toContain('authorizedFacilityIds');

    expect(orchestrator).toContain('facilityId: params.facilityId');
    expect(orchestrator).toContain('departmentId: params.departmentId');
    expect(orchestrator).toContain('facilityId: encounterRecord.facilityId');
    expect(orchestrator).toContain('departmentId: encounterRecord.departmentId');

    expect(runtimeType).toContain('facilityId?: string');
    expect(runtimeType).toContain('departmentId?: string');
  });

  test('cross-role OPD UI cannot programmatically expose an unauthorized Queue surface', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(workspace).toContain(
      "activeTab === 'QUEUE' && canAccessTab('QUEUE')"
    );
    expect(workspace).toContain(
      "isSettled && canAccessTab('QUEUE') ? 'QUEUE' : 'BILLING'"
    );
    expect(workspace).toContain(
      "canAccessTab('DISPOSITION') ? 'DISPOSITION' : 'BILLING'"
    );
  });

  test('authorized encounter deep-link selection never bypasses hydrated read scope', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(workspace).toContain("searchParams.get('opdEncounterId')");
    expect(workspace).toContain(
      'encounters.some((encounter) => encounter.id === requestedEncounterId)'
    );
    expect(workspace).toContain('setSelectedEncounterId(requestedEncounterId)');
    expect(workspace).toContain('data-encounter-id={activeEncounter.id}');
  });

  test('generic Playwright CI excludes the deployed staging qualification suite', async () => {
    const genericConfig = await source('playwright.config.ts');
    const stagingConfig = await source('playwright.opd-staging.config.ts');

    expect(genericConfig).toContain("testIgnore: ['staging/**']");
    expect(stagingConfig).toContain("testDir: './e2e/staging'");
    expect(stagingConfig).toContain("testMatch: /opd-cross-role\\.spec\\.ts/");
    expect(stagingConfig).toContain('GHIMS_STAGING_BASE_URL_REQUIRED');
  });

  test('staging Playwright suite is real-auth, real-server and STAGING-only', async () => {
    const config = await source('playwright.opd-staging.config.ts');
    const spec = await source('e2e/staging/opd-cross-role.spec.ts');

    expect(config).toContain('GHIMS_STAGING_BASE_URL_REQUIRED');
    expect(config).toContain("parsed.protocol !== 'https:'");
    expect(config).toContain("'localhost'");
    expect(config).toContain("'127.0.0.1'");
    expect(config).not.toContain('webServer:');

    expect(spec).toContain("request.get('/api/health/ready')");
    expect(spec).toContain("expect(health.runtime).toBe('STAGING')");
    expect(spec).toContain('GHIMS_OPD_SQ1_CONFIRM_TENANT');
    expect(spec).toContain('GHIMS_P7_BOOTSTRAP_PASSWORD');
    expect(spec).toContain('p7.reception@g-hims.invalid');
    expect(spec).toContain('p7.billing@g-hims.invalid');
    expect(spec).toContain('p7.nurse@g-hims.invalid');
    expect(spec).toContain('p7.doctor@g-hims.invalid');

    for (const boundaryBypass of [
      'page.route(',
      'context.route(',
      'addInitScript',
      'localStorage',
      'sessionStorage',
      'storageState:',
    ]) {
      expect(spec).not.toContain(boundaryBypass);
    }
  });

  test('browser journey covers mandatory reception-to-discharge role handoff', async () => {
    const spec = await source('e2e/staging/opd-cross-role.spec.ts');

    for (const checkpoint of [
      "getByTestId('opd-registration-submit')",
      "getByTestId('opd-billing-collect')",
      "getByRole('button', { name: 'Call Token' })",
      "getByRole('button', { name: 'Admit to Bay' })",
      "getByTestId('opd-triage-submit')",
      "getByTestId('opd-consultation-submit')",
      "getByTestId('opd-final-reconcile')",
      "getByTestId('opd-disposition-submit')",
      'Authoritative Encounter Timeline & Audit Provenance',
    ]) {
      expect(spec).toContain(checkpoint);
    }
  });

  test('manual workflow uses staging environment secrets and retains failure evidence', async () => {
    const workflow = await source(
      '.github/workflows/opd-sq1-staging-e2e.yml'
    );

    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('environment: staging');
    expect(workflow).toContain('Require current main qualification source');
    expect(workflow).toContain('refs/heads/main');
    expect(workflow).toContain('git rev-parse origin/main');
    expect(workflow).toContain('secrets.GHIMS_STAGING_BASE_URL');
    expect(workflow).toContain('secrets.GHIMS_P7_BOOTSTRAP_PASSWORD');
    expect(workflow).toContain(
      'GHIMS_OPD_SQ1_CONFIRM_TENANT: ${{ vars.GHIMS_OPD_SQ1_CONFIRM_TENANT }}'
    );
    expect(workflow).not.toContain(
      'GHIMS_OPD_SQ1_CONFIRM_TENANT: ${{ vars.GHIMS_P7_TENANT_ID'
    );
    expect(workflow).toContain('playwright-report/opd-staging');
    expect(workflow).toContain('test-results/opd-staging');
    expect(workflow).not.toContain('pull_request:');
  });

  test('synthetic staging nurse is department-scoped to the qualified OPD path', async () => {
    const provision = await source(
      'scripts/ops/p7-provision-staging-identities.ts'
    );
    const nurseBlock = provision.slice(
      provision.indexOf("key: 'nurse'"),
      provision.indexOf("key: 'doctor'")
    );

    expect(nurseBlock).toContain("department: 'General Medicine'");
    expect(provision).toContain("facilityIds: ['P7H0']");
    expect(provision).toContain('syntheticQualificationAccount: true');
  });
});
