import {
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '@/firebase-applet-config.json';
import { assertServerFirebaseProjectIsolation } from '@/lib/runtime/environment-contract';

let directoryApp: App | null = null;
let directoryFirestore: Firestore | null = null;

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
    key.toLowerCase().includes('placeholder')
  ) {
    return null;
  }

  key = key.replace(/\\n/g, '\n').replace(/\\r/g, '\r');

  const match = key.match(
    /(-----BEGIN[A-Z0-9_ -]+-----)([\s\S]+?)(-----END[A-Z0-9_ -]+-----)/
  );
  if (!match) return key;

  const header = match[1].trim();
  const body = match[2].replace(/\s+/g, '');
  const footer = match[3].trim();
  const chunks = body.match(/.{1,64}/g) || [body];
  return `${header}\n${chunks.join('\n')}\n${footer}\n`;
}

function getDirectoryApp(): App | null {
  if (directoryApp) return directoryApp;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    firebaseConfig.projectId;

  assertServerFirebaseProjectIsolation(String(projectId || ''));

  if (getApps().length > 0) {
    directoryApp = getApp();
    return directoryApp;
  }

  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
  const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) return null;

  directoryApp = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    projectId,
  });

  return directoryApp;
}

export function getDirectoryFirestore(): Firestore | null {
  if (directoryFirestore) return directoryFirestore;

  const app = getDirectoryApp();
  if (!app) return null;

  const configuredDatabaseId =
    process.env.FIRESTORE_DATABASE_ID ||
    process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID ||
    (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;

  directoryFirestore =
    configuredDatabaseId && configuredDatabaseId !== '(default)'
      ? getFirestore(app, configuredDatabaseId)
      : getFirestore(app);

  return directoryFirestore;
}
