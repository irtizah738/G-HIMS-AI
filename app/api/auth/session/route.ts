import { NextRequest, NextResponse } from 'next/server';
import { extractBearerToken, verifyFirebaseToken } from '@/server/auth/verify-token';
import { resolveAuthorizationContext } from '@/server/auth/authorization-context';
import { createSession, validateSession, revokeSession } from '@/server/auth/session-service';
import { registerOrUpdateDevice } from '@/server/auth/device-service';
import { logAuthEvent } from '@/server/auth/audit-service';
import { getUserAccessibleTenants } from '@/server/auth/tenant-membership';
import { LoginResponsePayload } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';

export async function POST(req: NextRequest) {
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'Unknown';

  try {
    const authHeader = req.headers.get('authorization');
    const token = extractBearerToken(authHeader);

    // 1. Verify token with Firebase Admin
    const verifiedToken = await verifyFirebaseToken(token, true);

    const body = await req.json().catch(() => ({}));
    const requestedTenantId = body.tenantId || 'central-metro-hospital';
    const deviceData = body.device || {};

    // 2. Register / heartbeat device workstation if provided
    let registeredDevice;
    if (deviceData.deviceId) {
      registeredDevice = await registerOrUpdateDevice({
        deviceId: deviceData.deviceId,
        userId: verifiedToken.uid,
        tenantId: requestedTenantId,
        deviceType: deviceData.deviceType,
        platform: deviceData.platform,
        appVersion: deviceData.appVersion,
      });
    }

    // 3. Create server-authoritative session
    const session = await createSession({
      userId: verifiedToken.uid,
      tenantId: requestedTenantId,
      deviceId: registeredDevice?.deviceId,
      ip: clientIp,
      userAgent,
    });

    // 4. Resolve full authorization context (RBAC, ABAC, Department, Privileges, Status)
    const authContext = await resolveAuthorizationContext(
      verifiedToken,
      requestedTenantId,
      session.sessionId,
      registeredDevice?.deviceId
    );

    // 5. Get user's accessible tenants
    const accessibleTenants = await getUserAccessibleTenants(verifiedToken.uid, verifiedToken.email);

    // 6. Log security audit event
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
        name: authContext.tenantId === 'central-metro-hospital' ? 'Central Metro General Hospital' : `Hospital (${authContext.tenantId})`,
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
      code: 'AUTHENTICATION_REQUIRED',
      message: err?.message || 'Authentication failed',
      statusCode: 401,
    });

    await logAuthEvent({
      eventType: 'LOGIN_FAILURE',
      ip: clientIp,
      userAgent,
      reason: errorObj.message,
    }).catch(() => {});

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

export async function GET(req: NextRequest) {
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || req.headers.get('x-real-ip') || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'Unknown';

  try {
    const authHeader = req.headers.get('authorization');
    const token = extractBearerToken(authHeader);

    const verifiedToken = await verifyFirebaseToken(token, false);
    const tenantId = (req.headers.get('x-ghims-tenant-id') || verifiedToken.claims.tenantId || 'central-metro-hospital').toLowerCase();

    // Resolve auth context
    const authContext = await resolveAuthorizationContext(verifiedToken, tenantId);
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
        name: authContext.tenantId === 'central-metro-hospital' ? 'Central Metro General Hospital' : `Hospital (${authContext.tenantId})`,
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
        sessionId: authContext.sessionId,
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
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
      code: 'SESSION_EXPIRED',
      message: err?.message || 'Session validation failed',
      statusCode: 401,
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

export async function DELETE(req: NextRequest) {
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'Unknown';

  try {
    const authHeader = req.headers.get('authorization');
    let userId = 'anonymous';
    let tenantId = 'central-metro-hospital';

    if (authHeader) {
      try {
        const token = extractBearerToken(authHeader);
        const verified = await verifyFirebaseToken(token, false);
        userId = verified.uid;
      } catch {
        // Continue cleanup
      }
    }

    const body = await req.json().catch(() => ({}));
    if (body.sessionId) {
      await revokeSession(body.tenantId || tenantId, body.sessionId, userId, 'User initiated sign out');
    }

    await logAuthEvent({
      eventType: 'LOGOUT',
      tenantId: body.tenantId || tenantId,
      userId,
      sessionId: body.sessionId,
      ip: clientIp,
      userAgent,
      reason: 'Standard user sign out',
    });

    return NextResponse.json({ success: true, message: 'Session terminated successfully' });
  } catch (err: any) {
    return NextResponse.json({ success: true });
  }
}
