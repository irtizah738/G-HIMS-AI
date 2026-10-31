/**
 * Read-only prerequisite verification for the isolated hosted investor demo.
 * Invoked before any synthetic credentials/passwords or hosted write approval.
 * Uses the supported Firebase Admin ADC implementation available in Cloud Shell.
 */
import { getAdminAuth, getAdminFirestore } from '../../server/firebase/admin';
import { assertDemoRuntime } from '../../lib/runtime/runtime-mode';
import { assertServerFirebaseProjectIsolation } from '../../lib/runtime/environment-contract';

const target = 'g-hims-ci-demo';
const tenantId = 'central-metro-hospital';

assertDemoRuntime('Cloud Shell Firebase demo readiness');
assertServerFirebaseProjectIsolation(target);
if (
  process.env.DEVSHELL_PROJECT_ID !== target ||
  process.env.GHIMS_DEMO_USE_CLOUD_SHELL_CLI !== 'true' ||
  process.env.FIREBASE_PROJECT_ID !== target ||
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== target ||
  process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO !== target ||
  process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO !== target ||
  process.env.VERCEL ||
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  process.env.FIREBASE_PRIVATE_KEY ||
  process.env.FIRESTORE_EMULATOR_HOST ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  process.env.GHIMS_DEMO_HOSTED_WRITE_ACK
) throw new Error('DEMO_READONLY_PREFLIGHT_ENVIRONMENT_INVALID');

const auth = getAdminAuth();
const firestore = getAdminFirestore();
if (!auth || !firestore) {
  throw new Error('DEMO_READONLY_PREFLIGHT_ADMIN_SDK_UNAVAILABLE');
}

try {
  await auth.listUsers(1);
  console.log('DEMO_FIREBASE_AUTH_READONLY=PASS');
} catch (error: any) {
  // Never print token/credential contents. Codes alone diagnose IAM failures.
  throw new Error(
    'DEMO_FIREBASE_AUTH_READONLY_FAILED: ' + String(error?.code || error?.name || 'UNKNOWN')
  );
}

try {
  await firestore.collection('tenants').doc(tenantId).get();
  console.log('DEMO_FIRESTORE_READONLY=PASS');
} catch (error: any) {
  throw new Error(
    'DEMO_FIRESTORE_READONLY_FAILED: ' + String(error?.code || error?.name || 'UNKNOWN')
  );
}

console.log('DEMO_READONLY_PREFLIGHT=PASS');
