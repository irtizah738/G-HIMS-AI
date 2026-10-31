/**
 * Exclusive authority for investor-demo data writes.
 *
 * "DEMO" as a runtime label is NOT enough: require an explicitly named,
 * dedicated Firebase project in both server and browser configuration.
 * This guard runs before either demo bootstrap script creates clients/writes.
 */
export interface InvestorDemoTarget {
  runtime: string | undefined;
  publicRuntime: string | undefined;
  projectId: string | undefined;
  publicProjectId: string | undefined;
  namedDemoProjectId: string | undefined;
  publicNamedDemoProjectId: string | undefined;
  productionProjectId?: string | undefined;
  stagingProjectId?: string | undefined;
  testProjectId?: string | undefined;
  firebaseAuthEmulatorHost?: string | undefined;
  firestoreEmulatorHost?: string | undefined;
  vercel?: string | undefined;
  hostedWriteAck?: string | undefined;
}

const clean = (value: string | undefined) => String(value || '').trim();

export function assertInvestorDemoIsolation(target: InvestorDemoTarget): void {
  const runtime = clean(target.runtime).toUpperCase();
  const publicRuntime = clean(target.publicRuntime).toUpperCase();
  if (runtime !== 'DEMO' || publicRuntime !== 'DEMO') {
    throw new Error('INVESTOR_DEMO_DUAL_DEMO_RUNTIME_REQUIRED');
  }
  const project = clean(target.projectId);
  const client = clean(target.publicProjectId);
  const named = clean(target.namedDemoProjectId);
  const publicNamed = clean(target.publicNamedDemoProjectId);
  if (!project || !named || !publicNamed || project !== client ||
      project !== named || project !== publicNamed ||
      !/^[a-z][a-z0-9-]{5,62}$/.test(project)) {
    throw new Error('INVESTOR_DEMO_EXPLICIT_FIREBASE_PROJECT_REQUIRED');
  }
  // The known production and staging projects cannot ever serve investor-demo data.
  const blocked = new Set([
    'g-hims-ai',
    'studio-1130431360-48a05',
    clean(target.productionProjectId),
    clean(target.stagingProjectId),
    clean(target.testProjectId),
  ].filter(Boolean));
  if (blocked.has(project)) {
    throw new Error('INVESTOR_DEMO_PROTECTED_PROJECT_COLLISION');
  }
  const authHost = clean(target.firebaseAuthEmulatorHost);
  const firestoreHost = clean(target.firestoreEmulatorHost);
  if (Boolean(authHost) !== Boolean(firestoreHost)) {
    throw new Error('INVESTOR_DEMO_PARTIAL_EMULATOR_CONFIGURATION');
  }
  if (authHost || firestoreHost) {
    if (target.vercel ||
        !/^127\.0\.0\.1:[0-9]{2,5}$/.test(authHost) ||
        !/^127\.0\.0\.1:[0-9]{2,5}$/.test(firestoreHost)) {
      throw new Error('INVESTOR_DEMO_LOOPBACK_EMULATORS_REQUIRED');
    }
  } else if (clean(target.hostedWriteAck) !== 'I_ACCEPT_SYNTHETIC_DEMO_WRITES') {
    throw new Error('INVESTOR_DEMO_HOSTED_WRITE_ACK_REQUIRED');
  }
}

export function assertInvestorDemoFromEnvironment(): void {
  assertInvestorDemoIsolation({
    runtime: process.env.GHIMS_RUNTIME_MODE,
    publicRuntime: process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE,
    projectId: process.env.FIREBASE_PROJECT_ID,
    publicProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    namedDemoProjectId: process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO,
    publicNamedDemoProjectId: process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO,
    productionProjectId: process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION,
    stagingProjectId: process.env.GHIMS_FIREBASE_PROJECT_ID_STAGING,
    testProjectId: process.env.GHIMS_FIREBASE_PROJECT_ID_TEST,
    firebaseAuthEmulatorHost: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    vercel: process.env.VERCEL,
    hostedWriteAck: process.env.GHIMS_DEMO_HOSTED_WRITE_ACK,
  });
}
