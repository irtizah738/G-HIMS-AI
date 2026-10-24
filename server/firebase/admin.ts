import {
  App,
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { Firestore, getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '@/firebase-applet-config.json';
import { assertServerFirebaseProjectIsolation } from '@/lib/runtime/environment-contract';

let adminApp: App | null = null;
let adminFirestoreInstance: Firestore | null = null;

function formatPrivateKey(rawKey: string | undefined): string | null {
  if (!rawKey) return null;
  let key = rawKey.trim();

  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  if (
    !key ||
    key.length < 30 ||
    key.toLowerCase().includes('your-private-key') ||
    key.toLowerCase().includes('placeholder')
  ) {
    return null;
  }

  key = key.replace(/\\n/g, '\n').replace(/\\r/g, '\r');

  if (key.includes('BEGIN') && key.includes('KEY')) {
    const match = key.match(
      /(-----BEGIN[A-Z0-9_ -]+-----)([\s\S]+?)(-----END[A-Z0-9_ -]+-----)/
    );
    if (match) {
      const header = match[1].trim();
      const body = match[2].replace(/\s+/g, '');
      const footer = match[3].trim();
      const chunks = body.match(/.{1,64}/g) || [body];
      return `${header}\n${chunks.join('\n')}\n${footer}\n`;
    }
  }

  return key;
}

function emulatorRuntimeAllowed(): boolean {
  const mode = String(process.env.GHIMS_RUNTIME_MODE || '').toUpperCase();
  return mode === 'TEST' || mode === 'DEMO';
}

function canUseFirestoreEmulator(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST) && emulatorRuntimeAllowed();
}

function canUseAuthEmulator(): boolean {
  return Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST) && emulatorRuntimeAllowed();
}

function canUseFirebaseEmulator(): boolean {
  return canUseFirestoreEmulator() || canUseAuthEmulator();
}

function canUseApplicationDefaultCredentials(): boolean {
  // Never infer server credentials merely from DEMO runtime or the presence
  // of a metadata endpoint. Vercel still requires its own approved identity.
  if (process.env.VERCEL) return false;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;

  // A deliberate, short-lived operator-only opt-in for the isolated investor
  // demo when this script runs on a Google Cloud VM with an attached identity.
  // The Google Auth library uses the VM metadata server rather than a JSON key.
  return (
    process.env.GHIMS_DEMO_USE_VM_IDENTITY === 'true' &&
    process.env.GHIMS_RUNTIME_MODE === 'DEMO' &&
    process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO' &&
    process.env.FIREBASE_PROJECT_ID === 'g-hims-ci-demo' &&
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === 'g-hims-ci-demo' &&
    process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO === 'g-hims-ci-demo' &&
    process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO === 'g-hims-ci-demo' &&
    !process.env.FIREBASE_AUTH_EMULATOR_HOST &&
    !process.env.FIRESTORE_EMULATOR_HOST
  );
}

function cleanEnvString(raw: string | undefined): string {
  if (!raw) return '';
  let val = raw.trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1).trim();
  }
  return val;
}

function getAdminCredentials(): { clientEmail: string | null; privateKey: string | null } {
  const clientEmail = cleanEnvString(
    process.env.FIREBASE_CLIENT_EMAIL ||
    process.env.client_email ||
    ''
  );

  const rawKey =
    process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_PRIVATE_KEY.includes('BEGIN')
      ? process.env.FIREBASE_PRIVATE_KEY
      : process.env.private_key || process.env.FIREBASE_PRIVATE_KEY;

  const privateKey = formatPrivateKey(rawKey);

  return {
    clientEmail: clientEmail || null,
    privateKey: privateKey || null,
  };
}

export function hasAdminCredentials(): boolean {
  const { clientEmail, privateKey } = getAdminCredentials();

  return Boolean(
    (clientEmail && privateKey) ||
    canUseApplicationDefaultCredentials()
  );
}

export function getAdminApp(): App | null {
  if (adminApp) return adminApp;

  const rawProject =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    firebaseConfig.projectId;
  const projectId = cleanEnvString(rawProject);

  assertServerFirebaseProjectIsolation(projectId);

  const existingApps = getApps();
  if (existingApps.length > 0) {
    const existing = getApp();
    const existingProjectId = cleanEnvString(String(existing.options.projectId || ''));
    assertServerFirebaseProjectIsolation(existingProjectId || projectId);
    if (existingProjectId && projectId && existingProjectId !== projectId) {
      throw new Error(
        `FIREBASE_ADMIN_PROJECT_MISMATCH: existing app uses ${existingProjectId}, expected ${projectId}.`
      );
    }
    adminApp = existing;
    return adminApp;
  }

  const { clientEmail, privateKey } = getAdminCredentials();

  if (canUseFirebaseEmulator()) {
    adminApp = initializeApp({ projectId: projectId || 'ghims-p1-ci' });
    return adminApp;
  }

  if (projectId && clientEmail && privateKey) {
    try {
      adminApp = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        projectId,
      });
      return adminApp;
    } catch (error) {
      console.warn(
        'Notice: Firebase Admin certificate initialization failed:',
        error instanceof Error ? error.message : 'Invalid service account credentials'
      );
      return null;
    }
  }

  if (canUseApplicationDefaultCredentials()) {
    try {
      adminApp = initializeApp({
        credential: applicationDefault(),
        projectId: projectId || process.env.GCLOUD_PROJECT,
      });
      return adminApp;
    } catch {
      return null;
    }
  }

  return null;
}

export function getAdminAuth(): Auth | null {
  if (!hasAdminCredentials() && !canUseAuthEmulator()) return null;
  const app = getAdminApp();
  return app ? getAuth(app) : null;
}

export function getAdminFirestore(): Firestore | null {
  if (!hasAdminCredentials() && !canUseFirestoreEmulator()) return null;
  if (adminFirestoreInstance) return adminFirestoreInstance;

  const app = getAdminApp();
  if (!app) return null;

  try {
    const rawDatabaseId =
      process.env.FIRESTORE_DATABASE_ID ||
      (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
    const configuredDatabaseId = cleanEnvString(rawDatabaseId);

    const firestore =
      configuredDatabaseId && configuredDatabaseId !== '(default)'
        ? getFirestore(app, configuredDatabaseId)
        : getFirestore(app);

    try {
      firestore.settings({ ignoreUndefinedProperties: true });
    } catch {
      // Firestore settings are immutable after first use.
    }

    adminFirestoreInstance = firestore;
    return adminFirestoreInstance;
  } catch {
    return null;
  }
}

export const adminAuth = {
  get instance() {
    return getAdminAuth();
  },
  verifyIdToken: async (token: string, checkRevoked = true) => {
    const auth = getAdminAuth();
    if (!auth) throw new Error('Firebase Admin Auth is not initialized');
    return auth.verifyIdToken(token, checkRevoked);
  },
  setCustomUserClaims: async (uid: string, customUserClaims: object | null) => {
    const auth = getAdminAuth();
    if (!auth) throw new Error('Firebase Admin Auth is not initialized');
    return auth.setCustomUserClaims(uid, customUserClaims);
  },
  getUser: async (uid: string) => {
    const auth = getAdminAuth();
    if (!auth) throw new Error('Firebase Admin Auth is not initialized');
    return auth.getUser(uid);
  },
  generatePasswordResetLink: async (email: string) => {
    const auth = getAdminAuth();
    if (!auth) throw new Error('Firebase Admin Auth is not initialized');
    return auth.generatePasswordResetLink(email);
  },
};

export const adminFirestore = {
  get instance() {
    return getAdminFirestore();
  },
  collection: (collectionPath: string) => {
    const db = getAdminFirestore();
    if (!db) throw new Error('Firebase Admin Firestore is not initialized');
    return db.collection(collectionPath);
  },
  doc: (docPath: string) => {
    const db = getAdminFirestore();
    if (!db) throw new Error('Firebase Admin Firestore is not initialized');
    return db.doc(docPath);
  },
};

export default getAdminApp;
