import { getAdminFirestore } from '@/server/firebase/admin';
import type { VectorClock } from '@/types/offline';
import { compareClocks, mergeClocks } from '@/lib/offline/vector-clock';

export interface EdgeVersionRecord {
  tenantId: string;
  entityKey: string;
  serverVersion: number;
  vectorClock: VectorClock;
  updatedAt: number;
  lastMutationId?: string;
}

function documentId(entityKey: string): string {
  return entityKey.replace(/[^a-zA-Z0-9_.:-]/g, '_');
}

export class EdgeVersionRepository {
  public static async get(tenantId: string, entityKey: string): Promise<EdgeVersionRecord | null> {
    const db = getAdminFirestore();
    if (!db) return null;
    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('edge_versions')
      .doc(documentId(entityKey))
      .get();
    return snapshot.exists ? snapshot.data() as EdgeVersionRecord : null;
  }

  public static compare(
    current: EdgeVersionRecord | null,
    baseEntityVersion?: number,
    baseVectorClock?: VectorClock
  ): 'MATCH' | 'STALE' | 'CONCURRENT' {
    if (!current) return 'MATCH';

    if (
      typeof baseEntityVersion === 'number' &&
      baseEntityVersion > 0 &&
      baseEntityVersion !== current.serverVersion
    ) {
      return 'STALE';
    }

    if (baseVectorClock && Object.keys(baseVectorClock).length > 0) {
      const relation = compareClocks(baseVectorClock, current.vectorClock);
      if (relation === 'CONCURRENT') return 'CONCURRENT';
      if (relation === 'LESS') return 'STALE';
    }

    return 'MATCH';
  }

  public static async recordAccepted(
    tenantId: string,
    entityKey: string,
    clientClock: VectorClock | undefined,
    mutationId: string
  ): Promise<EdgeVersionRecord | null> {
    const db = getAdminFirestore();
    if (!db) return null;

    const ref = db
      .collection('tenants')
      .doc(tenantId)
      .collection('edge_versions')
      .doc(documentId(entityKey));

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists ? snapshot.data() as EdgeVersionRecord : null;
      const next: EdgeVersionRecord = {
        tenantId,
        entityKey,
        serverVersion: (current?.serverVersion || 0) + 1,
        vectorClock: mergeClocks(current?.vectorClock || {}, clientClock || {}),
        updatedAt: Date.now(),
        lastMutationId: mutationId,
      };
      transaction.set(ref, next, { merge: false });
      return next;
    });
  }
}


export interface AuthoritativeEntityVersion {
  serverVersion: number;
  vectorClock: VectorClock;
}

export async function getAuthoritativeEntityVersion(
  tenantId: string,
  collection: string,
  entityId: string
): Promise<AuthoritativeEntityVersion | null> {
  const db = getAdminFirestore();
  if (!db) return null;

  const snapshot = await db
    .collection('tenants')
    .doc(tenantId)
    .collection(collection)
    .doc(entityId)
    .get();

  if (!snapshot.exists) return null;
  const data = snapshot.data() as Record<string, unknown>;

  return {
    serverVersion: Number(data._serverVersion || 0),
    vectorClock:
      data._vectorClock && typeof data._vectorClock === 'object'
        ? data._vectorClock as VectorClock
        : {},
  };
}

export function compareAuthoritativeEntityVersion(
  current: AuthoritativeEntityVersion | null,
  baseEntityVersion?: number,
  baseVectorClock?: VectorClock
): 'MATCH' | 'STALE' | 'CONCURRENT' {
  if (!current) return 'MATCH';

  if (
    typeof baseEntityVersion === 'number' &&
    baseEntityVersion >= 0 &&
    baseEntityVersion !== current.serverVersion
  ) {
    return 'STALE';
  }

  if (baseVectorClock && Object.keys(baseVectorClock).length > 0 && Object.keys(current.vectorClock).length > 0) {
    const relation = compareClocks(baseVectorClock, current.vectorClock);
    if (relation === 'CONCURRENT') return 'CONCURRENT';
    if (relation === 'LESS') return 'STALE';
  }

  return 'MATCH';
}
