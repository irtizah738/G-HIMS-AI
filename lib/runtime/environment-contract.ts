import { getRuntimeMode, type GhimsRuntimeMode } from './runtime-mode';

type ProjectMap = Partial<Record<GhimsRuntimeMode, string>>;

function clean(value: string | undefined): string {
  return String(value || '').trim();
}

function serverProjectMap(): ProjectMap {
  return {
    DEMO: clean(process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO),
    TEST: clean(process.env.GHIMS_FIREBASE_PROJECT_ID_TEST),
    STAGING: clean(process.env.GHIMS_FIREBASE_PROJECT_ID_STAGING),
    PRODUCTION: clean(process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION),
  };
}

function clientProjectMap(): ProjectMap {
  // NEXT_PUBLIC variables must be referenced statically so Next.js can inline them
  // into the browser bundle.
  return {
    DEMO: clean(process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO),
    TEST: clean(process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST),
    STAGING: clean(process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING),
    PRODUCTION: clean(process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION),
  };
}

function assertDistinctNamedProjects(projects: ProjectMap, scope: string): void {
  const protectedModes: GhimsRuntimeMode[] = ['DEMO', 'STAGING', 'PRODUCTION'];
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
  const strict = mode === 'DEMO' || mode === 'STAGING' || mode === 'PRODUCTION';

  if (strict && !expected) {
    throw new Error(
      'ENVIRONMENT_PROJECT_NOT_CONFIGURED: ' + scope + ' ' + mode +
      ' requires an explicit dedicated Firebase project ID.'
    );
  }

  if (expected && actual !== expected) {
    throw new Error(
      'ENVIRONMENT_PROJECT_MISMATCH: ' + scope + ' runtime ' + mode +
      ' expected Firebase project ' + expected + ' but received ' + actual + '.'
    );
  }
}

export function assertServerFirebaseProjectIsolation(actualProjectId: string): void {
  assertProjectMatchesMode(
    'server',
    getRuntimeMode(),
    actualProjectId,
    serverProjectMap()
  );
}

export function getPublicRuntimeMode(): GhimsRuntimeMode {
  const raw = clean(process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE).toUpperCase();
  if (raw === 'DEMO' || raw === 'TEST' || raw === 'STAGING' || raw === 'PRODUCTION') {
    return raw;
  }

  // Browser builds must not silently downgrade a deployed runtime.
  return process.env.NODE_ENV === 'test' ? 'TEST' : 'PRODUCTION';
}

export function assertClientFirebaseProjectIsolation(actualProjectId: string): void {
  assertProjectMatchesMode(
    'client',
    getPublicRuntimeMode(),
    actualProjectId,
    clientProjectMap()
  );
}
