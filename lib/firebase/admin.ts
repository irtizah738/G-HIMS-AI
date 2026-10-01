import {
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '@/firebase-applet-config.json';

let adminApp: App | null = null;

/**
 * Format and sanitize PEM private keys for OpenSSL 3 / Node.js crypto decoder compatibility.
 * Reconstitutes standard 64-char lines and handles escaped newlines/quotes.
 */
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

export function getAdminApp(): App | null {
  if (adminApp) return adminApp;

  const existingApps = getApps();
  if (existingApps.length > 0) {
    adminApp = getApp();
    return adminApp;
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    firebaseConfig.projectId;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

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
    } catch (certError) {
      console.warn(
        'Notice: Firebase Admin certificate parsing fallback:',
        certError instanceof Error ? certError.message : 'Invalid PEM format'
      );
    }
  }

  try {
    if (
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GCLOUD_PROJECT
    ) {
      adminApp = initializeApp({
        projectId: projectId || process.env.GCLOUD_PROJECT,
      });
      return adminApp;
    }
  } catch {
    // Continue to project-scoped initialization.
  }

  try {
    adminApp = initializeApp({
      projectId: projectId || firebaseConfig.projectId || 'g-hims-ai',
    });
    return adminApp;
  } catch {
    const apps = getApps();
    if (apps.length > 0) {
      adminApp = getApp();
      return adminApp;
    }
    return null;
  }
}

export function getAdminAuth(): Auth | null {
  const app = getAdminApp();
  return app ? getAuth(app) : null;
}

export function getAdminFirestore(): Firestore | null {
  const app = getAdminApp();
  if (!app) return null;

  const configuredDbId =
    process.env.FIRESTORE_DATABASE_ID ||
    process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID ||
    (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;

  if (configuredDbId && configuredDbId !== '(default)') {
    return getFirestore(app, configuredDbId);
  }
  return getFirestore(app);
}

export const adminAuth = {
  get instance() {
    return getAdminAuth();
  },
  verifyIdToken: async (token: string, checkRevoked = false) => {
    const auth = getAdminAuth();
    if (!auth) throw new Error('Firebase Admin Auth is not initialized');
    return auth.verifyIdToken(token, checkRevoked);
  },
  setCustomUserClaims: async (
    uid: string,
    customUserClaims: object | null
  ) => {
    const auth = getAdminAuth();
    if (!auth) throw new Error('Firebase Admin Auth is not initialized');
    return auth.setCustomUserClaims(uid, customUserClaims);
  },
  getUser: async (uid: string) => {
    const auth = getAdminAuth();
    if (!auth) throw new Error('Firebase Admin Auth is not initialized');
    return auth.getUser(uid);
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
