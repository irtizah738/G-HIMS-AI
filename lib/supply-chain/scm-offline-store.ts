// ============================================================================
// G-HIMS SCM: Offline-First IndexedDB Cache & Transactional Sync Queue
// ============================================================================

import { StockTransaction, InventoryBalance, ItemMaster } from '@/types/scm-domain';

export interface PendingSyncMutation {
  id: string;
  tenantId: string;
  mutationType: 'RECORD_STOCK_TRANSACTION' | 'RECORD_PATIENT_CONSUMPTION' | 'SUBMIT_REQUISITION';
  payload: Record<string, unknown>;
  idempotencyKey: string;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}

const DB_NAME = 'GHIMS_SCM_OFFLINE_DB';
const DB_VERSION = 1;
const STORE_BALANCES = 'inventory_balances';
const STORE_ITEMS = 'items_catalog';
const STORE_QUEUE = 'sync_queue';

function openSCMDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_BALANCES)) {
          db.createObjectStore(STORE_BALANCES, { keyPath: 'balanceId' });
        }
        if (!db.objectStoreNames.contains(STORE_ITEMS)) {
          db.createObjectStore(STORE_ITEMS, { keyPath: 'itemId' });
        }
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn('Could not open SCM IndexedDB, falling back to in-memory');
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

// In-memory fallback
const memoryBalances: Map<string, InventoryBalance> = new Map();
const memoryQueue: PendingSyncMutation[] = [];

export async function cacheBalancesLocally(balances: InventoryBalance[]): Promise<void> {
  const db = await openSCMDatabase();
  if (!db) {
    balances.forEach((b) => memoryBalances.set(b.balanceId, b));
    return;
  }

  try {
    const tx = db.transaction(STORE_BALANCES, 'readwrite');
    const store = tx.objectStore(STORE_BALANCES);
    for (const b of balances) {
      store.put(b);
    }
  } catch (err) {
    console.warn('Failed writing balances to IndexedDB', err);
  }
}

export async function getLocalBalances(): Promise<InventoryBalance[]> {
  const db = await openSCMDatabase();
  if (!db) {
    return Array.from(memoryBalances.values());
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_BALANCES, 'readonly');
      const store = tx.objectStore(STORE_BALANCES);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve(Array.from(memoryBalances.values()));
    } catch {
      resolve(Array.from(memoryBalances.values()));
    }
  });
}

export async function enqueueOfflineMutation(mutation: PendingSyncMutation): Promise<void> {
  const db = await openSCMDatabase();
  if (!db) {
    memoryQueue.push(mutation);
    return;
  }

  try {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    const store = tx.objectStore(STORE_QUEUE);
    store.put(mutation);
  } catch {
    memoryQueue.push(mutation);
  }
}

export async function getPendingSyncQueue(): Promise<PendingSyncMutation[]> {
  const db = await openSCMDatabase();
  if (!db) {
    return [...memoryQueue];
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_QUEUE, 'readonly');
      const store = tx.objectStore(STORE_QUEUE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([...memoryQueue]);
    } catch {
      resolve([...memoryQueue]);
    }
  });
}

export async function removePendingSyncMutation(id: string): Promise<void> {
  const db = await openSCMDatabase();
  if (!db) {
    const idx = memoryQueue.findIndex((m) => m.id === id);
    if (idx >= 0) memoryQueue.splice(idx, 1);
    return;
  }

  try {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    tx.objectStore(STORE_QUEUE).delete(id);
  } catch {
    const idx = memoryQueue.findIndex((m) => m.id === id);
    if (idx >= 0) memoryQueue.splice(idx, 1);
  }
}
