import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { assertInvestorDemoIsolation, type InvestorDemoTarget } from '@/lib/runtime/investor-demo-isolation';

const valid: InvestorDemoTarget = {
  runtime: 'DEMO', publicRuntime: 'DEMO',
  projectId: 'ghims-investor-demo-2026',
  publicProjectId: 'ghims-investor-demo-2026',
  namedDemoProjectId: 'ghims-investor-demo-2026',
  publicNamedDemoProjectId: 'ghims-investor-demo-2026',
  productionProjectId: 'g-hims-ai',
  stagingProjectId: 'studio-1130431360-48a05',
  testProjectId: 'ghims-test-project',
  firebaseAuthEmulatorHost: '127.0.0.1:9099',
  firestoreEmulatorHost: '127.0.0.1:8080',
};

describe('G-HIMS AI investor demo target isolation', () => {
  test('accepts dedicated DEMO project with both local emulators', () => {
    expect(() => assertInvestorDemoIsolation(valid)).not.toThrow();
  });
  test('rejects DEMO label alone, without separate matching project IDs', () => {
    expect(() => assertInvestorDemoIsolation({ ...valid, namedDemoProjectId: undefined }))
      .toThrow('INVESTOR_DEMO_EXPLICIT_FIREBASE_PROJECT_REQUIRED');
    expect(() => assertInvestorDemoIsolation({ ...valid, publicProjectId: 'g-hims-ai' }))
      .toThrow('INVESTOR_DEMO_EXPLICIT_FIREBASE_PROJECT_REQUIRED');
    expect(() => assertInvestorDemoIsolation({ ...valid, runtime: 'PRODUCTION' }))
      .toThrow('INVESTOR_DEMO_DUAL_DEMO_RUNTIME_REQUIRED');
  });
  test('denies every known production/staging project even if deliberately mislabeled DEMO', () => {
    for (const project of ['g-hims-ai', 'studio-1130431360-48a05', 'ghims-test-project']) {
      const target = { ...valid, projectId: project, publicProjectId: project,
        namedDemoProjectId: project, publicNamedDemoProjectId: project };
      expect(() => assertInvestorDemoIsolation(target))
        .toThrow('INVESTOR_DEMO_PROTECTED_PROJECT_COLLISION');
    }
  });
  test('fails on partial emulator / remote emulator / hosted writes without explicit ack', () => {
    expect(() => assertInvestorDemoIsolation({ ...valid, firebaseAuthEmulatorHost: undefined }))
      .toThrow('INVESTOR_DEMO_PARTIAL_EMULATOR_CONFIGURATION');
    expect(() => assertInvestorDemoIsolation({ ...valid, firestoreEmulatorHost: '10.0.0.5:8080' }))
      .toThrow('INVESTOR_DEMO_LOOPBACK_EMULATORS_REQUIRED');
    expect(() => assertInvestorDemoIsolation({ ...valid, vercel: '1' }))
      .toThrow('INVESTOR_DEMO_LOOPBACK_EMULATORS_REQUIRED');
    expect(() => assertInvestorDemoIsolation({
      ...valid, firestoreEmulatorHost: undefined, firebaseAuthEmulatorHost: undefined,
    })).toThrow('INVESTOR_DEMO_HOSTED_WRITE_ACK_REQUIRED');
    expect(() => assertInvestorDemoIsolation({
      ...valid, firestoreEmulatorHost: undefined, firebaseAuthEmulatorHost: undefined,
      hostedWriteAck: 'I_ACCEPT_SYNTHETIC_DEMO_WRITES',
    })).not.toThrow();
  });
  test('both seed scripts enforce the guard before obtaining a Firebase client', async () => {
    for (const path of [
      'scripts/demo/provision-clinical-intelligence-demo.ts',
      'scripts/demo/provision-demo-identities.ts',
    ]) {
      const source = await readFile(path, 'utf8');
      expect(source).toContain('assertInvestorDemoFromEnvironment()');
      expect(source.indexOf('assertInvestorDemoFromEnvironment()'))
        .toBeLessThan(source.indexOf('getAdminFirestore()'));
      expect(source).toContain('assertDemoRuntime(');
      expect(source).toContain('GHIMS_DEMO_CONFIRM_TENANT');
    }
  });
  test('local G-HIMS AI DEMO browser uses explicit Firebase emulators without borrowing TEST mode', async () => {
    const source = await readFile('lib/firebase/client.ts', 'utf8');
    expect(source).toContain('NEXT_PUBLIC_GHIMS_DEMO_EMULATORS');
    expect(source).toContain('INVESTOR_DEMO_BROWSER_EMULATOR_SCOPE_INVALID');
    expect(source).toContain("process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE !== 'DEMO'");
    expect(source).toContain("projectId !== process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO");
    expect(source).toContain("connectAuthEmulator(auth, 'http://127.0.0.1:9099'");
    expect(source).toContain("connectFirestoreEmulator(db, '127.0.0.1', 8080)");
    expect(source).toContain('FIREBASE_EMULATOR_MODE_COLLISION');
  });
  test('Cloud Shell seeding uses short-lived gcloud CLI token, never private keys or live Vercel', async () => {
    const adminSource = await readFile('server/firebase/admin.ts', 'utf8');
    const seedSource = await readFile('scripts/demo/provision-hosted-ci-demo-with-adc.sh', 'utf8');
    expect(adminSource).toContain("process.env.GHIMS_DEMO_USE_CLOUD_SHELL_CLI === 'true'");
    expect(adminSource).toContain("process.env.DEVSHELL_PROJECT_ID === 'g-hims-ci-demo'");
    expect(adminSource).toContain("process.env.GHIMS_RUNTIME_MODE === 'DEMO'");
    expect(adminSource).toContain("process.env.FIREBASE_PROJECT_ID === 'g-hims-ci-demo'");
    expect(adminSource).toContain("process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO === 'g-hims-ci-demo'");
    expect(adminSource).toContain('!process.env.VERCEL');
    expect(adminSource).toContain('credential: applicationDefault()');
    expect(adminSource).not.toContain('cloudShellDemoCredential()');
    expect(seedSource).toContain('GHIMS_DEMO_USE_CLOUD_SHELL_CLI=true');
    expect(seedSource).toContain('bun scripts/demo/verify-cloud-shell-firebase-readiness.ts');
    expect(seedSource.indexOf('bun scripts/demo/verify-cloud-shell-firebase-readiness.ts'))
      .toBeLessThan(seedSource.indexOf("read -r -p"));
    expect(seedSource).toContain('gcloud auth print-access-token --project="$demo_project" >/dev/null 2>&1');
    expect(seedSource).not.toContain('gcloud auth application-default login --project');
    expect(seedSource).toContain("demo_project='g-hims-ci-demo'");
    const preflight = await readFile('scripts/demo/verify-cloud-shell-firebase-readiness.ts', 'utf8');
    expect(preflight).toContain('await auth.listUsers(1)');
    expect(preflight).toContain("await firestore.collection('tenants').doc(tenantId).get()");
    expect(preflight).not.toContain('.set(');
    expect(preflight).not.toContain('.create(');
    expect(preflight).not.toContain('.update(');
  });
  test('hosted DEMO verification never writes synthetic patient or auth data', async () => {
    const shell = await readFile('scripts/demo/verify-hosted-ci-demo.sh', 'utf8');
    const verifier = await readFile('scripts/demo/verify-hosted-ci-demo.ts', 'utf8');
    expect(shell).toContain("demo_project='g-hims-ci-demo'");
    expect(shell).toContain('bun scripts/demo/verify-hosted-ci-demo.ts');
    expect(shell).not.toContain('I_ACCEPT_SYNTHETIC_DEMO_WRITES');
    expect(verifier).toContain("const projectId = 'g-hims-ci-demo'");
    expect(verifier).toContain("tenantRef.collection('patients').doc(patientId).get()");
    expect(verifier).toContain("tenantRef.collection('patient360Projections').doc(patientId).get()");
    expect(verifier).toContain("projectionData.timelineReady !== true");
    expect(verifier).toContain('CI_DEMO_HOSTED_READ_VERIFICATION=PASS');
    expect(verifier).not.toContain('.set(');
    expect(verifier).not.toContain('.create(');
    expect(verifier).not.toContain('.update(');
    expect(verifier).not.toContain('rebuildPatient(');
  });
  test('Vercel DEMO WIF display names fit Google Cloud limits', async () => {
    const setup = await readFile('scripts/demo/configure-vercel-preview-wif.sh', 'utf8');
    const poolName = setup.match(/^pool_display='([^']+)'$/m)?.[1];
    const providerName = setup.match(/^provider_display='([^']+)'$/m)?.[1];
    expect(poolName).toBeDefined();
    expect(providerName).toBeDefined();
    expect(poolName!.length).toBeLessThanOrEqual(32);
    expect(providerName!.length).toBeLessThanOrEqual(32);
    expect(setup).toContain('--display-name="$pool_display"');
    expect(setup).toContain('--display-name="$provider_display"');
    expect(setup).toContain("project='g-hims-ci-demo'");
    expect(setup).toContain("environment='preview'");
    expect(setup).toContain('roles/iam.workloadIdentityUser');
    expect(setup).not.toContain('service-accounts keys create');
  });

  test('fundraising landing exists in G-HIMS AI but not in production runtime', async () => {
    const source = await readFile('app/[tenantId]/clinical-intelligence/page.tsx', 'utf8');
    expect(source).toContain("getRuntimeMode() !== 'DEMO'");
    expect(source).toContain("getPublicRuntimeMode() !== 'DEMO'");
    expect(source).toContain('notFound()');
    expect(source).toContain('/patients/demo-ci-patient-001/360');
    expect(source).toContain('SYNTHETIC DEMO');
    expect(source).not.toContain('bypassAuthorization');
  });
});
