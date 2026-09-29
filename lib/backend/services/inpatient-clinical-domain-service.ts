/**
 * G-HIMS inpatient clinical command service.
 *
 * This service removes React component state from the authoritative inpatient
 * record. UI pathway steps may remain richer than the domain model, but notes,
 * orders and medication administrations must persist through CommandBus.
 */

import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import type { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { buildCanonicalMedicationAdministration } from '@/lib/clinical/canonical-fact-builders';

interface PersistedEncounter {
  encounterId?: string;
  id?: string;
  patientId?: string;
  encounterType?: string;
  type?: string;
  status?: string;
}

export interface PlaceInpatientOrderPayload {
  encounterId: string;
  patientId: string;
  orderType: 'DIET' | 'ACTIVITY' | 'MEDICATION' | 'LAB' | 'IMAGING' | 'NURSING';
  description: string;
  priority?: 'ROUTINE' | 'URGENT' | 'STAT';
}

export interface RecordMedicationAdministrationPayload {
  encounterId: string;
  patientId: string;
  medicationId: string;
  medicationName: string;
  dose: string;
  route: string;
  status?: 'GIVEN' | 'HELD';
  administeredAt?: number;
  notes?: string;
}

function isActiveInpatientEncounter(encounter: PersistedEncounter | null, patientId: string): boolean {
  if (!encounter) return false;
  const encounterType = String(encounter.encounterType || encounter.type || '').toUpperCase();
  const status = String(encounter.status || '').toUpperCase();
  return (
    encounterType === 'IPD' &&
    String(encounter.patientId || '') === patientId &&
    ['ACTIVE', 'IN_PROGRESS', 'ADMITTED'].includes(status)
  );
}

export class InpatientClinicalDomainService {
  public static async placeOrder(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: PlaceInpatientOrderPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Inpatient order authority required.',
        },
      };
    }

    const description = String(payload.description || '').trim();
    if (!payload.encounterId || !payload.patientId || !description) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_INPATIENT_ORDER',
          message: 'Encounter, patient and order description are required.',
        },
      };
    }

    const encounter = await DomainStateRepository.getById<PersistedEncounter>(
      context.tenantId,
      'encounters',
      payload.encounterId
    );
    if (!isActiveInpatientEncounter(encounter, payload.patientId)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INPATIENT_ENCOUNTER_REQUIRED',
          message: 'Orders may only be placed against the active inpatient encounter for this patient.',
        },
      };
    }

    const now = Date.now();
    const orderId = `ipd_ord_${crypto.randomUUID()}`;
    const domainState = {
      orderId,
      tenantId: context.tenantId,
      encounterId: payload.encounterId,
      patientId: payload.patientId,
      orderType: payload.orderType,
      description,
      priority: payload.priority || 'ROUTINE',
      status: 'ACTIVE',
      orderedBy: context.actorId,
      orderedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    const tx = await TransactionManager.executeAtomicWrite(
      context,
      commandId,
      idempotencyKey,
      {
        entityType: 'INPATIENT_ORDER',
        entityId: orderId,
        eventType: 'INPATIENT_ORDER_PLACED',
        domainState,
        eventPayload: {
          orderId,
          encounterId: payload.encounterId,
          patientId: payload.patientId,
          orderType: payload.orderType,
          priority: payload.priority || 'ROUTINE',
        },
        auditReason: `Placed ${payload.orderType} inpatient order ${orderId}`,
        outboxTopic: 'g-hims-clinical-events',
      }
    );

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: orderId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: domainState,
    };
  }

  public static async recordMedicationAdministration(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordMedicationAdministrationPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['NURSE', 'DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Medication administration authority required.',
        },
      };
    }

    if (
      !payload.encounterId ||
      !payload.patientId ||
      !payload.medicationId ||
      !String(payload.medicationName || '').trim() ||
      !String(payload.dose || '').trim() ||
      !String(payload.route || '').trim()
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_MEDICATION_ADMINISTRATION',
          message: 'Encounter, patient, medication, dose and route are required.',
        },
      };
    }

    const encounter = await DomainStateRepository.getById<PersistedEncounter>(
      context.tenantId,
      'encounters',
      payload.encounterId
    );
    if (!isActiveInpatientEncounter(encounter, payload.patientId)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INPATIENT_ENCOUNTER_REQUIRED',
          message: 'Medication administration may only be recorded against the active inpatient encounter.',
        },
      };
    }

    const administeredAt = payload.administeredAt || Date.now();
    const administrationId = `medadm_${crypto.randomUUID()}`;
    const status = payload.status || 'GIVEN';
    const domainState = {
      administrationId,
      tenantId: context.tenantId,
      encounterId: payload.encounterId,
      patientId: payload.patientId,
      medicationId: payload.medicationId,
      medicationName: payload.medicationName,
      dose: payload.dose,
      route: payload.route,
      status,
      notes: payload.notes,
      administeredBy: context.actorId,
      administeredAt,
      createdAt: Date.now(),
    };

    const canonicalAdministration = buildCanonicalMedicationAdministration({
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      administrationId,
      actorId: context.actorId,
      medicationOrderId: payload.medicationId,
      medicationCode: payload.medicationId,
      medicationName: payload.medicationName,
      doseText: payload.dose,
      route: payload.route,
      status,
      administeredAt,
      notes: payload.notes,
    });

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'MEDICATION_ADMINISTRATION',
      aggregateId: administrationId,
      eventType:
        status === 'GIVEN'
          ? 'MEDICATION_ADMINISTERED'
          : 'MEDICATION_ADMINISTRATION_HELD',
      eventPayload: {
        administrationId,
        encounterId: payload.encounterId,
        patientId: payload.patientId,
        medicationId: payload.medicationId,
        status,
        administeredAt,
        canonicalMedicationAdministrationId: canonicalAdministration.medicationAdministrationId,
      },
      auditAction: status === 'GIVEN' ? 'ADMINISTER_MEDICATION' : 'HOLD_MEDICATION',
      auditResourceType: 'MEDICATION_ADMINISTRATION',
      auditResourceId: administrationId,
      auditReason: `${status === 'GIVEN' ? 'Administered' : 'Held'} medication ${payload.medicationName} for inpatient encounter ${payload.encounterId}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState,
      additionalStateWrites: [
        {
          entityType: 'CANONICAL_MEDICATION_ADMINISTRATION',
          entityId: canonicalAdministration.medicationAdministrationId,
          domainState: canonicalAdministration,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: administrationId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: {
        ...domainState,
        canonicalMedicationAdministrationId: canonicalAdministration.medicationAdministrationId,
      },
    };
  }
}
