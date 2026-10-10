/**
 * Browser connect-src exceptions for the disposable local Firebase emulator.
 *
 * Never enable these origins for hosted, shared, staging or production pages.
 * Reuse the same fail-closed project, tenant and emulator scope as provisioning.
 */
import { validateDevelopmentSandbox, SANDBOX_PROJECT_ID, type SandboxEnvironment } from './safety';

export type SandboxBrowserEnvironment = SandboxEnvironment & {
  NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS?: string;
  NEXT_PUBLIC_GHIMS_RUNTIME_MODE?: string;
  NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
  NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST?: string;
};

export function sandboxEmulatorConnectSources(
  env: SandboxBrowserEnvironment,
  hostname: string
): string[] {
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') return [];
  if (env.NODE_ENV !== 'development' ||
      env.NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS !== 'true' ||
      env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE !== 'TEST' ||
      env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== SANDBOX_PROJECT_ID ||
      env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST !== SANDBOX_PROJECT_ID ||
      env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') {
    return [];
  }

  try {
    validateDevelopmentSandbox(env);
  } catch {
    return [];
  }

  return ['http://127.0.0.1:9099', 'http://127.0.0.1:8080'];
}
