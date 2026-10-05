import { evaluateClinicalIntelligenceProductionConfig } from '@/lib/clinical/intelligence/clinical-intelligence-production-policy';

const fail = (code: string, details?: Record<string, unknown>): never => {
  process.stderr.write(
    JSON.stringify({ success: false, code, ...details }, null, 2) + '\n'
  );
  process.exit(1);
};

const runtime = String(process.env.GHIMS_RUNTIME_MODE || '')
  .trim()
  .toUpperCase();
const publicRuntime = String(
  process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE || ''
)
  .trim()
  .toUpperCase();

if (runtime !== 'PRODUCTION' || publicRuntime !== 'PRODUCTION') {
  fail('CI10I_PRODUCTION_RUNTIME_REQUIRED', { runtime, publicRuntime });
}

const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
const publicProjectId = String(
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || ''
).trim();
const productionProject = String(
  process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION || ''
).trim();
const publicProductionProject = String(
  process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION || ''
).trim();
const databaseId = String(process.env.FIRESTORE_DATABASE_ID || '').trim();

if (
  !projectId ||
  !publicProjectId ||
  !productionProject ||
  !publicProductionProject
) {
  fail('CI10I_PRODUCTION_FIREBASE_PROJECT_REQUIRED');
}
if (
  projectId !== productionProject ||
  publicProjectId !== publicProductionProject ||
  projectId !== publicProjectId
) {
  fail('CI10I_PRODUCTION_PROJECT_MISMATCH', {
    serverMatchesProduction: projectId === productionProject,
    clientMatchesProduction: publicProjectId === publicProductionProject,
    clientServerMatch: projectId === publicProjectId,
  });
}
if (!databaseId) {
  fail('CI10I_PRODUCTION_FIRESTORE_DATABASE_REQUIRED');
}

const forbiddenProjects = [
  process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO,
  process.env.GHIMS_FIREBASE_PROJECT_ID_TEST,
  process.env.GHIMS_FIREBASE_PROJECT_ID_STAGING,
  process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO,
  process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST,
  process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING,
]
  .map((value) => String(value || '').trim())
  .filter(Boolean);

if (forbiddenProjects.includes(projectId)) {
  fail('CI10I_PRODUCTION_PROJECT_COLLISION');
}

if (
  String(process.env.FIRESTORE_EMULATOR_HOST || '').trim() ||
  String(process.env.FIREBASE_AUTH_EMULATOR_HOST || '').trim()
) {
  fail('CI10I_EMULATOR_FORBIDDEN_IN_PRODUCTION');
}

const firebaseCredentialsPresent =
  Boolean(String(process.env.FIREBASE_CLIENT_EMAIL || '').trim()) &&
  Boolean(String(process.env.FIREBASE_PRIVATE_KEY || '').trim());

if (
  !firebaseCredentialsPresent &&
  !String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()
) {
  fail('CI10I_PRODUCTION_FIREBASE_ADMIN_CREDENTIALS_REQUIRED');
}

const intelligence = evaluateClinicalIntelligenceProductionConfig(
  process.env,
  'PRODUCTION'
);
if (!intelligence.ready) {
  fail('CI10I_CLINICAL_INTELLIGENCE_POLICY_FAILED', {
    blockers: intelligence.blockers,
  });
}

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      runtime,
      projectId,
      databaseId,
      clinicalIntelligence: {
        policyVersion: intelligence.policyVersion,
        aiState: intelligence.ai.state,
        provider: intelligence.ai.provider,
        model: intelligence.ai.model,
        timeoutMs: intelligence.ai.timeoutMs,
        providerApproved: intelligence.ai.providerApproved,
        modelApproved: intelligence.ai.modelApproved,
      },
      verifiedAt: new Date().toISOString(),
    },
    null,
    2
  ) + '\n'
);
