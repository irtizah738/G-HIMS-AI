/**
 * Clinical Order Domain Service
 * Manages diagnostic orders, credential-gated prescriptions, and atomic
 * prescription-to-inventory dispensing.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { EncounterDomainService } from './encounter-domain-service';
import type { InventoryBalance } from '@/types/scm-domain';
import {
  buildCanonicalDiagnosticOrder,
  buildCanonicalMedicationDispense,
  buildCanonicalMedicationOrder,
} from '@/lib/clinical/canonical-fact-builders';

export interface PlaceOrderPayload {
  encounterId: string;
  patientId: string;
  orderType: 'LAB' | 'RADIOLOGY' | 'PROCEDURE';
  catalogCode: string;
  orderName: string;
  priority: 'STAT' | 'URGENT' | 'ROUTINE';
  clinicalIndication: string;
  estimatedCostMinorUnits: number;
}

export interface PrescribeMedicationPayload {
  encounterId: string;
  patientId: string;
  drugCode: string;
  drugName: string;
  dosage: string;
  route: string;
  frequency: string;
  durationDays: number;
  quantityPrescribed?: number;
  unitOfMeasure?: string;
  unitPriceMinorUnits?: number;
  inventoryItemId?: string;
  instructions?: string;
}

interface VersionedInventoryBalance extends InventoryBalance {
  _serverVersion?: number;
}

function isClosedEncounter(status: unknown): boolean {
  return ['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED'].includes(
    String(status || '').toUpperCase()
  );
}

export class ClinicalOrderDomainService {
  /**
   * Places a diagnostic order with clinical revenue lock evaluation.
   */
  public static async placeDiagnosticOrder(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: PlaceOrderPayload
  ): Promise<CommandResult> {
    const requiredPrivilege = payload.orderType === 'LAB' ? 'ORDER_LAB' : 'ORDER_RADIOLOGY';
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
      requiredPrivilege,
      allowBreakGlass: payload.priority === 'STAT',
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Not privileged to order diagnostics.' },
      };
    }

    const encounter = await EncounterDomainService.getAuthoritativeEncounter(
      context.tenantId,
      payload.encounterId
    );
    if (!encounter || String(encounter.patientId || '') !== payload.patientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_PATIENT_MISMATCH',
          message: 'Diagnostic orders require an existing encounter for the same patient.',
        },
      };
    }
    if (isClosedEncounter(encounter.status)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_ALREADY_CLOSED',
          message: 'Diagnostic orders cannot be added to a closed encounter.',
        },
      };
    }

    const orderId = `ord_${crypto.randomUUID()}`;
    const unlockStatus = payload.priority === 'STAT' ? 'UNLOCKED_STAT_OVERRIDE' : 'PENDING_PAYMENT_CLEARANCE';

    const domainState = {
      orderId,
      tenantId: context.tenantId,
      encounterId: payload.encounterId,
      patientId: payload.patientId,
      orderType: payload.orderType,
      catalogCode: payload.catalogCode,
      orderName: payload.orderName,
      priority: payload.priority,
      clinicalIndication: payload.clinicalIndication,
      status: 'PLACED',
      revenueLockStatus: unlockStatus,
      costMinorUnits: payload.estimatedCostMinorUnits,
      orderedBy: context.actorId,
      createdAt: Date.now(),
    };

    const canonicalOrder = buildCanonicalDiagnosticOrder({
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      orderId,
      actorId: context.actorId,
      orderType: payload.orderType,
      catalogCode: payload.catalogCode,
      orderName: payload.orderName,
      priority: payload.priority,
      clinicalIndication: payload.clinicalIndication,
      orderedAt: domainState.createdAt,
    });

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'DIAGNOSTIC_ORDER',
      aggregateId: orderId,
      eventType: 'INVESTIGATION_ORDERED',
      eventPayload: {
        orderId,
        encounterId: payload.encounterId,
        patientId: payload.patientId,
        catalogCode: payload.catalogCode,
        priority: payload.priority,
        canonicalDiagnosticOrderId: canonicalOrder.diagnosticOrderId,
      },
      auditAction: 'PLACE_DIAGNOSTIC_ORDER',
      auditResourceType: 'DIAGNOSTIC_ORDER',
      auditResourceId: orderId,
      auditReason: `Ordered ${payload.orderType} ${payload.orderName} (${payload.priority})`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState,
      additionalStateWrites: [
        {
          entityType: 'CANONICAL_DIAGNOSTIC_ORDER',
          entityId: canonicalOrder.diagnosticOrderId,
          domainState: canonicalOrder,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: orderId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: {
        ...domainState,
        canonicalDiagnosticOrderId: canonicalOrder.diagnosticOrderId,
      },
    };
  }

  public static async dispenseMedication(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      prescriptionId: string;
      quantityDispensed: number;
      batchNumber?: string;
      expiryDate?: string;
      dispensedByName?: string;
    }
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['PHARMACIST', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Licensed pharmacy authority required to dispense medication.',
        },
      };
    }

    if (
      !payload.prescriptionId ||
      !Number.isFinite(payload.quantityDispensed) ||
      payload.quantityDispensed <= 0
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_DISPENSE',
          message: 'Prescription identity and a positive dispense quantity are required.',
        },
      };
    }

    const prescription = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'prescriptions',
      payload.prescriptionId
    );

    if (!prescription) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'PRESCRIPTION_NOT_FOUND', message: 'Prescription was not found.' },
      };
    }
    if (String(prescription.status || '') !== 'PRESCRIBED') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PRESCRIPTION_STATE_CONFLICT',
          message: `Prescription is already ${String(prescription.status || 'UNKNOWN')}.`,
        },
      };
    }

    const patientId = String(prescription.patientId || '');
    const encounterId = String(prescription.encounterId || '');
    const itemId = String(prescription.inventoryItemId || prescription.drugCode || '');
    if (!patientId || !encounterId || !itemId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PRESCRIPTION_TRACEABILITY_INCOMPLETE',
          message: 'Prescription is missing patient, encounter, or inventory item identity.',
        },
      };
    }

    const [patient, encounter, balances] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(context.tenantId, 'patients', patientId),
      EncounterDomainService.getAuthoritativeEncounter(context.tenantId, encounterId),
      DomainStateRepository.queryEqual<VersionedInventoryBalance>(
        context.tenantId,
        'inventoryBalances',
        'itemId',
        itemId,
        200
      ),
    ]);

    if (!patient || !encounter || String(encounter.patientId || '') !== patientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PRESCRIPTION_ENCOUNTER_TRACEABILITY_CONFLICT',
          message: 'Prescription patient/encounter lineage could not be verified.',
        },
      };
    }
    if (isClosedEncounter(encounter.status)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_ALREADY_CLOSED',
          message: 'Medication cannot be dispensed against a closed encounter.',
        },
      };
    }

    const now = Date.now();
    const eligibleBalances = balances
      .filter((balance) => {
        const expiryMs = Date.parse(balance.expiryDate);
        return (
          balance.available >= payload.quantityDispensed &&
          Number.isFinite(expiryMs) &&
          expiryMs > now
        );
      })
      .sort((left, right) => {
        const expiryDelta = Date.parse(left.expiryDate) - Date.parse(right.expiryDate);
        if (expiryDelta !== 0) return expiryDelta;
        return String(left.batchNumber || '').localeCompare(String(right.batchNumber || ''));
      });

    const selectedBalance = eligibleBalances[0];
    if (!selectedBalance) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PHARMACY_STOCK_NOT_AVAILABLE',
          message: `No non-expired FEFO inventory batch has ${payload.quantityDispensed} units available for ${itemId}.`,
        },
      };
    }

    if (
      payload.batchNumber &&
      String(payload.batchNumber).trim() !== String(selectedBalance.batchNumber || '').trim()
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'FEFO_BATCH_MISMATCH',
          message: `Client-selected batch ${payload.batchNumber} is not the authoritative FEFO batch ${selectedBalance.batchNumber}.`,
        },
      };
    }
    if (
      payload.expiryDate &&
      String(payload.expiryDate).slice(0, 10) !== String(selectedBalance.expiryDate).slice(0, 10)
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'FEFO_EXPIRY_MISMATCH',
          message: 'Client-supplied expiry does not match the authoritative inventory batch.',
        },
      };
    }

    const quantity = payload.quantityDispensed;
    const dispensedAt = Date.now();
    const stockTransactionId = `stk_dispense_${crypto.randomUUID()}`;
    const consumptionId = `consume_${crypto.randomUUID()}`;
    const chargeId = `chg_rx_${crypto.randomUUID()}`;
    const unitPriceMinorUnits = Math.max(0, Number(prescription.unitPriceMinorUnits || 0));
    const amountMinorUnits = Math.round(unitPriceMinorUnits * quantity);

    const prescriptionState = {
      ...prescription,
      status: 'DISPENSED',
      quantityDispensed: quantity,
      batchId: selectedBalance.batchId,
      batchNumber: selectedBalance.batchNumber,
      expiryDate: selectedBalance.expiryDate,
      inventoryBalanceId: selectedBalance.balanceId,
      dispensedBy: context.actorId,
      dispensedByName: payload.dispensedByName,
      dispensedAt,
    };

    const inventoryState: VersionedInventoryBalance = {
      ...selectedBalance,
      onHand: Math.max(0, selectedBalance.onHand - quantity),
      available: Math.max(0, selectedBalance.available - quantity),
      totalValuation: Math.max(
        0,
        (selectedBalance.onHand - quantity) * selectedBalance.unitCost
      ),
      lastMovementAt: new Date(dispensedAt).toISOString(),
      version: Number(selectedBalance.version || 0) + 1,
    };

    const stockTransactionState = {
      transactionId: stockTransactionId,
      tenantId: context.tenantId,
      facilityId: selectedBalance.facilityId,
      itemId: selectedBalance.itemId,
      itemCode: selectedBalance.itemCode,
      itemName: selectedBalance.itemName,
      batchId: selectedBalance.batchId,
      batchNumber: selectedBalance.batchNumber,
      expirationDate: selectedBalance.expiryDate,
      fromLocationId: selectedBalance.locationId,
      fromLocationName: selectedBalance.locationName,
      quantity,
      uom: selectedBalance.uom,
      normalizedQuantity: quantity,
      unitCost: selectedBalance.unitCost,
      totalCost: quantity * selectedBalance.unitCost,
      currency: 'PKR',
      transactionType: 'DISPENSE',
      referenceType: 'PRESCRIPTION',
      referenceId: payload.prescriptionId,
      patientId,
      encounterId,
      performedBy: {
        userId: context.actorId,
        userName: payload.dispensedByName || context.actorId,
        role: context.roles[0] || 'PHARMACIST',
      },
      occurredAt: new Date(dispensedAt).toISOString(),
      recordedAt: new Date(dispensedAt).toISOString(),
      idempotencyKey,
      source: 'ONLINE',
    };

    const consumptionState = {
      consumptionId,
      tenantId: context.tenantId,
      patientId,
      patientMRN: String(patient.mrn || ''),
      patientName: String(patient.fullName || ''),
      encounterId,
      departmentId: String(encounter.departmentId || encounter.department || ''),
      departmentName: String(encounter.departmentId || encounter.department || ''),
      itemId: selectedBalance.itemId,
      itemCode: selectedBalance.itemCode,
      itemName: selectedBalance.itemName,
      itemType: selectedBalance.itemType,
      batchId: selectedBalance.batchId,
      batchNumber: selectedBalance.batchNumber,
      quantity,
      uom: selectedBalance.uom,
      consumedAt: new Date(dispensedAt).toISOString(),
      documentedBy: context.actorId,
      isImplant: false,
      sourcePrescriptionId: payload.prescriptionId,
    };

    const canonicalDispense = buildCanonicalMedicationDispense({
      tenantId: context.tenantId,
      patientId,
      encounterId,
      prescriptionId: payload.prescriptionId,
      actorId: context.actorId,
      drugCode: String(prescription.drugCode || itemId),
      drugName: String(prescription.drugName || selectedBalance.itemName),
      quantityDispensed: quantity,
      unitOfMeasure: String(prescription.unitOfMeasure || selectedBalance.uom || 'unit'),
      batchNumber: String(selectedBalance.batchNumber || ''),
      expiryDate: String(selectedBalance.expiryDate || ''),
      dispensedAt,
    });

    const chargeState = {
      chargeId,
      tenantId: context.tenantId,
      encounterId,
      patientId,
      category: 'PHARMACY',
      sourceType: 'PRESCRIPTION_DISPENSE',
      sourceId: payload.prescriptionId,
      serviceCode: String(prescription.drugCode || itemId),
      description: `${String(prescription.drugName || selectedBalance.itemName)} dispense`,
      quantity,
      unitPriceMinorUnits,
      amountMinorUnits,
      status: amountMinorUnits > 0 ? 'UNBILLED' : 'PRICE_PENDING',
      createdAt: dispensedAt,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'PHARMACIST',
      aggregateType: 'PRESCRIPTION',
      aggregateId: payload.prescriptionId,
      eventType: 'MEDICATION_DISPENSED',
      eventPayload: {
        prescriptionId: payload.prescriptionId,
        patientId,
        encounterId,
        quantityDispensed: quantity,
        inventoryBalanceId: selectedBalance.balanceId,
        batchId: selectedBalance.batchId,
        batchNumber: selectedBalance.batchNumber,
        expiryDate: selectedBalance.expiryDate,
        stockTransactionId,
        consumptionId,
        chargeId,
        amountMinorUnits,
        dispensedAt,
      },
      auditAction: 'DISPENSE_MEDICATION',
      auditResourceType: 'PRESCRIPTION',
      auditResourceId: payload.prescriptionId,
      auditReason: `Dispensed prescription ${payload.prescriptionId} from FEFO batch ${selectedBalance.batchNumber}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: prescriptionState,
      expectedPrimaryServerVersion: Number(prescription._serverVersion || 0),
      additionalStateWrites: [
        {
          entityType: 'INVENTORY_BALANCE',
          entityId: selectedBalance.balanceId,
          domainState: inventoryState,
          expectedServerVersion: Number(selectedBalance._serverVersion || 0),
        },
        {
          entityType: 'STOCK_TRANSACTION',
          entityId: stockTransactionId,
          domainState: stockTransactionState,
        },
        {
          entityType: 'PATIENT_CONSUMPTION',
          entityId: consumptionId,
          domainState: consumptionState,
        },
        {
          entityType: 'ENCOUNTER_CHARGE',
          entityId: chargeId,
          domainState: chargeState,
        },
        {
          entityType: 'MEDICATION_DISPENSE',
          entityId: canonicalDispense.medicationDispenseId,
          domainState: canonicalDispense,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.prescriptionId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        prescription: prescriptionState,
        inventoryBalance: inventoryState,
        stockTransaction: stockTransactionState,
        patientConsumption: consumptionState,
        charge: chargeState,
        canonicalMedicationDispense: canonicalDispense,
      },
    };
  }

  /**
   * Prescribes medication requiring explicit PRESCRIBE clinical privilege.
   */
  public static async prescribeMedication(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: PrescribeMedicationPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
      requiredPrivilege: 'PRESCRIBE',
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Active PRESCRIBE privilege required.' },
      };
    }

    const encounter = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'encounters',
      payload.encounterId
    );
    if (!encounter || String(encounter.patientId || '') !== payload.patientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_PATIENT_MISMATCH',
          message: 'Prescription requires an existing encounter for the same patient.',
        },
      };
    }
    if (isClosedEncounter(encounter.status)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_ALREADY_CLOSED',
          message: 'Medication cannot be prescribed against a closed encounter.',
        },
      };
    }

    const prescriptionId = `rx_${crypto.randomUUID()}`;
    const domainState = {
      prescriptionId,
      tenantId: context.tenantId,
      encounterId: payload.encounterId,
      patientId: payload.patientId,
      drugCode: payload.drugCode,
      drugName: payload.drugName,
      dosage: payload.dosage,
      route: payload.route,
      frequency: payload.frequency,
      durationDays: payload.durationDays,
      quantityPrescribed: payload.quantityPrescribed,
      unitOfMeasure: payload.unitOfMeasure,
      unitPriceMinorUnits: payload.unitPriceMinorUnits,
      inventoryItemId: payload.inventoryItemId || payload.drugCode,
      instructions: payload.instructions,
      prescribedBy: context.actorId,
      status: 'PRESCRIBED',
      createdAt: Date.now(),
    };

    const canonicalMedicationOrder = buildCanonicalMedicationOrder({
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      prescriptionId,
      actorId: context.actorId,
      drugCode: payload.drugCode,
      drugName: payload.drugName,
      dosage: payload.dosage,
      route: payload.route,
      frequency: payload.frequency,
      durationDays: payload.durationDays,
      quantityPrescribed: payload.quantityPrescribed,
      unitOfMeasure: payload.unitOfMeasure,
      instructions: payload.instructions,
      authoredAt: domainState.createdAt,
    });

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'PRESCRIPTION',
      aggregateId: prescriptionId,
      eventType: 'MEDICATION_PRESCRIBED',
      eventPayload: {
        prescriptionId,
        encounterId: payload.encounterId,
        patientId: payload.patientId,
        drugCode: payload.drugCode,
        drugName: payload.drugName,
        quantityPrescribed: payload.quantityPrescribed,
        canonicalMedicationOrderId: canonicalMedicationOrder.medicationOrderId,
      },
      auditAction: 'PRESCRIBE_MEDICATION',
      auditResourceType: 'PRESCRIPTION',
      auditResourceId: prescriptionId,
      auditReason: `Prescribed ${payload.drugName} ${payload.dosage} (${payload.route})`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState,
      additionalStateWrites: [
        {
          entityType: 'MEDICATION_ORDER',
          entityId: canonicalMedicationOrder.medicationOrderId,
          domainState: canonicalMedicationOrder,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: prescriptionId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: {
        ...domainState,
        canonicalMedicationOrderId: canonicalMedicationOrder.medicationOrderId,
      },
    };
  }
}
