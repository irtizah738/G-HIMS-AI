export {};

const runtime = String(process.env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();
const publicRuntime = String(process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE || '').trim().toUpperCase();
const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
const publicProjectId = String(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
const stagingProject = String(process.env.GHIMS_FIREBASE_PROJECT_ID_STAGING || '').trim();
const publicStagingProject = String(process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING || '').trim();
const databaseId = String(process.env.FIRESTORE_DATABASE_ID || '').trim();

const fail = (code: string, details?: Record<string, unknown>): never => {
  process.stderr.write(JSON.stringify({ success: false, code, ...details }, null, 2) + '\n');
  process.exit(1);
};

if (runtime !== 'STAGING' || publicRuntime !== 'STAGING') {
  fail('STAGING_RUNTIME_REQUIRED', { runtime, publicRuntime });
}
if (!projectId || !publicProjectId || !stagingProject || !publicStagingProject) {
  fail('STAGING_FIREBASE_PROJECT_REQUIRED');
}
if (projectId !== stagingProject || publicProjectId !== publicStagingProject) {
  fail('STAGING_PROJECT_MISMATCH', {
    serverMatches: projectId === stagingProject,
    clientMatches: publicProjectId === publicStagingProject,
  });
}
if (projectId !== publicProjectId) {
  fail('STAGING_CLIENT_SERVER_PROJECT_MISMATCH');
}

// The non-secret production project reference is mandatory in Preview:
// without it, an accidentally production-bound staging build can evade comparison.
const productionProject = String(process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION || '').trim();
if (!productionProject) {
  fail('STAGING_PRODUCTION_REFERENCE_REQUIRED');
}
if (productionProject === stagingProject) {
  fail('STAGING_PROJECT_COLLISION');
}
// The browser must also carry the non-secret production comparator. Without
// it, a staging bundle can initialize the production Firebase client before
// the server rejects the mixed-trust configuration.
const publicProductionProject = String(
  process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION || ''
).trim();
if (!publicProductionProject) {
  fail('STAGING_PUBLIC_PRODUCTION_REFERENCE_REQUIRED');
}
if (publicProductionProject !== productionProject) {
  fail('STAGING_PUBLIC_PRODUCTION_REFERENCE_MISMATCH');
}

const forbiddenProjects = [
  process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO,
  process.env.GHIMS_FIREBASE_PROJECT_ID_TEST,
  process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION,
  process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO,
  process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST,
  process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION,
]
  .map((value) => String(value || '').trim())
  .filter(Boolean);

if (forbiddenProjects.includes(projectId)) {
  fail('STAGING_PROJECT_COLLISION');
}
if (!databaseId) {
  fail('STAGING_FIRESTORE_DATABASE_REQUIRED');
}

const integrationNames = ['AI', 'HL7', 'FHIR_R4', 'DICOMWEB', 'DEVICE_TELEMETRY', 'EDI_X12'] as const;
const integrationStates = Object.fromEntries(
  integrationNames.map((name) => [
    name,
    String(process.env[`GHIMS_INTEGRATION_${name}_STATE`] || 'DISABLED')
      .trim()
      .toUpperCase(),
  ])
);

for (const [name, state] of Object.entries(integrationStates)) {
  if (state !== 'DISABLED') {
    fail('UNQUALIFIED_STAGING_INTEGRATION_ENABLED', { integration: name, state });
  }
}

const adminClientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim().toLowerCase();
const firebaseCredentialsPresent =
  Boolean(adminClientEmail) &&
  Boolean(String(process.env.FIREBASE_PRIVATE_KEY || '').trim());

// An Admin SDK credential may authenticate a service account belonging to
// another Firebase project. A staging deployment must never reuse a production
// project service account, even when the configured client project ID is safe.
if (adminClientEmail && !adminClientEmail.endsWith(
  `@${stagingProject.toLowerCase()}.iam.gserviceaccount.com`
)) {
  fail('STAGING_SERVICE_ACCOUNT_PROJECT_MISMATCH');
}

if (!firebaseCredentialsPresent && !String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()) {
  fail('STAGING_FIREBASE_ADMIN_CREDENTIALS_REQUIRED');
}

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      runtime,
      projectId,
      databaseId,
      integrations: integrationStates,
      credentials: 'configured',
      verifiedAt: new Date().toISOString(),
    },
    null,
    2
  ) + '\n'
);
