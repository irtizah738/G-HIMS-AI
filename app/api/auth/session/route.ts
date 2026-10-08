import { NextRequest, NextResponse } from 'next/server';
import { extractBearerToken, verifyFirebaseToken } from '@/server/auth/verify-token';
import { resolveAuthorizationContext } from '@/server/auth/authorization-context';
import { createSession, validateSession, revokeSession } from '@/server/auth/session-service';
import { registerOrUpdateDevice } from '@/server/auth/device-service';
import { logAuthEvent } from '@/server/auth/audit-service';
import { getUserAccessibleTenants } from '@/server/auth/tenant-membership';
import { getAdminAuth } from '@/server/firebase/admin';
import { LoginResponsePayload } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { issueOfflineCaptureCapability } from '@/server/auth/offline-capability';

function hospital0TenantId(): string | null {
  const value = String(process.env.GHIMS_HOSPITAL0_TENANT_ID || '').trim().toLowerCase();
  return value || null;
}

function assertHospital0TenantScope(tenantId: string): void {
  const hospital0 = hospital0TenantId();
  if (hospital0 && tenantId !== hospital0) {
    throw new AuthError({
      code: 'TENANT_ACCESS_DENIED',
      message: 'This Hospital-0 runtime is restricted to its configured facility.',
      statusCode: 403,
      userMessage: 'Select the Hospital-0 facility configured for this environment.',
    });
  }
}

function filterHospital0Tenants<T extends { tenantId: string }>(tenants: T[]): T[] {
  const hospital0 = hospital0TenantId();
  return hospital0 ? tenants.filter((tenant) => tenant.tenantId === hospital0) : tenants;
}

function errorResponse(error: unknown, fallbackCode: 'AUTHENTICATION_REQUIRED' | 'SESSION_EXPIRED' = 'AUTHENTICATION_REQUIRED') {
  const authError = error instanceof AuthError
    ? error
    : new AuthError({
        code: fallbackCode,
        message: error instanceof Error ? error.message : 'Authentication failed',
        statusCode: 401,
      });

  return NextResponse.json(
    {
      error: authError.message,
      code: authError.code,
      userMessage: authError.userMessage,
    },
    { status: authError.statusCode }
  );
}

export async function POST(req: NextRequest) {
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'Unknown';

  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    const verifiedToken = await verifyFirebaseToken(token, true);
    const body = await req.json().catch(() => ({}));
    const requestedTenantId = String(body.tenantId || '').trim().toLowerCase();
    const deviceData = body.device || {};
    const rememberDevice = body.rememberDevice !== false;
    const runtimeMode = getRuntimeMode();
    const deviceBindingRequired = runtimeMode === 'STAGING' || runtimeMode === 'PRODUCTION';

    if (!requestedTenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    assertHospital0TenantScope(requestedTenantId);

    if (deviceBindingRequired && !String(deviceData.deviceId || '').trim()) {
      throw new AuthError({
        code: 'DEVICE_REVOKED',
        message: `Registered device identity is required in ${runtimeMode}.`,
        statusCode: 403,
        userMessage: 'This environment requires a registered clinical workstation or device.',
      });
    }

    // Authentication never creates authorization. Tenant membership, roles,
    // credentials and clinical privileges must already exist through the
    // governed IAM/credentialing workflows before a session can be established.
    // Membership is checked before any session/device authority is created.
    await resolveAuthorizationContext(verifiedToken, requestedTenantId);

    let registeredDevice;
    if ((deviceBindingRequired || rememberDevice) && deviceData.deviceId) {
      registeredDevice = await registerOrUpdateDevice({
        deviceId: deviceData.deviceId,
        userId: verifiedToken.uid,
        tenantId: requestedTenantId,
        deviceType: deviceData.deviceType,
        platform: deviceData.platform,
        appVersion: deviceData.appVersion,
      });
    }

    const session = await createSession({
      userId: verifiedToken.uid,
      tenantId: requestedTenantId,
      deviceId: registeredDevice?.deviceId,
      ip: clientIp,
      userAgent,
    });

    const authContext = await resolveAuthorizationContext(
      verifiedToken,
      requestedTenantId,
      session.sessionId,
      registeredDevice?.deviceId
    );

    const accessibleTenants = filterHospital0Tenants(
      await getUserAccessibleTenants(verifiedToken.uid, verifiedToken.email)
    );
    const offlineCapability = await issueOfflineCaptureCapability(
      authContext,
      session
    );

    // Claims are a convenience for Firestore read rules only. Tenant membership
    // remains the server-side authority and is re-resolved on every sensitive request.
    const adminAuth = getAdminAuth();
    if (adminAuth) {
      await adminAuth.setCustomUserClaims(verifiedToken.uid, {
        tenantId: authContext.tenantId,
        role: authContext.roles[0],
        roles: authContext.roles,
        accessibleTenants: accessibleTenants
          .filter((tenant) => tenant.status === 'ACTIVE')
          .map((tenant) => tenant.tenantId),
      });
    }

    await logAuthEvent({
      eventType: 'LOGIN_SUCCESS',
      tenantId: authContext.tenantId,
      userId: verifiedToken.uid,
      userEmail: verifiedToken.email,
      sessionId: session.sessionId,
      deviceId: registeredDevice?.deviceId,
      ip: clientIp,
      userAgent,
      metadata: {
        roles: authContext.roles,
        departmentIds: authContext.departmentIds,
      },
    });

    const payload: LoginResponsePayload = {
      authenticated: true,
      user: {
        uid: verifiedToken.uid,
        displayName: verifiedToken.name || verifiedToken.email.split('@')[0],
        email: verifiedToken.email,
      },
      tenant: {
        tenantId: authContext.tenantId,
        name: accessibleTenants.find((tenant) => tenant.tenantId === authContext.tenantId)?.name || `Hospital (${authContext.tenantId})`,
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
      ...(offlineCapability ? { offlineCapability } : {}),
      accessibleTenants: accessibleTenants.map((tenant) => ({
        tenantId: tenant.tenantId,
        name: tenant.name,
        facilityCode: tenant.facilityCode,
        roles: tenant.roles,
      })),
    };

    return NextResponse.json(payload);
  } catch (error) {
    await logAuthEvent({
      eventType: 'LOGIN_FAILURE',
      ip: clientIp,
      userAgent,
      reason: error instanceof Error ? error.message : 'Authentication failed',
    }).catch(() => {});

    return errorResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    const verifiedToken = await verifyFirebaseToken(token, true);
    const tenantId = String(req.headers.get('x-ghims-tenant-id') || verifiedToken.claims.tenantId || '').trim().toLowerCase();
    assertHospital0TenantScope(tenantId);
    const sessionId = String(req.headers.get('x-ghims-session-id') || '').trim();

    if (!tenantId || !sessionId) {
      throw new AuthError({
        code: 'SESSION_NOT_FOUND',
        message: 'Active tenant and session identifiers are required',
        statusCode: 401,
      });
    }

    const session = await validateSession(tenantId, sessionId, verifiedToken.uid);
    const authContext = await resolveAuthorizationContext(verifiedToken, tenantId, session.sessionId, session.deviceId);
    const accessibleTenants = await getUserAccessibleTenants(verifiedToken.uid, verifiedToken.email);

    const payload: LoginResponsePayload = {
      authenticated: true,
      user: {
        uid: verifiedToken.uid,
        displayName: verifiedToken.name || verifiedToken.email.split('@')[0],
        email: verifiedToken.email,
      },
      tenant: {
        tenantId: authContext.tenantId,
        name: accessibleTenants.find((tenant) => tenant.tenantId === authContext.tenantId)?.name || `Hospital (${authContext.tenantId})`,
      },
      authorization: {
        roles: authContext.roles,
        permissions: authContext.permissions,
        departmentIds: authContext.departmentIds,
        facilityIds: authContext.facilityIds,
        clinicalPrivileges: authContext.clinicalPrivileges,
        accountStatus: authContext.accountStatus,
      },
      session: {
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
      },
      accessibleTenants: accessibleTenants.map((tenant) => ({
        tenantId: tenant.tenantId,
        name: tenant.name,
        facilityCode: tenant.facilityCode,
        roles: tenant.roles,
      })),
    };

    return NextResponse.json(payload);
  } catch (error) {
    return errorResponse(error, 'SESSION_EXPIRED');
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const token = extractBearerToken(req.headers.get('authorization'));
    const verifiedToken = await verifyFirebaseToken(token, false);
    const body = await req.json().catch(() => ({}));
    const tenantId = String(body.tenantId || req.headers.get('x-ghims-tenant-id') || '').trim().toLowerCase();
    const sessionId = String(body.sessionId || req.headers.get('x-ghims-session-id') || '').trim();

    if (!tenantId || !sessionId) {
      throw new AuthError({
        code: 'SESSION_NOT_FOUND',
        message: 'tenantId and sessionId are required',
        statusCode: 401,
      });
    }

    await validateSession(tenantId, sessionId, verifiedToken.uid);
    await revokeSession(tenantId, sessionId, verifiedToken.uid, 'User initiated sign out');

    await logAuthEvent({
      eventType: 'LOGOUT',
      tenantId,
      userId: verifiedToken.uid,
      sessionId,
      reason: 'Standard user sign out',
    });

    return NextResponse.json({ success: true, message: 'Session terminated successfully' });
  } catch (error) {
    return errorResponse(error, 'SESSION_EXPIRED');
  }
}
