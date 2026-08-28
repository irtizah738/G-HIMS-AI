import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '@/firebase-applet-config.json';

let adminApp: admin.app.App | null = null;
let adminFirestoreInstance: admin.firestore.Firestore | null = null;

/**
 * Format and sanitize PEM private keys for OpenSSL 3 / Node.js crypto decoder compatibility.
 */
function formatPrivateKey(rawKey: string | undefined): string | null {
  if (!rawKey) return null;
  let key = rawKey.trim();

  // Strip wrapping single or double quotes
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
  }

  // Ignore empty or placeholder strings
  if (!key || key.length < 30 || key.toLowerCase().includes('your-private-key') || key.toLowerCase().includes('placeholder')) {
    return null;
  }

  // Unescape escaped newlines or carriage returns
  key = key.replace(/\\n/g, '\n').replace(/\\r/g, '\r');

  // Check for PEM boundary markers
  if (key.includes('BEGIN') && key.includes('KEY')) {
    const match = key.match(/(-----BEGIN[A-Z0-9_ -]+-----)([\s\S]+?)(-----END[A-Z0-9_ -]+-----)/);
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

export function getAdminApp(): admin.app.App | null {
  if (adminApp) {
    return adminApp;
  }

  if (admin.apps.length > 0) {
    adminApp = admin.app();
    return adminApp;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || firebaseConfig.projectId;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  // 1. Try initializing with explicit service account credentials if valid
  if (projectId && clientEmail && privateKey) {
    try {
      adminApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
        projectId,
      });
      return adminApp;
    } catch (certError) {
      console.warn('Notice: Firebase Admin certificate parsing fallback:', certError instanceof Error ? certError.message : 'Invalid PEM format');
    }
  }

  // 2. Fallback: Google Application Default Credentials or GCloud Project environment
  try {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GCLOUD_PROJECT) {
      adminApp = admin.initializeApp({
        projectId: projectId || process.env.GCLOUD_PROJECT,
      });
      return adminApp;
    }
  } catch {
    // Continue
  }

  // 3. Fallback: Project-scoped initialization
  try {
    adminApp = admin.initializeApp({
      projectId: projectId || firebaseConfig.projectId || 'g-hims-ai',
    });
    return adminApp;
  } catch {
    if (admin.apps.length > 0) {
      adminApp = admin.app();
      return adminApp;
    }
    return null;
  }
}

export function getAdminAuth(): admin.auth.Auth | null {
  const app = getAdminApp();
  return app ? getAuth(app) : null;
}

export function getAdminFirestore(): admin.firestore.Firestore | null {
  if (adminFirestoreInstance) {
    return adminFirestoreInstance;
  }
  const app = getAdminApp();
  if (!app) return null;
  try {
    const dbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
    let fs: admin.firestore.Firestore;
    if (dbId && dbId !== '(default)') {
      fs = getFirestore(app, dbId);
    } else {
      fs = admin.firestore(app);
    }
    try {
      fs.settings({ ignoreUndefinedProperties: true });
    } catch {
      // Settings can only be set once
    }
    adminFirestoreInstance = fs;
    return adminFirestoreInstance;
  } catch {
    try {
      const fs = admin.firestore(app);
      try {
        fs.settings({ ignoreUndefinedProperties: true });
      } catch {
        // Settings can only be set once
      }
      adminFirestoreInstance = fs;
      return adminFirestoreInstance;
    } catch {
      return null;
    }
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
  }
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
  }
};

export default getAdminApp;
