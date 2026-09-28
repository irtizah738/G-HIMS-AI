import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
  type Auth,
} from 'firebase/auth';
import { getAdminFirestore } from '@/server/firebase/admin';
import { verifyFirebaseToken } from '@/server/auth/verify-token';
import { resolveAuthorizationContext } from '@/server/auth/authorization-context';
import { createSession, validateSession } from '@/server/auth/session-service';
import { registerOrUpdateDevice } from '@/server/auth/device-service';
import { UserProvisioningService } from '@/server/auth/user-provisioning-service';
import { findActiveBreakGlassGrant } from '@/server/auth/break-glass-service';

let clientApp: FirebaseApp;
let clientAuth: Auth;

function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${crypto.randomUUID().slice(0,8)}@example.test`;
}

describe('P5A Firebase Auth + IAM integration', () => {
  beforeAll(() => {
    const projectId = process.env.FIREBASE_PROJECT_ID || 'ghims-p5a-ci';
    clientApp = initializeApp(
      {
        apiKey: 'fake-api-key-for-emulator',
        authDomain: `${projectId}.firebaseapp.com`,
        projectId,
      },
      `p5a-client-${Date.now()}`
    );
    clientAuth = getAuth(clientApp);
    const host = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    connectAuthEmulator(clientAuth, `http://${host}`, { disableWarnings: true });
  });

  afterAll(async () => {
    await signOut(clientAuth).catch(() => {});
    await deleteApp(clientApp).catch(() => {});
  });

  test('real Firebase UID becomes the tenant membership key and authorizes a session', async () => {
    const tenantId = `tenant-p5a-${crypto.randomUUID().slice(0,8)}`;
    const email = uniqueEmail('doctor');
    const password = 'P5a-Test-Password-123!';

    const credential = await createUserWithEmailAndPassword(clientAuth, email, password);
    const uid = credential.user.uid;

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
    expect(provisioned.user.userId).toBe(uid);

    const db = getAdminFirestore();
    expect(db).not.toBeNull();
    if (!db) throw new Error('Firestore Admin emulator unavailable');

    const membership = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('users')
      .doc(uid)
      .get();

    expect(membership.exists).toBe(true);
    expect(membership.data()?.userId).toBe(uid);
    expect(membership.data()?.roles).toEqual(['doctor']);
    expect(membership.data()?.credentialStatus).toBe('UNVERIFIED');

    const idToken = await credential.user.getIdToken(true);
    const verified = await verifyFirebaseToken(idToken, false);
    expect(verified.uid).toBe(uid);

    const authorization = await resolveAuthorizationContext(verified, tenantId);
    expect(authorization.uid).toBe(uid);
    expect(authorization.roles).toContain('doctor');
    // Clinical authority remains credential-gated.
    expect(authorization.clinicalPrivileges).toEqual([]);

    const session = await createSession({
      userId: uid,
      tenantId,
      deviceId: 'shared-workstation-a',
      ip: '127.0.0.1',
      userAgent: 'P5A Auth Emulator',
    });
    const validated = await validateSession(tenantId, session.sessionId, uid);
    expect(validated.status).toBe('ACTIVE');
    expect(validated.userId).toBe(uid);
  });

  test('shared tenant workstation supports sequential users without transferring user authority', async () => {
    const tenantId = `tenant-shared-${crypto.randomUUID().slice(0,8)}`;
    const password = 'P5a-Shared-Password-123!';
    const deviceId = 'shared-nurse-station-01';

    const emailA = uniqueEmail('usera');
    const userA = await createUserWithEmailAndPassword(clientAuth, emailA, password);
    await UserProvisioningService.provision({
      tenantId,
      email: emailA,
      displayName: 'Shared User A',
      role: 'nurse',
      department: 'Ward A',
      assignedWards: ['Ward A'],
    });

    const deviceA = await registerOrUpdateDevice({
      deviceId,
      userId: userA.user.uid,
      tenantId,
    });
    expect(deviceA.userId).toBe(userA.user.uid);

    await signOut(clientAuth);

    const emailB = uniqueEmail('userb');
    const userB = await createUserWithEmailAndPassword(clientAuth, emailB, password);
    await UserProvisioningService.provision({
      tenantId,
      email: emailB,
      displayName: 'Shared User B',
      role: 'nurse',
      department: 'Ward A',
      assignedWards: ['Ward A'],
    });

    const deviceB = await registerOrUpdateDevice({
      deviceId,
      userId: userB.user.uid,
      tenantId,
    });
    expect(deviceB.userId).toBe(userB.user.uid);
    expect(deviceB.tenantId).toBe(tenantId);

    const db = getAdminFirestore();
    if (!db) throw new Error('Firestore Admin emulator unavailable');
    const deviceDoc = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('devices')
      .doc(deviceId)
      .get();

    expect(deviceDoc.data()?.userId).toBe(userB.user.uid);
    expect(deviceDoc.data()?.tenantId).toBe(tenantId);
  });

  test('disabled membership and wrong tenant fail closed after Firebase authentication', async () => {
    await signOut(clientAuth).catch(() => {});
    const tenantId = `tenant-deny-${crypto.randomUUID().slice(0,8)}`;
    const email = uniqueEmail('disabled');
    const password = 'P5a-Disabled-Password-123!';

    const credential = await createUserWithEmailAndPassword(clientAuth, email, password);
    await UserProvisioningService.provision({
      tenantId,
      email,
      displayName: 'Disabled User',
      role: 'reception',
      department: 'Front Desk',
      assignedWards: [],
    });

    const token = await credential.user.getIdToken(true);
    const verified = await verifyFirebaseToken(token, false);

    await expect(
      resolveAuthorizationContext(verified, `wrong-${tenantId}`)
    ).rejects.toThrow(/no membership|TENANT/i);

    await UserProvisioningService.update({
      tenantId,
      userId: credential.user.uid,
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

    const wrongPatient = await findActiveBreakGlassGrant({
      tenantId,
      userId,
      patientId: 'patient-b',
      encounterId,
    });
    expect(wrongPatient).toBeNull();

    await ref.set(
      {
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
      { merge: true }
    );

    const expired = await findActiveBreakGlassGrant({
      tenantId,
      userId,
      patientId,
      encounterId,
    });
    expect(expired).toBeNull();

    const expiredDoc = await ref.get();
    expect(expiredDoc.data()?.status).toBe('EXPIRED');
  });
});
