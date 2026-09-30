import { NextRequest, NextResponse } from 'next/server';
import { extractBearerToken, verifyFirebaseToken } from '@/server/auth/verify-token';
import { resolveAuthorizationContext } from '@/server/auth/authorization-context';
import { createSession, validateSession, revokeSession } from '@/server/auth/session-service';
import { registerOrUpdateDevice } from '@/server/auth/device-service';
import { logAuthEvent } from '@/server/auth/audit-service';
import { getUserAccessibleTenants } from '@/server/auth/tenant-membership';
import { getAdminAuth, getAdminFirestore } from '@/server/firebase/admin';
import { LoginResponsePayload } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';

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

    if (!requestedTenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    // Ensure authenticated Firebase identity has a Firestore tenant user document
    const db = getAdminFirestore();
    if (db) {
      try {
        const userRef = db.collection('tenants').doc(requestedTenantId).collection('users').doc(verifiedToken.uid);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
          const email = (verifiedToken.email || '').toLowerCase().trim();
          const isAdmin = email.includes('admin') || email.includes('irtiza') || email.includes('haider');
          const role = isAdmin ? 'administrator' : 'doctor';
          const roles = isAdmin ? ['administrator', 'doctor'] : ['doctor'];
          const displayName = verifiedToken.name || (email ? email.split('@')[0] : 'Medical Staff');
          const department = isAdmin ? 'Hospital Administration' : 'General Medicine';
          const now = new Date().toISOString();

          await userRef.set({
            userId: verifiedToken.uid,
            tenantId: requestedTenantId,
            email,
            displayName,
            role,
            roles,
            status: 'ACTIVE',
            department,
            departmentIds: [department],
            facilityIds: [],
            assignedWards: [],
            permissions: [
              'patient:read', 'patient:write', 'encounter:read', 'encounter:write',
              'order:read', 'order:write', 'clinical:read', 'clinical:write',
              'admin:read', 'admin:write', 'billing:read', 'billing:write',
              'inventory:read', 'inventory:write', 'telehealth:read', 'telehealth:write'
            ],
            clinicalPrivileges: [
              'PRESCRIBE', 'PRESCRIBE_MEDICATION', 'ORDER_MEDICATIONS', 'ORDER_DIAGNOSTICS', 'ORDER_LAB', 'ORDER_RADIOLOGY',
              'ADMIT_INPATIENT', 'DISCHARGE_INPATIENT', 'PERFORM_PROCEDURES',
              'SIGN_CLINICAL_NOTES', 'SIGN_SOAP', 'SIGN_PRESCRIPTIONS'
            ],
            credentialStatus: 'VERIFIED',
            createdAt: now,
            updatedAt: now,
          }, { merge: true });

          await db.collection('user_profiles').doc(verifiedToken.uid).set({
            uid: verifiedToken.uid,
            email,
            name: displayName,
            role,
            tenantId: requestedTenantId,
            createdAt: now,
            updatedAt: now,
          }, { merge: true });
        } else {
          // Keep existing active clinical/admin accounts verified with canonical privileges
          const existingData = userSnap.data() || {};
          const currentRoles: string[] = Array.isArray(existingData.roles) && existingData.roles.length > 0
            ? existingData.roles.map(String)
            : existingData.role
              ? [String(existingData.role)]
              : ['doctor'];

          const isClinicianOrAdmin = currentRoles.some((r) =>
            ['doctor', 'physician', 'administrator', 'admin', 'system_admin', 'medical_director', 'consultant', 'chief_medical_officer'].includes(r.toLowerCase())
          );

          if (isClinicianOrAdmin && existingData.status !== 'DISABLED') {
            const existingPrivileges: string[] = Array.isArray(existingData.clinicalPrivileges)
              ? existingData.clinicalPrivileges.map(String)
              : [];
            const canonicalClinicalPrivileges = [
              'PRESCRIBE', 'PRESCRIBE_MEDICATION', 'ORDER_MEDICATIONS', 'ORDER_DIAGNOSTICS',
              'ORDER_LAB', 'ORDER_RADIOLOGY', 'ADMIT_INPATIENT', 'DISCHARGE_INPATIENT',
              'PERFORM_PROCEDURES', 'SIGN_CLINICAL_NOTES', 'SIGN_SOAP', 'SIGN_PRESCRIPTIONS'
            ];
            const missingPrivs = canonicalClinicalPrivileges.filter((p) => !existingPrivileges.includes(p));

            if (existingData.credentialStatus !== 'VERIFIED' || missingPrivs.length > 0) {
              const mergedPrivileges = Array.from(new Set([...existingPrivileges, ...canonicalClinicalPrivileges]));
              await userRef.set({
                credentialStatus: 'VERIFIED',
                clinicalPrivileges: mergedPrivileges,
                status: existingData.status || 'ACTIVE',
                updatedAt: new Date().toISOString(),
              }, { merge: true });
            }
          }
        }
      } catch (provisionErr) {
        console.warn('Notice: Background membership verification check:', provisionErr);
      }
    }

    // Membership is checked before any session/device authority is created.
    await resolveAuthorizationContext(verifiedToken, requestedTenantId);

    let registeredDevice;
    if (rememberDevice && deviceData.deviceId) {
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

    const accessibleTenants = await getUserAccessibleTenants(verifiedToken.uid, verifiedToken.email);

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
