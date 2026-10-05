import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { ClinicalDeteriorationService } from './clinical-deterioration-service';
import { DischargeReadinessService } from './discharge-readiness-service';
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

    const [
      deterioration,
      dischargeReadiness,
      diagnosticOrders,
      inpatientOrders,
    ] = await Promise.all([
      encounterId ? ClinicalDeteriorationService.getProjection(context.tenantId, encounterId) : Promise.resolve(null),
      careSetting === 'IPD' && encounterId
        ? DischargeReadinessService.getProjection(context.tenantId, encounterId)
        : Promise.resolve(null),
      encounterId
        ? DomainStateRepository.queryAllEqual<Record<string, unknown>>(
            context.tenantId,
            'orders',
            'encounterId',
            encounterId
          )
        : Promise.resolve([]),
      encounterId
        ? DomainStateRepository.queryAllEqual<Record<string, unknown>>(
            context.tenantId,
            'inpatientOrders',
            'encounterId',
            encounterId
          )
        : Promise.resolve([]),
    ]);

    const now = Date.now();
    const openItems: ClinicalOpenItemProjection[] = [];

    if (
      deterioration &&
      ['ESCALATION_REQUIRED', 'CRITICAL_REVIEW_REQUIRED'].includes(deterioration.state)
    ) {
      openItems.push({
        openItemId: stableId('open', [patientId, encounterId || '', 'deterioration', deterioration.evaluationId]),
        tenantId: context.tenantId,
        patientId,
        encounterId,
        careSetting,
        category: 'DETERIORATION',
        description:
          deterioration.state === 'CRITICAL_REVIEW_REQUIRED'
            ? 'Clinical deterioration requires critical consultant review.'
            : 'Clinical deterioration requires consultant escalation review.',
        clinicalPriority:
          deterioration.state === 'CRITICAL_REVIEW_REQUIRED'
            ? 'CRITICAL_REVIEW_REQUIRED'
            : 'ACTION_REQUIRED',
        ownerType: 'CONSULTANT',
        ownerId: context.actorId,
        status: 'OPEN',
        createdAt: deterioration.evaluatedAt,
        sourceRefs: [deterioration.evaluationId],
      });
    }

    for (const finding of dischargeReadiness?.blockers || []) {
      openItems.push({
        openItemId: stableId('open', [patientId, encounterId || '', 'discharge', finding.findingId]),
        tenantId: context.tenantId,
        patientId,
        encounterId,
        careSetting,
        category: 'DISCHARGE',
        description: finding.title,
        clinicalPriority: 'ACTION_REQUIRED',
        ownerType: 'CARE_TEAM',
        status: 'OPEN',
        createdAt: dischargeReadiness?.evaluatedAt || now,
        sourceRefs: [finding.findingId],
      });
    }

    const pendingDiagnosticOrders = diagnosticOrders.filter((item) =>
      !['COMPLETED', 'CANCELLED', 'RESULTS_READY', 'FINALIZED'].includes(
        String(item.status || '').toUpperCase()
      )
    );
    for (const order of pendingDiagnosticOrders.slice(0, 100)) {
      const orderId = String(order.orderId || order.id || '');
      openItems.push({
        openItemId: stableId('open', [patientId, encounterId || '', 'diagnostic', orderId]),
        tenantId: context.tenantId,
        patientId,
        encounterId,
        careSetting,
        category: 'DIAGNOSTIC',
        description: `Pending diagnostic order: ${String(order.orderName || order.catalogCode || orderId || 'investigation')}`,
        clinicalPriority:
          String(order.priority || '').toUpperCase() === 'STAT'
            ? 'CRITICAL_REVIEW_REQUIRED'
            : 'REVIEW_REQUIRED',
        ownerType: 'CARE_TEAM',
        status: 'OPEN',
        createdAt: Number(order.createdAt || order.orderedAt || now),
        sourceRefs: [orderId].filter(Boolean),
      });
    }

    const unresolvedInpatientOrders = inpatientOrders.filter((item) =>
      !['COMPLETED', 'CANCELLED', 'DISCONTINUED'].includes(
        String(item.status || '').toUpperCase()
      )
    );
    for (const order of unresolvedInpatientOrders.slice(0, 100)) {
      const orderId = String(order.orderId || order.id || '');
      openItems.push({
        openItemId: stableId('open', [patientId, encounterId || '', 'ipd-order', orderId]),
        tenantId: context.tenantId,
        patientId,
        encounterId,
        careSetting,
        category: 'ORDER',
        description: `Unresolved inpatient order: ${String(order.description || order.orderType || orderId || 'order')}`,
        clinicalPriority:
          String(order.priority || '').toUpperCase() === 'STAT'
            ? 'CRITICAL_REVIEW_REQUIRED'
            : 'REVIEW_REQUIRED',
        ownerType: 'CARE_TEAM',
        status: 'OPEN',
        createdAt: Number(order.createdAt || now),
        sourceRefs: [orderId].filter(Boolean),
      });
    }

    for (const code of projection.dataQuality.missingCanonicalFacts) {
      openItems.push({
        openItemId: stableId('open', [patientId, encounterId || '', 'quality', code]),
        tenantId: context.tenantId,
        patientId,
        encounterId,
        careSetting,
        category: 'DATA_QUALITY',
        description: code.replace(/_/g, ' ').toLowerCase(),
        clinicalPriority: 'REVIEW_REQUIRED',
        ownerType: 'CARE_TEAM',
        status: 'OPEN',
        createdAt: projection.projectedAt,
        sourceRefs: [code],
      });
    }

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
      pendingDiagnosticCount: pendingDiagnosticOrders.length,
      unacknowledgedResultCount: 0,
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
