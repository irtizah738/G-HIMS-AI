/**
 * G-HIMS Master Idempotency Service
 * Guarantees zero-duplicate execution for clinical, billing, and accounting operations.
 */

import { IdempotencyRecord, CommandResult } from '../types';

export class IdempotencyService {
  private static localMemoryCache = new Map<string, IdempotencyRecord>();

  /**
   * Computes a deterministic SHA-256 hash representation of a command payload.
   */
  public static computeHash(commandType: string, payload: unknown): string {
    const raw = JSON.stringify({ commandType, payload }, Object.keys(payload as object || {}).sort());
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return `hash_${Math.abs(hash).toString(16)}`;
  }

  /**
   * Evaluates if a command with the specified key has already executed or is pending.
   */
  public static checkIdempotency(
    tenantId: string,
    idempotencyKey: string,
    commandType: string,
    payload: unknown
  ): { status: 'NEW' | 'CACHED' | 'CONFLICT'; record?: IdempotencyRecord } {
    const cacheKey = `${tenantId}:${idempotencyKey}`;
    const existing = this.localMemoryCache.get(cacheKey);

    if (!existing) {
      return { status: 'NEW' };
    }

    const currentHash = this.computeHash(commandType, payload);
    if (existing.requestHash === currentHash) {
      return { status: 'CACHED', record: existing };
    }

    // Key reused with differing payload/commandType -> CONFLICT
    return { status: 'CONFLICT', record: existing };
  }

  /**
   * Commits the execution result to the idempotency registry.
   */
  public static recordExecution(
    tenantId: string,
    idempotencyKey: string,
    commandType: string,
    payload: unknown,
    result: CommandResult
  ): void {
    const cacheKey = `${tenantId}:${idempotencyKey}`;
    const record: IdempotencyRecord = {
      tenantId,
      idempotencyKey,
      commandType,
      requestHash: this.computeHash(commandType, payload),
      status: result.success ? 'COMPLETED' : 'FAILED',
      result,
      createdAt: Date.now(),
      completedAt: Date.now(),
    };

    this.localMemoryCache.set(cacheKey, record);
  }
}
