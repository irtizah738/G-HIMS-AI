/**
 * G-HIMS authoritative Supply Chain domain service.
 * Offline SCM mutations replay through these same commands as online traffic.
 */
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { CommandContext, CommandResult } from '../types';
import type {
  InventoryBalance,
  StockTransaction,
  PatientConsumptionRecord,
  PurchaseRequisition,
} from '@/types/scm-domain';
import { calculateDerivedBalance } from '@/lib/supply-chain/scm-engine';

function authorized(context: CommandContext) {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: [
      'PHARMACIST',
      'INVENTORY_MANAGER',
      'PROCUREMENT_OFFICER',
      'STORE_KEEPER',
      'SYSTEM_ADMIN',
      'ADMINISTRATOR',
    ],
  });
}

export class SupplyChainDomainService {
  public static async recordStockTransaction(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Partial<StockTransaction> & { balanceId: string }
  ): Promise<CommandResult> {
    const auth = authorized(context);
    if (!auth.authorized) {
      return {
        success: false, commandId, idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Inventory authority required.' },
      };
    }

    if (!payload.balanceId || !payload.transactionType || !Number.isFinite(payload.quantity) || Number(payload.quantity) <= 0) {
      return {
        success: false, commandId, idempotencyKey,
        error: { code: 'INVALID_STOCK_TRANSACTION', message: 'balanceId, transactionType and a positive quantity are required.' },
      };
    }

    const balance = await DomainStateRepository.getById<InventoryBalance>(
      context.tenantId,
      'inventoryBalances',
      payload.balanceId
    );
    if (!balance) {
      return {
        success: false, commandId, idempotencyKey,
        error: { code: 'INVENTORY_BALANCE_NOT_FOUND', message: 'Authoritative inventory balance was not found.' },
      };
    }

    const nextBalance = calculateDerivedBalance(balance, payload);
    if (
      ['ISSUE','ADJUSTMENT_OUT','TRANSFER_OUT','CONSUMPTION','DISPENSE','WRITE_OFF'].includes(String(payload.transactionType)) &&
      Number(payload.quantity) > balance.available
    ) {
      return {
        success: false, commandId, idempotencyKey,
        error: { code: 'INSUFFICIENT_AVAILABLE_STOCK', message: 'Requested stock movement exceeds authoritative available quantity.' },
      };
    }

    const now = new Date().toISOString();
    const transactionId = String(payload.transactionId || `stx_${crypto.randomUUID()}`);
    const transaction: StockTransaction = {
      ...(payload as StockTransaction),
      transactionId,
      tenantId: context.tenantId,
      recordedAt: now,
      occurredAt: payload.occurredAt || now,
      performedBy: payload.performedBy || {
        userId: context.actorId,
        userName: context.actorId,
        role: context.roles[0] || 'AUTHENTICATED_USER',
      },
      idempotencyKey,
      source: context.offlineMutationId ? 'OFFLINE_SYNC' : 'ONLINE',
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'INVENTORY_MANAGER',
      aggregateType: 'STOCK_TRANSACTION',
      aggregateId: transactionId,
      eventType: 'STOCK_TRANSACTION_RECORDED',
      eventPayload: {
        transactionId,
        balanceId: payload.balanceId,
        itemId: transaction.itemId,
        transactionType: transaction.transactionType,
        quantity: transaction.quantity,
      },
      auditAction: 'STOCK_TRANSACTION_RECORDED',
      auditResourceType: 'INVENTORY',
      auditResourceId: payload.balanceId,
      auditReason: `Recorded ${transaction.transactionType} of ${transaction.quantity} for ${transaction.itemCode || transaction.itemId}`,
      outboxTopic: 'g-hims-supply-chain-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      causalVectorClock: context.offlineVectorClock,
      causalBaseEntityVersion: context.offlineBaseEntityVersion,
      domainState: transaction,
      additionalStateWrites: [
        {
          entityType: 'INVENTORY_BALANCE',
          entityId: payload.balanceId,
          domainState: nextBalance,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: transactionId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: { transaction, balance: nextBalance },
    };
  }

  public static async recordPatientConsumption(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: PatientConsumptionRecord
  ): Promise<CommandResult> {
    const auth = authorized(context);
    if (!auth.authorized) {
      return {
        success: false, commandId, idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Inventory authority required.' },
      };
    }

    const consumptionId = String((payload as any).consumptionId || `cons_${crypto.randomUUID()}`);
    if (!payload.patientId || !payload.encounterId || !payload.itemId) {
      return {
        success: false, commandId, idempotencyKey,
        error: { code: 'INVALID_PATIENT_CONSUMPTION', message: 'patientId, encounterId and itemId are required.' },
      };
    }

    const state = {
      ...payload,
      consumptionId,
      tenantId: context.tenantId,
      recordedBy: context.actorId,
      recordedAt: new Date().toISOString(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'PATIENT_CONSUMPTION',
      entityId: consumptionId,
      eventType: 'PATIENT_SUPPLY_CONSUMED',
      domainState: state,
      eventPayload: {
        consumptionId,
        patientId: payload.patientId,
        encounterId: payload.encounterId,
        itemId: payload.itemId,
        quantity: (payload as any).quantity,
      },
      auditReason: `Recorded patient-linked consumption ${consumptionId}`,
      outboxTopic: 'g-hims-supply-chain-events',
    });

    return {
      success: true, commandId, idempotencyKey, entityId: consumptionId,
      eventId: tx.event.eventId, auditId: tx.audit.auditId, outboxId: tx.outbox.outboxId,
      data: state,
    };
  }

  public static async submitRequisition(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: PurchaseRequisition
  ): Promise<CommandResult> {
    const auth = authorized(context);
    if (!auth.authorized) {
      return {
        success: false, commandId, idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Procurement authority required.' },
      };
    }

    const requisitionId = String((payload as any).requisitionId || `req_${crypto.randomUUID()}`);
    if (!Array.isArray((payload as any).items) || (payload as any).items.length === 0) {
      return {
        success: false, commandId, idempotencyKey,
        error: { code: 'INVALID_REQUISITION', message: 'At least one requisition item is required.' },
      };
    }

    const state = {
      ...payload,
      requisitionId,
      tenantId: context.tenantId,
      status: 'SUBMITTED',
      submittedBy: context.actorId,
      submittedAt: new Date().toISOString(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'PURCHASE_REQUISITION',
      entityId: requisitionId,
      eventType: 'INVENTORY_REQUISITION_SUBMITTED',
      domainState: state,
      eventPayload: { requisitionId, itemCount: (payload as any).items.length },
      auditReason: `Submitted inventory requisition ${requisitionId}`,
      outboxTopic: 'g-hims-supply-chain-events',
    });

    return {
      success: true, commandId, idempotencyKey, entityId: requisitionId,
      eventId: tx.event.eventId, auditId: tx.audit.auditId, outboxId: tx.outbox.outboxId,
      data: state,
    };
  }
}
