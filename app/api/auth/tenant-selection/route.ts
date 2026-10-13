import { NextRequest, NextResponse } from 'next/server';
import { extractBearerToken, verifyFirebaseToken } from '@/server/auth/verify-token';
import { getUserAccessibleTenants, getTenantMembership } from '@/server/auth/tenant-membership';
import { resolveAuthorizationContext } from '@/server/auth/authorization-context';
import { createSession } from '@/server/auth/session-service';
import { registerOrUpdateDevice } from '@/server/auth/device-service';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { logAuthEvent } from '@/server/auth/audit-service';
import { getAdminAuth } from '@/server/firebase/admin';
import { LoginResponsePayload } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = extractBearerToken(authHeader);
    const verifiedToken = await verifyFirebaseToken(token, false);

    const tenants = await getUserAccessibleTenants(verifiedToken.uid, verifiedToken.email);
    return NextResponse.json({ tenants });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch accessible tenants' },
      { status: err instanceof AuthError ? err.statusCode : 401 }
    );
  }
}

export async function POST(req: NextRequest) {
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'Unknown';

  try {
    const authHeader = req.headers.get('authorization');
    const token = extractBearerToken(authHeader);
    const verifiedToken = await verifyFirebaseToken(token, true);

    const body = await req.json().catch(() => ({}));
    const targetTenantId = String(body.tenantId || '').trim().toLowerCase();
    const deviceData = body.device || {};
    const mode = getRuntimeMode();
    const deviceRequired = mode === 'STAGING' || mode === 'PRODUCTION';

    if (!targetTenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    // 1. Verify membership in target tenant
    const membership = await getTenantMembership(targetTenantId, verifiedToken.uid, verifiedToken.email, verifiedToken.name);

    // Authorization must be ACTIVE before any durable security state is mutated.
    // In particular, never mint tenant claims or sessions for PENDING/SUSPENDED users:
    // Firestore clients can refresh custom claims independently of this request.
    if (membership.status !== 'ACTIVE') {
      throw new AuthError({
        code:
          membership.status === 'DISABLED'
            ? 'ACCOUNT_DISABLED'
            : membership.status === 'SUSPENDED'
              ? 'ACCOUNT_SUSPENDED'
              : 'ACCOUNT_PENDING',
        message: `Account is not active in target facility: ${membership.status}`,
        statusCode: 403,
      });
    }

    // Resolve the full authorization policy, including verified email, staff MFA
    // and canonical HCM credentials BEFORE mutating tenant claims or sessions.
    // Membership alone never constitutes production identity assurance.
    await resolveAuthorizationContext(verifiedToken, targetTenantId);

    if (deviceRequired && !String(deviceData.deviceId || '').trim()) {
      throw new AuthError({
        code: 'DEVICE_REVOKED',
        message: 'A registered workstation identity is required for tenant switching.',
        statusCode: 403,
      });
    }
    const registeredDevice = deviceData.deviceId
      ? await registerOrUpdateDevice({
          deviceId: String(deviceData.deviceId).trim(),
          userId: verifiedToken.uid,
          tenantId: targetTenantId,
          deviceType: deviceData.deviceType,
          platform: deviceData.platform,
          appVersion: deviceData.appVersion,
        })
      : undefined;

    // 2. Update Firebase custom claims for active tenant scope
    const adminAuth = getAdminAuth();
    if (!adminAuth) {
      throw new AuthError({
        code: 'INTERNAL_AUTH_ERROR',
        message: 'Firebase Admin Auth is required to synchronize tenant claims.',
        statusCode: 503,
      });
    }

    const accessibleTenantsBeforeSwitch = await getUserAccessibleTenants(
        verifiedToken.uid,
        verifiedToken.email
      );

    await adminAuth.setCustomUserClaims(verifiedToken.uid, {
      tenantId: targetTenantId,
      role: membership.roles[0],
      roles: membership.roles,
      accessibleTenants: accessibleTenantsBeforeSwitch
        .filter((tenant) => tenant.status === 'ACTIVE')
        .map((tenant) => tenant.tenantId),
      ...(membership.departmentIds[0] ? { department: membership.departmentIds[0] } : {}),
      claimedAt: Date.now(),
    });

    // 3. Create fresh session in target tenant
    const session = await createSession({
      userId: verifiedToken.uid,
      tenantId: targetTenantId,
      deviceId: registeredDevice?.deviceId,
      ip: clientIp,
      userAgent,
    });

    const authContext = await resolveAuthorizationContext(
      verifiedToken,
      targetTenantId,
      session.sessionId,
      registeredDevice?.deviceId
    );

    const accessibleTenants = await getUserAccessibleTenants(verifiedToken.uid, verifiedToken.email);

    await logAuthEvent({
      eventType: 'TENANT_SWITCHED',
      tenantId: targetTenantId,
      userId: verifiedToken.uid,
      sessionId: session.sessionId,
      ip: clientIp,
      userAgent,
      metadata: { targetTenantId },
    });

    const payload: LoginResponsePayload = {
      authenticated: true,
      user: {
        uid: verifiedToken.uid,
        displayName: verifiedToken.name || verifiedToken.email.split('@')[0],
        email: verifiedToken.email,
      },
      tenant: {
        tenantId: targetTenantId,
        name: membership.tenantName || `Hospital (${targetTenantId})`,
      },
      authorization: {
        roles: authContext.roles,
        permissions: authContext.permissions,
        financialAuthorityMinorUnits: authContext.financialAuthorityMinorUnits,
        departmentIds: authContext.departmentIds,
        facilityIds: authContext.facilityIds,
        clinicalPrivileges: authContext.clinicalPrivileges,
        accountStatus: authContext.accountStatus,
      },
      session: {
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        deviceId: session.deviceId,
      },
      accessibleTenants: accessibleTenants.map((t) => ({
        tenantId: t.tenantId,
        name: t.name,
        facilityCode: t.facilityCode,
        roles: t.roles,
      })),
    };

    return NextResponse.json(payload);
  } catch (err: any) {
    const errorObj = err instanceof AuthError ? err : new AuthError({
      code: 'TENANT_ACCESS_DENIED',
      message: err?.message || 'Tenant access denied',
      statusCode: 403,
    });

    return NextResponse.json(
      {
        error: errorObj.message,
        code: errorObj.code,
        userMessage: errorObj.userMessage,
      },
      { status: errorObj.statusCode }
    );
  }
}
