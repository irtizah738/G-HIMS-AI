/**
 * G-HIMS Durable Idempotency Service
 * Production authority is Firestore. DEMO/TEST may use an in-process fallback.
 */

import crypto from 'node:crypto';
import { IdempotencyRecord, CommandResult } from '../types';
import { getAdminFirestore } from '@/server/firebase/admin';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';

export type IdempotencyAcquireStatus = 'NEW' | 'CACHED' | 'CONFLICT' | 'IN_PROGRESS';

export interface IdempotencyAcquireResult {
  status: IdempotencyAcquireStatus;
  record?: IdempotencyRecord;
}

export class IdempotencyService {
  private static localMemoryCache = new Map<string, IdempotencyRecord>();

  private static canUseEphemeralStore(): boolean {
    const mode = getRuntimeMode();
    return mode === 'DEMO' || mode === 'TEST';
  }

  private static canonicalStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map((item) => this.canonicalStringify(item)).join(',') + ']';
    }

    const object = value as Record<string, unknown>;
    return '{' + Object.keys(object)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + this.canonicalStringify(object[key]))
      .join(',') + '}';
  }

  public static computeHash(commandType: string, payload: unknown): string {
    const canonical = this.canonicalStringify({ commandType, payload });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  public static getDocumentId(idempotencyKey: string): string {
    return `idem_${crypto.createHash('sha256').update(idempotencyKey).digest('hex')}`;
  }

  private static memoryKey(tenantId: string, idempotencyKey: string): string {
    return `${tenantId}:${idempotencyKey}`;
  }

  public static async acquireExecution(
    tenantId: string,
    idempotencyKey: string,
    commandType: string,
    payload: unknown,
    commandId: string
  ): Promise<IdempotencyAcquireResult> {
    const requestHash = this.computeHash(commandType, payload);
    const db = getAdminFirestore();

    if (!db) {
      if (!this.canUseEphemeralStore()) {
        throw new Error('IDEMPOTENCY_STORE_UNAVAILABLE: durable idempotency registry is required.');
      }

      const key = this.memoryKey(tenantId, idempotencyKey);
      const existing = this.localMemoryCache.get(key);
      if (!existing) {
        const record: IdempotencyRecord = {
          tenantId,
          idempotencyKey,
          commandType,
          requestHash,
          status: 'PENDING',
          createdAt: Date.now(),
        };
        this.localMemoryCache.set(key, record);
        return { status: 'NEW', record };
      }

      if (existing.requestHash !== requestHash || existing.commandType !== commandType) {
        return { status: 'CONFLICT', record: existing };
      }
      if (existing.status === 'COMPLETED' && existing.result) {
        return { status: 'CACHED', record: existing };
      }
      return { status: 'IN_PROGRESS', record: existing };
    }

    const ref = db.collection('tenants').doc(tenantId)
      .collection('idempotency').doc(this.getDocumentId(idempotencyKey));

    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        const record = {
          tenantId,
          idempotencyKey,
          commandType,
          requestHash,
          status: 'PENDING' as const,
          commandId,
          createdAt: Date.now(),
        };
        transaction.create(ref, sanitizeForFirestore(record));
        return { status: 'NEW' as const, record };
      }

      const existing = snapshot.data() as IdempotencyRecord;
      if (existing.requestHash !== requestHash || existing.commandType !== commandType) {
        return { status: 'CONFLICT' as const, record: existing };
      }
      if (existing.status === 'COMPLETED' && existing.result) {
        return { status: 'CACHED' as const, record: existing };
      }
      return { status: 'IN_PROGRESS' as const, record: existing };
    });
  }

  public static async completeExecution(
    tenantId: string,
    idempotencyKey: string,
    commandType: string,
    payload: unknown,
    result: CommandResult
  ): Promise<void> {
    const requestHash = this.computeHash(commandType, payload);
    const db = getAdminFirestore();

    if (!db) {
      if (!this.canUseEphemeralStore()) {
        throw new Error('IDEMPOTENCY_STORE_UNAVAILABLE: durable idempotency registry is required.');
      }
      this.recordExecution(tenantId, idempotencyKey, commandType, payload, result);
      return;
    }

    const ref = db.collection('tenants').doc(tenantId)
      .collection('idempotency').doc(this.getDocumentId(idempotencyKey));

    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error('IDEMPOTENCY_RESERVATION_MISSING');

      const existing = snapshot.data() as IdempotencyRecord;
      if (existing.requestHash !== requestHash || existing.commandType !== commandType) {
        throw new Error('IDEMPOTENCY_KEY_CONFLICT');
      }

      transaction.set(ref, sanitizeForFirestore({
        ...existing,
        status: result.success ? 'COMPLETED' : 'FAILED',
        result,
        completedAt: Date.now(),
      }), { merge: true });
    });
  }

  public static checkIdempotency(
    tenantId: string,
    idempotencyKey: string,
    commandType: string,
    payload: unknown
  ): { status: 'NEW' | 'CACHED' | 'CONFLICT'; record?: IdempotencyRecord } {
    const existing = this.localMemoryCache.get(this.memoryKey(tenantId, idempotencyKey));
    if (!existing) return { status: 'NEW' };

    const currentHash = this.computeHash(commandType, payload);
    if (existing.requestHash === currentHash && existing.commandType === commandType) {
      return existing.status === 'COMPLETED' && existing.result
        ? { status: 'CACHED', record: existing }
        : { status: 'NEW', record: existing };
    }

    return { status: 'CONFLICT', record: existing };
  }

  public static recordExecution(
    tenantId: string,
    idempotencyKey: string,
    commandType: string,
    payload: unknown,
    result: CommandResult
  ): void {
    this.localMemoryCache.set(this.memoryKey(tenantId, idempotencyKey), {
      tenantId,
      idempotencyKey,
      commandType,
      requestHash: this.computeHash(commandType, payload),
      status: result.success ? 'COMPLETED' : 'FAILED',
      result,
      createdAt: Date.now(),
      completedAt: Date.now(),
    });
  }
}
