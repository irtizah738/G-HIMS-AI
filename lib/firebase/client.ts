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

function cleanValue(val: string | undefined): string {
  if (!val) return '';
  let str = String(val).trim();
  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    str = str.slice(1, -1).trim();
  }
  return str;
}

// Opt-in only: the browser sandbox must never connect to hosted Firebase.
const requestedLocalSandbox = process.env.NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS === 'true';
// Dedicated local investor-demo runtime, completely separate from TEST.
const requestedDemoSandbox = process.env.NEXT_PUBLIC_GHIMS_DEMO_EMULATORS === 'true';
const requestedAnyEmulator = requestedLocalSandbox || requestedDemoSandbox;
if (requestedLocalSandbox && requestedDemoSandbox) {
  throw new Error('FIREBASE_EMULATOR_MODE_COLLISION');
}

const clientCredentials = {
  apiKey: requestedAnyEmulator ? 'ghims-local-synthetic-api-key' : (cleanValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY) || firebaseConfig.apiKey),
  authDomain: requestedAnyEmulator ? ((cleanValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) || 'ghims-demo') + '.firebaseapp.com') : (cleanValue(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) || firebaseConfig.authDomain),
  projectId: cleanValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) || firebaseConfig.projectId,
  storageBucket: requestedAnyEmulator ? ((cleanValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) || 'ghims-demo') + '.appspot.com') : (cleanValue(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) || firebaseConfig.storageBucket),
  messagingSenderId: requestedAnyEmulator ? '000000000000' : (cleanValue(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID) || firebaseConfig.messagingSenderId),
  appId: requestedAnyEmulator ? '1:000000000000:web:0000000000000000000000' : (cleanValue(process.env.NEXT_PUBLIC_FIREBASE_APP_ID) || firebaseConfig.appId),
  measurementId: requestedAnyEmulator ? '' : (cleanValue(process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID) || firebaseConfig.measurementId),
};

assertClientFirebaseProjectIsolation(String(clientCredentials.projectId || ''));

// Singleton Client App instance. A pre-existing default app must belong to the
// same environment; never silently reuse another project's app.
const existingClientApp: FirebaseApp | null = getApps().length > 0 ? getApp() : null;
if (existingClientApp) {
  const existingProjectId = cleanValue(String(existingClientApp.options.projectId || ''));
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

if (requestedDemoSandbox && typeof window !== 'undefined') {
  const localPage = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const projectId = String(clientCredentials.projectId || '');
  if (!localPage || process.env.NODE_ENV === 'production' ||
      process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE !== 'DEMO' ||
      !projectId ||
      projectId !== process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO ||
      projectId === 'g-hims-ai' ||
      projectId === 'studio-1130431360-48a05') {
    throw new Error('INVESTOR_DEMO_BROWSER_EMULATOR_SCOPE_INVALID');
  }
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

if (requestedLocalSandbox && typeof window !== 'undefined') {
  const localPage = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (process.env.NODE_ENV === 'production' ||
      process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE !== 'TEST' ||
      String(clientCredentials.projectId) !== 'ghims-dev-sandbox-local' ||
      process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST !== 'ghims-dev-sandbox-local' ||
      !localPage) {
    throw new Error('DEV_SANDBOX_BROWSER_EMULATOR_SCOPE_INVALID');
  }
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

// Firestore Instance with multi-tenant custom database ID support and forced long polling for preview sandbox stability
const rawCustomDbId = cleanValue(process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID) || (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
const customDbId = cleanValue(rawCustomDbId);

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

if (requestedDemoSandbox && typeof window !== 'undefined') {
  // The strict DEMO + loopback guard above has already succeeded.
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

if (requestedLocalSandbox && typeof window !== 'undefined') {
  // The strict TEST and localhost guard above has already succeeded.
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

// Analytics Instance (Safe SSR / Browser verification)
let analyticsInstance: Analytics | null = null;

export async function getFirebaseAnalytics(): Promise<Analytics | null> {
  if (typeof window === 'undefined' || requestedAnyEmulator) {
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
