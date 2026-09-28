import { getAdminFirestore } from '@/server/firebase/admin';

export interface ActiveBreakGlassGrant {
  grantId: string;
  tenantId: string;
  userId: string;
  patientId: string;
  encounterId: string;
  reason: string;
  expiresAt: string;
}

export async function findActiveBreakGlassGrant(params: {
  tenantId: string;
  userId: string;
  patientId: string;
  encounterId: string;
}): Promise<ActiveBreakGlassGrant | null> {
  const db = getAdminFirestore();
  if (!db) return null;

  const snapshot = await db
    .collection('tenants')
    .doc(params.tenantId)
    .collection('break_glass_grants')
    .where('userId', '==', params.userId)
    .limit(20)
    .get();

  const now = Date.now();

  for (const document of snapshot.docs) {
    const data = document.data() as Record<string, unknown>;
    if (
      String(data.status || '') !== 'ACTIVE' ||
      String(data.patientId || '') !== params.patientId ||
      String(data.encounterId || '') !== params.encounterId
    ) {
      continue;
    }

    const expiresAt = String(data.expiresAt || '');
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      await document.ref.set(
        {
          status: 'EXPIRED',
          expiredAt: new Date(now).toISOString(),
        },
        { merge: true }
      ).catch(() => {});
      continue;
    }

    return {
      grantId: document.id,
      tenantId: params.tenantId,
      userId: params.userId,
      patientId: params.patientId,
      encounterId: params.encounterId,
      reason: String(data.reason || ''),
      expiresAt,
    };
  }

  return null;
}
