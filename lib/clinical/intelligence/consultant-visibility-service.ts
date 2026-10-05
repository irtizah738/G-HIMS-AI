import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { normalizeCareSetting } from '@/lib/clinical/patient360/care-context';
import type { CommandContext } from '@/lib/backend/types';
import type {
  ConsultantChangeCategory,
  ConsultantChangeItem,
  ConsultantChangeSeverity,
  ConsultantPatientStateProjection,
  ConsultantRelationship,
  ConsultantReviewCheckpoint,
  ClinicalCareSetting,
  ClinicalOpenItemProjection,
} from '@/types/consultant-visibility';
import type {
  Patient360EncounterSummary,
  Patient360Projection,
  Patient360TimelineItem,
} from '@/types/patient360-projection';

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}_${crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)}`;
}

function relationship(
  actorId: string,
  encounter?: Patient360EncounterSummary
): ConsultantRelationship {
  if (!encounter) return 'REVIEWER';
  if (encounter.assignedProviderId && encounter.assignedProviderId === actorId) {
    return 'PRIMARY_CONSULTANT';
  }
  return 'REVIEWER';
}

function classifyCategory(eventType: string): ConsultantChangeCategory {
  const type = eventType.toUpperCase();
  if (type.includes('VITAL')) return 'VITALS';
  if (type.includes('DIAGNOSTIC') || type.includes('INVESTIGATION') || type.includes('LAB') || type.includes('RADIOLOGY')) return 'DIAGNOSTICS';
  if (type.includes('MEDICATION') || type.includes('PRESCR')) return 'MEDICATIONS';
  if (type.includes('ORDER')) return 'ORDERS';
  if (type.includes('CONSULT')) return 'CONSULTATIONS';
  if (type.includes('HANDOFF') || type.includes('TRANSFER')) return 'HANDOFFS';
  if (type.includes('DISCHARGE')) return 'DISCHARGE';
  if (type.includes('DISPOSITION') || type.includes('ADMISSION')) return 'DISPOSITION';
  if (type.includes('NOTE') || type.includes('DOCUMENT')) return 'DOCUMENTS';
  if (type.includes('CONDITION') || type.includes('ALLERGY')) return 'CLINICAL_CONDITION';
  return 'OTHER';
}

function classifySeverity(eventType: string): ConsultantChangeSeverity {
  const type = eventType.toUpperCase();
  if (
    type.includes('CRITICAL') ||
    type.includes('DETERIORATION_CRITICAL') ||
    type.includes('ESCALATION_REQUIRED')
  ) {
    return 'CRITICAL_REVIEW_REQUIRED';
  }
  if (
    type.includes('ADMISSION_REQUESTED') ||
    type.includes('CONSULTATION_REQUESTED') ||
    type.includes('DIAGNOSTIC_RESULT_VERIFIED') ||
    type.includes('DISCHARGE_READINESS')
  ) {
    return 'ACTION_REQUIRED';
  }
  if (
    type.includes('VITAL') ||
    type.includes('DIAGNOSTIC_RESULT') ||
    type.includes('MEDICATION') ||
    type.includes('CLINICAL_NOTE') ||
    type.includes('CONDITION')
  ) {
    return 'REVIEW_REQUIRED';
  }
  return 'INFORMATION';
}

function selectEncounter(
  projection: Patient360Projection,
  options: { encounterId?: string; careSetting?: ClinicalCareSetting }
): Patient360EncounterSummary | undefined {
  if (options.encounterId) {
    return projection.recentEncounters.find((item) => item.encounterId === options.encounterId);
  }

  switch (options.careSetting) {
    case 'IPD':
      return projection.careContexts.activeIpdEncounter || projection.careContexts.latestIpdEncounter;
    case 'EMERGENCY':
      return projection.careContexts.activeEmergencyEncounter || projection.careContexts.latestEmergencyEncounter;
    case 'OPD':
      return projection.careContexts.activeOpdEncounters[0] || projection.careContexts.latestOpdEncounter;
    case 'TELEHEALTH':
      return projection.careContexts.activeTelehealthEncounters[0] || projection.careContexts.latestTelehealthEncounter;
    default:
      return projection.activeEncounter;
  }
}

function changedAfterCheckpoint(
  item: Patient360TimelineItem,
  checkpoint: ConsultantReviewCheckpoint | null
): boolean {
  if (!checkpoint) return true;
  const cursor = Number(item.recordedAt || item.occurredAt || 0);
  const checkpointCursor = Number(checkpoint.lastEventRecordedAt || checkpoint.reviewedAt || 0);
  if (cursor !== checkpointCursor) return cursor > checkpointCursor;
  return item.eventId !== checkpoint.lastEventId;
}

export class ConsultantVisibilityService {
  public static checkpointId(
    consultantId: string,
    patientId: string,
    encounterId: string
  ): string {
    return stableId('crv', [consultantId, patientId, encounterId]);
  }

  public static async getReviewCheckpoint(
    tenantId: string,
    consultantId: string,
    patientId: string,
    encounterId: string
  ): Promise<ConsultantReviewCheckpoint | null> {
    const db = getAdminFirestore();
    if (!db) return null;
    const id = this.checkpointId(consultantId, patientId, encounterId);
    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('consultantReviewCheckpoints')
      .doc(id)
      .get();
    return snapshot.exists ? (snapshot.data() as ConsultantReviewCheckpoint) : null;
  }

  public static async buildForActor(
    context: CommandContext,
    patientId: string,
    options: { encounterId?: string; careSetting?: ClinicalCareSetting; timelineLimit?: number } = {}
  ): Promise<ConsultantPatientStateProjection | null> {
    const { projection, timeline } = await Patient360ProjectionService.readClinicalView(
      context.tenantId,
      patientId,
      options.timelineLimit || 500
    );
    if (!projection) return null;

    const encounter = selectEncounter(projection, options);
    const careSetting = normalizeCareSetting(
      options.careSetting || encounter?.careSetting || encounter?.encounterType
    );
    const encounterId = encounter?.encounterId;
    const checkpoint = encounterId
      ? await this.getReviewCheckpoint(context.tenantId, context.actorId, patientId, encounterId)
      : null;

    const changes: ConsultantChangeItem[] = timeline
      .filter((item) => changedAfterCheckpoint(item, checkpoint))
      .filter((item) => !encounterId || !item.encounterId || item.encounterId === encounterId)
      .map((item) => {
        const severity = classifySeverity(item.eventType);
        return {
          changeId: stableId('chg', [context.actorId, patientId, item.eventId]),
          patientId,
          encounterId: item.encounterId,
          careSetting: item.careSetting || careSetting,
          eventId: item.eventId,
          eventType: item.eventType,
          occurredAt: item.occurredAt,
          recordedAt: item.recordedAt,
          category: classifyCategory(item.eventType),
          severity,
          statement: item.summary,
          sourceEventIds: [item.eventId],
          requiresAcknowledgment: severity !== 'INFORMATION',
          requiresAction:
            severity === 'ACTION_REQUIRED' || severity === 'CRITICAL_REVIEW_REQUIRED',
        };
      });

    const db = getAdminFirestore();
    const openItems: ClinicalOpenItemProjection[] =
      db && encounterId
        ? (
            await db
              .collection('tenants')
              .doc(context.tenantId)
              .collection('clinicalOpenItems')
              .where('encounterId', '==', encounterId)
              .get()
          ).docs
            .map((doc) => doc.data() as ClinicalOpenItemProjection)
            .filter((item) => item.status !== 'RESOLVED')
            .sort(
              (left, right) =>
                (
                  {
                    CRITICAL_REVIEW_REQUIRED: 0,
                    ACTION_REQUIRED: 1,
                    REVIEW_REQUIRED: 2,
                    INFORMATION: 3,
                  } as Record<string, number>
                )[left.clinicalPriority] -
                  (
                    {
                      CRITICAL_REVIEW_REQUIRED: 0,
                      ACTION_REQUIRED: 1,
                      REVIEW_REQUIRED: 2,
                      INFORMATION: 3,
                    } as Record<string, number>
                  )[right.clinicalPriority] ||
                Number(left.dueAt || Number.MAX_SAFE_INTEGER) -
                  Number(right.dueAt || Number.MAX_SAFE_INTEGER) ||
                Number(left.createdAt || 0) - Number(right.createdAt || 0)
            )
        : [];

    const pendingDiagnosticCount = openItems.filter(
      (item) => item.category === 'DIAGNOSTIC'
    ).length;
    const unacknowledgedResultCount = openItems.filter(
      (item) =>
        item.category === 'DIAGNOSTIC' &&
        item.clinicalPriority === 'CRITICAL_REVIEW_REQUIRED' &&
        item.status === 'OPEN'
    ).length;
    const now = Date.now();

    const criticalItemsCount = openItems.filter(
      (item) => item.clinicalPriority === 'CRITICAL_REVIEW_REQUIRED'
    ).length;
    const medicationChangesCount = changes.filter(
      (item) => item.category === 'MEDICATIONS'
    ).length;

    return {
      tenantId: context.tenantId,
      consultantId: context.actorId,
      patientId,
      encounter,
      encounterId,
      careSetting,
      relationship: relationship(context.actorId, encounter),
      lastReviewedAt: checkpoint?.reviewedAt,
      lastReviewedRevision: checkpoint?.patient360Revision,
      patient360Revision: projection.revision,
      patient360SourceCheckpoint: projection.sourceCheckpoint,
      unreadClinicalChanges: changes.length,
      unresolvedItemsCount: openItems.length,
      criticalItemsCount,
      pendingDiagnosticCount,
      unacknowledgedResultCount,
      medicationChangesCount,
      dataQualityState:
        projection.dataQuality.missingCanonicalFacts.length > 0
          ? 'REVIEW_REQUIRED'
          : 'COMPLETE',
      changes,
      openItems,
      generatedAt: now,
    };
  }
}
