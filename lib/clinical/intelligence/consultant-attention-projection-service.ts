import crypto from 'node:crypto';
import type { DocumentReference } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/server/firebase/admin';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { ClinicalDeteriorationService } from '@/lib/clinical/intelligence/clinical-deterioration-service';
import { DischargeReadinessService } from '@/lib/clinical/intelligence/discharge-readiness-service';
import type { MedicationSafetyProjection } from '@/types/medication-safety';
import { normalizeCareSetting } from '@/lib/clinical/patient360/care-context';
import type { CommandContext } from '@/lib/backend/types';
import type { ClinicalOpenItemProjection } from '@/types/consultant-visibility';
import type {
  ClinicalConsultationRequest,
  ClinicalEscalationProjection,
  ClinicalHandoff,
  ConsultantWorklist,
  ConsultantWorklistItem,
} from '@/types/clinical-coordination';

export interface ConsultantAttentionTriggerEvent {
  eventId: string;
  tenantId: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  payload?: Record<string, unknown>;
  occurredAt?: number;
  recordedAt?: number;
}

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}_${crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 32)}`;
}

function priorityRank(value: string): number {
  switch (String(value || '').toUpperCase()) {
    case 'CRITICAL_REVIEW_REQUIRED':
      return 0;
    case 'ACTION_REQUIRED':
      return 1;
    case 'REVIEW_REQUIRED':
      return 2;
    default:
      return 3;
  }
}

function isTerminalOrder(status: unknown): boolean {
  return [
    'COMPLETED',
    'CANCELLED',
    'DISCONTINUED',
    'FINALIZED',
    'RESULTS_READY',
  ].includes(String(status || '').toUpperCase());
}

function careOwner(encounter: Record<string, unknown>): {
  ownerType: ClinicalOpenItemProjection['ownerType'];
  ownerId?: string;
  ownerDepartmentId?: string;
  ownerRole?: string;
} {
  const consultantId = String(
    encounter.attendingConsultantId ||
      encounter.assignedProviderId ||
      encounter.consultantId ||
      encounter.assignedDoctorId ||
      ''
  ).trim();
  if (consultantId) {
    return { ownerType: 'CONSULTANT', ownerId: consultantId };
  }

  const departmentId = String(
    encounter.departmentId || encounter.department || ''
  ).trim();
  if (departmentId) {
    return {
      ownerType: 'DEPARTMENT',
      ownerId: departmentId,
      ownerDepartmentId: departmentId,
    };
  }

  return {
    ownerType: 'ROLE',
    ownerId: 'CONSULTANT',
    ownerRole: 'CONSULTANT',
  };
}

function item(
  base: Omit<
    ClinicalOpenItemProjection,
    | 'tenantId'
    | 'status'
    | 'resolutionMode'
    | 'generatedBy'
    | 'updatedAt'
  > & { tenantId: string; resolutionMode?: 'SOURCE_STATE' | 'MANUAL' },
  now: number
): ClinicalOpenItemProjection {
  return {
    ...base,
    status: 'OPEN',
    resolutionMode: base.resolutionMode || 'SOURCE_STATE',
    generatedBy: 'CONSULTANT_ATTENTION_PROJECTION',
    updatedAt: now,
  };
}

export class ConsultantAttentionProjectionService {
  public static async refreshEncounter(
    tenantId: string,
    patientId: string,
    encounterId: string,
    trigger?: { eventId?: string; eventType?: string }
  ): Promise<ClinicalOpenItemProjection[]> {
    const db = getAdminFirestore();
    if (!db) throw new Error('CONSULTANT_ATTENTION_STORE_UNAVAILABLE');

    const tenantRef = db.collection('tenants').doc(tenantId);
    const encounterSnapshot = await tenantRef
      .collection('encounters')
      .doc(encounterId)
      .get();
    if (!encounterSnapshot.exists) return [];

    const encounter = encounterSnapshot.data() as Record<string, unknown>;
    if (String(encounter.patientId || '') !== patientId) return [];

    const patient360 = await Patient360ProjectionService.getProjection(
      tenantId,
      patientId
    );
    if (!patient360) return [];

    const careSetting = normalizeCareSetting(
      encounter.encounterType || encounter.type
    );
    const owner = careOwner(encounter);
    const now = Date.now();

    const [
      deterioration,
      dischargeReadiness,
      diagnosticOrdersSnapshot,
      inpatientOrdersSnapshot,
      diagnosticResultsSnapshot,
      diagnosticAckSnapshot,
      consultationSnapshot,
      handoffSnapshot,
      medicationSafetySnapshot,
      existingOpenItemsSnapshot,
      existingEscalationSnapshot,
    ] = await Promise.all([
      ClinicalDeteriorationService.getProjection(tenantId, encounterId),
      careSetting === 'IPD'
        ? DischargeReadinessService.getProjection(tenantId, encounterId)
        : Promise.resolve(null),
      tenantRef.collection('orders').where('encounterId', '==', encounterId).get(),
      tenantRef
        .collection('inpatientOrders')
        .where('encounterId', '==', encounterId)
        .get(),
      tenantRef
        .collection('diagnosticResults')
        .where('encounterId', '==', encounterId)
        .get(),
      tenantRef
        .collection('diagnosticResultAcknowledgements')
        .where('encounterId', '==', encounterId)
        .get(),
      tenantRef
        .collection('consultationRequests')
        .where('encounterId', '==', encounterId)
        .get(),
      tenantRef
        .collection('clinicalHandoffs')
        .where('encounterId', '==', encounterId)
        .get(),
      tenantRef
        .collection('medicationSafetyProjections')
        .doc(patientId)
        .get(),
      tenantRef
        .collection('clinicalOpenItems')
        .where('encounterId', '==', encounterId)
        .get(),
      tenantRef.collection('clinicalEscalations').doc(`esc_${encounterId}`).get(),
    ]);

    const active: ClinicalOpenItemProjection[] = [];
    const diagnosticOrders = diagnosticOrdersSnapshot.docs.map((doc) => doc.data());
    const inpatientOrders = inpatientOrdersSnapshot.docs.map((doc) => doc.data());
    const diagnosticResults = diagnosticResultsSnapshot.docs.map((doc) => doc.data());
    const ackedReportIds = new Set(
      diagnosticAckSnapshot.docs
        .map((doc) => String(doc.data().reportId || '').trim())
        .filter(Boolean)
    );
    const consultations = consultationSnapshot.docs.map(
      (doc) => doc.data() as ClinicalConsultationRequest
    );
    const handoffs = handoffSnapshot.docs.map(
      (doc) => doc.data() as ClinicalHandoff
    );
    const medicationSafety = medicationSafetySnapshot.exists
      ? (medicationSafetySnapshot.data() as MedicationSafetyProjection)
      : null;

    if (
      deterioration &&
      ['ESCALATION_REQUIRED', 'CRITICAL_REVIEW_REQUIRED'].includes(
        deterioration.state
      )
    ) {
      const critical =
        deterioration.state === 'CRITICAL_REVIEW_REQUIRED';
      active.push(
        item(
          {
            openItemId: stableId('open', [
              patientId,
              encounterId,
              'deterioration',
              deterioration.evaluationId,
            ]),
            tenantId,
            patientId,
            encounterId,
            careSetting,
            category: 'DETERIORATION',
            description: critical
              ? 'Clinical deterioration requires critical consultant review.'
              : 'Clinical deterioration requires consultant escalation review.',
            clinicalPriority: critical
              ? 'CRITICAL_REVIEW_REQUIRED'
              : 'ACTION_REQUIRED',
            ...owner,
            createdAt: deterioration.evaluatedAt,
            dueAt: deterioration.evaluatedAt + (critical ? 15 : 30) * 60_000,
            sourceRefs: [deterioration.evaluationId],
            lastSourceEventId: trigger?.eventId,
          },
          now
        )
      );
    }

    for (const finding of dischargeReadiness?.blockers || []) {
      active.push(
        item(
          {
            openItemId: stableId('open', [
              patientId,
              encounterId,
              'discharge',
              finding.findingId,
            ]),
            tenantId,
            patientId,
            encounterId,
            careSetting,
            category: 'DISCHARGE',
            description: finding.title,
            clinicalPriority: 'ACTION_REQUIRED',
            ...owner,
            createdAt: dischargeReadiness?.evaluatedAt || now,
            sourceRefs: [finding.findingId],
            lastSourceEventId: trigger?.eventId,
          },
          now
        )
      );
    }

    for (const order of diagnosticOrders.filter(
      (candidate) => !isTerminalOrder(candidate.status)
    )) {
      const orderId = String(order.orderId || order.id || '').trim();
      if (!orderId) continue;
      const stat = String(order.priority || '').toUpperCase() === 'STAT';
      active.push(
        item(
          {
            openItemId: stableId('open', [
              patientId,
              encounterId,
              'diagnostic-order',
              orderId,
            ]),
            tenantId,
            patientId,
            encounterId,
            careSetting,
            category: 'DIAGNOSTIC',
            description: `Pending diagnostic order: ${String(
              order.orderName || order.catalogCode || orderId
            )}`,
            clinicalPriority: stat
              ? 'CRITICAL_REVIEW_REQUIRED'
              : 'REVIEW_REQUIRED',
            ...owner,
            createdAt: Number(order.createdAt || order.orderedAt || now),
            dueAt: stat
              ? Number(order.createdAt || order.orderedAt || now) + 15 * 60_000
              : undefined,
            sourceRefs: [orderId],
            lastSourceEventId: trigger?.eventId,
          },
          now
        )
      );
    }

    for (const result of diagnosticResults) {
      const reportId = String(
        result.reportId || result.diagnosticResultId || ''
      ).trim();
      if (
        !reportId ||
        !Boolean(result.hasCriticalResult) ||
        ackedReportIds.has(reportId)
      ) {
        continue;
      }
      const issuedAt = Number(result.issuedAt || result.recordedAt || now);
      active.push(
        item(
          {
            openItemId: stableId('open', [
              patientId,
              encounterId,
              'critical-result',
              reportId,
            ]),
            tenantId,
            patientId,
            encounterId,
            careSetting,
            category: 'DIAGNOSTIC',
            description: `Critical diagnostic result requires acknowledgment: ${String(
              result.reportDisplay || result.reportCode || reportId
            )}`,
            clinicalPriority: 'CRITICAL_REVIEW_REQUIRED',
            ...owner,
            createdAt: issuedAt,
            dueAt: issuedAt + 15 * 60_000,
            sourceRefs: [reportId],
            lastSourceEventId: trigger?.eventId,
          },
          now
        )
      );
    }

    for (const order of inpatientOrders.filter(
      (candidate) => !isTerminalOrder(candidate.status)
    )) {
      const orderId = String(order.orderId || order.id || '').trim();
      if (!orderId) continue;
      const stat = String(order.priority || '').toUpperCase() === 'STAT';
      active.push(
        item(
          {
            openItemId: stableId('open', [
              patientId,
              encounterId,
              'inpatient-order',
              orderId,
            ]),
            tenantId,
            patientId,
            encounterId,
            careSetting,
            category: 'ORDER',
            description: `Unresolved inpatient order: ${String(
              order.description || order.orderType || orderId
            )}`,
            clinicalPriority: stat
              ? 'CRITICAL_REVIEW_REQUIRED'
              : 'REVIEW_REQUIRED',
            ...owner,
            createdAt: Number(order.createdAt || now),
            sourceRefs: [orderId],
            lastSourceEventId: trigger?.eventId,
          },
          now
        )
      );
    }

    for (const consultation of consultations.filter(
      (candidate) =>
        !['COMPLETED', 'CANCELLED'].includes(
          String(candidate.status || '').toUpperCase()
        )
    )) {
      const consultationOwner = consultation.assignedConsultantId ||
        consultation.requestedConsultantId;
      active.push(
        item(
          {
            openItemId: stableId('open', [
              patientId,
              encounterId,
              'consultation',
              consultation.consultationId,
            ]),
            tenantId,
            patientId,
            encounterId,
            careSetting,
            category: 'CONSULTATION',
            description: `${consultation.priority} ${consultation.requestedSpecialty} consultation pending: ${consultation.clinicalQuestion}`,
            clinicalPriority:
              consultation.priority === 'STAT'
                ? 'CRITICAL_REVIEW_REQUIRED'
                : consultation.priority === 'URGENT'
                  ? 'ACTION_REQUIRED'
                  : 'REVIEW_REQUIRED',
            ownerType: consultationOwner ? 'CONSULTANT' : 'ROLE',
            ownerId: consultationOwner || 'CONSULTANT',
            ownerRole: consultationOwner ? undefined : 'CONSULTANT',
            createdAt: consultation.requestedAt,
            dueAt:
              consultation.priority === 'STAT'
                ? consultation.requestedAt + 15 * 60_000
                : consultation.priority === 'URGENT'
                  ? consultation.requestedAt + 60 * 60_000
                  : undefined,
            sourceRefs: [consultation.consultationId],
            lastSourceEventId: trigger?.eventId,
          },
          now
        )
      );
    }

    for (const consultation of consultations.filter(
      (candidate) =>
        candidate.status === 'COMPLETED' &&
        candidate.primaryTeamReviewRequired
    )) {
      active.push(
        item(
          {
            openItemId: stableId('open', [
              patientId,
              encounterId,
              'consultation-review',
              consultation.consultationId,
            ]),
            tenantId,
            patientId,
            encounterId,
            careSetting,
            category: 'CONSULTATION',
            description: `Completed ${consultation.requestedSpecialty} consultation requires primary-team review.`,
            clinicalPriority: 'ACTION_REQUIRED',
            ...owner,
            resolutionMode: 'MANUAL',
            createdAt: consultation.completedAt || consultation.updatedAt,
            sourceRefs: [consultation.consultationId],
            lastSourceEventId: trigger?.eventId,
          },
          now
        )
      );
    }

    for (const handoff of handoffs.filter(
      (candidate) => candidate.status === 'PENDING_ACCEPTANCE'
    )) {
      const targetOwner = handoff.toClinicianId
        ? {
            ownerType: 'CONSULTANT' as const,
            ownerId: handoff.toClinicianId,
          }
        : handoff.toDepartmentId
          ? {
              ownerType: 'DEPARTMENT' as const,
              ownerId: handoff.toDepartmentId,
              ownerDepartmentId: handoff.toDepartmentId,
            }
          : {
              ownerType: 'ROLE' as const,
              ownerId: handoff.toRole || 'CONSULTANT',
              ownerRole: handoff.toRole || 'CONSULTANT',
            };
      active.push(
        item(
          {
            openItemId: stableId('open', [
              patientId,
              encounterId,
              'handoff',
              handoff.handoffId,
            ]),
            tenantId,
            patientId,
            encounterId,
            careSetting,
            category: 'HANDOFF',
            description: `Clinical handoff awaiting acceptance: ${handoff.currentProblemSummary}`,
            clinicalPriority: 'ACTION_REQUIRED',
            ...targetOwner,
            createdAt: handoff.createdAt,
            sourceRefs: [handoff.handoffId],
            lastSourceEventId: trigger?.eventId,
          },
          now
        )
      );
    }

    for (const finding of medicationSafety?.findings || []) {
      if (finding.encounterId && finding.encounterId !== encounterId) continue;
      active.push(
        item(
          {
            openItemId: stableId('open', [
              patientId,
              encounterId,
              'medication-safety',
              finding.findingId,
            ]),
            tenantId,
            patientId,
            encounterId,
            careSetting,
            category: 'MEDICATION',
            description: finding.title,
            clinicalPriority: finding.severity,
            ...owner,
            createdAt: finding.detectedAt,
            dueAt:
              finding.severity === 'CRITICAL_REVIEW_REQUIRED'
                ? finding.detectedAt + 15 * 60_000
                : finding.severity === 'ACTION_REQUIRED'
                  ? finding.detectedAt + 4 * 60 * 60_000
                  : undefined,
            sourceRefs: [
              finding.findingId,
              ...finding.evidence.map((evidence) => evidence.entityId),
            ],
            lastSourceEventId: trigger?.eventId,
          },
          now
        )
      );
    }

    for (const code of patient360.dataQuality.missingCanonicalFacts) {
      active.push(
        item(
          {
            openItemId: stableId('open', [
              patientId,
              encounterId,
              'data-quality',
              code,
            ]),
            tenantId,
            patientId,
            encounterId,
            careSetting,
            category: 'DATA_QUALITY',
            description: `Clinical knowledge incomplete: ${code
              .replace(/_/g, ' ')
              .toLowerCase()}`,
            clinicalPriority: 'REVIEW_REQUIRED',
            ...owner,
            createdAt: patient360.projectedAt,
            sourceRefs: [code],
            lastSourceEventId: trigger?.eventId,
          },
          now
        )
      );
    }

    const existing = new Map(
      existingOpenItemsSnapshot.docs.map((doc) => [
        doc.id,
        doc.data() as ClinicalOpenItemProjection,
      ])
    );
    const activeIds = new Set(active.map((entry) => entry.openItemId));

    const writes: Array<{
      ref: DocumentReference;
      data: Record<string, unknown>;
    }> = [];
    for (const next of active) {
      const previous = existing.get(next.openItemId);
      const status =
        previous?.status === 'ACKNOWLEDGED'
          ? 'ACKNOWLEDGED'
          : previous?.status === 'RESOLVED' &&
              previous.resolutionMode === 'MANUAL'
            ? 'RESOLVED'
            : 'OPEN';
      const merged: ClinicalOpenItemProjection = {
        ...next,
        status,
        acknowledgedAt:
          status === 'ACKNOWLEDGED' ? previous?.acknowledgedAt : undefined,
        acknowledgedBy:
          status === 'ACKNOWLEDGED' ? previous?.acknowledgedBy : undefined,
        acknowledgementNote:
          status === 'ACKNOWLEDGED'
            ? previous?.acknowledgementNote
            : undefined,
        resolvedAt: status === 'RESOLVED' ? previous?.resolvedAt : undefined,
        resolvedBy: status === 'RESOLVED' ? previous?.resolvedBy : undefined,
        resolutionReason:
          status === 'RESOLVED' ? previous?.resolutionReason : undefined,
        resolutionRef:
          status === 'RESOLVED' ? previous?.resolutionRef : undefined,
        updatedAt: now,
      };
      writes.push({
        ref: tenantRef.collection('clinicalOpenItems').doc(next.openItemId),
        data: sanitizeForFirestore(merged) as unknown as Record<string, unknown>,
      });
    }

    for (const [openItemId, previous] of existing) {
      if (
        previous.generatedBy !== 'CONSULTANT_ATTENTION_PROJECTION' ||
        activeIds.has(openItemId) ||
        previous.status === 'RESOLVED'
      ) {
        continue;
      }
      writes.push({
        ref: tenantRef.collection('clinicalOpenItems').doc(openItemId),
        data: sanitizeForFirestore({
          ...previous,
          status: 'RESOLVED',
          resolvedAt: now,
          resolvedBy: 'SYSTEM_PROJECTION',
          resolutionReason:
            'Authoritative source state no longer indicates an unresolved item.',
          resolutionRef: trigger?.eventId,
          updatedAt: now,
        }),
      });
    }

    const escalationRef = tenantRef
      .collection('clinicalEscalations')
      .doc(`esc_${encounterId}`);
    const currentEscalation = existingEscalationSnapshot.exists
      ? (existingEscalationSnapshot.data() as ClinicalEscalationProjection)
      : null;

    if (
      deterioration &&
      ['ESCALATION_REQUIRED', 'CRITICAL_REVIEW_REQUIRED'].includes(
        deterioration.state
      )
    ) {
      const severity =
        deterioration.state === 'CRITICAL_REVIEW_REQUIRED'
          ? 'CRITICAL_REVIEW_REQUIRED'
          : 'ACTION_REQUIRED';
      const sameEvaluation = currentEscalation?.sourceRefs?.includes(
        deterioration.evaluationId
      );
      const nextEscalation: ClinicalEscalationProjection = {
        escalationId: `esc_${encounterId}`,
        tenantId,
        patientId,
        encounterId,
        careSetting,
        severity,
        state:
          sameEvaluation &&
          currentEscalation?.state === 'ACKNOWLEDGED'
            ? 'ACKNOWLEDGED'
            : owner.ownerId
              ? 'DELIVERED'
              : 'DETECTED',
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        sourceRefs: [deterioration.evaluationId],
        detectedAt: sameEvaluation
          ? currentEscalation?.detectedAt || deterioration.evaluatedAt
          : deterioration.evaluatedAt,
        dueAt:
          deterioration.evaluatedAt +
          (severity === 'CRITICAL_REVIEW_REQUIRED' ? 15 : 30) * 60_000,
        deliveredAt: owner.ownerId ? now : undefined,
        acknowledgedAt:
          sameEvaluation &&
          currentEscalation?.state === 'ACKNOWLEDGED'
            ? currentEscalation.acknowledgedAt
            : undefined,
        acknowledgedBy:
          sameEvaluation &&
          currentEscalation?.state === 'ACKNOWLEDGED'
            ? currentEscalation.acknowledgedBy
            : undefined,
        note:
          sameEvaluation &&
          currentEscalation?.state === 'ACKNOWLEDGED'
            ? currentEscalation.note
            : undefined,
        updatedAt: now,
      };
      writes.push({
        ref: escalationRef,
        data: sanitizeForFirestore(nextEscalation) as unknown as Record<string, unknown>,
      });
    } else if (
      currentEscalation &&
      currentEscalation.state !== 'RESOLVED'
    ) {
      writes.push({
        ref: escalationRef,
        data: sanitizeForFirestore({
          ...currentEscalation,
          state: 'RESOLVED',
          resolvedAt: now,
          updatedAt: now,
        }),
      });
    }

    for (let offset = 0; offset < writes.length; offset += 400) {
      const batch = db.batch();
      for (const write of writes.slice(offset, offset + 400)) {
        batch.set(write.ref, write.data);
      }
      await batch.commit();
    }
    return active;
  }

  public static async refreshFromEvent(
    event: ConsultantAttentionTriggerEvent
  ): Promise<ClinicalOpenItemProjection[]> {
    const db = getAdminFirestore();
    if (!db) throw new Error('CONSULTANT_ATTENTION_STORE_UNAVAILABLE');

    const payload = event.payload || {};
    const patientId = String(
      payload.patientId ||
        (String(event.aggregateType || '')
          .toUpperCase()
          .includes('PATIENT')
          ? event.aggregateId
          : '') ||
        ''
    ).trim();
    if (!patientId) return [];

    let encounterId = String(payload.encounterId || '').trim();
    if (!encounterId) {
      const projection = await Patient360ProjectionService.getProjection(
        event.tenantId,
        patientId
      );
      encounterId = String(
        projection?.careContexts.activeIpdEncounter?.encounterId ||
          projection?.careContexts.activeEmergencyEncounter?.encounterId ||
          projection?.careContexts.activeOpdEncounters[0]?.encounterId ||
          projection?.activeEncounter?.encounterId ||
          ''
      ).trim();
    }
    if (!encounterId) return [];

    const checkpointRef = db
      .collection('tenants')
      .doc(event.tenantId)
      .collection('consultantAttentionCheckpoints')
      .doc(event.eventId);
    const existing = await checkpointRef.get();
    if (existing.exists) {
      return [];
    }

    const items = await this.refreshEncounter(
      event.tenantId,
      patientId,
      encounterId,
      {
        eventId: event.eventId,
        eventType: event.eventType,
      }
    );

    await checkpointRef.set(
      sanitizeForFirestore({
        eventId: event.eventId,
        tenantId: event.tenantId,
        patientId,
        encounterId,
        openItemCount: items.length,
        processedAt: Date.now(),
      })
    );
    return items;
  }

  public static async rebuildTenantFromEvents(
    tenantId: string,
    events: ConsultantAttentionTriggerEvent[]
  ): Promise<number> {
    const scopes = new Map<string, { patientId: string; encounterId: string }>();
    for (const event of events) {
      const patientId = String(event.payload?.patientId || '').trim();
      const encounterId = String(event.payload?.encounterId || '').trim();
      if (patientId && encounterId) {
        scopes.set(`${patientId}:${encounterId}`, {
          patientId,
          encounterId,
        });
      }
    }

    let rebuilt = 0;
    for (const scope of scopes.values()) {
      await this.refreshEncounter(
        tenantId,
        scope.patientId,
        scope.encounterId,
        { eventType: 'CBE_REBUILD' }
      );
      rebuilt += 1;
    }
    return rebuilt;
  }

  public static async getWorklist(
    context: CommandContext
  ): Promise<ConsultantWorklist> {
    const db = getAdminFirestore();
    if (!db) throw new Error('CONSULTANT_ATTENTION_STORE_UNAVAILABLE');

    const roles = new Set(
      context.roles.map((role) => String(role).trim().toUpperCase())
    );
    const allowed = [
      'DOCTOR',
      'CONSULTANT',
      'ATTENDING_PHYSICIAN',
      'SYSTEM_ADMIN',
    ].some((role) => roles.has(role));
    if (!allowed) {
      throw new Error('CONSULTANT_WORKLIST_UNAUTHORIZED');
    }

    const departments = new Set(
      [
        ...(context.departmentIds || []),
        ...(context.departmentId ? [context.departmentId] : []),
      ]
        .map((item) => String(item).trim().toUpperCase())
        .filter(Boolean)
    );

    let rawItems: ClinicalOpenItemProjection[] = [];
    if (roles.has('SYSTEM_ADMIN')) {
      const [open, acknowledged] = await Promise.all([
        DomainStateRepository.queryAllEqual<ClinicalOpenItemProjection>(
          context.tenantId,
          'clinicalOpenItems',
          'status',
          'OPEN'
        ),
        DomainStateRepository.queryAllEqual<ClinicalOpenItemProjection>(
          context.tenantId,
          'clinicalOpenItems',
          'status',
          'ACKNOWLEDGED'
        ),
      ]);
      rawItems = [...open, ...acknowledged];
    } else {
      const ownershipKeys = Array.from(
        new Set([
          context.actorId,
          ...Array.from(departments),
          ...Array.from(roles),
        ])
      ).filter(Boolean);

      const ownershipRows = await Promise.all(
        ownershipKeys.map((ownerId) =>
          DomainStateRepository.queryAllEqual<ClinicalOpenItemProjection>(
            context.tenantId,
            'clinicalOpenItems',
            'ownerId',
            ownerId
          )
        )
      );
      const byId = new Map<string, ClinicalOpenItemProjection>();
      for (const entry of ownershipRows.flat()) {
        if (entry.status !== 'OPEN' && entry.status !== 'ACKNOWLEDGED') continue;
        byId.set(entry.openItemId, entry);
      }
      rawItems = [...byId.values()];
    }

    const items = rawItems
      .filter((entry) => {
        if (roles.has('SYSTEM_ADMIN')) return true;
        if (entry.ownerType === 'CONSULTANT') {
          return entry.ownerId === context.actorId;
        }
        if (entry.ownerType === 'DEPARTMENT' || entry.ownerType === 'CARE_TEAM') {
          const department = String(
            entry.ownerDepartmentId || entry.ownerId || ''
          ).toUpperCase();
          return Boolean(department && departments.has(department));
        }
        if (entry.ownerType === 'ROLE') {
          const role = String(entry.ownerRole || entry.ownerId || '').toUpperCase();
          return Boolean(role && roles.has(role));
        }
        return false;
      })
      .sort(
        (left, right) =>
          priorityRank(left.clinicalPriority) -
            priorityRank(right.clinicalPriority) ||
          Number(left.dueAt || Number.MAX_SAFE_INTEGER) -
            Number(right.dueAt || Number.MAX_SAFE_INTEGER) ||
          Number(left.createdAt || 0) - Number(right.createdAt || 0)
      );

    const worklistItems: ConsultantWorklistItem[] = items.map((entry) => ({
      openItemId: entry.openItemId,
      patientId: entry.patientId,
      encounterId: entry.encounterId,
      careSetting: entry.careSetting,
      category: entry.category,
      description: entry.description,
      clinicalPriority: entry.clinicalPriority,
      ownerType: entry.ownerType,
      ownerId: entry.ownerId,
      status: entry.status,
      createdAt: entry.createdAt,
      dueAt: entry.dueAt,
      acknowledgedAt: entry.acknowledgedAt,
      sourceRefs: entry.sourceRefs,
    }));

    return {
      tenantId: context.tenantId,
      consultantId: context.actorId,
      generatedAt: Date.now(),
      counts: {
        total: worklistItems.length,
        critical: worklistItems.filter(
          (entry) =>
            entry.clinicalPriority === 'CRITICAL_REVIEW_REQUIRED'
        ).length,
        actionRequired: worklistItems.filter(
          (entry) => entry.clinicalPriority === 'ACTION_REQUIRED'
        ).length,
        diagnostics: worklistItems.filter(
          (entry) => entry.category === 'DIAGNOSTIC'
        ).length,
        consultations: worklistItems.filter(
          (entry) => entry.category === 'CONSULTATION'
        ).length,
        handoffs: worklistItems.filter(
          (entry) => entry.category === 'HANDOFF'
        ).length,
        deterioration: worklistItems.filter(
          (entry) => entry.category === 'DETERIORATION'
        ).length,
      },
      items: worklistItems,
    };
  }
}
