/**
 * DEMO-ONLY read gateway. It is intentionally separate from the authoritative
 * Patient360 clinician workflow: NO writes, no approvals, no note signing.
 * Requires BOTH Google-verified Vercel PREVIEW federation and a cryptographically
 * verified Firebase ID token for the specifically provisioned demo physician.
 */
import { createVerify, X509Certificate } from 'node:crypto';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { getPublicRuntimeMode } from '@/lib/runtime/environment-contract';

const PROJECT = 'g-hims-ci-demo';
const TENANT = 'central-metro-hospital';
const PATIENT = 'demo-ci-patient-001';
const PHYSICIAN_EMAIL = 'demo.doctor@example.invalid';
const TEAM = 'irtizah738s-projects';
const VERCEL_PROJECT = 'g-hims-clinical-intelligence-demo';
const EXPECTED_SUBJECT = `owner:${TEAM}:project:${VERCEL_PROJECT}:environment:preview`;
const AUDIENCE = '//iam.googleapis.com/projects/41373564161/locations/global/workloadIdentityPools/ghims-ci-demo-vercel/providers/vercel-preview';
const IMPERSONATED = 'ghims-ci-demo-preview@g-hims-ci-demo.iam.gserviceaccount.com';

export function previewClinicianEnvironment(): boolean {
  return process.env.VERCEL === '1' &&
    process.env.VERCEL_ENV === 'preview' &&
    getRuntimeMode() === 'DEMO' &&
    getPublicRuntimeMode() === 'DEMO' &&
    process.env.FIREBASE_PROJECT_ID === PROJECT &&
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === PROJECT &&
    process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO === PROJECT &&
    process.env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_DEMO === PROJECT &&
    process.env.GHIMS_DEMO_TENANT_ID === TENANT &&
    (!process.env.VERCEL_PROJECT_ID ||
      process.env.VERCEL_PROJECT_ID === 'prj_La4z7JH4LqDonJ84hGS7Id7UsRcW') &&
    !process.env.FIREBASE_PRIVATE_KEY &&
    !process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    !process.env.FIRESTORE_EMULATOR_HOST &&
    !process.env.FIREBASE_AUTH_EMULATOR_HOST;
}

async function jsonRequest(url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('CI_DEMO_UPSTREAM_REJECTED_' + response.status);
  return response.json();
}

function unpackJwt(token: string): { header: any; payload: any } {
  const pieces = token.split('.');
  if (pieces.length !== 3 || pieces.some(v => !v) || token.length > 12000) {
    throw new Error('CI_DEMO_JWT_SHAPE_INVALID');
  }
  return {
    header: JSON.parse(Buffer.from(pieces[0], 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(pieces[1], 'base64url').toString('utf8')),
  };
}

async function previewGoogleToken(request: Request): Promise<string> {
  const oidc = request.headers.get('x-vercel-oidc-token') || '';
  const { payload } = unpackJwt(oidc);
  if (
    payload.iss !== `https://oidc.vercel.com/${TEAM}` ||
    payload.aud !== `https://vercel.com/${TEAM}` ||
    payload.sub !== EXPECTED_SUBJECT ||
    payload.owner_id !== 'team_0S9QQkyN4yTIj7QUZ9BVKsVV' ||
    payload.project_id !== 'prj_La4z7JH4LqDonJ84hGS7Id7UsRcW' ||
    payload.environment !== 'preview'
  ) throw new Error('CI_DEMO_INVALID_VERCEL_PREVIEW_CLAIMS');
  // Google STS validates the OIDC issuer signature and exact configured subject.
  const sts = await jsonRequest('https://sts.googleapis.com/v1/token', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: AUDIENCE,
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      subject_token: oidc,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
    }),
  });
  if (typeof sts.access_token !== 'string') throw new Error('CI_DEMO_STS_UNAVAILABLE');
  const sa = await jsonRequest(
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${IMPERSONATED}:generateAccessToken`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${sts.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ scope: ['https://www.googleapis.com/auth/cloud-platform'], lifetime: '600s' }),
    },
  );
  if (typeof sa.accessToken !== 'string') throw new Error('CI_DEMO_GOOGLE_ACCESS_UNAVAILABLE');
  return sa.accessToken;
}

// Cached *public certificates only*. Never cache ID tokens or user records.
let firebaseCertCache: { expires: number; certs: Record<string, string> } | undefined;
async function googleFirebaseCertificates(): Promise<Record<string, string>> {
  if (firebaseCertCache && Date.now() < firebaseCertCache.expires) return firebaseCertCache.certs;
  const response = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com',
    { cache: 'no-store', signal: AbortSignal.timeout(12000) },
  );
  if (!response.ok) throw new Error('CI_DEMO_FIREBASE_KEYS_UNAVAILABLE');
  const certs = await response.json() as Record<string, string>;
  if (Object.keys(certs).length === 0) throw new Error('CI_DEMO_FIREBASE_KEYS_EMPTY');
  firebaseCertCache = { expires: Date.now() + 5 * 60_000, certs };
  return certs;
}

async function verifiedDemoPhysicianUid(request: Request): Promise<{ uid: string; authTime: number }> {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new Error('CI_DEMO_USER_TOKEN_REQUIRED');
  const token = authorization.slice('Bearer '.length).trim();
  const { header, payload } = unpackJwt(token);
  const now = Math.floor(Date.now() / 1000);
  if (
    header.alg !== 'RS256' || typeof header.kid !== 'string' ||
    !/^[A-Za-z0-9_-]{3,200}$/.test(header.kid) ||
    payload.aud !== PROJECT ||
    payload.iss !== `https://securetoken.google.com/${PROJECT}` ||
    payload.email !== PHYSICIAN_EMAIL ||
    payload.email_verified !== true ||
    payload.firebase?.sign_in_provider !== 'password' ||
    typeof payload.sub !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.sub) ||
    typeof payload.exp !== 'number' || payload.exp <= now ||
    typeof payload.iat !== 'number' || payload.iat > now ||
    typeof payload.auth_time !== 'number' || payload.auth_time > now
  ) throw new Error('CI_DEMO_DOCTOR_TOKEN_INVALID');
  const cert = (await googleFirebaseCertificates())[header.kid];
  if (!cert) throw new Error('CI_DEMO_FIREBASE_KEY_UNKNOWN');
  const signed = token.slice(0, token.lastIndexOf('.'));
  const signature = Buffer.from(token.split('.')[2], 'base64url');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signed);
  verifier.end();
  if (!verifier.verify(new X509Certificate(cert).publicKey, signature)) {
    throw new Error('CI_DEMO_FIREBASE_SIGNATURE_INVALID');
  }
  return { uid: payload.sub, authTime: payload.auth_time };
}

function fieldValue(field: any): any {
  if (field?.stringValue !== undefined) return field.stringValue;
  if (field?.booleanValue !== undefined) return field.booleanValue;
  if (field?.integerValue !== undefined) return Number(field.integerValue);
  if (field?.doubleValue !== undefined) return Number(field.doubleValue);
  if (field?.timestampValue !== undefined) return field.timestampValue;
  if (field?.nullValue !== undefined) return null;
  if (field?.arrayValue !== undefined) return (field.arrayValue.values || []).map(fieldValue);
  if (field?.mapValue !== undefined) return fieldsToObject(field.mapValue.fields || {});
  return undefined;
}
function fieldsToObject(fields: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, fieldValue(v)]));
}

async function firestoreDocument(path: string, accessToken: string): Promise<Record<string, any>> {
  const document = await jsonRequest(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${path}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  return fieldsToObject(document.fields || {});
}

/** Returns only bounded, synthetic Patient 360 facts to an authorized DEMO doctor. */
export async function readPhysicianDemoPatient360(request: Request): Promise<Record<string, any>> {
  if (!previewClinicianEnvironment()) throw new Error('CI_DEMO_PREVIEW_ONLY');
  const { uid, authTime } = await verifiedDemoPhysicianUid(request);
  const accessToken = await previewGoogleToken(request);

  // Check Firebase Auth authoritative status/revocation after verifying ID-token signature.
  const lookup = await jsonRequest(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ localId: [uid] }),
  });
  const account = Array.isArray(lookup.users) ? lookup.users[0] : null;
  if (!account || account.localId !== uid || account.email !== PHYSICIAN_EMAIL ||
      account.disabled === true || account.emailVerified !== true ||
      !Number.isFinite(Number(account.validSince)) ||
      authTime < Number(account.validSince)) {
    throw new Error('CI_DEMO_DOCTOR_ACCOUNT_NOT_ACTIVE');
  }

  const [tenant, membership, patient, projection] = await Promise.all([
    firestoreDocument(`tenants/${TENANT}`, accessToken),
    firestoreDocument(`tenants/${TENANT}/users/${uid}`, accessToken),
    firestoreDocument(`tenants/${TENANT}/patients/${PATIENT}`, accessToken),
    firestoreDocument(`tenants/${TENANT}/patient360Projections/${PATIENT}`, accessToken),
  ]);
  if (tenant.environment !== 'DEMO' || tenant.syntheticOnly !== true ||
      membership.tenantId !== TENANT || membership.userId !== uid ||
      membership.email !== PHYSICIAN_EMAIL || membership.status !== 'ACTIVE' ||
      membership.role !== 'doctor' || membership.credentialStatus !== 'VERIFIED' ||
      !Array.isArray(membership.facilityIds) || !membership.facilityIds.includes('DEMO_FACILITY') ||
      patient.tenantId !== TENANT || patient.patientId !== PATIENT ||
      patient.syntheticDemoRecord !== true || patient.mrn !== 'CI-DEMO-001' ||
      projection.patientId !== PATIENT || projection.tenantId !== TENANT ||
      projection.projectionVersion !== 6 || projection.revision < 10 ||
      projection.timelineReady !== true ||
      projection.identity?.mrn !== 'CI-DEMO-001' ||
      !Number.isInteger(projection.counts?.observations) || projection.counts.observations < 4) {
    throw new Error('CI_DEMO_PATIENT360_AUTHORITY_OR_PROJECTION_FAILED');
  }

  return {
    syntheticOnly: true,
    environment: 'DEMO',
    tenantId: TENANT,
    patientId: PATIENT,
    projectionVersion: projection.projectionVersion,
    revision: projection.revision,
    sourceCheckpoint: projection.sourceCheckpoint,
    identity: projection.identity,
    counts: projection.counts,
    activeProblems: projection.activeProblems,
    allergies: projection.allergies,
    currentMedications: projection.currentMedications,
    latestVitals: projection.latestVitals,
    recentResults: projection.recentResults,
    recentDiagnosticOrders: projection.recentDiagnosticOrders,
    recentProcedures: projection.recentProcedures,
    activeCarePlans: projection.activeCarePlans,
    recentDocuments: projection.recentDocuments,
  };
}
