/**
 * G-HIMS Offline Authentication Storage
 * IndexedDB backed persistent offline session cache and audit queue
 */

import { AuthenticatedUser, TenantMembership, UserSessionRecord } from '@/lib/auth/auth-types';
import { clearOfflineReadModelsForTenant } from '@/lib/offline/db';

const DB_NAME = 'ghims_offline_auth_db';
const DB_VERSION = 1;
const STORE_SESSION = 'auth_session';
const STORE_MEMBERSHIPS = 'tenant_memberships';
const STORE_AUDIT_QUEUE = 'offline_audit_queue';

interface CachedAuthRecord {
  id: string;
  user: AuthenticatedUser;
  session: UserSessionRecord;
  cachedAt: string;
  expiresAt: string;
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
    const db = await Promise.race([
      openDatabase(),
      new Promise<IDBDatabase>((_, reject) => setTimeout(() => reject(new Error('IDB timeout')), 800)),
    ]);
    const tx = db.transaction(STORE_SESSION, 'readwrite');
    const store = tx.objectStore(STORE_SESSION);

    const record: CachedAuthRecord = {
      id: 'current_active_session',
      user,
      session,
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
        const record = request.result as CachedAuthRecord | undefined;
        if (!record) {
          resolve(null);
          return;
        }

        const expiresTime = Date.parse(record.expiresAt);
        if (!Number.isFinite(expiresTime) || Date.now() >= expiresTime) {
          resolve(null);
          return;
        }

        resolve({ user: record.user, session: record.session });
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
    tenantId = existing?.user?.tenantId || '';

    const tx = db.transaction([STORE_SESSION, STORE_MEMBERSHIPS], 'readwrite');
    tx.objectStore(STORE_SESSION).clear();
    tx.objectStore(STORE_MEMBERSHIPS).clear();

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
    const db = await openDatabase();
    const tx = db.transaction(STORE_MEMBERSHIPS, 'readwrite');
    const store = tx.objectStore(STORE_MEMBERSHIPS);
    store.clear();
    for (const item of memberships) {
      store.put(item);
    }
  } catch {
    // Membership cache is optional; never downgrade to localStorage on shared devices.
  }
}

export async function getCachedTenantMemberships(): Promise<TenantMembership[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_MEMBERSHIPS, 'readonly');
    const store = tx.objectStore(STORE_MEMBERSHIPS);
    const request = store.getAll();

    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function queueOfflineAuditLog(auditEvent: Record<string, unknown>): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_AUDIT_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_AUDIT_QUEUE);
    store.add({
      ...auditEvent,
      queuedAt: new Date().toISOString(),
    });
  } catch {
    // Memory fallback
  }
}
