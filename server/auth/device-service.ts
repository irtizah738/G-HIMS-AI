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

      if (data.userId !== params.userId || data.tenantId !== params.tenantId) {
        throw new AuthError({
          code: 'DEVICE_REVOKED',
          message: 'Clinical workstation is bound to a different user or tenant.',
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
        lastSeenAt: now,
        lastSyncAt: now,
      });

      return {
        ...data,
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
