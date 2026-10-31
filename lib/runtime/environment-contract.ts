import { getRuntimeMode, inferRuntimeModeFromNodeEnv, type GhimsRuntimeMode } from './runtime-mode';
import firebaseConfig from '@/firebase-applet-config.json';
import { assertVercelDeploymentFirebaseIsolation } from './vercel-deployment-isolation';

type ProjectMap = Partial<Record<GhimsRuntimeMode, string>>;

function clean(value: string | undefined): string {
  if (!value) return '';
  let str = String(value).trim();
  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    str = str.slice(1, -1).trim();
  }
  return str;
}

function assertConfiguredTestDemoDistinct(testId: string, demoId: string, scope: string): void {
  if (testId && demoId && testId === demoId) {
    throw new Error('ENVIRONMENT_PROJECT_COLLISION: ' + scope +
      ' TEST and DEMO must use distinct explicitly configured Firebase projects.');
  }
}

function serverProjectMap(): ProjectMap {
  const demo = clean(process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO);
  const test = clean(process.env.GHIMS_FIREBASE_PROJECT_ID_TEST);
  assertConfiguredTestDemoDistinct(test, demo, 'server');
  const prod = clean(process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION);
  const ambient = clean(process.env.FIREBASE_PROJECT_ID) || firebaseConfig.projectId;
  const defaultTest = ambient && ambient !== demo && ambient !== prod ? ambient : 'ghims-test';
  const runtime = getRuntimeMode();
  // Never assign the active TEST project's ambient Firebase ID to DEMO or
  // PRODUCTION: they are separate authority boundaries, not aliases.
  // A deployed mode may use its own ambient ID only when that mode is active.
  // Explicit GHIMS_FIREBASE_PROJECT_ID_* values always participate in collision
  // detection regardless of the active mode.
  return {
    DEMO: demo || (runtime === 'DEMO' ? ambient : ''),
    TEST: test || defaultTest,
    STAGING: clean(process.env.GHIMS_FIREBASE_PROJECT_ID_STAGING),
    PRODUCTION: prod || (runtime === 'PRODUCTION' ? ambient : ''),
  };
}

function clientProjectMap(): ProjectMap {
  // NEXT_PUBLIC variables must be referenced statically so Next.js can inline them
  // into the browser bundle.
  const demo = clean(process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO);
  const test = clean(process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST);
  assertConfiguredTestDemoDistinct(test, demo, 'client');
  const prod = clean(process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION);
  const ambient = clean(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) || firebaseConfig.projectId;
  const defaultTest = ambient && ambient !== demo && ambient !== prod ? ambient : 'ghims-test';
  const runtime = getPublicRuntimeMode();
  return {
    DEMO: demo || (runtime === 'DEMO' ? ambient : ''),
    TEST: test || defaultTest,
    STAGING: clean(process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING),
    PRODUCTION: prod || (runtime === 'PRODUCTION' ? ambient : ''),
  };
}

function assertDistinctNamedProjects(projects: ProjectMap, scope: string): void {
  const explicitMode = Boolean(process.env.GHIMS_RUNTIME_MODE || process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE);
  if (!explicitMode) return;
  const protectedModes: GhimsRuntimeMode[] = ['TEST', 'DEMO', 'STAGING', 'PRODUCTION'];
  const seen = new Map<string, GhimsRuntimeMode>();

  for (const mode of protectedModes) {
    const projectId = clean(projects[mode]);
    if (!projectId) continue;
    const prior = seen.get(projectId);
    if (prior) {
      throw new Error(
        'ENVIRONMENT_PROJECT_COLLISION: ' + scope + ' project ' + projectId +
        ' is configured for both ' + prior + ' and ' + mode + '.'
      );
    }
    seen.set(projectId, mode);
  }
}

function assertProjectMatchesMode(
  scope: string,
  mode: GhimsRuntimeMode,
  actualProjectId: string,
  projects: ProjectMap
): void {
  assertDistinctNamedProjects(projects, scope);

  const actual = clean(actualProjectId);
  if (!actual) {
    throw new Error('FIREBASE_PROJECT_ID_REQUIRED: ' + scope + ' Firebase project ID is empty.');
  }

  const expected = clean(projects[mode]);
  const explicitMode = Boolean(process.env.GHIMS_RUNTIME_MODE || process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE);
  const strict = explicitMode && (mode === 'STAGING' || mode === 'PRODUCTION');

  if (strict && !expected) {
    throw new Error(
      'ENVIRONMENT_PROJECT_NOT_CONFIGURED: ' + scope + ' ' + mode +
      ' requires an explicit dedicated Firebase project ID.'
    );
  }

  if (expected && actual !== expected && explicitMode) {
    throw new Error(
      'ENVIRONMENT_PROJECT_MISMATCH: ' + scope + ' runtime ' + mode +
      ' expected Firebase project ' + expected + ' but received ' + actual + '.'
    );
  }
}

/**
 * Staging cannot prove isolation if the production project identity is missing.
 * Its public Firebase project ID is not a secret and must be configured for
 * both server and browser environments so an accidental shared project fails
 * before either Firebase SDK initializes or handles clinical data.
 */
export function assertStagingProjectDistinct(
  stagingProjectId: string | undefined,
  productionProjectId: string | undefined,
  scope: 'server' | 'client'
): void {
  const staging = clean(stagingProjectId);
  const production = clean(productionProjectId);
  if (!staging || !production) {
    throw new Error(
      'ENVIRONMENT_STAGING_ISOLATION_UNVERIFIED: ' + scope +
      ' requires explicit, separate staging and production Firebase project IDs.'
    );
  }
  if (staging === production) {
    throw new Error(
      'ENVIRONMENT_PROJECT_COLLISION: ' + scope +
      ' STAGING and PRODUCTION cannot share a Firebase project.'
    );
  }
}

export function assertServerFirebaseProjectIsolation(actualProjectId: string): void {
  // Vercel target authority is independent of the app runtime mode.
  // Reject Preview/Production project collisions before Admin SDK initialization.
  assertVercelDeploymentFirebaseIsolation(process.env, actualProjectId);
  const mode = getRuntimeMode();
  const projects = serverProjectMap();
  if (mode === 'STAGING') {
    assertStagingProjectDistinct(projects.STAGING, projects.PRODUCTION, 'server');
  }
  assertProjectMatchesMode('server', mode, actualProjectId, projects);
}

export function getPublicRuntimeMode(): GhimsRuntimeMode {
  const raw = clean(process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE).toUpperCase();
  if (raw === 'DEMO' || raw === 'TEST' || raw === 'STAGING' || raw === 'PRODUCTION') {
    return raw;
  }

  // Local/dev previews are sandboxes. Production builds remain fail-closed
  // unless NEXT_PUBLIC_GHIMS_RUNTIME_MODE is explicitly configured.
  return inferRuntimeModeFromNodeEnv(process.env.NODE_ENV);
}

export function assertClientFirebaseProjectIsolation(actualProjectId: string): void {
  const mode = getPublicRuntimeMode();
  const projects = clientProjectMap();
  if (mode === 'STAGING') {
    assertStagingProjectDistinct(projects.STAGING, projects.PRODUCTION, 'client');
  }
  assertProjectMatchesMode('client', mode, actualProjectId, projects);
}
