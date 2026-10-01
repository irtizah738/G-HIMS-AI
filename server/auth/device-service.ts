/**
 * G-HIMS Server-Side Device & Workstation Registration Service
 */

import { getAdminFirestore } from '@/server/firebase/admin';
import { UserDeviceRecord } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';

export interface RegisterDeviceParams {
  deviceId: string;
  userId: string;
  tenantId: string;
  deviceType?: 'DESKTOP' | 'TABLET' | 'MOBILE';
  platform?: string;
  appVersion?: string;
}

function canUseEphemeralDeviceState(): boolean {
  const mode = getRuntimeMode();
  return mode === 'DEMO' || mode === 'TEST';
}

export async function registerOrUpdateDevice(params: RegisterDeviceParams): Promise<UserDeviceRecord> {
  const db = getAdminFirestore();
  const now = new Date().toISOString();

  const deviceRecord: UserDeviceRecord = {
    deviceId: params.deviceId,
    userId: params.userId,
    tenantId: params.tenantId,
    deviceType: params.deviceType || 'DESKTOP',
    platform: params.platform || 'Browser',
    appVersion: params.appVersion || '2026.1.0',
    firstSeenAt: now,
    lastSeenAt: now,
    status: 'ACTIVE',
  };

  if (!db) {
    if (canUseEphemeralDeviceState()) return deviceRecord;

    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Authoritative device registry is unavailable.',
      statusCode: 503,
    });
  }

  try {
    const devDocRef = db.collection('tenants').doc(params.tenantId).collection('devices').doc(params.deviceId);
    const existingSnap = await devDocRef.get();

    if (existingSnap.exists) {
      const data = existingSnap.data() as UserDeviceRecord;

      if (data.tenantId !== params.tenantId) {
        throw new AuthError({
          code: 'DEVICE_REVOKED',
          message: 'Clinical workstation is enrolled to a different tenant.',
          statusCode: 403,
        });
      }

      if (data.status === 'REVOKED') {
        throw new AuthError({
          code: 'DEVICE_REVOKED',
          message: 'Workstation device has been revoked by hospital IT policy.',
          statusCode: 403,
        });
      }

      await devDocRef.update({
        userId: params.userId,
        lastSeenAt: now,
        lastSyncAt: now,
      });

      // userId is the most recent user for backward-compatible audit display only.
      // Device trust is tenant/workstation scoped; user authority remains session scoped.
      return {
        ...data,
        userId: params.userId,
        lastSeenAt: now,
        lastSyncAt: now,
      };
    }

    await devDocRef.create(deviceRecord);
    return deviceRecord;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (canUseEphemeralDeviceState()) return deviceRecord;

    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Unable to validate or persist clinical device registration.',
      statusCode: 503,
      originalError: error,
    });
  }
}


export async function assertDeviceActive(
  tenantId: string,
  deviceId: string,
  expectedUserId?: string
): Promise<UserDeviceRecord> {
  if (!tenantId || !deviceId) {
    throw new AuthError({
      code: 'DEVICE_REVOKED',
      message: 'A bound clinical device identifier is required.',
      statusCode: 403,
    });
  }

  const db = getAdminFirestore();
  if (!db) {
    if (canUseEphemeralDeviceState()) {
      return {
        deviceId,
        userId: expectedUserId || 'test-user',
        tenantId,
        deviceType: 'DESKTOP',
        platform: 'TEST',
        appVersion: 'TEST',
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        status: 'ACTIVE',
      };
    }
    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Authoritative device registry is unavailable.',
      statusCode: 503,
    });
  }

  const snapshot = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('devices')
    .doc(deviceId)
    .get();

  if (!snapshot.exists) {
    throw new AuthError({
      code: 'DEVICE_REVOKED',
      message: 'Bound clinical device is no longer registered.',
      statusCode: 403,
    });
  }

  const device = snapshot.data() as UserDeviceRecord;
  if (
    device.tenantId !== tenantId ||
    device.status !== 'ACTIVE'
  ) {
    throw new AuthError({
      code: 'DEVICE_REVOKED',
      message: 'Clinical device has been revoked by hospital IT policy.',
      statusCode: 403,
    });
  }

  return device;
}

export async function revokeDevice(
  tenantId: string,
  deviceId: string,
  revokedBy: string,
  reason: string
): Promise<void> {
  const db = getAdminFirestore();
  if (!db) {
    if (canUseEphemeralDeviceState()) return;
    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Authoritative device registry is unavailable.',
      statusCode: 503,
    });
  }

  const ref = db
    .collection('tenants')
    .doc(tenantId)
    .collection('devices')
    .doc(deviceId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    throw new AuthError({
      code: 'DEVICE_REVOKED',
      message: 'Clinical device is not registered.',
      statusCode: 404,
    });
  }

  await ref.update({
    status: 'REVOKED',
    revokedAt: new Date().toISOString(),
    revokedBy,
    revokeReason: reason,
  });

  const sessions = await db
    .collection('tenants')
    .doc(tenantId)
    .collection('sessions')
    .where('deviceId', '==', deviceId)
    .get();

  const active = sessions.docs.filter(
    (document) => String(document.data().status || '') === 'ACTIVE'
  );
  if (active.length > 0) {
    const batch = db.batch();
    const revokedAt = new Date().toISOString();
    for (const document of active) {
      batch.update(document.ref, {
        status: 'REVOKED',
        revokedAt,
        revokedBy,
        revokeReason: `Device revoked: ${reason}`,
      });
    }
    await batch.commit();
  }
}
