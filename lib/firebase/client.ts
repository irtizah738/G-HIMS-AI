import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, Auth } from 'firebase/auth';
import { initializeFirestore, getFirestore, connectFirestoreEmulator, Firestore, setLogLevel } from 'firebase/firestore';
import { getAnalytics, isSupported, Analytics } from 'firebase/analytics';
import firebaseConfig from '@/firebase-applet-config.json';
import { assertClientFirebaseProjectIsolation } from '@/lib/runtime/environment-contract';

// Configure Firestore log level to avoid unhandled connection retry logs in development/offline modes
if (typeof window !== 'undefined') {
  try {
    setLogLevel('silent');
  } catch {
    // Ignore if already set or unsupported
  }
}

const clientCredentials = {
  // Never reuse a hosted application's telemetry or API configuration in the
  // disposable local emulator. Firebase's Auth/Firestore emulators accept a
  // syntactically valid dummy app config.
  apiKey: process.env.NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS === 'true'
    ? 'ghims-local-synthetic-api-key'
    : process.env.NEXT_PUBLIC_FIREBASE_API_KEY || firebaseConfig.apiKey,
  authDomain: process.env.NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS === 'true'
    ? 'ghims-dev-sandbox-local.firebaseapp.com'
    : process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || firebaseConfig.authDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || firebaseConfig.projectId,
  storageBucket: process.env.NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS === 'true'
    ? 'ghims-dev-sandbox-local.appspot.com'
    : process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket,
  messagingSenderId: process.env.NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS === 'true'
    ? '000000000000'
    : process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || firebaseConfig.messagingSenderId,
  appId: process.env.NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS === 'true'
    ? '1:000000000000:web:0000000000000000000000'
    : process.env.NEXT_PUBLIC_FIREBASE_APP_ID || firebaseConfig.appId,
  measurementId: process.env.NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS === 'true'
    ? ''
    : process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || firebaseConfig.measurementId,
};

assertClientFirebaseProjectIsolation(String(clientCredentials.projectId || ''));

// Singleton Client App instance. A pre-existing default app must belong to the
// same environment; never silently reuse another project's app.
const existingClientApp: FirebaseApp | null = getApps().length > 0 ? getApp() : null;
if (existingClientApp) {
  const existingProjectId = String(existingClientApp.options.projectId || '');
  assertClientFirebaseProjectIsolation(
    existingProjectId || String(clientCredentials.projectId || '')
  );
  if (
    existingProjectId &&
    clientCredentials.projectId &&
    existingProjectId !== clientCredentials.projectId
  ) {
    throw new Error(
      `FIREBASE_CLIENT_PROJECT_MISMATCH: existing app uses ${existingProjectId}, expected ${clientCredentials.projectId}.`
    );
  }
}

export const app: FirebaseApp = existingClientApp || initializeApp(clientCredentials);

// Authentication Instance
export const auth: Auth = getAuth(app);

const requestedLocalSandbox = process.env.NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS === 'true';
if (requestedLocalSandbox && typeof window !== 'undefined') {
  const localPage = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE !== 'TEST' ||
      String(clientCredentials.projectId) !== 'ghims-dev-sandbox-local' ||
      process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST !== 'ghims-dev-sandbox-local' ||
      !localPage ||
      process.env.NODE_ENV === 'production') {
    throw new Error('DEV_SANDBOX_BROWSER_EMULATOR_SCOPE_INVALID');
  }
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

// Firestore Instance with multi-tenant custom database ID support and forced long polling for preview sandbox stability
const customDbId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;

export const db: Firestore = (() => {
  const dbId = customDbId && customDbId !== '(default)' ? customDbId : undefined;
  try {
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
      },
      dbId
    );
  } catch {
    return dbId ? getFirestore(app, dbId) : getFirestore(app);
  }
})();

if (requestedLocalSandbox && typeof window !== 'undefined') {
  // Only the verified local TEST page may opt into the emulator above.
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

// Analytics Instance (Safe SSR / Browser verification)
let analyticsInstance: Analytics | null = null;

export async function getFirebaseAnalytics(): Promise<Analytics | null> {
  if (typeof window === 'undefined' || requestedLocalSandbox) {
    // Local synthetic activity must never reach hosted analytics.
    return null;
  }
  if (!analyticsInstance) {
    const supported = await isSupported().catch(() => false);
    if (supported && clientCredentials.measurementId) {
      try {
        analyticsInstance = getAnalytics(app);
      } catch (err) {
        console.warn('Firebase Analytics initialization skipped:', err);
      }
    }
  }
  return analyticsInstance;
}

export default app;
