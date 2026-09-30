import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import {
  ClinicalDeteriorationEngine,
  DETERIORATION_RULESET_VERSION,
} from './clinical-deterioration-engine';
import type {
  DeteriorationEvaluation,
  DeteriorationProjection,
  DeteriorationSnapshot,
} from '@/types/clinical-deterioration';

export interface DeteriorationTriggerEvent {
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
  'ENCOUNTER_CREATED',
  'INPATIENT_ADMISSION_CREATED',
  'PATIENT_ADMITTED_TO_INPATIENT_CARE',
  'VITALS_RECORDED',
  'DIAGNOSTIC_RESULT_RECORDED',
  'DIAGNOSTIC_RESULT_VERIFIED',
  'CRITICAL_DIAGNOSTIC_RESULT_ACKNOWLEDGED',
  'MEDICATION_PRESCRIBED',
  'MEDICATION_DISPENSED',
  'MEDICATION_ADMINISTERED',
  'MEDICATION_ADMINISTRATION_HELD',
  'INPATIENT_ORDER_PLACED',
  'INPATIENT_ORDER_RESOLVED',
  'STAGE_COMPLETED',
  'ENCOUNTER_DISPOSITION_COMMITTED',
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
        DETERIORATION_RULESET_VERSION,
      ].join('|')
    )
    .digest('hex')
    .slice(0, 32);
  return `deval_${hash}`;
}

function compareCursor(
  left: DeteriorationProjection,
  right: DeteriorationProjection
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

function isActiveEncounter(
  encounter: Record<string, unknown> | null
): boolean {
  if (!encounter) return false;
  const status = String(encounter.status || '').toUpperCase();
  return !['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED'].includes(
    status
  );
}

export class ClinicalDeteriorationService {
  public static isRelevantEvent(eventType: string): boolean {
    return RELEVANT_EVENTS.has(String(eventType || '').toUpperCase());
  }

  public static async getProjection(
    tenantId: string,
    encounterId: string
  ): Promise<DeteriorationProjection | null> {
    const db = getAdminFirestore();
    if (!db) throw new Error('DETERIORATION_STORE_UNAVAILABLE');

    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('deteriorationProjections')
      .doc(encounterId)
      .get();

    return snapshot.exists
      ? (snapshot.data() as DeteriorationProjection)
      : null;
  }

  public static async getForPatient(
    tenantId: string,
    patientId: string
  ): Promise<DeteriorationProjection | null> {
    const patient360 = await Patient360ProjectionService.getProjection(
      tenantId,
      patientId
    );
    const encounterId = String(patient360?.activeEncounter?.encounterId || '');
    return encounterId ? this.getProjection(tenantId, encounterId) : null;
  }

  public static async buildSnapshot(
    tenantId: string,
    patientId: string
  ): Promise<DeteriorationSnapshot | null> {
    const patient360 = await Patient360ProjectionService.getProjection(
      tenantId,
      patientId
    );
    const activeEncounter = patient360?.activeEncounter;
    if (!patient360 || !activeEncounter?.encounterId) return null;

    const encounterId = activeEncounter.encounterId;
    const encounter = await DomainStateRepository.getById<
      Record<string, unknown>
    >(tenantId, 'encounters', encounterId);
    if (!isActiveEncounter(encounter)) return null;

    const [
      encounterEvidence,
      diagnosticResults,
      clinicalObservations,
      diagnosticAcknowledgements,
    ] = await Promise.all([
      DomainStateRepository.queryAllEqual<Record<string, unknown>>(
        tenantId,
        'encounterEvidence',
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
        activeEncounter,
        dataQuality: patient360.dataQuality,
      },
      encounter: encounter || {},
      encounterEvidence,
      diagnosticResults,
      clinicalObservations,
      diagnosticAcknowledgements,
    };
  }

  public static async evaluatePatient(
    tenantId: string,
    patientId: string,
    trigger?: { eventId?: string; eventType?: string }
  ): Promise<DeteriorationProjection | null> {
    const snapshot = await this.buildSnapshot(tenantId, patientId);
    if (!snapshot) return null;

    const evaluated = ClinicalDeteriorationEngine.evaluate(
      snapshot,
      snapshot.patient360.lastEventRecordedAt || Date.now()
    );
    const evaluationId = stableEvaluationId(
      tenantId,
      snapshot.encounterId,
      evaluated.patient360SourceCheckpoint
    );

    const projection: DeteriorationProjection = {
      ...evaluated,
      evaluationId,
    };
    const immutableEvaluation: DeteriorationEvaluation = {
      ...projection,
      triggerEventId: trigger?.eventId,
      triggerEventType: trigger?.eventType,
      immutable: true,
    };

    const db = getAdminFirestore();
    if (!db) throw new Error('DETERIORATION_STORE_UNAVAILABLE');

    const tenantRef = db.collection('tenants').doc(tenantId);
    const evaluationRef = tenantRef
      .collection('clinicalDeteriorationEvaluations')
      .doc(evaluationId);
    const projectionRef = tenantRef
      .collection('deteriorationProjections')
      .doc(snapshot.encounterId);

    await db.runTransaction(async (transaction) => {
      const [existingEvaluation, currentProjectionSnapshot] =
        await Promise.all([
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
        ? (currentProjectionSnapshot.data() as DeteriorationProjection)
        : null;

      if (currentProjection) {
        const comparison = compareCursor(projection, currentProjection);
        if (comparison < 0) return;
        if (
          comparison === 0 &&
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
    event: DeteriorationTriggerEvent
  ): Promise<DeteriorationProjection | null> {
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
    if (!db) throw new Error('DETERIORATION_STORE_UNAVAILABLE');

    const tenantRef = db.collection('tenants').doc(event.tenantId);
    const checkpointRef = tenantRef
      .collection('deteriorationCheckpoints')
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
    events: DeteriorationTriggerEvent[]
  ): Promise<number> {
    const patientIds = Array.from(
      new Set(
        events
          .map((event) =>
            String(
              event.payload?.patientId ||
                (String(event.aggregateType || '')
                  .toUpperCase()
                  .includes('PATIENT')
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
        eventType: 'CI8_REBUILD',
      });
      if (projection) rebuilt += 1;
    }
    return rebuilt;
  }
}
