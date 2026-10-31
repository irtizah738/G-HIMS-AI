/**
 * Synthetic-only investor DEMO: verify Vercel Preview -> GCP keyless
 * federation -> Firestore READ. NO credentials or patient data in output.
 *
 * This does NOT authenticate the full G-HIMS Firebase Admin clinical app.
 * Expose only on an SSO-protected, dedicated Vercel PREVIEW deployment.
 */
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { getPublicRuntimeMode } from '@/lib/runtime/environment-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const demoProject = 'g-hims-ci-demo';
const demoTenant = 'central-metro-hospital';
const demoPatient = 'demo-ci-patient-001';
const demoVercelProject = 'g-hims-clinical-intelligence-demo';
const vercelTeam = 'irtizah738s-projects';
const wifAudience =
  '//iam.googleapis.com/projects/41373564161/locations/global/workloadIdentityPools/ghims-ci-demo-vercel/providers/vercel-preview';
const identityEmail = 'ghims-ci-demo-preview@g-hims-ci-demo.iam.gserviceaccount.com';
const expectedSubject = `owner:${vercelTeam}:project:${demoVercelProject}:environment:preview`;

function safePreview(): boolean {
  return (
    process.env.VERCEL === '1' &&
    process.env.VERCEL_ENV === 'preview' &&
    getRuntimeMode() === 'DEMO' &&
    getPublicRuntimeMode() === 'DEMO' &&
    process.env.FIREBASE_PROJECT_ID === demoProject &&
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === demoProject &&
    process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO === demoProject &&
    process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO === demoProject &&
    process.env.GHIMS_DEMO_TENANT_ID === demoTenant &&
    (!process.env.VERCEL_PROJECT_ID ||
      process.env.VERCEL_PROJECT_ID === 'prj_La4z7JH4LqDonJ84hGS7Id7UsRcW') &&
    !process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    !process.env.FIREBASE_PRIVATE_KEY &&
    !process.env.FIRESTORE_EMULATOR_HOST &&
    !process.env.FIREBASE_AUTH_EMULATOR_HOST
  );
}

async function fetchJson(url: string, init: RequestInit) {
  const result = await fetch(url, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  });
  // Never return response bodies from OAuth failures; they may include private context.
  if (!result.ok) throw new Error('UPSTREAM_' + result.status);
  return result.json() as Promise<Record<string, any>>;
}

function checkTokenClaims(token: string): void {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) throw new Error('OIDC_TOKEN_SHAPE');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  // Claims are only an early preflight filter, not a signature check.
  // Google STS performs the actual cryptographic verification.
  if (payload.iss !== `https://oidc.vercel.com/${vercelTeam}` ||
      payload.aud !== `https://vercel.com/${vercelTeam}` ||
      payload.sub !== expectedSubject ||
      payload.owner_id !== 'team_0S9QQkyN4yTIj7QUZ9BVKsVV' ||
      payload.project_id !== 'prj_La4z7JH4LqDonJ84hGS7Id7UsRcW' ||
      payload.environment !== 'preview') {
    throw new Error('OIDC_EXPECTED_PREVIEW_CLAIMS_MISMATCH');
  }
}

export async function GET(request: Request): Promise<Response> {
  const common = { 'cache-control': 'no-store' };
  if (!safePreview()) {
    return new Response(null, { status: 404, headers: common });
  }
  const oidcToken = request.headers.get('x-vercel-oidc-token') || '';
  if (!oidcToken || oidcToken.length > 12000) {
    return Response.json({ ready: false, reason: 'OIDC_TOKEN_NOT_PRESENT' },
      { status: 503, headers: common });
  }
  try {
    checkTokenClaims(oidcToken);
    const sts = await fetchJson('https://sts.googleapis.com/v1/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        audience: wifAudience,
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        subject_token: oidcToken,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
      }),
    });
    if (typeof sts.access_token !== 'string') throw new Error('STS_TOKEN_MISSING');
    const impersonated = await fetchJson(
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${identityEmail}:generateAccessToken`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${sts.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          scope: ['https://www.googleapis.com/auth/cloud-platform'],
          lifetime: '600s',
        }),
      },
    );
    if (typeof impersonated.accessToken !== 'string') throw new Error('IMPERSONATED_TOKEN_MISSING');
    const path = encodeURI(
      `https://firestore.googleapis.com/v1/projects/${demoProject}/databases/(default)/documents/tenants/${demoTenant}/patients/${demoPatient}`,
    );
    const record = await fetchJson(path, {
      headers: { authorization: `Bearer ${impersonated.accessToken}` },
    });
    if (record.fields?.syntheticDemoRecord?.booleanValue !== true ||
        record.fields?.mrn?.stringValue !== 'CI-DEMO-001' ||
        record.fields?.tenantId?.stringValue !== demoTenant) {
      throw new Error('DEMO_SYNTHETIC_PATIENT_MISMATCH');
    }
    return Response.json({
      ready: true,
      gcpProject: demoProject,
      deploymentEnvironment: 'preview',
      federation: 'PASS',
      firestoreSyntheticRead: 'PASS',
    }, { headers: common });
  } catch {
    // Intentionally hide token strings and upstream provider error responses.
    return Response.json({ ready: false, reason: 'PREVIEW_FEDERATION_OR_READ_FAILED' },
      { status: 503, headers: common });
  }
}
