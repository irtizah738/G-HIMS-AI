'use client';

export interface EncryptedEdgeEnvelope {
  v: 1;
  alg: 'AES-GCM';
  keyId: string;
  iv: string;
  ciphertext: string;
}

const KEY_DB_NAME = 'ghims_edge_crypto_db';
const KEY_DB_VERSION = 1;
const KEY_STORE = 'keys';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB || !window.crypto?.subtle) {
      reject(new Error('EDGE_CRYPTO_UNAVAILABLE'));
      return;
    }

    const request = indexedDB.open(KEY_DB_NAME, KEY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('EDGE_CRYPTO_KEY_DB_FAILED'));
  });
}

async function getOrCreateKey(keyId: string): Promise<CryptoKey> {
  const db = await openKeyDb();
  try {
    const existing = await new Promise<CryptoKey | null>((resolve) => {
      const tx = db.transaction(KEY_STORE, 'readonly');
      const request = tx.objectStore(KEY_STORE).get(keyId);
      request.onsuccess = () => resolve((request.result?.cryptoKey as CryptoKey | undefined) || null);
      request.onerror = () => resolve(null);
    });

    if (existing) return existing;

    const cryptoKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readwrite');
      tx.objectStore(KEY_STORE).put({
        id: keyId,
        cryptoKey,
        createdAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('EDGE_CRYPTO_KEY_WRITE_FAILED'));
      tx.onabort = () => reject(tx.error || new Error('EDGE_CRYPTO_KEY_WRITE_ABORTED'));
    });

    return cryptoKey;
  } finally {
    db.close();
  }
}

export function edgeCryptoKeyId(tenantId: string, actorId: string): string {
  return `${String(tenantId || '').trim().toLowerCase()}:${String(actorId || '').trim()}:clinical-edge-v1`;
}

export function isEncryptedEdgeEnvelope(value: unknown): value is EncryptedEdgeEnvelope {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as any).v === 1 &&
    (value as any).alg === 'AES-GCM' &&
    typeof (value as any).keyId === 'string' &&
    typeof (value as any).iv === 'string' &&
    typeof (value as any).ciphertext === 'string'
  );
}

export async function encryptEdgeJson(
  tenantId: string,
  actorId: string,
  value: unknown
): Promise<EncryptedEdgeEnvelope> {
  const keyId = edgeCryptoKeyId(tenantId, actorId);
  const key = await getOrCreateKey(keyId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(keyId);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    plaintext
  );

  return {
    v: 1,
    alg: 'AES-GCM',
    keyId,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptEdgeJson<T>(
  envelope: EncryptedEdgeEnvelope
): Promise<T> {
  const key = await getOrCreateKey(envelope.keyId);
  const aad = new TextEncoder().encode(envelope.keyId);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(envelope.iv),
      additionalData: aad,
    },
    key,
    base64ToBytes(envelope.ciphertext)
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function deleteEdgeCryptoKey(tenantId: string, actorId: string): Promise<void> {
  const keyId = edgeCryptoKeyId(tenantId, actorId);
  try {
    const db = await openKeyDb();
    const tx = db.transaction(KEY_STORE, 'readwrite');
    tx.objectStore(KEY_STORE).delete(keyId);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    db.close();
  } catch {
    // Best-effort privacy cleanup.
  }
}
