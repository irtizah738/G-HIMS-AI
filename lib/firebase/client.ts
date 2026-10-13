import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { initializeFirestore, getFirestore, Firestore, setLogLevel } from 'firebase/firestore';
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

const clientCredentials = {
  apiKey: cleanValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY) || firebaseConfig.apiKey,
  authDomain: cleanValue(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) || firebaseConfig.authDomain,
  projectId: cleanValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) || firebaseConfig.projectId,
  storageBucket: cleanValue(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) || firebaseConfig.storageBucket,
  messagingSenderId: cleanValue(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID) || firebaseConfig.messagingSenderId,
  appId: cleanValue(process.env.NEXT_PUBLIC_FIREBASE_APP_ID) || firebaseConfig.appId,
  measurementId: cleanValue(process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID) || firebaseConfig.measurementId,
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

// Analytics Instance (Safe SSR / Browser verification)
let analyticsInstance: Analytics | null = null;

export async function getFirebaseAnalytics(): Promise<Analytics | null> {
  if (typeof window === 'undefined') {
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
