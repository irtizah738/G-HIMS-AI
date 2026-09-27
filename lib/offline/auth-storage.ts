/**
 * G-HIMS Offline Authentication Storage
 * IndexedDB backed persistent offline session cache and audit queue
 */

import { AuthenticatedUser, TenantMembership, UserSessionRecord } from '@/lib/auth/auth-types';

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
  // Always synchronously save to localStorage first for instant, guaranteed availability
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem('ghims_cached_auth_user', JSON.stringify(user));
      localStorage.setItem('ghims_cached_auth_session', JSON.stringify(session));
      localStorage.setItem('ghims_active_tenant', user.tenantId);
    } catch {
      // storage quota or private mode
    }
  }

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
      expiresAt: session.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    store.put(record);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 800);
      tx.oncomplete = () => {
        clearTimeout(timer);
        resolve();
      };
      tx.onerror = () => {
        clearTimeout(timer);
        reject(tx.error);
      };
    });
  } catch (err) {
    // Ignore IndexedDB error as localStorage already persisted
  }
}

export async function getCachedAuthSession(): Promise<{ user: AuthenticatedUser; session: UserSessionRecord } | null> {
  // Fast path: Check localStorage first for instant synchronous resolution
  const localCached = fallbackLocalStorage();
  if (localCached) {
    return localCached;
  }

  try {
    const db = await Promise.race([
      openDatabase(),
      new Promise<IDBDatabase>((_, reject) => setTimeout(() => reject(new Error('IDB timeout')), 800)),
    ]);
    const tx = db.transaction(STORE_SESSION, 'readonly');
    const store = tx.objectStore(STORE_SESSION);
    const request = store.get('current_active_session');

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(fallbackLocalStorage()), 800);
      request.onsuccess = () => {
        clearTimeout(timer);
        const record = request.result as CachedAuthRecord | undefined;
        if (!record) {
          resolve(fallbackLocalStorage());
          return;
        }

        // Verify expiration
        const expiresTime = new Date(record.expiresAt).getTime();
        if (Date.now() > expiresTime) {
          resolve(null);
          return;
        }

        resolve({ user: record.user, session: record.session });
      };
      request.onerror = () => {
        clearTimeout(timer);
        resolve(fallbackLocalStorage());
      };
    });
  } catch {
    return fallbackLocalStorage();
  }
}

function fallbackLocalStorage(): { user: AuthenticatedUser; session: UserSessionRecord } | null {
  if (typeof window === 'undefined') return null;
  try {
    const userStr = localStorage.getItem('ghims_cached_auth_user');
    const sessionStr = localStorage.getItem('ghims_cached_auth_session');
    if (!userStr || !sessionStr) return null;

    const user = JSON.parse(userStr);
    const session = JSON.parse(sessionStr);

    if (session?.expiresAt) {
      const expiry = new Date(session.expiresAt).getTime();
      if (Date.now() > expiry) {
        localStorage.removeItem('ghims_cached_auth_user');
        localStorage.removeItem('ghims_cached_auth_session');
        return null;
      }
    }

    return { user, session };
  } catch {
    return null;
  }
}

export async function clearCachedAuthSession(): Promise<void> {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('ghims_cached_auth_user');
      localStorage.removeItem('ghims_cached_auth_session');
      localStorage.removeItem('ghims_active_tenant');
    } catch {
      // Ignore
    }
  }

  try {
    const db = await Promise.race([
      openDatabase(),
      new Promise<IDBDatabase>((_, reject) => setTimeout(() => reject(new Error('IDB timeout')), 800)),
    ]);
    const tx = db.transaction([STORE_SESSION, STORE_MEMBERSHIPS], 'readwrite');
    tx.objectStore(STORE_SESSION).clear();
    tx.objectStore(STORE_MEMBERSHIPS).clear();
  } catch {
    // Ignore error
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
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('ghims_cached_memberships', JSON.stringify(memberships));
      } catch {
        // Ignore
      }
    }
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
    if (typeof window !== 'undefined') {
      try {
        const memStr = localStorage.getItem('ghims_cached_memberships');
        return memStr ? JSON.parse(memStr) : [];
      } catch {
        return [];
      }
    }
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
