/**
 * CIQP / R7: read-only local configuration preflight for isolated G-HIMS-AI
 * Vercel Preview. Never initializes Firebase, reads PHI or performs writes.
 *
 * A passing configuration check is NOT evidence of service-account IAM,
 * provider MFA, hosted reachability, staging data provenance or approval.
 */
export type StagingPreflightStatus = 'BLOCKED' | 'CONFIGURATION_CANDIDATE';

export interface StagingPreflightResult {
  operation: 'GHIMS_AI_STAGING_CONFIGURATION_PREFLIGHT';
  status: StagingPreflightStatus;
  missingKeys: string[];
  blockerCodes: string[];
  firebaseNetworkCalls: 0;
  writesPerformed: 0;
  clinicalReleaseAuthority: 'NOT_GRANTED';
  productionDeploymentAuthority: 'NOT_GRANTED';
}

const REQUIRED_PUBLIC_FIREBASE = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
] as const;

const REQUIRED_PROJECTS = [
  'FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'GHIMS_FIREBASE_PROJECT_ID_STAGING',
  'NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING',
  'GHIMS_FIREBASE_PROJECT_ID_PRODUCTION',
  'NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION',
] as const;

const REQUIRED_FIRESTORE = [
  'FIRESTORE_DATABASE_ID',
  'NEXT_PUBLIC_FIRESTORE_DATABASE_ID',
] as const;

const REQUIRED_ADMIN = ['FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'] as const;

const DISABLED_UNTIL_QUALIFIED = [
  'GHIMS_INTEGRATION_AI_STATE',
  'GHIMS_INTEGRATION_HL7_STATE',
  'GHIMS_INTEGRATION_FHIR_R4_STATE',
  'GHIMS_INTEGRATION_DICOMWEB_STATE',
  'GHIMS_INTEGRATION_DEVICE_TELEMETRY_STATE',
  'GHIMS_INTEGRATION_EDI_X12_STATE',
] as const;

const normalized = (env: NodeJS.ProcessEnv, key: string): string =>
  String(env[key] ?? '').trim();

/**
 * Sanitized assessment. Do not put env values in this result, including public
 * project IDs: a uniform output is easier to retain as non-sensitive evidence.
 */
export function evaluateStagingConfiguration(
  env: NodeJS.ProcessEnv
): StagingPreflightResult {
  const blockers = new Set<string>();
  const required = [
    ...REQUIRED_PUBLIC_FIREBASE, ...REQUIRED_PROJECTS,
    ...REQUIRED_FIRESTORE, ...REQUIRED_ADMIN,
    ...DISABLED_UNTIL_QUALIFIED,
  ];
  const missingKeys = required.filter(key => !normalized(env, key)).sort();

  if (missingKeys.length) blockers.add('STAGING_REQUIRED_CONFIGURATION_MISSING');
  if (normalized(env, 'GHIMS_RUNTIME_MODE') !== 'STAGING' ||
      normalized(env, 'NEXT_PUBLIC_GHIMS_RUNTIME_MODE') !== 'STAGING') {
    blockers.add('STAGING_RUNTIME_NOT_EXPLICIT');
  }
  // This utility may be run locally against pulled Preview configuration.
  // If Vercel supplies its target, any non-Preview target is forbidden.
  if (normalized(env, 'VERCEL_ENV') &&
      normalized(env, 'VERCEL_ENV') !== 'preview') {
    blockers.add('STAGING_VERCEL_TARGET_NOT_PREVIEW');
  }
  if (normalized(env, 'FIRESTORE_EMULATOR_HOST') ||
      normalized(env, 'FIREBASE_AUTH_EMULATOR_HOST')) {
    blockers.add('STAGING_EMULATOR_CONFIG_NOT_HOSTED');
  }

  const staging = normalized(env, 'GHIMS_FIREBASE_PROJECT_ID_STAGING');
  const publicStaging = normalized(env, 'NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING');
  const activeServer = normalized(env, 'FIREBASE_PROJECT_ID');
  const activeClient = normalized(env, 'NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  const production = normalized(env, 'GHIMS_FIREBASE_PROJECT_ID_PRODUCTION');
  const publicProduction = normalized(env, 'NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION');

  if (staging && (!/^[a-z][a-z0-9-]{4,62}$/.test(staging) ||
      staging === 'g-hims-ai')) {
    blockers.add('STAGING_FIREBASE_PROJECT_INVALID');
  }
  if (staging && production && staging === production) {
    blockers.add('STAGING_PRODUCTION_PROJECT_COLLISION');
  }
  if (production && publicProduction && production !== publicProduction) {
    blockers.add('STAGING_PRODUCTION_COMPARATOR_MISMATCH');
  }
  if ([staging, publicStaging, activeServer, activeClient].every(Boolean) &&
      new Set([staging, publicStaging, activeServer, activeClient]).size !== 1) {
    blockers.add('STAGING_ACTIVE_FIREBASE_PROJECT_MISMATCH');
  }
  // Partial configuration is also a mismatch; never infer successful isolation
  // from a project ID entered on only one side.
  if (!staging || !publicStaging || !activeServer || !activeClient ||
      !production || !publicProduction) {
    blockers.add('STAGING_PROJECT_ISOLATION_UNVERIFIED');
  }
  const otherModes = [
    'GHIMS_FIREBASE_PROJECT_ID_TEST',
    'GHIMS_FIREBASE_PROJECT_ID_DEMO',
    'NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST',
    'NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO',
  ];
  if (staging && otherModes.some(key => normalized(env, key) === staging)) {
    blockers.add('STAGING_NONPRODUCTION_PROJECT_COLLISION');
  }

  const db = normalized(env, 'FIRESTORE_DATABASE_ID');
  const publicDb = normalized(env, 'NEXT_PUBLIC_FIRESTORE_DATABASE_ID');
  if (db && publicDb && db !== publicDb) {
    blockers.add('STAGING_FIRESTORE_DATABASE_MISMATCH');
  }

  // Configured email is not independent IAM attestation; require a dedicated
  // service identity's project domain as an additional fail-closed check.
  const serviceEmail = normalized(env, 'FIREBASE_CLIENT_EMAIL');
  if (serviceEmail && staging &&
      !serviceEmail.endsWith('@' + staging + '.iam.gserviceaccount.com')) {
    blockers.add('STAGING_ADMIN_IDENTITY_NOT_PROJECT_SCOPED');
  }

  if (DISABLED_UNTIL_QUALIFIED.some(key =>
    normalized(env, key) !== 'DISABLED')) {
    blockers.add('STAGING_UNQUALIFIED_INTEGRATION_ACTIVE');
  }

  return {
    operation: 'GHIMS_AI_STAGING_CONFIGURATION_PREFLIGHT',
    status: blockers.size ? 'BLOCKED' : 'CONFIGURATION_CANDIDATE',
    missingKeys,
    blockerCodes: [...blockers].sort(),
    firebaseNetworkCalls: 0,
    writesPerformed: 0,
    clinicalReleaseAuthority: 'NOT_GRANTED',
    productionDeploymentAuthority: 'NOT_GRANTED',
  };
}

if (import.meta.main) {
  const report = evaluateStagingConfiguration(process.env);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.status === 'BLOCKED') process.exitCode = 1;
}
