import { NextRequest, NextResponse } from 'next/server';
import { extractBearerToken, verifyFirebaseToken } from '@/server/auth/verify-token';
import { getTenantMembership } from '@/server/auth/tenant-membership';
import { getAdminAuth } from '@/server/firebase/admin';
import { AuthError } from '@/lib/auth/auth-errors';

/**
 * POST refreshes Firebase custom claims from an already-existing authoritative membership.
 * It never creates a tenant or membership.
 */
export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    const verified = await verifyFirebaseToken(token, true);
    const body = await req.json().catch(() => ({}));
    const tenantId = String(body.tenantId || '').trim().toLowerCase();

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const membership = await getTenantMembership(tenantId, verified.uid, verified.email, verified.name);
    if (membership.status !== 'ACTIVE') {
      throw new AuthError({
        code: 'TENANT_ACCESS_DENIED',
        message: `Tenant membership is not active: ${membership.status}`,
        statusCode: 403,
      });
    }

    const adminAuth = getAdminAuth();
    if (!adminAuth) {
      throw new AuthError({
        code: 'INTERNAL_AUTH_ERROR',
        message: 'Firebase Admin Auth is unavailable',
        statusCode: 503,
      });
    }

    await adminAuth.setCustomUserClaims(verified.uid, {
      tenantId,
      role: membership.roles[0],
      roles: membership.roles,
      departmentIds: membership.departmentIds,
      accessibleTenants: [tenantId],
      claimedAt: Date.now(),
    });

    return NextResponse.json({
      success: true,
      userId: verified.uid,
      tenantId,
      roles: membership.roles,
      message: 'Tenant claims refreshed from authoritative membership.',
    });
  } catch (error) {
    const authError = error instanceof AuthError
      ? error
      : new AuthError({
          code: 'TENANT_ACCESS_DENIED',
          message: error instanceof Error ? error.message : 'Tenant access denied',
          statusCode: 403,
        });

    return NextResponse.json(
      { error: authError.message, code: authError.code, userMessage: authError.userMessage },
      { status: authError.statusCode }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    const verified = await verifyFirebaseToken(token, true);
    const tenantId = String(req.nextUrl.searchParams.get('tenantId') || '').trim().toLowerCase();

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const membership = await getTenantMembership(tenantId, verified.uid, verified.email, verified.name);
    return NextResponse.json({
      userId: verified.uid,
      tenantId,
      exists: true,
      membership,
    });
  } catch (error) {
    const authError = error instanceof AuthError
      ? error
      : new AuthError({
          code: 'TENANT_ACCESS_DENIED',
          message: error instanceof Error ? error.message : 'Tenant access denied',
          statusCode: 403,
        });

    return NextResponse.json(
      { error: authError.message, code: authError.code },
      { status: authError.statusCode }
    );
  }
}

/**
 * PUT is an administrative membership update. The caller must already be an
 * ACTIVE administrator in the same tenant. Client-provided Firebase claims are ignored.
 */
export async function PUT() {
  return NextResponse.json(
    {
      error: 'LEGACY_IAM_MUTATION_ROUTE_RETIRED',
      message:
        'Tenant membership mutations must use the governed /api/admin/users IAM endpoint.',
    },
    { status: 410 }
  );
}
