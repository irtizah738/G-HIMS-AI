import { afterAll, describe, expect, test } from 'bun:test';
import getAdminApp, { getAdminFirestore } from '@/server/firebase/admin';
import { deleteApp } from 'firebase-admin/app';
import { verifyFirebaseToken } from '@/server/auth/verify-token';
import { resolveAuthorizationContext } from '@/server/auth/authorization-context';
import { createSession, validateSession } from '@/server/auth/session-service';
import { registerOrUpdateDevice } from '@/server/auth/device-service';
import { UserProvisioningService } from '@/server/auth/user-provisioning-service';
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

  test('real Firebase UID becomes the tenant membership key and authorizes a session', async () => {
    const tenantId = `tenant-p5a-${crypto.randomUUID().slice(0,8)}`;
    const email = uniqueEmail('doctor');
    const identity = await createEmulatorIdentity(
      email,
      'P5a-Test-Password-123!'
    );

    const provisioned = await UserProvisioningService.provision({
      tenantId,
      email,
      displayName: 'P5A Doctor',
      role: 'doctor',
      department: 'General Medicine',
      licenseId: 'TEST-MD-001',
      assignedWards: ['OPD'],
    });

    expect(provisioned.identityCreated).toBe(false);
    expect(provisioned.user.userId).toBe(identity.localId);

    const db = getAdminFirestore();
    expect(db).not.toBeNull();
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
    expect(membership.data()?.credentialStatus).toBe('UNVERIFIED');

    const verified = await verifyFirebaseToken(identity.idToken, false);
    expect(verified.uid).toBe(identity.localId);

    const authorization = await resolveAuthorizationContext(verified, tenantId);
    expect(authorization.uid).toBe(identity.localId);
    expect(authorization.roles).toContain('doctor');
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
  });

  test('shared tenant workstation supports sequential users without transferring user authority', async () => {
    const tenantId = `tenant-shared-${crypto.randomUUID().slice(0,8)}`;
    const deviceId = 'shared-nurse-station-01';

    const identityA = await createEmulatorIdentity(
      uniqueEmail('usera'),
      'P5a-Shared-A-Password-123!'
    );
    await UserProvisioningService.provision({
      tenantId,
      email: identityA.email,
      displayName: 'Shared User A',
      role: 'nurse',
      department: 'Ward A',
      assignedWards: ['Ward A'],
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
    await UserProvisioningService.provision({
      tenantId,
      email: identityB.email,
      displayName: 'Shared User B',
      role: 'nurse',
      department: 'Ward A',
      assignedWards: ['Ward A'],
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
  });

  test('disabled membership and wrong tenant fail closed after Firebase authentication', async () => {
    const tenantId = `tenant-deny-${crypto.randomUUID().slice(0,8)}`;
    const identity = await createEmulatorIdentity(
      uniqueEmail('disabled'),
      'P5a-Disabled-Password-123!'
    );

    await UserProvisioningService.provision({
      tenantId,
      email: identity.email,
      displayName: 'Disabled User',
      role: 'reception',
      department: 'Front Desk',
      assignedWards: [],
    });

    const verified = await verifyFirebaseToken(identity.idToken, false);

    await expect(
      resolveAuthorizationContext(verified, `wrong-${tenantId}`)
    ).rejects.toThrow(/no membership|TENANT/i);

    await UserProvisioningService.update({
      tenantId,
      userId: identity.localId,
      status: 'disabled',
    });

    await expect(
      resolveAuthorizationContext(verified, tenantId)
    ).rejects.toThrow(/disabled/i);
  });

  test('server provisioning creates a Firebase identity and membership with the same UID', async () => {
    const tenantId = `tenant-provision-${crypto.randomUUID().slice(0,8)}`;
    const email = uniqueEmail('provisioned');

    const result = await UserProvisioningService.provision({
      tenantId,
      email,
      displayName: 'Provisioned Administrator',
      role: 'admin',
      department: 'Hospital Administration',
      assignedWards: [],
    });

    expect(result.identityCreated).toBe(true);
    expect(result.passwordSetupRequired).toBe(true);

    const db = getAdminFirestore();
    if (!db) throw new Error('Firestore Admin emulator unavailable');
    const membership = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('users')
      .doc(result.user.userId)
      .get();

    expect(membership.exists).toBe(true);
    expect(membership.data()?.userId).toBe(result.user.userId);
    expect(membership.data()?.roles).toEqual(['administrator']);
  });

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
  });
});
