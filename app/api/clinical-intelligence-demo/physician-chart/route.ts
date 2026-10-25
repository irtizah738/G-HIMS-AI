/**
 * Keyless DEMO-only, read-only clinical view.
 * Two independent authority boundaries:
 * 1) Google-verified Vercel preview workload identity.
 * 2) Google-signed Firebase user token and canonical tenant/role/credential.
 * No write endpoints, no AI authority, no simulated clinical sign-offs.
 */
import {
  previewClinicianEnvironment,
  readPhysicianDemoPatient360,
} from '@/server/demo/preview-clinician-patient360';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (!previewClinicianEnvironment()) {
    return new Response(null, { status: 404, headers });
  }
  try {
    const result = await readPhysicianDemoPatient360(request);
    return Response.json(result, { headers });
  } catch {
    // Never disclose access tokens, source records or internal access failures.
    return Response.json({ ready: false, code: 'CI_DEMO_CLINICIAN_REVIEW_DENIED' },
      { status: 403, headers });
  }
}
