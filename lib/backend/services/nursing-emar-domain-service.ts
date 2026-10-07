import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { AdditionalStateWrite } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { MedicationOrder, CarePlan } from '@/types/clinical-canonical';
import type { ClinicalOpenItemProjection } from '@/types/consultant-visibility';
import type {
  EmarScheduleSlot,
  MedicationAdministrationOutcome,
  NursingCarePlanRecord,
} from '@/types/wave2-clinical-domains';
import { buildCanonicalMedicationAdministration } from '@/lib/clinical/canonical-fact-builders';
import {
  clinicianAuthorization,
  loadWave2ScopedEncounter,
  nurseAuthorization,
  uniqueWave2Strings,
  wave2Failure,
} from './wave2-clinical-common';

export interface ScheduleMedicationAdministrationPayload {
  patientId: string;
  encounterId: string;
  medicationOrderId: string;
  scheduledFor: number;
  toleranceMinutes?: number;
}

export interface AdministerScheduledMedicationPayload {
  patientId: string;
  encounterId: string;
  emarSlotId: string;
  outcome: MedicationAdministrationOutcome;
  administeredAt?: number;
  reason?: string;
  expectedMedicationOrderVersion?: number;
}

export interface CreateNursingCarePlanPayload {
  patientId: string;
  encounterId: string;
  title: string;
  problems?: string[];
  goals: string[];
  interventions: Array<{
    description: string;
    scheduledAt?: number;
  }>;
}

export interface UpdateNursingCarePlanInterventionPayload {
  patientId: string;
  encounterId: string;
  carePlanId: string;
  interventionId: string;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

function medicationLabel(order: MedicationOrder): string {
  return String(
    order.medication.text ||
      order.medication.codings?.[0]?.display ||
      order.medication.codings?.[0]?.code ||
      order.medicationOrderId
  ).trim();
}

function medicationRoute(order: MedicationOrder): string {
  return String(
    order.route?.text ||
      order.route?.codings?.[0]?.display ||
      order.route?.codings?.[0]?.code ||
      ''
  ).trim();
}

export class NursingEmarDomainService {
  public static async scheduleMedication(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ScheduleMedicationAdministrationPayload
  ): Promise<CommandResult> {
    const auth = clinicianAuthorization(context);
    if (!auth.authorized) {
      return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Medication schedule authority is required.');
    }
    const scoped = await loadWave2ScopedEncounter(
      context,
      payload.patientId,
      payload.encounterId,
      { requireInpatient: true }
    );
    if ('error' in scoped) {
      return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);
    }

    const order = await DomainStateRepository.getById<MedicationOrder>(
      context.tenantId,
      'medicationOrders',
      payload.medicationOrderId
    );
    if (
      !order ||
      order.patientId !== payload.patientId ||
      order.encounterId !== payload.encounterId ||
      order.status !== 'ACTIVE'
    ) {
      return wave2Failure(
        commandId,
        idempotencyKey,
        'EMAR_ACTIVE_MEDICATION_ORDER_REQUIRED',
        'eMAR scheduling requires an active medication order for the same patient encounter.'
      );
    }

    if (!Number.isSafeInteger(payload.scheduledFor) || payload.scheduledFor <= 0) {
      return wave2Failure(commandId, idempotencyKey, 'EMAR_SCHEDULE_TIME_INVALID', 'A valid medication administration time is required.');
    }
    const toleranceMinutes = payload.toleranceMinutes ?? 60;
    if (!Number.isInteger(toleranceMinutes) || toleranceMinutes < 5 || toleranceMinutes > 240) {
      return wave2Failure(commandId, idempotencyKey, 'EMAR_TOLERANCE_INVALID', 'eMAR tolerance must be between 5 and 240 minutes.');
    }

    const emarSlotId = `emar_${payload.medicationOrderId}_${payload.scheduledFor}`;
    const existing = await DomainStateRepository.getById<EmarScheduleSlot>(
      context.tenantId,
      'emarScheduleSlots',
      emarSlotId
    );
    if (existing) {
      return wave2Failure(commandId, idempotencyKey, 'EMAR_SLOT_ALREADY_EXISTS', 'This medication order already has an eMAR slot for the selected time.');
    }

    const now = Date.now();
    const slot: EmarScheduleSlot = {
      emarSlotId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      medicationOrderId: order.medicationOrderId,
      scheduledFor: payload.scheduledFor,
      toleranceMinutes,
      status: 'DUE',
      createdBy: context.actorId,
      createdAt: now,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'EMAR_SCHEDULE_SLOT',
      aggregateId: emarSlotId,
      eventType: 'EMAR_MEDICATION_SLOT_SCHEDULED',
      eventPayload: {
        emarSlotId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        medicationOrderId: order.medicationOrderId,
        medicationName: medicationLabel(order),
        scheduledFor: payload.scheduledFor,
        toleranceMinutes,
      },
      auditAction: 'SCHEDULE_MEDICATION_ADMINISTRATION',
      auditResourceType: 'MEDICATION_ORDER',
      auditResourceId: order.medicationOrderId,
      auditReason: 'Created authoritative eMAR administration slot.',
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: slot,
      expectedPrimaryServerVersion: 0,
    });

    return { success: true, commandId, idempotencyKey, entityId: emarSlotId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: slot };
  }

  public static async administerMedication(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: AdministerScheduledMedicationPayload
  ): Promise<CommandResult> {
    const auth = nurseAuthorization(context);
    if (!auth.authorized) {
      return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Medication administration authority is required.');
    }
    const scoped = await loadWave2ScopedEncounter(
      context,
      payload.patientId,
      payload.encounterId,
      { requireInpatient: true }
    );
    if ('error' in scoped) {
      return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);
    }

    const slot = await DomainStateRepository.getById<EmarScheduleSlot>(
      context.tenantId,
      'emarScheduleSlots',
      payload.emarSlotId
    );
    if (
      !slot ||
      slot.patientId !== payload.patientId ||
      slot.encounterId !== payload.encounterId ||
      slot.status !== 'DUE'
    ) {
      return wave2Failure(commandId, idempotencyKey, 'EMAR_SLOT_NOT_DUE', 'Only a due eMAR slot for this patient encounter may be actioned.');
    }

    const order = await DomainStateRepository.getById<MedicationOrder>(
      context.tenantId,
      'medicationOrders',
      slot.medicationOrderId
    );
    if (
      !order ||
      order.patientId !== payload.patientId ||
      order.encounterId !== payload.encounterId ||
      order.status !== 'ACTIVE'
    ) {
      return wave2Failure(commandId, idempotencyKey, 'EMAR_ORDER_STALE_OR_STOPPED', 'Medication order is missing, stopped, or outside the active encounter. Refresh before administration.');
    }

    const orderVersion = Number((order as unknown as Record<string, unknown>)._serverVersion || 0);
    if (
      payload.expectedMedicationOrderVersion !== undefined &&
      payload.expectedMedicationOrderVersion !== orderVersion
    ) {
      return wave2Failure(commandId, idempotencyKey, 'EMAR_ORDER_VERSION_CONFLICT', 'Medication order changed after bedside review. Refresh eMAR before proceeding.');
    }

    const administeredAt = payload.administeredAt || Date.now();
    const allowedVarianceMs = slot.toleranceMinutes * 60_000;
    if (
      payload.outcome === 'GIVEN' &&
      Math.abs(administeredAt - slot.scheduledFor) > allowedVarianceMs
    ) {
      return wave2Failure(commandId, idempotencyKey, 'EMAR_RIGHT_TIME_FAILED', 'Administration falls outside the authorized medication time window. Record a delayed dose with reason or obtain a new schedule slot.');
    }

    const reason = String(payload.reason || '').trim();
    if (payload.outcome !== 'GIVEN' && reason.length < 5) {
      return wave2Failure(commandId, idempotencyKey, 'EMAR_EXCEPTION_REASON_REQUIRED', 'Held, refused, missed, and delayed doses require an explicit reason.');
    }

    const administrationId = `medadm_${slot.emarSlotId}`;
    const existingAdministration = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'medicationAdministrations',
      administrationId
    );
    if (existingAdministration) {
      return wave2Failure(commandId, idempotencyKey, 'EMAR_DUPLICATE_ADMINISTRATION', 'This scheduled medication slot already has an administration outcome.');
    }

    const medicationName = medicationLabel(order);
    const route = medicationRoute(order);
    if (!medicationName || !order.dosageText || !route) {
      return wave2Failure(commandId, idempotencyKey, 'EMAR_ORDER_INCOMPLETE', 'Medication order is missing medication, dose, or route required for five-rights verification.');
    }

    const now = Date.now();
    const domainState = {
      administrationId,
      emarSlotId: slot.emarSlotId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      medicationOrderId: order.medicationOrderId,
      medicationName,
      dose: order.dosageText,
      route,
      scheduledFor: slot.scheduledFor,
      toleranceMinutes: slot.toleranceMinutes,
      status: payload.outcome,
      reason: payload.outcome === 'GIVEN' ? undefined : reason,
      administeredBy: context.actorId,
      administeredAt,
      fiveRights: {
        rightPatient: true,
        rightMedication: true,
        rightDose: true,
        rightRoute: true,
        rightTime: payload.outcome === 'GIVEN'
          ? Math.abs(administeredAt - slot.scheduledFor) <= allowedVarianceMs
          : false,
      },
      medicationOrderVersion: orderVersion,
      createdAt: now,
      updatedAt: now,
    };

    const canonicalAdministration = buildCanonicalMedicationAdministration({
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      administrationId,
      actorId: context.actorId,
      medicationOrderId: order.medicationOrderId,
      medicationCode: order.medication.codings?.[0]?.code || order.medicationOrderId,
      medicationName,
      doseText: order.dosageText,
      route,
      status: payload.outcome === 'GIVEN' ? 'GIVEN' : 'HELD',
      administeredAt,
      notes: payload.outcome === 'GIVEN' ? undefined : `${payload.outcome}: ${reason}`,
    });

    const nextSlot: EmarScheduleSlot = {
      ...slot,
      status: payload.outcome === 'GIVEN' ? 'ADMINISTERED' : payload.outcome,
      updatedAt: now,
    };

    const additionalStateWrites: AdditionalStateWrite[] = [
      {
        entityType: 'CANONICAL_MEDICATION_ADMINISTRATION',
        entityId: canonicalAdministration.medicationAdministrationId,
        domainState: canonicalAdministration,
        expectedServerVersion: 0,
      },
      {
        entityType: 'EMAR_SCHEDULE_SLOT',
        entityId: slot.emarSlotId,
        domainState: nextSlot,
        expectedServerVersion: Number((slot as unknown as Record<string, unknown>)._serverVersion || 0),
      },
    ];

    if (payload.outcome !== 'GIVEN') {
      const openItemId = `open_emar_${slot.emarSlotId}`;
      const openItem: ClinicalOpenItemProjection = {
        openItemId,
        tenantId: context.tenantId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        careSetting: 'IPD',
        category: 'MEDICATION',
        description: `${medicationName} ${order.dosageText} ${route}: ${payload.outcome.toLowerCase()} — ${reason}`,
        clinicalPriority:
          payload.outcome === 'MISSED' || payload.outcome === 'REFUSED'
            ? 'ACTION_REQUIRED'
            : 'REVIEW_REQUIRED',
        ownerType: 'ROLE',
        ownerId: 'DOCTOR',
        ownerRole: 'DOCTOR',
        status: 'OPEN',
        resolutionMode: 'MANUAL',
        createdAt: now,
        dueAt: now + (payload.outcome === 'MISSED' ? 30 : 120) * 60_000,
        sourceRefs: [administrationId, order.medicationOrderId, slot.emarSlotId],
        generatedBy: 'WAVE2_EMAR',
        updatedAt: now,
      };
      additionalStateWrites.push({
        entityType: 'CLINICAL_OPEN_ITEM',
        entityId: openItemId,
        domainState: openItem,
        expectedServerVersion: 0,
      });
    }

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'NURSE',
      aggregateType: 'MEDICATION_ADMINISTRATION',
      aggregateId: administrationId,
      eventType:
        payload.outcome === 'GIVEN'
          ? 'MEDICATION_ADMINISTERED'
          : `MEDICATION_ADMINISTRATION_${payload.outcome}`,
      eventPayload: {
        administrationId,
        emarSlotId: slot.emarSlotId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        medicationOrderId: order.medicationOrderId,
        medicationName,
        dose: order.dosageText,
        route,
        scheduledFor: slot.scheduledFor,
        administeredAt,
        outcome: payload.outcome,
        reason: payload.outcome === 'GIVEN' ? undefined : reason,
        fiveRights: domainState.fiveRights,
      },
      auditAction:
        payload.outcome === 'GIVEN'
          ? 'ADMINISTER_MEDICATION'
          : 'RECORD_MEDICATION_ADMINISTRATION_EXCEPTION',
      auditResourceType: 'MEDICATION_ADMINISTRATION',
      auditResourceId: administrationId,
      auditReason:
        payload.outcome === 'GIVEN'
          ? `Administered ordered medication ${medicationName}.`
          : `${payload.outcome}: ${reason}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState,
      expectedPrimaryServerVersion: 0,
      additionalStateWrites,
    });

    return { success: true, commandId, idempotencyKey, entityId: administrationId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: domainState };
  }

  public static async rejectLegacyAdministration(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string
  ): Promise<CommandResult> {
    void context;
    return wave2Failure(
      commandId,
      idempotencyKey,
      'EMAR_SCHEDULED_COMMAND_REQUIRED',
      'Direct client-authored medication administration is retired. Use an authoritative eMAR schedule slot and AdministerScheduledMedicationCommand.'
    );
  }

  public static async createCarePlan(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreateNursingCarePlanPayload
  ): Promise<CommandResult> {
    const auth = nurseAuthorization(context);
    if (!auth.authorized) {
      return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Nursing care-plan authority is required.');
    }
    const scoped = await loadWave2ScopedEncounter(
      context,
      payload.patientId,
      payload.encounterId,
      { requireInpatient: true }
    );
    if ('error' in scoped) {
      return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);
    }

    const title = String(payload.title || '').trim();
    const goals = uniqueWave2Strings(payload.goals, 100);
    const interventions = (payload.interventions || [])
      .map((item) => ({
        description: String(item.description || '').trim(),
        scheduledAt: item.scheduledAt,
      }))
      .filter((item) => item.description)
      .slice(0, 100);
    if (!title || goals.length === 0 || interventions.length === 0) {
      return wave2Failure(commandId, idempotencyKey, 'NURSING_CARE_PLAN_INVALID', 'Care plan requires title, goals, and interventions.');
    }

    const now = Date.now();
    const carePlanId = `ncp_${crypto.randomUUID()}`;
    const record: NursingCarePlanRecord = {
      carePlanId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      title,
      problems: uniqueWave2Strings(payload.problems, 100),
      goals,
      interventions: interventions.map((item, index) => ({
        interventionId: `${carePlanId}_int_${index + 1}`,
        description: item.description,
        status: 'NOT_STARTED',
        scheduledAt: item.scheduledAt,
      })),
      status: 'ACTIVE',
      authoredBy: context.actorId,
      authoredAt: now,
      updatedAt: now,
    };

    const canonical: CarePlan = {
      carePlanId,
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      sourceEvidenceId: carePlanId,
      provenance: {
        provenanceId: `prov_${carePlanId}`,
        tenantId: context.tenantId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        sourceEvidenceId: carePlanId,
        sourceType: 'NURSE',
        recordedBy: context.actorId,
        recordedAt: now,
      },
      createdAt: now,
      updatedAt: now,
      version: 1,
      status: 'ACTIVE',
      intent: 'PLAN',
      title,
      description: record.problems.join('; ') || undefined,
      addressesConditionIds: [],
      activities: record.interventions.map((item) => ({
        activityId: item.interventionId,
        description: item.description,
        status: 'NOT_STARTED',
        scheduledAt: item.scheduledAt,
        responsibleRole: 'NURSE',
      })),
      authoredBy: context.actorId,
      authoredAt: now,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'NURSE',
      aggregateType: 'NURSING_CARE_PLAN',
      aggregateId: carePlanId,
      eventType: 'NURSING_CARE_PLAN_CREATED',
      eventPayload: {
        carePlanId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        title,
        goalCount: goals.length,
        interventionCount: record.interventions.length,
      },
      auditAction: 'CREATE_NURSING_CARE_PLAN',
      auditResourceType: 'NURSING_CARE_PLAN',
      auditResourceId: carePlanId,
      auditReason: 'Created inpatient nursing care plan.',
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: record,
      expectedPrimaryServerVersion: 0,
      additionalStateWrites: [
        {
          entityType: 'CARE_PLAN',
          entityId: carePlanId,
          domainState: canonical,
          expectedServerVersion: 0,
        },
      ],
    });

    return { success: true, commandId, idempotencyKey, entityId: carePlanId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: record };
  }

  public static async updateCarePlanIntervention(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: UpdateNursingCarePlanInterventionPayload
  ): Promise<CommandResult> {
    const auth = nurseAuthorization(context);
    if (!auth.authorized) {
      return wave2Failure(commandId, idempotencyKey, auth.code || 'UNAUTHORIZED', auth.reason || 'Nursing care-plan authority is required.');
    }
    const scoped = await loadWave2ScopedEncounter(
      context,
      payload.patientId,
      payload.encounterId,
      { requireInpatient: true }
    );
    if ('error' in scoped) {
      return wave2Failure(commandId, idempotencyKey, scoped.error.code, scoped.error.message);
    }

    const [record, canonical] = await Promise.all([
      DomainStateRepository.getById<NursingCarePlanRecord>(context.tenantId, 'nursingCarePlans', payload.carePlanId),
      DomainStateRepository.getById<CarePlan>(context.tenantId, 'carePlans', payload.carePlanId),
    ]);
    if (
      !record ||
      record.patientId !== payload.patientId ||
      record.encounterId !== payload.encounterId ||
      record.status !== 'ACTIVE' ||
      !canonical
    ) {
      return wave2Failure(commandId, idempotencyKey, 'NURSING_CARE_PLAN_NOT_ACTIVE', 'Active nursing care plan for this patient encounter is required.');
    }
    const current = record.interventions.find((item) => item.interventionId === payload.interventionId);
    if (!current) {
      return wave2Failure(commandId, idempotencyKey, 'NURSING_INTERVENTION_NOT_FOUND', 'Intervention is not part of the selected care plan.');
    }

    const now = Date.now();
    const nextRecord: NursingCarePlanRecord = {
      ...record,
      interventions: record.interventions.map((item) =>
        item.interventionId === payload.interventionId
          ? {
              ...item,
              status: payload.status,
              completedAt: payload.status === 'COMPLETED' ? now : item.completedAt,
            }
          : item
      ),
      updatedAt: now,
    };
    const allClosed = nextRecord.interventions.every((item) =>
      ['COMPLETED', 'CANCELLED'].includes(item.status)
    );
    if (allClosed) nextRecord.status = 'COMPLETED';

    const nextCanonical: CarePlan = {
      ...canonical,
      status: allClosed ? 'COMPLETED' : canonical.status,
      activities: canonical.activities.map((item) =>
        item.activityId === payload.interventionId
          ? {
              ...item,
              status: payload.status,
              completedAt: payload.status === 'COMPLETED' ? now : item.completedAt,
            }
          : item
      ),
      updatedAt: now,
      version: Number(canonical.version || 1) + 1,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'NURSE',
      aggregateType: 'NURSING_CARE_PLAN',
      aggregateId: record.carePlanId,
      eventType: 'NURSING_CARE_PLAN_INTERVENTION_UPDATED',
      eventPayload: {
        carePlanId: record.carePlanId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        interventionId: payload.interventionId,
        previousStatus: current.status,
        status: payload.status,
      },
      auditAction: 'UPDATE_NURSING_CARE_PLAN',
      auditResourceType: 'NURSING_CARE_PLAN',
      auditResourceId: record.carePlanId,
      auditReason: `Updated nursing intervention ${payload.interventionId} to ${payload.status}.`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: nextRecord,
      expectedPrimaryServerVersion: Number((record as unknown as Record<string, unknown>)._serverVersion || 0),
      additionalStateWrites: [{
        entityType: 'CARE_PLAN',
        entityId: canonical.carePlanId,
        domainState: nextCanonical,
        expectedServerVersion: Number((canonical as unknown as Record<string, unknown>)._serverVersion || 0),
      }],
    });

    return { success: true, commandId, idempotencyKey, entityId: record.carePlanId, eventId: tx.eventId, auditId: tx.auditId, outboxId: tx.outboxId, data: nextRecord };
  }
}
