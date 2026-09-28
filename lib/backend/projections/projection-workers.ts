/**
 * G-HIMS Durable CQRS Projection Workers
 *
 * Projection processing is idempotent and persisted per tenant. An outbox record
 * may be marked PUBLISHED only after this consumer commits its projection writes
 * and per-event checkpoint.
 */

import { getAdminFirestore } from '@/server/firebase/admin';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';

export interface ConsumableEvent {
  eventId: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt?: number;
}

export interface PatientTimelineItem {
  eventId: string;
  tenantId: string;
  patientId: string;
  encounterId?: string;
  eventType: string;
  summary: string;
  occurredAt: number;
  projectedAt: number;
}

export interface QueueItemProjection {
  encounterId: string;
  tenantId: string;
  patientId?: string;
  stage: string;
  priority?: string;
  updatedAt: number;
  lastEventId: string;
}

export interface GeneralLedgerBalanceProjection {
  tenantId: string;
  totalDebits: number;
  totalCredits: number;
  updatedAt: number;
  lastEventId: string;
}

function canUseEphemeralProjectionState(): boolean {
  const mode = getRuntimeMode();
  return mode === 'DEMO' || mode === 'TEST';
}

export class ProjectionWorkers {
  private static processedEventIds = new Set<string>();

  // DEMO/TEST fallback read models only. Production uses Firestore projections.
  public static patientTimelines = new Map<string, PatientTimelineItem[]>();
  public static clinicalQueues = new Map<string, QueueItemProjection>();
  public static generalLedgerBalances = new Map<string, { totalDebits: number; totalCredits: number }>();

  private static async consumeInMemory(event: ConsumableEvent): Promise<void> {
    const dedupeKey = `${event.tenantId}:${event.eventId}`;
    if (this.processedEventIds.has(dedupeKey)) return;
    this.processedEventIds.add(dedupeKey);

    const { eventType, payload, eventId } = event;
    const now = Date.now();
    const occurredAt = event.occurredAt || now;

    switch (eventType) {
      case 'ENCOUNTER_CREATED': {
        const patientId = String(payload.patientId || '');
        const encounterId = String(payload.encounterId || '');
        if (patientId) {
          const key = `${event.tenantId}:${patientId}`;
          const list = this.patientTimelines.get(key) || [];
          list.unshift({
            eventId,
            tenantId: event.tenantId,
            patientId,
            encounterId,
            eventType,
            summary: `Encounter created (${payload.encounterType || 'OPD'}) - ${payload.chiefComplaint || ''}`,
            occurredAt,
            projectedAt: now,
          });
          this.patientTimelines.set(key, list);
        }
        if (encounterId) {
          this.clinicalQueues.set(`${event.tenantId}:${encounterId}`, {
            encounterId,
            tenantId: event.tenantId,
            patientId: patientId || undefined,
            stage: 'TRIAGE',
            priority: String(payload.priority || 'ROUTINE'),
            updatedAt: now,
            lastEventId: eventId,
          });
        }
        break;
      }

      case 'STAGE_COMPLETED': {
        const encounterId = String(payload.encounterId || '');
        const key = `${event.tenantId}:${encounterId}`;
        const existing = this.clinicalQueues.get(key);
        if (existing) {
          this.clinicalQueues.set(key, {
            ...existing,
            stage: String(payload.toStage || existing.stage),
            updatedAt: now,
            lastEventId: eventId,
          });
        }
        break;
      }

      case 'INVESTIGATION_ORDERED': {
        const patientId = String(payload.patientId || '');
        if (patientId) {
          const key = `${event.tenantId}:${patientId}`;
          const list = this.patientTimelines.get(key) || [];
          list.unshift({
            eventId,
            tenantId: event.tenantId,
            patientId,
            encounterId: String(payload.encounterId || '') || undefined,
            eventType,
            summary: `Investigation ordered: ${payload.catalogCode || ''} [Priority: ${payload.priority || 'ROUTINE'}]`,
            occurredAt,
            projectedAt: now,
          });
          this.patientTimelines.set(key, list);
        }
        break;
      }

      case 'JOURNAL_ENTRY_POSTED': {
        const key = event.tenantId;
        const current = this.generalLedgerBalances.get(key) || {
          totalDebits: 0,
          totalCredits: 0,
        };
        const amount = Number(payload.totalAmountMinorUnits || 0);
        this.generalLedgerBalances.set(key, {
          totalDebits: current.totalDebits + amount,
          totalCredits: current.totalCredits + amount,
        });
        break;
      }

      default:
        break;
    }
  }

  /**
   * Persist a single event's read-model effects and checkpoint atomically.
   */
  public static async consumeEvent(event: ConsumableEvent): Promise<void> {
    if (!event.tenantId || !event.eventId) {
      throw new Error('PROJECTION_EVENT_INVALID: tenantId and eventId are required.');
    }

    const db = getAdminFirestore();
    if (!db) {
      if (canUseEphemeralProjectionState()) {
        await this.consumeInMemory(event);
        return;
      }
      throw new Error('PROJECTION_STORE_UNAVAILABLE: Firestore Admin is required.');
    }

    const tenantRef = db.collection('tenants').doc(event.tenantId);
    const checkpointRef = tenantRef.collection('projectionCheckpoints').doc(event.eventId);

    await db.runTransaction(async (transaction) => {
      // Every projection transaction reads its checkpoint before any write.
      const checkpoint = await transaction.get(checkpointRef);
      if (checkpoint.exists) return;

      const now = Date.now();
      const occurredAt = event.occurredAt || now;
      const payload = event.payload || {};

      // Journal projections require a read before any writes so we can update the
      // aggregate exactly once under the same event checkpoint transaction.
      let currentLedger: GeneralLedgerBalanceProjection | null = null;
      const ledgerRef = tenantRef.collection('generalLedgerProjections').doc('universal-journal-balance');

      if (event.eventType === 'JOURNAL_ENTRY_POSTED') {
        const ledgerSnapshot = await transaction.get(ledgerRef);
        currentLedger = ledgerSnapshot.exists
          ? (ledgerSnapshot.data() as GeneralLedgerBalanceProjection)
          : null;
      }

      switch (event.eventType) {
        case 'ENCOUNTER_CREATED': {
          const patientId = String(payload.patientId || '');
          const encounterId = String(payload.encounterId || '');

          if (patientId) {
            const timelineRef = tenantRef.collection('timelineProjections').doc(event.eventId);
            const timeline: PatientTimelineItem = {
              eventId: event.eventId,
              tenantId: event.tenantId,
              patientId,
              encounterId: encounterId || undefined,
              eventType: event.eventType,
              summary: `Encounter created (${payload.encounterType || 'OPD'}) - ${payload.chiefComplaint || ''}`,
              occurredAt,
              projectedAt: now,
            };
            transaction.set(timelineRef, timeline);
          }

          if (encounterId) {
            const queueRef = tenantRef.collection('clinicalQueues').doc(encounterId);
            const queue: QueueItemProjection = {
              encounterId,
              tenantId: event.tenantId,
              patientId: patientId || undefined,
              stage: 'TRIAGE',
              priority: String(payload.priority || 'ROUTINE'),
              updatedAt: now,
              lastEventId: event.eventId,
            };
            transaction.set(queueRef, queue);
          }
          break;
        }

        case 'STAGE_COMPLETED': {
          const encounterId = String(payload.encounterId || '');
          if (encounterId) {
            const queueRef = tenantRef.collection('clinicalQueues').doc(encounterId);
            transaction.set(queueRef, {
              encounterId,
              tenantId: event.tenantId,
              stage: String(payload.toStage || ''),
              updatedAt: now,
              lastEventId: event.eventId,
            }, { merge: true });
          }
          break;
        }

        case 'INVESTIGATION_ORDERED': {
          const patientId = String(payload.patientId || '');
          if (patientId) {
            const timelineRef = tenantRef.collection('timelineProjections').doc(event.eventId);
            const timeline: PatientTimelineItem = {
              eventId: event.eventId,
              tenantId: event.tenantId,
              patientId,
              encounterId: String(payload.encounterId || '') || undefined,
              eventType: event.eventType,
              summary: `Investigation ordered: ${payload.catalogCode || ''} [Priority: ${payload.priority || 'ROUTINE'}]`,
              occurredAt,
              projectedAt: now,
            };
            transaction.set(timelineRef, timeline);
          }
          break;
        }

        case 'JOURNAL_ENTRY_POSTED': {
          const amount = Number(payload.totalAmountMinorUnits || 0);
          const next: GeneralLedgerBalanceProjection = {
            tenantId: event.tenantId,
            totalDebits: Number(currentLedger?.totalDebits || 0) + amount,
            totalCredits: Number(currentLedger?.totalCredits || 0) + amount,
            updatedAt: now,
            lastEventId: event.eventId,
          };
          transaction.set(ledgerRef, next);
          break;
        }

        default:
          // Events without a read-model consumer still receive a durable checkpoint.
          break;
      }

      transaction.create(checkpointRef, {
        eventId: event.eventId,
        tenantId: event.tenantId,
        eventType: event.eventType,
        processedAt: now,
      });
    });
  }

  private static async clearCollection(
    tenantId: string,
    collectionName: string
  ): Promise<void> {
    const db = getAdminFirestore();
    if (!db) return;

    const ref = db.collection('tenants').doc(tenantId).collection(collectionName);

    while (true) {
      const snapshot = await ref.limit(400).get();
      if (snapshot.empty) break;

      const batch = db.batch();
      for (const document of snapshot.docs) batch.delete(document.ref);
      await batch.commit();

      if (snapshot.size < 400) break;
    }
  }

  /**
   * Rebuild disposable projections from an ordered event history.
   */
  public static async rebuildProjections(
    events: ConsumableEvent[]
  ): Promise<{ rebuiltCount: number }> {
    const tenantIds = Array.from(new Set(events.map((event) => event.tenantId).filter(Boolean)));
    const db = getAdminFirestore();

    if (!db) {
      if (!canUseEphemeralProjectionState()) {
        throw new Error('PROJECTION_STORE_UNAVAILABLE: Firestore Admin is required.');
      }

      this.processedEventIds.clear();
      this.patientTimelines.clear();
      this.clinicalQueues.clear();
      this.generalLedgerBalances.clear();

      for (const event of events) await this.consumeInMemory(event);
      return { rebuiltCount: events.length };
    }

    for (const tenantId of tenantIds) {
      for (const collectionName of [
        'projectionCheckpoints',
        'timelineProjections',
        'clinicalQueues',
        'generalLedgerProjections',
      ]) {
        await this.clearCollection(tenantId, collectionName);
      }
    }

    for (const event of events) {
      await this.consumeEvent(event);
    }

    return { rebuiltCount: events.length };
  }
}
