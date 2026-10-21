/**
 * G-HIMS-AI CI-10I exact production-target configuration guard.
 *
 * A checked source/environment string does NOT attest service-account IAM,
 * live deployed commit identity, production connectivity, institutional
 * approval, or clinical safety. Those must be qualified independently.
 *
 * Pure function: no Firebase Admin initialization, credentials readback,
 * network, logging, clinical reads or writes.
 */
const OFFICIAL_GHIMS_AI_PRODUCTION_FIREBASE = 'g-hims-ai';
const SEPARATE_GHIMS_OS_STAGING_FIREBASE = 'studio-1130431360-48a05';

export type Ci10iProductionTargetAssessment = {
  status: 'CONFIGURATION_MATCH_ONLY' | 'BLOCKED';
  blockers: string[];
  clinicalReleaseAuthorization: 'NOT_GRANTED';
  productionDeploymentAuthorization: 'NOT_GRANTED';
  networkCalls: 0;
  writesPerformed: 0;
};

export function evaluateCi10iProductionTarget(
  env: NodeJS.ProcessEnv
): Ci10iProductionTargetAssessment {
  const value = (key: string) => String(env[key] ?? '').trim();
  const blockers = new Set<string>();

  const ids = [
    value('FIREBASE_PROJECT_ID'),
    value('NEXT_PUBLIC_FIREBASE_PROJECT_ID'),
    value('GHIMS_FIREBASE_PROJECT_ID_PRODUCTION'),
    value('NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION'),
  ];

  if (ids.some(id => id !== OFFICIAL_GHIMS_AI_PRODUCTION_FIREBASE)) {
    blockers.add('CI10I_OFFICIAL_PRODUCTION_PROJECT_REQUIRED');
  }

  const otherProjectKeys = [
    'GHIMS_FIREBASE_PROJECT_ID_STAGING',
    'NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING',
    'GHIMS_FIREBASE_PROJECT_ID_TEST',
    'NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST',
    'GHIMS_FIREBASE_PROJECT_ID_DEMO',
    'NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO',
  ];
  if (otherProjectKeys.some(key =>
    value(key) === OFFICIAL_GHIMS_AI_PRODUCTION_FIREBASE)) {
    blockers.add('CI10I_PRODUCTION_PROJECT_REUSED_AS_NONPRODUCTION');
  }
  // Distinct OS staging is not a shortcut to qualify or run G-HIMS-AI.
  if (ids.includes(SEPARATE_GHIMS_OS_STAGING_FIREBASE)) {
    blockers.add('CI10I_GHIMS_OS_STAGING_NOT_PRODUCTION');
  }

  const vercelEnv = value('VERCEL_ENV');
  if (vercelEnv && vercelEnv !== 'production') {
    blockers.add('CI10I_VERCEL_PREVIEW_NOT_PRODUCTION');
  }
  if (value('GHIMS_RUNTIME_MODE') !== 'PRODUCTION' ||
      value('NEXT_PUBLIC_GHIMS_RUNTIME_MODE') !== 'PRODUCTION') {
    blockers.add('CI10I_PRODUCTION_RUNTIME_REQUIRED');
  }
  if (value('FIRESTORE_EMULATOR_HOST') ||
      value('FIREBASE_AUTH_EMULATOR_HOST')) {
    blockers.add('CI10I_EMULATOR_FORBIDDEN_IN_PRODUCTION');
  }

  return {
    status: blockers.size ? 'BLOCKED' : 'CONFIGURATION_MATCH_ONLY',
    blockers: [...blockers].sort(),
    clinicalReleaseAuthorization: 'NOT_GRANTED',
    productionDeploymentAuthorization: 'NOT_GRANTED',
    networkCalls: 0,
    writesPerformed: 0,
  };
}
