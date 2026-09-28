import { afterAll, describe, expect, test } from 'bun:test';
import getAdminApp, { getAdminFirestore } from '@/server/firebase/admin';
import { deleteApp } from 'firebase-admin/app';
import { verifyFirebaseToken } from '@/server/auth/verify-token';
import { resolveAuthorizationContext } from '@/server/auth/authorization-context';
import { createSession, validateSession } from '@/server/auth/session-service';
import { registerOrUpdateDevice } from '@/server/auth/device-service';
import { findActiveBreakGlassGrant } from '@/server/auth/break-glass-service';

interface EmulatorIdentity {
  localId: string;
  email: string;
  idToken: string;
}

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${crypto.randomUUID().slice(0,8)}@example.test`;
}

function authEmulatorBase(): string {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  return `http://${host}/identitytoolkit.googleapis.com/v1`;
}

async function createEmulatorIdentity(
  email: string,
  password: string
): Promise<EmulatorIdentity> {
  const response = await fetch(
    `${authEmulatorBase()}/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
      signal: AbortSignal.timeout(10_000),
    }
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`AUTH_EMULATOR_SIGNUP_FAILED: ${JSON.stringify(payload)}`);
  }
  return payload as EmulatorIdentity;
}

async function writeMembership(params: {
  tenantId: string;
  identity: EmulatorIdentity;
  role: string;
  status?: 'ACTIVE' | 'DISABLED';
  department?: string;
  credentialStatus?: 'VERIFIED' | 'UNVERIFIED';
  clinicalPrivileges?: string[];
}) {
  const db = getAdminFirestore();
  if (!db) throw new Error('Firestore Admin emulator unavailable');

  const now = new Date().toISOString();
  await db
    .collection('tenants')
    .doc(params.tenantId)
    .collection('users')
    .doc(params.identity.localId)
    .set({
      userId: params.identity.localId,
      tenantId: params.tenantId,
      email: params.identity.email,
      displayName: params.identity.email.split('@')[0],
      role: params.role,
      roles: [params.role],
      status: params.status || 'ACTIVE',
      department: params.department || 'General',
      departmentIds: [params.department || 'General'],
      facilityIds: [],
      permissions: [],
      clinicalPrivileges: params.clinicalPrivileges || [],
      credentialStatus: params.credentialStatus || 'VERIFIED',
      createdAt: now,
      updatedAt: now,
    });
}

describe('P5A Firebase Auth + IAM integration', () => {
  afterAll(async () => {
    const db = getAdminFirestore();
    if (db) {
      await db.terminate().catch(() => {});
    }

    const app = getAdminApp();
    if (app) {
      await deleteApp(app).catch(() => {});
    }
  });

  test('real Firebase Auth token resolves the UID-backed tenant membership and session', async () => {
    const tenantId = `tenant-p5a-${crypto.randomUUID().slice(0,8)}`;
    const identity = await createEmulatorIdentity(
      uniqueEmail('doctor'),
      'P5a-Test-Password-123!'
    );

    await writeMembership({
      tenantId,
      identity,
      role: 'doctor',
      department: 'General Medicine',
      credentialStatus: 'UNVERIFIED',
      clinicalPrivileges: ['ORDER_LAB', 'SIGN_CLINICAL_NOTES'],
    });

    const db = getAdminFirestore();
    if (!db) throw new Error('Firestore Admin emulator unavailable');

    const membership = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('users')
      .doc(identity.localId)
      .get();

    expect(membership.exists).toBe(true);
    expect(membership.data()?.userId).toBe(identity.localId);
    expect(membership.data()?.roles).toEqual(['doctor']);

    const verified = await verifyFirebaseToken(identity.idToken, false);
    expect(verified.uid).toBe(identity.localId);

    const authorization = await resolveAuthorizationContext(verified, tenantId);
    expect(authorization.uid).toBe(identity.localId);
    expect(authorization.roles).toContain('doctor');
    // Membership declares privileges, but UNVERIFIED credentials must strip them.
    expect(authorization.clinicalPrivileges).toEqual([]);

    const session = await createSession({
      userId: identity.localId,
      tenantId,
      deviceId: 'shared-workstation-a',
      ip: '127.0.0.1',
      userAgent: 'P5A Auth Emulator',
    });

    const validated = await validateSession(
      tenantId,
      session.sessionId,
      identity.localId
    );
    expect(validated.status).toBe('ACTIVE');
    expect(validated.userId).toBe(identity.localId);
  }, 15_000);

  test('shared tenant workstation supports sequential authenticated users', async () => {
    const tenantId = `tenant-shared-${crypto.randomUUID().slice(0,8)}`;
    const deviceId = 'shared-nurse-station-01';

    const identityA = await createEmulatorIdentity(
      uniqueEmail('usera'),
      'P5a-Shared-A-Password-123!'
    );
    await writeMembership({
      tenantId,
      identity: identityA,
      role: 'nurse',
      department: 'Ward A',
    });

    const deviceA = await registerOrUpdateDevice({
      deviceId,
      userId: identityA.localId,
      tenantId,
    });
    expect(deviceA.userId).toBe(identityA.localId);

    const identityB = await createEmulatorIdentity(
      uniqueEmail('userb'),
      'P5a-Shared-B-Password-123!'
    );
    await writeMembership({
      tenantId,
      identity: identityB,
      role: 'nurse',
      department: 'Ward A',
    });

    const deviceB = await registerOrUpdateDevice({
      deviceId,
      userId: identityB.localId,
      tenantId,
    });
    expect(deviceB.userId).toBe(identityB.localId);
    expect(deviceB.tenantId).toBe(tenantId);

    const db = getAdminFirestore();
    if (!db) throw new Error('Firestore Admin emulator unavailable');
    const deviceDoc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('devices')
      .doc(deviceId)
      .get();

    expect(deviceDoc.data()?.userId).toBe(identityB.localId);
    expect(deviceDoc.data()?.tenantId).toBe(tenantId);
  }, 15_000);

  test('disabled membership and wrong tenant fail closed after Firebase authentication', async () => {
    const tenantId = `tenant-deny-${crypto.randomUUID().slice(0,8)}`;
    const identity = await createEmulatorIdentity(
      uniqueEmail('disabled'),
      'P5a-Disabled-Password-123!'
    );

    await writeMembership({
      tenantId,
      identity,
      role: 'receptionist',
      department: 'Front Desk',
    });

    const verified = await verifyFirebaseToken(identity.idToken, false);

    await expect(
      resolveAuthorizationContext(verified, `wrong-${tenantId}`)
    ).rejects.toThrow(/no membership|TENANT/i);

    const db = getAdminFirestore();
    if (!db) throw new Error('Firestore Admin emulator unavailable');
    await db
      .collection('tenants')
      .doc(tenantId)
      .collection('users')
      .doc(identity.localId)
      .set(
        {
          status: 'DISABLED',
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

    await expect(
      resolveAuthorizationContext(verified, tenantId)
    ).rejects.toThrow(/disabled/i);
  }, 15_000);

  test('break-glass grants are exact-user patient encounter scoped and expire server-side', async () => {
    const db = getAdminFirestore();
    if (!db) throw new Error('Firestore Admin emulator unavailable');

    const tenantId = `tenant-bg-${crypto.randomUUID().slice(0,8)}`;
    const userId = `uid-${crypto.randomUUID().slice(0,8)}`;
    const patientId = 'patient-a';
    const encounterId = 'encounter-a';
    const grantId = `bg-${crypto.randomUUID()}`;

    const ref = db
      .collection('tenants')
      .doc(tenantId)
      .collection('break_glass_grants')
      .doc(grantId);

    await ref.set({
      grantId,
      tenantId,
      userId,
      patientId,
      encounterId,
      reason: 'Emergency access for emulator validation',
      scope: ['EMERGENCY_CLINICAL_OVERRIDE'],
      status: 'ACTIVE',
      reviewStatus: 'PENDING_REVIEW',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const active = await findActiveBreakGlassGrant({
      tenantId,
      userId,
      patientId,
      encounterId,
    });
    expect(active?.grantId).toBe(grantId);

    expect(
      await findActiveBreakGlassGrant({
        tenantId,
        userId,
        patientId: 'patient-b',
        encounterId,
      })
    ).toBeNull();

    await ref.set(
      {
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
      { merge: true }
    );

    expect(
      await findActiveBreakGlassGrant({
        tenantId,
        userId,
        patientId,
        encounterId,
      })
    ).toBeNull();

    expect((await ref.get()).data()?.status).toBe('EXPIRED');
  }, 15_000);
});
