import {
  App,
  type Credential,
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

// CIQP-182 exception is restricted to a disposable synthetic G-HIMS-AI
// qualification SOURCE, never g-hims-ai or G-HIMS-OS.
const CIQP182_DISPOSABLE_SOURCE = 'ciqp-ghims-source-20261022';
let ciqp182SourceCredentialActivated = false;

/**
 * Activate an in-memory, short-lived impersonated Credential exclusively in
 * the standalone CIQP-182 hosted writer. No service-account key / personal
 * ADC refresh credential. Fail closed on an existing Firebase app.
 * The writer must validate its exact SHA, approval and tenant before calling.
 */
export function activateCiqp182SyntheticHostedSourceCredential(credential: Credential): void {
  const env = process.env;
  if (env.CIQP182_HOSTED_SOURCE_AUTH_MODE !== 'GCLOUD_IMPERSONATION_APPLY' ||
      env.CIQP182_HOSTED_SOURCE_MODE !== 'APPLY' ||
      env.GHIMS_RUNTIME_MODE !== 'STAGING' ||
      env.NODE_ENV === 'production' || Boolean(env.VERCEL) ||
      Boolean(env.GITHUB_ACTIONS) ||
      env.FIREBASE_PROJECT_ID !== CIQP182_DISPOSABLE_SOURCE ||
      env.GHIMS_FIREBASE_PROJECT_ID_STAGING !== CIQP182_DISPOSABLE_SOURCE ||
      env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION !== 'g-hims-ai' ||
      env.FIRESTORE_DATABASE_ID !== '(default)' ||
      env.GHIMS_CIQP_STAGING_TENANT_ID !== 'ciqp-synthetic-hospital0' ||
      env.CIQP182_HOSTED_SOURCE_CONFIRM_PROJECT !== CIQP182_DISPOSABLE_SOURCE ||
      env.CIQP182_HOSTED_SOURCE_CONFIRM_TENANT !== 'ciqp-synthetic-hospital0' ||
      env.CIQP182_HOSTED_SOURCE_WRITER_EMAIL !==
        'ciqp182-synthetic-writer@' + CIQP182_DISPOSABLE_SOURCE + '.iam.gserviceaccount.com' ||
      Boolean(env.GOOGLE_APPLICATION_CREDENTIALS) ||
      Boolean(env.FIREBASE_PRIVATE_KEY) ||
      Boolean(env.FIREBASE_CLIENT_EMAIL) ||
      Boolean(env.FIRESTORE_EMULATOR_HOST) ||
      Boolean(env.FIREBASE_AUTH_EMULATOR_HOST) ||
      !credential || typeof credential.getAccessToken !== 'function' ||
      Boolean(adminApp) || Boolean(adminFirestoreInstance) ||
      getApps().length !== 0) {
    throw new Error('CIQP182_DISPOSABLE_SOURCE_CREDENTIAL_SCOPE_DENIED');
  }
  assertServerFirebaseProjectIsolation(CIQP182_DISPOSABLE_SOURCE);
  adminApp = initializeApp({
    projectId: CIQP182_DISPOSABLE_SOURCE,
    credential,
  });
  ciqp182SourceCredentialActivated = true;
}

function isCiqp182SourceCredentialActive(): boolean {
  return ciqp182SourceCredentialActivated &&
    adminApp?.options.projectId === CIQP182_DISPOSABLE_SOURCE &&
    process.env.CIQP182_HOSTED_SOURCE_AUTH_MODE === 'GCLOUD_IMPERSONATION_APPLY' &&
    process.env.CIQP182_HOSTED_SOURCE_MODE === 'APPLY' &&
    process.env.GHIMS_RUNTIME_MODE === 'STAGING' &&
    process.env.FIREBASE_PROJECT_ID === CIQP182_DISPOSABLE_SOURCE &&
    process.env.GHIMS_FIREBASE_PROJECT_ID_STAGING === CIQP182_DISPOSABLE_SOURCE &&
    process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION === 'g-hims-ai' &&
    process.env.FIRESTORE_DATABASE_ID === '(default)' &&
    process.env.GHIMS_CIQP_STAGING_TENANT_ID === 'ciqp-synthetic-hospital0' &&
    !process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    !process.env.FIRESTORE_EMULATOR_HOST;
}


/**
 * CIQP-182 ONLY: install the separately authenticated, short-lived gRPC
 * Firestore client after the source-project Admin app and runtime checks pass.
 * Firebase Admin Firestore rejects custom Credentials; never loosen that gate.
 * No production, G-HIMS-OS or restore project may activate this client.
 */
export function activateCiqp182SyntheticHostedSourceFirestore(firestore: Firestore): void {
  if (!isCiqp182SourceCredentialActive() ||
      !firestore || firestore.projectId !== CIQP182_DISPOSABLE_SOURCE ||
      Boolean(adminFirestoreInstance)) {
    throw new Error('CIQP182_DISPOSABLE_SOURCE_FIRESTORE_SCOPE_DENIED');
  }
  adminFirestoreInstance = firestore;
}

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
    canUseApplicationDefaultCredentials() ||
    isCiqp182SourceCredentialActive()
  );
}

export function getAdminApp(): App | null {
  if (adminApp) {
    if (ciqp182SourceCredentialActivated && !isCiqp182SourceCredentialActive()) {
      throw new Error('CIQP182_DISPOSABLE_SOURCE_CREDENTIAL_SCOPE_DENIED');
    }
    return adminApp;
  }

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
  // The CIQP-182 in-memory credential is NOT accepted by Admin getFirestore().
  // Never silently fall back to ADC: only the explicitly installed,
  // tenant-scoped gRPC client is eligible for this disposable source run.
  if (ciqp182SourceCredentialActivated) {
    if (!isCiqp182SourceCredentialActive()) {
      throw new Error('CIQP182_DISPOSABLE_SOURCE_CREDENTIAL_SCOPE_DENIED');
    }
    return adminFirestoreInstance;
  }
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
