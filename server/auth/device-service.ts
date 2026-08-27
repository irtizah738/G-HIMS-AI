/**
 * G-HIMS Server-Side Device & Workstation Registration Service
 */

import { getAdminFirestore } from '@/server/firebase/admin';
import { UserDeviceRecord } from '@/lib/auth/auth-types';
import { AuthError } from '@/lib/auth/auth-errors';

export interface RegisterDeviceParams {
  deviceId: string;
  userId: string;
  tenantId: string;
  deviceType?: 'DESKTOP' | 'TABLET' | 'MOBILE';
  platform?: string;
  appVersion?: string;
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
    return deviceRecord;
  }

  try {
    const devDocRef = db.collection('tenants').doc(params.tenantId).collection('devices').doc(params.deviceId);
    const existingSnap = await devDocRef.get();

    if (existingSnap.exists) {
      const data = existingSnap.data() as UserDeviceRecord;
      if (data.status === 'REVOKED') {
        throw new AuthError({
          code: 'DEVICE_REVOKED',
          message: 'Workstation device has been revoked by hospital IT policy',
          statusCode: 403,
        });
      }

      await devDocRef.update({
        lastSeenAt: now,
        lastSyncAt: now,
      }).catch(() => {});

      return {
        ...data,
        lastSeenAt: now,
        lastSyncAt: now,
      };
    }

    await devDocRef.set(deviceRecord, { merge: true });
    return deviceRecord;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    return deviceRecord;
  }
}
