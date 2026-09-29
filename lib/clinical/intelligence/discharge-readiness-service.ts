import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import {
  DISCHARGE_READINESS_RULESET_VERSION,
  DischargeReadinessEngine,
} from './discharge-readiness-engine';
import type {
  DischargeReadinessEvaluation,
  DischargeReadinessProjection,
  DischargeReadinessSnapshot,
} from '@/types/discharge-readiness';

export interface DischargeReadinessTriggerEvent {
  eventId: string;
  tenantId: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  payload: Record<string, unknown>;
  occurredAt?: number;
  recordedAt?: number;
}

const RELEVANT_EVENTS = new Set([
  'INPATIENT_ADMISSION_CREATED',
  'PATIENT_ADMITTED_TO_INPATIENT_CARE',
  'VITALS_RECORDED',
  'MEDICATION_RECONCILIATION_COMPLETED',
  'CLINICAL_NOTE_SIGNED',
  'INVESTIGATION_ORDERED',
  'DIAGNOSTIC_RESULT_RECORDED',
  'DIAGNOSTIC_RESULT_VERIFIED',
  'CRITICAL_DIAGNOSTIC_RESULT_ACKNOWLEDGED',
  'INPATIENT_ORDER_PLACED',
  'INPATIENT_ORDER_RESOLVED',
  'MEDICATION_PRESCRIBED',
  'MEDICATION_DISPENSED',
  'MEDICATION_ADMINISTERED',
  'MEDICATION_ADMINISTRATION_HELD',
  'CLINICAL_CONDITION_RECORDED',
  'CLINICAL_ALLERGY_RECORDED',
  'PATIENT_CLINICAL_KNOWLEDGE_STATUS_UPDATED',
  'INPATIENT_ENCOUNTER_DISCHARGED',
]);

function stableEvaluationId(
  tenantId: string,
  encounterId: string,
  sourceCheckpoint: string
): string {
  const hash = crypto
    .createHash('sha256')
    .update(
      [
        tenantId,
        encounterId,
        sourceCheckpoint,
        DISCHARGE_READINESS_RULESET_VERSION,
      ].join('|')
    )
    .digest('hex')
    .slice(0, 32);
  return `dreval_${hash}`;
}

function compareReadinessCursor(
  left: DischargeReadinessProjection,
  right: DischargeReadinessProjection
): number {
  if (left.patient360Revision !== right.patient360Revision) {
    return left.patient360Revision > right.patient360Revision ? 1 : -1;
  }

  const parse = (value: string) => {
    const separator = value.indexOf(':');
    const recordedAt = Number(
      separator >= 0 ? value.slice(0, separator) : value
    );
    const eventId = separator >= 0 ? value.slice(separator + 1) : '';
    return {
      recordedAt: Number.isFinite(recordedAt) ? recordedAt : 0,
      eventId,
    };
  };

  const leftCursor = parse(left.patient360SourceCheckpoint);
  const rightCursor = parse(right.patient360SourceCheckpoint);
  if (leftCursor.recordedAt !== rightCursor.recordedAt) {
    return leftCursor.recordedAt > rightCursor.recordedAt ? 1 : -1;
  }
  return leftCursor.eventId.localeCompare(rightCursor.eventId);
}

function isActiveInpatientEncounter(encounter: Record<string, unknown> | null): boolean {
  if (!encounter) return false;
  const type = String(encounter.encounterType || encounter.type || '').toUpperCase();
  const status = String(encounter.status || '').toUpperCase();
  return type === 'IPD' &&
    ['ACTIVE', 'IN_PROGRESS', 'ADMITTED'].includes(status);
}

export class DischargeReadinessService {
  public static isRelevantEvent(eventType: string): boolean {
    return RELEVANT_EVENTS.has(String(eventType || '').toUpperCase());
  }

  public static async getProjection(
    tenantId: string,
    encounterId: string
  ): Promise<DischargeReadinessProjection | null> {
    const db = getAdminFirestore();
    if (!db) {
      throw new Error('DISCHARGE_READINESS_STORE_UNAVAILABLE');
    }

    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('dischargeReadinessProjections')
      .doc(encounterId)
      .get();

    return snapshot.exists
      ? (snapshot.data() as DischargeReadinessProjection)
      : null;
  }

  public static async getForPatient(
    tenantId: string,
    patientId: string
  ): Promise<DischargeReadinessProjection | null> {
    const patient360 = await Patient360ProjectionService.getProjection(
      tenantId,
      patientId
    );
    const encounterId = String(patient360?.activeEncounter?.encounterId || '');
    if (!encounterId) return null;
    return this.getProjection(tenantId, encounterId);
  }

  public static async buildSnapshot(
    tenantId: string,
    patientId: string
  ): Promise<DischargeReadinessSnapshot | null> {
    const patient360 = await Patient360ProjectionService.getProjection(
      tenantId,
      patientId
    );
    if (!patient360?.activeEncounter?.encounterId) return null;

    const encounterId = patient360.activeEncounter.encounterId;
    const encounter = await DomainStateRepository.getById<Record<string, unknown>>(
      tenantId,
      'encounters',
      encounterId
    );
    if (!isActiveInpatientEncounter(encounter)) return null;

    const [
      encounterEvidence,
      diagnosticOrders,
      diagnosticResults,
      clinicalObservations,
      diagnosticAcknowledgements,
      inpatientOrders,
    ] = await Promise.all([
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        tenantId,
        'encounterEvidence',
        'encounterId',
        encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        tenantId,
        'orders',
        'encounterId',
        encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        tenantId,
        'diagnosticResults',
        'encounterId',
        encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        tenantId,
        'clinicalObservations',
        'encounterId',
        encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        tenantId,
        'diagnosticResultAcknowledgements',
        'encounterId',
        encounterId
      ),
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        tenantId,
        'inpatientOrders',
        'encounterId',
        encounterId
      ),
    ]);

    return {
      tenantId,
      patientId,
      encounterId,
      patient360: {
        revision: patient360.revision,
        sourceCheckpoint: patient360.sourceCheckpoint,
        lastEventId: patient360.lastEventId,
        lastEventRecordedAt: patient360.lastEventRecordedAt,
        activeEncounter: {
          encounterId,
          encounterType: patient360.activeEncounter.encounterType,
          status: patient360.activeEncounter.status,
        },
        currentMedicationCount: patient360.currentMedications.length,
        dataQuality: {
          allergyKnowledge: patient360.dataQuality.allergyKnowledge,
          medicationKnowledge: patient360.dataQuality.medicationKnowledge,
          problemListKnowledge: patient360.dataQuality.problemListKnowledge,
          hasPreliminaryResults: patient360.dataQuality.hasPreliminaryResults,
        },
      },
      encounter: encounter || {},
      encounterEvidence,
      diagnosticOrders,
      diagnosticResults,
      clinicalObservations,
      diagnosticAcknowledgements,
      inpatientOrders,
    };
  }

  public static async evaluatePatient(
    tenantId: string,
    patientId: string,
    trigger?: { eventId?: string; eventType?: string }
  ): Promise<DischargeReadinessProjection | null> {
    const snapshot = await this.buildSnapshot(tenantId, patientId);
    if (!snapshot) return null;

    const evaluated = DischargeReadinessEngine.evaluate(
      snapshot,
      snapshot.patient360.lastEventRecordedAt || Date.now()
    );
    const evaluationId = stableEvaluationId(
      tenantId,
      snapshot.encounterId,
      evaluated.patient360SourceCheckpoint
    );

    const projection: DischargeReadinessProjection = {
      ...evaluated,
      evaluationId,
    };
    const immutableEvaluation: DischargeReadinessEvaluation = {
      ...projection,
      triggerEventId: trigger?.eventId,
      triggerEventType: trigger?.eventType,
      immutable: true,
    };

    const db = getAdminFirestore();
    if (!db) {
      throw new Error('DISCHARGE_READINESS_STORE_UNAVAILABLE');
    }

    const tenantRef = db.collection('tenants').doc(tenantId);
    const evaluationRef = tenantRef
      .collection('clinicalIntelligenceEvaluations')
      .doc(evaluationId);
    const projectionRef = tenantRef
      .collection('dischargeReadinessProjections')
      .doc(snapshot.encounterId);

    await db.runTransaction(async (transaction) => {
      // All reads precede writes so Firestore can retry this transaction safely.
      const [existingEvaluation, currentProjectionSnapshot] = await Promise.all([
        transaction.get(evaluationRef),
        transaction.get(projectionRef),
      ]);

      if (!existingEvaluation.exists) {
        transaction.create(
          evaluationRef,
          sanitizeForFirestore(immutableEvaluation)
        );
      }

      const currentProjection = currentProjectionSnapshot.exists
        ? (currentProjectionSnapshot.data() as DischargeReadinessProjection)
        : null;

      if (currentProjection) {
        const cursorComparison = compareReadinessCursor(
          projection,
          currentProjection
        );

        // Concurrent workers may finish out of order. Preserve the newest
        // Patient 360-derived assessment as the current projection.
        if (cursorComparison < 0) {
          return;
        }

        if (
          cursorComparison === 0 &&
          currentProjection.evaluationId === projection.evaluationId
        ) {
          return;
        }
      }

      transaction.set(projectionRef, sanitizeForFirestore(projection));
    });

    return projection;
  }

  public static async refreshFromEvent(
    event: DischargeReadinessTriggerEvent
  ): Promise<DischargeReadinessProjection | null> {
    if (!this.isRelevantEvent(event.eventType)) return null;

    const patientId = String(
      event.payload?.patientId ||
      (String(event.aggregateType || '').toUpperCase().includes('PATIENT')
        ? event.aggregateId
        : '') ||
      ''
    ).trim();

    if (!patientId) return null;

    const db = getAdminFirestore();
    if (!db) {
      throw new Error('DISCHARGE_READINESS_STORE_UNAVAILABLE');
    }

    const tenantRef = db.collection('tenants').doc(event.tenantId);
    const checkpointRef = tenantRef
      .collection('dischargeReadinessCheckpoints')
      .doc(event.eventId);

    const existing = await checkpointRef.get();
    if (existing.exists) {
      const encounterId = String(existing.data()?.encounterId || '');
      return encounterId
        ? this.getProjection(event.tenantId, encounterId)
        : null;
    }

    const projection = await this.evaluatePatient(event.tenantId, patientId, {
      eventId: event.eventId,
      eventType: event.eventType,
    });

    await db.runTransaction(async (transaction) => {
      const duplicate = await transaction.get(checkpointRef);
      if (duplicate.exists) return;
      transaction.create(
        checkpointRef,
        sanitizeForFirestore({
          eventId: event.eventId,
          tenantId: event.tenantId,
          patientId,
          encounterId: projection?.encounterId || null,
          evaluationId: projection?.evaluationId || null,
          processedAt: Date.now(),
          status: projection ? 'EVALUATED' : 'NOT_APPLICABLE',
        })
      );
    });

    return projection;
  }

  public static async rebuildTenantFromEvents(
    tenantId: string,
    events: DischargeReadinessTriggerEvent[]
  ): Promise<number> {
    const patientIds = Array.from(
      new Set(
        events
          .map((event) =>
            String(
              event.payload?.patientId ||
              (String(event.aggregateType || '').toUpperCase().includes('PATIENT')
                ? event.aggregateId
                : '') ||
              ''
            ).trim()
          )
          .filter(Boolean)
      )
    );

    let rebuilt = 0;
    for (const patientId of patientIds) {
      const projection = await this.evaluatePatient(tenantId, patientId, {
        eventType: 'CI7_REBUILD',
      });
      if (projection) rebuilt += 1;
    }
    return rebuilt;
  }
}
