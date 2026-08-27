/**
 * G-HIMS Outbox Dispatcher & Pub/Sub Relay
 * Dispatches pending outbox records to asynchronous Pub/Sub topics and integration brokers.
 */

import { OutboxRecord } from '../types';
import { TransactionManager } from '../transactions/transaction-manager';
import { ProjectionWorkers } from '../projections/projection-workers';

export interface DispatchResult {
  dispatchedCount: number;
  failedCount: number;
  deadLetterCount: number;
  details: Array<{ outboxId: string; status: string; topic: string; error?: string }>;
}

export class OutboxDispatcher {
  /**
   * Scans and relays pending outbox messages to event bus and projection workers.
   */
  public static async relayPendingOutbox(): Promise<DispatchResult> {
    const pendingItems = TransactionManager.getPendingOutbox();
    const details: DispatchResult['details'] = [];
    let dispatchedCount = 0;
    let failedCount = 0;
    let deadLetterCount = 0;

    for (const record of pendingItems) {
      try {
        record.status = 'PROCESSING';
        record.attempts += 1;

        // 1. Simulate Pub/Sub Transmission to Topic
        console.log(`[PUB/SUB] Transmitted event '${record.eventType}' (${record.eventId}) to topic '${record.topic}'`);

        // 2. Trigger In-Process CQRS Projection Workers (§17)
        await ProjectionWorkers.consumeEvent({
          eventId: record.eventId,
          tenantId: record.tenantId,
          eventType: record.eventType,
          payload: record.payload,
        });

        // 3. Mark Published in Outbox Store
        TransactionManager.markOutboxPublished(record.outboxId);
        dispatchedCount++;
        details.push({
          outboxId: record.outboxId,
          status: 'PUBLISHED',
          topic: record.topic,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        record.lastError = errorMsg;

        if (record.attempts >= record.maxAttempts) {
          record.status = 'DEAD_LETTER';
          deadLetterCount++;
          details.push({
            outboxId: record.outboxId,
            status: 'DEAD_LETTER',
            topic: record.topic,
            error: errorMsg,
          });
        } else {
          record.status = 'FAILED';
          record.nextAttemptAt = Date.now() + record.attempts * 5000; // Exponential backoff
          failedCount++;
          details.push({
            outboxId: record.outboxId,
            status: 'FAILED',
            topic: record.topic,
            error: errorMsg,
          });
        }
      }
    }

    return {
      dispatchedCount,
      failedCount,
      deadLetterCount,
      details,
    };
  }
}
