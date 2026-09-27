import { NextRequest, NextResponse } from 'next/server';
import { extractBearerToken, verifyFirebaseToken } from '@/server/auth/verify-token';
import { getTenantMembership } from '@/server/auth/tenant-membership';
import { getAdminAuth, getAdminFirestore } from '@/server/firebase/admin';
import { AuthError } from '@/lib/auth/auth-errors';

function isTenantAdmin(roles: string[]): boolean {
  const normalized = roles.map((role) => role.toLowerCase());
  return normalized.some((role) =>
    ['administrator', 'admin', 'super_admin', 'system_admin', 'hospital_admin'].includes(role)
  );
}

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
export async function PUT(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    const verified = await verifyFirebaseToken(token, true);
    const body = await req.json().catch(() => ({}));

    const tenantId = String(body.tenantId || '').trim().toLowerCase();
    const targetUserId = String(body.targetUserId || '').trim();

    if (!tenantId || !targetUserId) {
      return NextResponse.json(
        { error: 'tenantId and targetUserId are required' },
        { status: 400 }
      );
    }

    const callerMembership = await getTenantMembership(
      tenantId,
      verified.uid,
      verified.email,
      verified.name
    );

    if (callerMembership.status !== 'ACTIVE' || !isTenantAdmin(callerMembership.roles)) {
      throw new AuthError({
        code: 'AUTHORIZATION_REQUIRED',
        message: 'Administrator role required to modify tenant membership',
        statusCode: 403,
      });
    }

    const db = getAdminFirestore();
    const adminAuth = getAdminAuth();
    if (!db || !adminAuth) {
      throw new AuthError({
        code: 'INTERNAL_AUTH_ERROR',
        message: 'Authoritative identity services are unavailable',
        statusCode: 503,
      });
    }

    const targetRef = db.collection('tenants').doc(tenantId).collection('users').doc(targetUserId);
    const existing = await targetRef.get();
    if (!existing.exists) {
      return NextResponse.json(
        { error: 'Target tenant membership does not exist' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
      updatedBy: verified.uid,
    };

    if (body.role) {
      updateData.role = String(body.role).toLowerCase();
      updateData.roles = [String(body.role).toLowerCase()];
    }
    if (body.department !== undefined) {
      updateData.department = String(body.department);
      updateData.departmentIds = [String(body.department)];
    }
    if (body.status) updateData.status = String(body.status).toUpperCase();
    if (body.licenseId !== undefined) updateData.licenseId = String(body.licenseId);
    if (Array.isArray(body.assignedWards)) updateData.assignedWards = body.assignedWards.map(String);

    await targetRef.set(updateData, { merge: true });

    if (body.role) {
      const targetRecord = await adminAuth.getUser(targetUserId);
      const currentClaims = targetRecord.customClaims || {};
      await adminAuth.setCustomUserClaims(targetUserId, {
        ...currentClaims,
        tenantId,
        role: String(body.role).toLowerCase(),
        roles: [String(body.role).toLowerCase()],
        claimedAt: Date.now(),
      });
    }

    return NextResponse.json({
      success: true,
      tenantId,
      targetUserId,
      updated: updateData,
    });
  } catch (error) {
    const authError = error instanceof AuthError
      ? error
      : new AuthError({
          code: 'INTERNAL_AUTH_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update tenant user',
          statusCode: 500,
        });

    return NextResponse.json(
      { error: authError.message, code: authError.code, userMessage: authError.userMessage },
      { status: authError.statusCode }
    );
  }
}
