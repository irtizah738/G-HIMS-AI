/**
 * Fail-closed guard for the disposable development sandbox.
 *
 * It is intentionally impossible to use against a hosted Firebase project.
 * No clinical permission, tenant or Firestore-rule bypass is introduced.
 */
export interface SandboxEnvironment {
  GHIMS_RUNTIME_MODE?: string;
  NODE_ENV?: string;
  FIREBASE_PROJECT_ID?: string;
  GCLOUD_PROJECT?: string;
  GHIMS_FIREBASE_PROJECT_ID_TEST?: string;
  GHIMS_FIREBASE_PROJECT_ID_DEMO?: string;
  GHIMS_FIREBASE_PROJECT_ID_STAGING?: string;
  GHIMS_FIREBASE_PROJECT_ID_PRODUCTION?: string;
  NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING?: string;
  NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION?: string;
  FIRESTORE_EMULATOR_HOST?: string;
  FIREBASE_AUTH_EMULATOR_HOST?: string;
  GHIMS_DEV_SANDBOX_TENANT_ID?: string;
  GHIMS_DEV_SANDBOX_ACK?: string;
}

export const SANDBOX_ACK = 'I_CONFIRM_DISPOSABLE_LOCAL_EMULATORS_ONLY';
export const SANDBOX_PROJECT_ID = 'ghims-dev-sandbox-local';
export const SANDBOX_TENANT_ID = 'dev-sandbox-hospital';

function localEmulatorHost(value: unknown): boolean {
  const host = String(value || '').trim();
  return /^(localhost|127\.0\.0\.1):\d{2,5}$/.test(host);
}

export function validateDevelopmentSandbox(env: SandboxEnvironment): {
  projectId: string;
  tenantId: string;
} {
  if (String(env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase() !== 'TEST' ||
      String(env.NODE_ENV || '').toLowerCase() === 'production') {
    throw new Error('DEV_SANDBOX_TEST_RUNTIME_ONLY');
  }
  if (env.GHIMS_DEV_SANDBOX_ACK !== SANDBOX_ACK) {
    throw new Error('DEV_SANDBOX_OPERATOR_ACK_REQUIRED');
  }
  if (!localEmulatorHost(env.FIRESTORE_EMULATOR_HOST) ||
      !localEmulatorHost(env.FIREBASE_AUTH_EMULATOR_HOST)) {
    throw new Error('DEV_SANDBOX_REQUIRES_LOCAL_FIRESTORE_AND_AUTH_EMULATORS');
  }
  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  const tenantId = String(env.GHIMS_DEV_SANDBOX_TENANT_ID || '').trim().toLowerCase();
  if (projectId !== SANDBOX_PROJECT_ID ||
      String(env.GHIMS_FIREBASE_PROJECT_ID_TEST || '').trim() !== SANDBOX_PROJECT_ID ||
      (env.GCLOUD_PROJECT && env.GCLOUD_PROJECT !== SANDBOX_PROJECT_ID)) {
    throw new Error('DEV_SANDBOX_DEDICATED_PROJECT_REQUIRED');
  }
  const protectedProjects = [
    env.GHIMS_FIREBASE_PROJECT_ID_DEMO,
    env.GHIMS_FIREBASE_PROJECT_ID_STAGING,
    env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION,
    env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING,
    env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION,
  ];
  if (protectedProjects.some(value => String(value || '').trim() === projectId)) {
    throw new Error('DEV_SANDBOX_PROTECTED_PROJECT_COLLISION');
  }
  if (tenantId !== SANDBOX_TENANT_ID) {
    throw new Error('DEV_SANDBOX_DEDICATED_TENANT_REQUIRED');
  }
  return { projectId, tenantId };
}
