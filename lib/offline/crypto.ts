'use client';

export interface EncryptedEdgeEnvelope {
  algorithm: 'AES-GCM';
  version: 1;
  keyId: string;
  iv: string;
  ciphertext: string;
}

const KEY_DB_NAME = 'ghims_edge_key_vault_db';
const KEY_DB_VERSION = 1;
const KEY_STORE = 'keys';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function keyIdFor(tenantId: string, ownerUid: string): string {
  const tenant = String(tenantId || '').trim().toLowerCase();
  const uid = String(ownerUid || '').trim();
  if (!tenant || !uid) throw new Error('EDGE_ENCRYPTION_IDENTITY_REQUIRED');
  return `${tenant}:${uid}:v1`;
}

function openVault(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('EDGE_KEY_VAULT_UNAVAILABLE'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB_NAME, KEY_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) {
        db.createObjectStore(KEY_STORE, { keyPath: 'keyId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('EDGE_KEY_VAULT_OPEN_FAILED'));
  });
}

async function readKey(keyId: string): Promise<CryptoKey | null> {
  const db = await openVault();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readonly');
      const request = tx.objectStore(KEY_STORE).get(keyId);
      request.onsuccess = () => resolve((request.result?.key as CryptoKey | undefined) || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeKey(keyId: string, key: CryptoKey): Promise<void> {
  const db = await openVault();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readwrite');
      tx.objectStore(KEY_STORE).put({
        keyId,
        key,
        createdAt: Date.now(),
        algorithm: 'AES-GCM',
        extractable: false,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('EDGE_KEY_VAULT_WRITE_ABORTED'));
    });
  } finally {
    db.close();
  }
}

export async function getOrCreateEdgeKey(
  tenantId: string,
  ownerUid: string
): Promise<{ keyId: string; key: CryptoKey }> {
  const keyId = keyIdFor(tenantId, ownerUid);
  const existing = await readKey(keyId);
  if (existing) return { keyId, key: existing };

  if (!globalThis.crypto?.subtle) {
    throw new Error('EDGE_WEBCRYPTO_UNAVAILABLE');
  }

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  await writeKey(keyId, key);
  return { keyId, key };
}

export async function encryptEdgeJson(
  tenantId: string,
  ownerUid: string,
  value: unknown
): Promise<EncryptedEdgeEnvelope> {
  const { keyId, key } = await getOrCreateEdgeKey(tenantId, ownerUid);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value ?? null));
  const additionalData = new TextEncoder().encode(keyId);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData },
    key,
    plaintext
  );

  return {
    algorithm: 'AES-GCM',
    version: 1,
    keyId,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptEdgeJson<T>(
  tenantId: string,
  ownerUid: string,
  envelope: EncryptedEdgeEnvelope
): Promise<T> {
  const expectedKeyId = keyIdFor(tenantId, ownerUid);
  if (
    !envelope ||
    envelope.algorithm !== 'AES-GCM' ||
    envelope.version !== 1 ||
    envelope.keyId !== expectedKeyId
  ) {
    throw new Error('EDGE_ENCRYPTION_SCOPE_MISMATCH');
  }

  const key = await readKey(expectedKeyId);
  if (!key) throw new Error('EDGE_ENCRYPTION_KEY_MISSING');

  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(envelope.iv),
      additionalData: new TextEncoder().encode(expectedKeyId),
    },
    key,
    base64ToBytes(envelope.ciphertext)
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function deleteEdgeKey(tenantId: string, ownerUid: string): Promise<void> {
  const keyId = keyIdFor(tenantId, ownerUid);
  const db = await openVault();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, 'readwrite');
      tx.objectStore(KEY_STORE).delete(keyId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
