/**
 * Clinical Order Domain Service
 * Manages Diagnostic Orders (LIS/RIS), Revenue Gating, and Credential-Gated Prescriptions.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';

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
  instructions?: string;
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
      isEmergencyOverride: payload.priority === 'STAT',
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Not privileged to order diagnostics.' },
      };
    }

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    // Revenue Lock: STAT orders are automatically unlocked; ROUTINE orders require cashier clearance
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

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'DIAGNOSTIC_ORDER',
      entityId: orderId,
      eventType: 'INVESTIGATION_ORDERED',
      domainState,
      eventPayload: {
        orderId,
        encounterId: payload.encounterId,
        patientId: payload.patientId,
        catalogCode: payload.catalogCode,
        priority: payload.priority,
      },
      auditReason: `Ordered ${payload.orderType} ${payload.orderName} (${payload.priority})`,
      outboxTopic: 'g-hims-clinical-events',
    });

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

    const prescriptionId = `rx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
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
      instructions: payload.instructions,
      prescribedBy: context.actorId,
      status: 'PRESCRIBED',
      createdAt: Date.now(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'PRESCRIPTION',
      entityId: prescriptionId,
      eventType: 'MEDICATION_PRESCRIBED',
      domainState,
      eventPayload: {
        prescriptionId,
        encounterId: payload.encounterId,
        patientId: payload.patientId,
        drugCode: payload.drugCode,
        drugName: payload.drugName,
      },
      auditReason: `Prescribed ${payload.drugName} ${payload.dosage} (${payload.route})`,
      outboxTopic: 'g-hims-clinical-events',
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: prescriptionId,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: domainState,
    };
  }
}
