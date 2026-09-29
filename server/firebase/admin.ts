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
  // Vercel functions do not have a local service-account JSON file unless an
  // operator explicitly provisions one into the runtime, which G-HIMS does not do.
  // Use FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY on Vercel.
  return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS) && !process.env.VERCEL;
}

function getAdminCredentials(): { clientEmail: string | null; privateKey: string | null } {
  const clientEmail = (
    process.env.FIREBASE_CLIENT_EMAIL ||
    process.env.client_email ||
    ''
  )
    .replace(/^['"]|['"]$/g, '')
    .trim();

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

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    firebaseConfig.projectId;

  assertServerFirebaseProjectIsolation(String(projectId || ''));

  const existingApps = getApps();
  if (existingApps.length > 0) {
    const existing = getApp();
    const existingProjectId = String(existing.options.projectId || '');
    assertServerFirebaseProjectIsolation(existingProjectId || String(projectId || ''));
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
    const configuredDatabaseId =
      process.env.FIRESTORE_DATABASE_ID ||
      (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;

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
