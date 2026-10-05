/**
 * G-HIMS Durable CQRS Projection Workers
 *
 * Projection processing is idempotent and persisted per tenant. An outbox record
 * may be marked PUBLISHED only after this consumer commits its projection writes
 * and per-event checkpoint.
 */

import { getAdminFirestore } from '@/server/firebase/admin';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { DischargeReadinessService } from '@/lib/clinical/intelligence/discharge-readiness-service';
import { ClinicalDeteriorationService } from '@/lib/clinical/intelligence/clinical-deterioration-service';
import { ConsultantAttentionProjectionService } from '@/lib/clinical/intelligence/consultant-attention-projection-service';

export interface ConsumableEvent {
  eventId: string;
  tenantId: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  payload: Record<string, unknown>;
  occurredAt?: number;
  recordedAt?: number;
}

export interface ProjectionConsumeOptions {
  skipPatient360?: boolean;
}

export interface ProjectionRebuildOptions {
  expectedTenantId?: string;
  /**
   * Destructive rebuilds are allowed only in an isolated non-production recovery environment.
   * Production in-place rebuild is intentionally forbidden.
   */
  allowDestructive?: boolean;
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
      case 'PATIENT_REGISTERED':
      case 'ENCOUNTER_CREATED': {
        const patientId = String(payload.patientId || '');
        const encounterId = String(payload.encounterId || '');
        const isRegistration = eventType === 'PATIENT_REGISTERED';
        if (patientId) {
          const key = `${event.tenantId}:${patientId}`;
          const list = this.patientTimelines.get(key) || [];
          list.unshift({
            eventId,
            tenantId: event.tenantId,
            patientId,
            encounterId,
            eventType,
            summary: isRegistration
              ? `Patient registered; encounter initialized in ${payload.department || 'General Medicine'}`
              : `Encounter created (${payload.encounterType || 'OPD'}) - ${payload.chiefComplaint || ''}`,
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
            stage: isRegistration ? String(payload.initialStage || 'REGISTRATION') : 'TRIAGE',
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
  public static async consumeEvent(
    event: ConsumableEvent,
    options: ProjectionConsumeOptions = {}
  ): Promise<void> {
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
        case 'PATIENT_REGISTERED':
        case 'ENCOUNTER_CREATED': {
          const patientId = String(payload.patientId || '');
          const encounterId = String(payload.encounterId || '');
          const isRegistration = event.eventType === 'PATIENT_REGISTERED';

          if (patientId) {
            const timelineRef = tenantRef.collection('timelineProjections').doc(event.eventId);
            const timeline: PatientTimelineItem = {
              eventId: event.eventId,
              tenantId: event.tenantId,
              patientId,
              encounterId: encounterId || undefined,
              eventType: event.eventType,
              summary: isRegistration
                ? `Patient registered; encounter initialized in ${payload.department || 'General Medicine'}`
                : `Encounter created (${payload.encounterType || 'OPD'}) - ${payload.chiefComplaint || ''}`,
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
              stage: isRegistration ? String(payload.initialStage || 'REGISTRATION') : 'TRIAGE',
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

    if (!options.skipPatient360) {
      await Patient360ProjectionService.refreshFromEvent(event);
      await DischargeReadinessService.refreshFromEvent(event);
      await ClinicalDeteriorationService.refreshFromEvent(event);
      await ConsultantAttentionProjectionService.refreshFromEvent(event);
    }
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
   * Rebuild disposable projections from a validated single-tenant event history.
   *
   * This is intentionally destructive and therefore forbidden against a PRODUCTION
   * runtime. Production recovery must restore into an isolated recovery project,
   * run this rebuild there, validate it, and only then follow the DR promotion plan.
   */
  public static async rebuildProjections(
    events: ConsumableEvent[],
    options: ProjectionRebuildOptions = {}
  ): Promise<{ rebuiltCount: number; tenantId: string }> {
    if (!Array.isArray(events) || events.length === 0) {
      throw new Error('PROJECTION_REBUILD_EMPTY_STREAM: at least one authoritative event is required.');
    }

    const tenantIds = Array.from(new Set(events.map((event) => String(event.tenantId || '').trim()).filter(Boolean)));
    if (tenantIds.length !== 1) {
      throw new Error('PROJECTION_REBUILD_TENANT_SCOPE_INVALID: rebuild must contain exactly one tenant.');
    }

    const tenantId = tenantIds[0];
    if (options.expectedTenantId && options.expectedTenantId !== tenantId) {
      throw new Error('PROJECTION_REBUILD_TENANT_MISMATCH: event stream does not match the confirmed tenant.');
    }

    const seen = new Set<string>();
    for (const event of events) {
      if (!event.eventId || !event.eventType || event.tenantId !== tenantId) {
        throw new Error('PROJECTION_REBUILD_EVENT_INVALID: eventId, eventType and tenantId are required.');
      }
      if (seen.has(event.eventId)) {
        throw new Error(`PROJECTION_REBUILD_DUPLICATE_EVENT: ${event.eventId}`);
      }
      seen.add(event.eventId);
      if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
        throw new Error(`PROJECTION_REBUILD_EVENT_INVALID: event ${event.eventId} has an invalid payload.`);
      }
      if (event.occurredAt !== undefined && !Number.isFinite(event.occurredAt)) {
        throw new Error(`PROJECTION_REBUILD_EVENT_INVALID: event ${event.eventId} has an invalid timestamp.`);
      }
    }

    const orderedEvents = [...events].sort(
      (a, b) => Number(a.occurredAt || 0) - Number(b.occurredAt || 0) || a.eventId.localeCompare(b.eventId)
    );
    const db = getAdminFirestore();

    if (!db) {
      if (!canUseEphemeralProjectionState()) {
        throw new Error('PROJECTION_STORE_UNAVAILABLE: Firestore Admin is required.');
      }

      for (const key of Array.from(this.processedEventIds)) {
        if (key.startsWith(`${tenantId}:`)) this.processedEventIds.delete(key);
      }
      for (const key of Array.from(this.patientTimelines.keys())) {
        if (key.startsWith(`${tenantId}:`)) this.patientTimelines.delete(key);
      }
      for (const key of Array.from(this.clinicalQueues.keys())) {
        if (key.startsWith(`${tenantId}:`)) this.clinicalQueues.delete(key);
      }
      this.generalLedgerBalances.delete(tenantId);

      for (const event of orderedEvents) await this.consumeInMemory(event);
      return { rebuiltCount: orderedEvents.length, tenantId };
    }

    if (getRuntimeMode() === 'PRODUCTION') {
      throw new Error('PROJECTION_REBUILD_FORBIDDEN_IN_PRODUCTION: restore into an isolated recovery project first.');
    }
    if (!options.allowDestructive) {
      throw new Error('PROJECTION_REBUILD_CONFIRMATION_REQUIRED: destructive rebuild requires explicit confirmation.');
    }

    for (const collectionName of [
      'projectionCheckpoints',
      'timelineProjections',
      'clinicalQueues',
      'generalLedgerProjections',
      'patient360ProjectionCheckpoints',
      'patient360Projections',
      'patient360Timeline',
      'dischargeReadinessCheckpoints',
      'dischargeReadinessProjections',
      'deteriorationCheckpoints',
      'deteriorationProjections',
      'consultantAttentionCheckpoints',
      'clinicalOpenItems',
      'clinicalEscalations',
    ]) {
      await this.clearCollection(tenantId, collectionName);
    }

    for (const event of orderedEvents) {
      await this.consumeEvent(event, { skipPatient360: true });
    }

    await Patient360ProjectionService.rebuildTenantFromEventStream(
      tenantId,
      orderedEvents
    );
    await DischargeReadinessService.rebuildTenantFromEvents(
      tenantId,
      orderedEvents
    );
    await ClinicalDeteriorationService.rebuildTenantFromEvents(
      tenantId,
      orderedEvents
    );
    await ConsultantAttentionProjectionService.rebuildTenantFromEvents(
      tenantId,
      orderedEvents
    );

    return { rebuiltCount: orderedEvents.length, tenantId };
  }
}
