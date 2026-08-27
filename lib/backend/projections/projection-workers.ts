/**
 * G-HIMS CQRS Projection Workers
 * Idempotently consumes domain events to update disposable, query-optimized read models.
 */

export interface ConsumableEvent {
  eventId: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface PatientTimelineItem {
  eventId: string;
  patientId: string;
  eventType: string;
  summary: string;
  occurredAt: number;
}

export interface QueueItemProjection {
  encounterId: string;
  patientId: string;
  stage: string;
  priority: string;
  updatedAt: number;
}

export class ProjectionWorkers {
  private static processedEventIds = new Set<string>();

  // In-memory CQRS read models (Disposables, Rebuildable from Event Store)
  public static patientTimelines = new Map<string, PatientTimelineItem[]>();
  public static clinicalQueues = new Map<string, QueueItemProjection>();
  public static generalLedgerBalances = new Map<string, { totalDebits: number; totalCredits: number }>();

  /**
   * Idempotently processes an event across the projection pipelines.
   */
  public static async consumeEvent(event: ConsumableEvent): Promise<void> {
    // Deduplication check
    if (this.processedEventIds.has(event.eventId)) {
      return;
    }
    this.processedEventIds.add(event.eventId);

    const { eventType, payload, eventId } = event;
    const now = Date.now();

    switch (eventType) {
      case 'ENCOUNTER_CREATED': {
        const patientId = String(payload.patientId || '');
        const encounterId = String(payload.encounterId || '');
        if (patientId) {
          const list = this.patientTimelines.get(patientId) || [];
          list.unshift({
            eventId,
            patientId,
            eventType,
            summary: `Encounter created (${payload.encounterType || 'OPD'}) - ${payload.chiefComplaint || ''}`,
            occurredAt: now,
          });
          this.patientTimelines.set(patientId, list);

          this.clinicalQueues.set(encounterId, {
            encounterId,
            patientId,
            stage: 'TRIAGE',
            priority: String(payload.priority || 'ROUTINE'),
            updatedAt: now,
          });
        }
        break;
      }

      case 'STAGE_COMPLETED': {
        const encounterId = String(payload.encounterId || '');
        const toStage = String(payload.toStage || '');
        const existing = this.clinicalQueues.get(encounterId);
        if (existing) {
          existing.stage = toStage;
          existing.updatedAt = now;
        }
        break;
      }

      case 'INVESTIGATION_ORDERED': {
        const patientId = String(payload.patientId || '');
        if (patientId) {
          const list = this.patientTimelines.get(patientId) || [];
          list.unshift({
            eventId,
            patientId,
            eventType,
            summary: `Investigation Ordered: ${payload.catalogCode || ''} [Priority: ${payload.priority || 'ROUTINE'}]`,
            occurredAt: now,
          });
          this.patientTimelines.set(patientId, list);
        }
        break;
      }

      case 'JOURNAL_ENTRY_POSTED': {
        const tenantKey = event.tenantId || 'global';
        const current = this.generalLedgerBalances.get(tenantKey) || { totalDebits: 0, totalCredits: 0 };
        const amount = Number(payload.totalAmountMinorUnits || 0);
        current.totalDebits += amount;
        current.totalCredits += amount;
        this.generalLedgerBalances.set(tenantKey, current);
        break;
      }

      default:
        // No specific projection update needed
        break;
    }
  }

  /**
   * Rebuilds all projections from raw historical events (§19).
   */
  public static async rebuildProjections(events: ConsumableEvent[]): Promise<{ rebuiltCount: number }> {
    this.processedEventIds.clear();
    this.patientTimelines.clear();
    this.clinicalQueues.clear();
    this.generalLedgerBalances.clear();

    for (const evt of events) {
      await this.consumeEvent(evt);
    }

    return { rebuiltCount: events.length };
  }
}
