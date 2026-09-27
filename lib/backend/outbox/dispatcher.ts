/**
 * G-HIMS Durable Outbox Dispatcher
 * Claims tenant-scoped records transactionally before projection/integration delivery.
 */

import { TransactionManager } from '../transactions/transaction-manager';
import { ProjectionWorkers } from '../projections/projection-workers';

export interface DispatchResult {
  dispatchedCount: number;
  failedCount: number;
  deadLetterCount: number;
  skippedCount: number;
  details: Array<{ outboxId: string; status: string; topic: string; error?: string }>;
}

export class OutboxDispatcher {
  public static async relayPendingOutbox(tenantId: string): Promise<DispatchResult> {
    const candidates = await TransactionManager.getPendingOutbox(tenantId);
    const details: DispatchResult['details'] = [];
    let dispatchedCount = 0;
    let failedCount = 0;
    let deadLetterCount = 0;
    let skippedCount = 0;

    for (const candidate of candidates) {
      const record = await TransactionManager.claimOutbox(tenantId, candidate.outboxId);
      if (!record) {
        skippedCount += 1;
        continue;
      }

      try {
        // Projection consumption is currently the in-process event-bus consumer.
        // External broker publication is introduced in the next integration layer.
        await ProjectionWorkers.consumeEvent({
          eventId: record.eventId,
          tenantId: record.tenantId,
          eventType: record.eventType,
          payload: record.payload,
        });

        await TransactionManager.updateOutbox(tenantId, record.outboxId, {
          status: 'PUBLISHED',
          publishedAt: Date.now(),
          lastError: undefined,
        });

        dispatchedCount += 1;
        details.push({
          outboxId: record.outboxId,
          status: 'PUBLISHED',
          topic: record.topic,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (record.attempts >= record.maxAttempts) {
          await TransactionManager.updateOutbox(tenantId, record.outboxId, {
            status: 'DEAD_LETTER',
            lastError: errorMessage,
          });
          deadLetterCount += 1;
          details.push({
            outboxId: record.outboxId,
            status: 'DEAD_LETTER',
            topic: record.topic,
            error: errorMessage,
          });
        } else {
          const backoffMs = Math.min(60_000, Math.pow(2, record.attempts) * 1000);
          await TransactionManager.updateOutbox(tenantId, record.outboxId, {
            status: 'FAILED',
            lastError: errorMessage,
            nextAttemptAt: Date.now() + backoffMs,
          });
          failedCount += 1;
          details.push({
            outboxId: record.outboxId,
            status: 'FAILED',
            topic: record.topic,
            error: errorMessage,
          });
        }
      }
    }

    return {
      dispatchedCount,
      failedCount,
      deadLetterCount,
      skippedCount,
      details,
    };
  }
}
