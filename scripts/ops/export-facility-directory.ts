import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
const rawPrivateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').trim();
const databaseId = String(process.env.FIRESTORE_DATABASE_ID || '').trim();

if (!projectId || !clientEmail || !rawPrivateKey || !databaseId) {
  throw new Error(
    'FACILITY_DIRECTORY_EXPORT_CONFIG_MISSING: Firebase project, service account and named database are required.'
  );
}

if (projectId !== 'g-hims-ai') {
  throw new Error(
    `FACILITY_DIRECTORY_PROJECT_MISMATCH: expected g-hims-ai, received ${projectId}.`
  );
}

if (
  databaseId !==
  'ai-studio-ghimsos-8d860f4b-3a80-47b3-bf97-15b9dc0d7fa7'
) {
  throw new Error(
    `FACILITY_DIRECTORY_DATABASE_MISMATCH: unexpected database ${databaseId}.`
  );
}

const privateKey = rawPrivateKey
  .replace(/^['"]|['"]$/g, '')
  .replace(/\\n/g, '\n');

const app = initializeApp({
  credential: cert({
    projectId,
    clientEmail,
    privateKey,
  }),
  projectId,
});

const db = getFirestore(app, databaseId);
const snapshot = await db.collection('tenants').get();

const facilities = snapshot.docs
  .map((document) => {
    const data = (document.data() || {}) as Record<string, unknown>;
    const tenantId = String(document.id || '').trim().toLowerCase();
    if (!tenantId) return null;

    const name =
      typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : typeof data.tenantName === 'string' && data.tenantName.trim()
          ? data.tenantName.trim()
          : typeof data.facilityName === 'string' && data.facilityName.trim()
            ? data.facilityName.trim()
            : `Hospital Organization (${tenantId})`;

    const facilityCode =
      typeof data.facilityCode === 'string' && data.facilityCode.trim()
        ? data.facilityCode.trim()
        : typeof data.code === 'string' && data.code.trim()
          ? data.code.trim()
          : undefined;

    return {
      tenantId,
      name,
      ...(facilityCode ? { facilityCode } : {}),
    };
  })
  .filter(
    (
      facility
    ): facility is {
      tenantId: string;
      name: string;
      facilityCode?: string;
    } => Boolean(facility)
  )
  .sort((a, b) => a.name.localeCompare(b.name));

if (facilities.length === 0) {
  throw new Error(
    'FACILITY_DIRECTORY_EMPTY: the named Firestore database returned no tenant documents.'
  );
}

if (!facilities.some((facility) => facility.tenantId === 'central-metro-hospital')) {
  throw new Error(
    'FACILITY_DIRECTORY_HOSPITAL0_MISSING: central-metro-hospital was not found in the named Firestore database.'
  );
}

const output = {
  generatedAt: new Date().toISOString(),
  facilities,
};

const outputPath = path.join(process.cwd(), 'public', 'facility-directory.json');
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

console.log(
  `Facility directory exported: ${facilities.length} tenant(s) from ${databaseId}.`
);
