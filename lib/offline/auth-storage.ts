/**
 * G-HIMS Offline Authentication Storage
 * IndexedDB backed persistent offline session cache and audit queue
 */

import { AuthenticatedUser, OfflineCaptureCapabilityLease, TenantMembership, UserSessionRecord } from '@/lib/auth/auth-types';
import { clearOfflineReadModelsForTenant } from '@/lib/offline/db';
import { decryptEdgeJson, encryptEdgeJson, type EncryptedEdgeEnvelope } from '@/lib/offline/crypto';

const DB_NAME = 'ghims_offline_auth_db';
const DB_VERSION = 2;
const STORE_SESSION = 'auth_session';
const STORE_MEMBERSHIPS = 'tenant_memberships';
const STORE_AUDIT_QUEUE = 'offline_audit_queue';
const STORE_OFFLINE_CAPABILITY = 'offline_capture_capability';

interface CachedAuthRecord {
  id: string;
  tenantId: string;
  actorId: string;
  encryptedPayload: EncryptedEdgeEnvelope;
  cachedAt: string;
  expiresAt: string;
}

interface CachedMembershipRecord {
  tenantId: string;
  cryptoTenantId: string;
  actorId: string;
  encryptedPayload: EncryptedEdgeEnvelope;
}

interface CachedOfflineCapabilityRecord {
  id: string;
  tenantId: string;
  actorId: string;
  deviceId: string;
  encryptedPayload: EncryptedEdgeEnvelope;
  expiresAt: string;
}

interface CachedAuditRecord {
  id?: number;
  tenantId: string;
  actorId: string;
  encryptedPayload: EncryptedEdgeEnvelope;
  queuedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const timer = setTimeout(() => {
      reject(new Error('IndexedDB open request timed out'));
    }, 800);

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onblocked = () => {
        clearTimeout(timer);
        reject(new Error('IndexedDB blocked'));
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_SESSION)) {
          db.createObjectStore(STORE_SESSION, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_MEMBERSHIPS)) {
          db.createObjectStore(STORE_MEMBERSHIPS, { keyPath: 'tenantId' });
        }
        if (!db.objectStoreNames.contains(STORE_AUDIT_QUEUE)) {
          db.createObjectStore(STORE_AUDIT_QUEUE, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORE_OFFLINE_CAPABILITY)) {
          db.createObjectStore(STORE_OFFLINE_CAPABILITY, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        reject(request.error);
      };
    } catch (e) {
      clearTimeout(timer);
      reject(e);
    }
  });
}

export async function saveCachedAuthSession(user: AuthenticatedUser, session: UserSessionRecord): Promise<void> {
  // Identity/session material is stored in IndexedDB only. Do not mirror clinical
  // identity or session records into localStorage on shared workstations.
  try {
    const encryptedPayload = await encryptEdgeJson(user.tenantId, user.uid, {
      user,
      session,
    });

    const db = await Promise.race([
      openDatabase(),
      new Promise<IDBDatabase>((_, reject) => setTimeout(() => reject(new Error('IDB timeout')), 800)),
    ]);
    const tx = db.transaction(STORE_SESSION, 'readwrite');
    const store = tx.objectStore(STORE_SESSION);

    const record: CachedAuthRecord = {
      id: 'current_active_session',
      tenantId: user.tenantId,
      actorId: user.uid,
      encryptedPayload,
      cachedAt: new Date().toISOString(),
      expiresAt: session.expiresAt,
    };

    store.put(record);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('IDB session write timeout')), 1200);
      tx.oncomplete = () => {
        clearTimeout(timer);
        resolve();
      };
      tx.onerror = () => {
        clearTimeout(timer);
        reject(tx.error);
      };
      tx.onabort = () => {
        clearTimeout(timer);
        reject(tx.error || new Error('IDB session write aborted'));
      };
    });
  } finally {
    if (typeof window !== 'undefined') {
      // Remove legacy copies created by earlier builds.
      localStorage.removeItem('ghims_cached_auth_user');
      localStorage.removeItem('ghims_cached_auth_session');
      localStorage.removeItem('ghims_cached_memberships');
    }
  }
}

export async function getCachedAuthSession(): Promise<{ user: AuthenticatedUser; session: UserSessionRecord } | null> {
  try {
    const db = await Promise.race([
      openDatabase(),
      new Promise<IDBDatabase>((_, reject) => setTimeout(() => reject(new Error('IDB timeout')), 800)),
    ]);
    const tx = db.transaction(STORE_SESSION, 'readonly');
    const request = tx.objectStore(STORE_SESSION).get('current_active_session');

    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 1000);
      request.onsuccess = () => {
        clearTimeout(timer);
        const record = request.result as (CachedAuthRecord & {
          user?: AuthenticatedUser;
          session?: UserSessionRecord;
        }) | undefined;
        if (!record) {
          resolve(null);
          return;
        }

        const expiresTime = Date.parse(record.expiresAt);
        if (!Number.isFinite(expiresTime) || Date.now() >= expiresTime) {
          resolve(null);
          return;
        }

        if (!record.encryptedPayload || !record.tenantId || !record.actorId) {
          resolve(null);
          return;
        }

        decryptEdgeJson<{ user: AuthenticatedUser; session: UserSessionRecord }>(
          record.encryptedPayload
        )
          .then((decoded) => resolve(decoded))
          .catch(() => resolve(null));
      };
      request.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

export async function saveCachedOfflineCapabilityLease(
  lease: OfflineCaptureCapabilityLease
): Promise<void> {
  const encryptedPayload = await encryptEdgeJson(
    lease.tenantId,
    lease.actorId,
    lease
  );
  const db = await openDatabase();
  const tx = db.transaction(STORE_OFFLINE_CAPABILITY, 'readwrite');
  const record: CachedOfflineCapabilityRecord = {
    id: 'current_offline_capture_capability',
    tenantId: lease.tenantId,
    actorId: lease.actorId,
    deviceId: lease.deviceId,
    encryptedPayload,
    expiresAt: lease.expiresAt,
  };
  tx.objectStore(STORE_OFFLINE_CAPABILITY).put(record);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('OFFLINE_CAPABILITY_WRITE_FAILED'));
    tx.onabort = () => reject(tx.error || new Error('OFFLINE_CAPABILITY_WRITE_ABORTED'));
  });
}

export async function getCachedOfflineCapabilityLease(): Promise<OfflineCaptureCapabilityLease | null> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_OFFLINE_CAPABILITY, 'readonly');
    const request = tx
      .objectStore(STORE_OFFLINE_CAPABILITY)
      .get('current_offline_capture_capability');
    const record = await new Promise<CachedOfflineCapabilityRecord | undefined>((resolve) => {
      request.onsuccess = () => resolve(request.result as CachedOfflineCapabilityRecord | undefined);
      request.onerror = () => resolve(undefined);
    });
    if (!record || Date.now() >= Date.parse(record.expiresAt)) return null;
    const lease = await decryptEdgeJson<OfflineCaptureCapabilityLease>(record.encryptedPayload);
    if (
      lease.tenantId !== record.tenantId ||
      lease.actorId !== record.actorId ||
      lease.deviceId !== record.deviceId ||
      lease.captureOnly !== true ||
      lease.replayRequiresOnlineReauthorization !== true
    ) {
      return null;
    }
    return lease;
  } catch {
    return null;
  }
}

export async function clearCachedAuthSession(): Promise<void> {
  let tenantId = '';

  if (typeof window !== 'undefined') {
    // Remove all legacy localStorage auth artifacts unconditionally.
    localStorage.removeItem('ghims_cached_auth_user');
    localStorage.removeItem('ghims_cached_auth_session');
    localStorage.removeItem('ghims_cached_memberships');
    localStorage.removeItem('ghims_active_tenant');
    localStorage.removeItem('ghims_active_rbac_role');
  }

  try {
    const db = await Promise.race([
      openDatabase(),
      new Promise<IDBDatabase>((_, reject) => setTimeout(() => reject(new Error('IDB timeout')), 800)),
    ]);

    const readTx = db.transaction(STORE_SESSION, 'readonly');
    const request = readTx.objectStore(STORE_SESSION).get('current_active_session');
    const existing = await new Promise<CachedAuthRecord | undefined>((resolve) => {
      request.onsuccess = () => resolve(request.result as CachedAuthRecord | undefined);
      request.onerror = () => resolve(undefined);
    });
    tenantId = existing?.tenantId || '';

    const tx = db.transaction([STORE_SESSION, STORE_MEMBERSHIPS, STORE_OFFLINE_CAPABILITY], 'readwrite');
    tx.objectStore(STORE_SESSION).clear();
    tx.objectStore(STORE_MEMBERSHIPS).clear();
    tx.objectStore(STORE_OFFLINE_CAPABILITY).clear();

    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Best-effort local privacy cleanup continues below.
  }

  if (tenantId) {
    await clearOfflineReadModelsForTenant(tenantId).catch(() => {});
  }
}

export async function saveCachedTenantMemberships(memberships: TenantMembership[]): Promise<void> {
  try {
    const cached = await getCachedAuthSession();
    if (!cached) return;

    const records: CachedMembershipRecord[] = await Promise.all(
      memberships.map(async (item) => ({
        tenantId: item.tenantId,
        cryptoTenantId: cached.user.tenantId,
        actorId: cached.user.uid,
        encryptedPayload: await encryptEdgeJson(
          cached.user.tenantId,
          cached.user.uid,
          item
        ),
      }))
    );

    const db = await openDatabase();
    const tx = db.transaction(STORE_MEMBERSHIPS, 'readwrite');
    const store = tx.objectStore(STORE_MEMBERSHIPS);
    store.clear();
    for (const record of records) {
      store.put(record);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IDB membership write aborted'));
    });
  } catch {
    // Membership cache is optional; never downgrade to plaintext/localStorage.
  }
}

export async function getCachedTenantMemberships(): Promise<TenantMembership[]> {
  try {
    const cached = await getCachedAuthSession();
    if (!cached) return [];

    const db = await openDatabase();
    const tx = db.transaction(STORE_MEMBERSHIPS, 'readonly');
    const request = tx.objectStore(STORE_MEMBERSHIPS).getAll();
    const rows = await new Promise<Array<CachedMembershipRecord & Partial<TenantMembership>>>((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });

    const decoded: TenantMembership[] = [];
    for (const row of rows) {
      if (row.encryptedPayload) {
        try {
          decoded.push(await decryptEdgeJson<TenantMembership>(row.encryptedPayload));
        } catch {
          // Ignore unreadable records from another actor/key.
        }
      }
    }
    return decoded;
  } catch {
    return [];
  }
}

export async function queueOfflineAuditLog(auditEvent: Record<string, unknown>): Promise<void> {
  try {
    const cached = await getCachedAuthSession();
    if (!cached) return;

    const encryptedPayload = await encryptEdgeJson(
      cached.user.tenantId,
      cached.user.uid,
      auditEvent
    );

    const db = await openDatabase();
    const tx = db.transaction(STORE_AUDIT_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_AUDIT_QUEUE);
    const row: CachedAuditRecord = {
      tenantId: cached.user.tenantId,
      actorId: cached.user.uid,
      encryptedPayload,
      queuedAt: new Date().toISOString(),
    };
    store.add(row);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IDB audit write aborted'));
    });
  } catch {
    // Audit persistence must never downgrade PHI/security context to plaintext.
  }
}
