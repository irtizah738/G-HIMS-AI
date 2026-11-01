import { NextResponse, type NextRequest } from 'next/server';
import { getAdminFirestore } from '@/server/firebase/admin';
import { assertJwksId, publicFhirJwks } from '@/lib/interop/fhir-public-jwks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public, stable Epic/SMART JKU.
 * Only the RSA public modulus, exponent and signing metadata are returned.
 * Never authorize patient reads here; never expose Secret Manager material.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ keySetId: string }> }
) {
  try {
    const { keySetId } = await params;
    assertJwksId(keySetId);
    const environment = process.env.GHIMS_FHIR_JWKS_ENVIRONMENT;
    if (environment !== 'STAGING' && environment !== 'PRODUCTION') {
      throw new Error('CI_EXT06B_NOT_CONFIGURED');
    }
    const db = getAdminFirestore();
    if (!db) throw new Error('CI_EXT06B_FIRESTORE_UNAVAILABLE');
    const snap = await db.collection('fhirPublicJwks').doc(keySetId).get();
    const jwks = publicFhirJwks(snap.exists ? snap.data() : null, environment, Date.now());
    return NextResponse.json(jwks, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=300, must-revalidate',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    // No keyset enumeration, tenant/source identity or internal error leakage.
    return NextResponse.json(
      { error: 'JWKS_NOT_AVAILABLE' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
