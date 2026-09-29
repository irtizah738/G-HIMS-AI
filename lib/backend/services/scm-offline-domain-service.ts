import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import type {
  InventoryBalance,
  PatientConsumptionRecord,
  PurchaseRequisition,
  StockTransaction,
} from '@/types/scm-domain';
import { calculateDerivedBalance } from '@/lib/supply-chain/scm-engine';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';

function stockBalanceId(tenantId: string, txn: StockTransaction): string {
  const facilityId = txn.facilityId || 'FAC-MAIN';
  const targetLoc = txn.toLocationId || txn.fromLocationId || 'loc-central';
  const batchId = txn.batchId || 'batch-gen';
  return `${tenantId}_${facilityId}_${targetLoc}_${txn.itemId}_${batchId}`;
}

export class ScmOfflineDomainService {
  public static async recordStockTransaction(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Record<string, unknown>
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['PHARMACIST', 'SCM_MANAGER', 'INVENTORY_OFFICER', 'SYSTEM_ADMIN', 'ADMINISTRATOR'],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Inventory transaction authority required.',
        },
      };
    }

    const txn = payload as unknown as StockTransaction;
    if (!txn.transactionId || !txn.itemId || !txn.transactionType || !(txn.quantity > 0)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'INVALID_STOCK_TRANSACTION', message: 'Stock transaction identity, item, type and positive quantity are required.' },
      };
    }

    const balanceId = stockBalanceId(context.tenantId, txn);
    const current = await DomainStateRepository.getById<InventoryBalance>(
      context.tenantId,
      'inventoryBalances',
      balanceId
    );

    const targetLoc = txn.toLocationId || txn.fromLocationId || 'loc-central';
    const base: InventoryBalance = current || {
      balanceId,
      tenantId: context.tenantId,
      facilityId: txn.facilityId || 'FAC-MAIN',
      locationId: targetLoc,
      locationName: txn.toLocationName || txn.fromLocationName || 'Hospital Store',
      itemId: txn.itemId,
      itemCode: txn.itemCode,
      itemName: txn.itemName,
      itemType: 'MEDICAL_CONSUMABLE',
      batchId: txn.batchId || 'batch-gen',
      batchNumber: txn.batchNumber || 'N/A',
      expiryDate: txn.expirationDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      onHand: 0,
      reserved: 0,
      quarantined: 0,
      damaged: 0,
      expired: 0,
      inTransit: 0,
      available: 0,
      uom: txn.uom,
      minimumStock: 0,
      maximumStock: 0,
      reorderPoint: 0,
      unitCost: txn.unitCost || 0,
      totalValuation: 0,
      lastMovementAt: new Date().toISOString(),
      version: 0,
    };

    if (
      ['ISSUE','ADJUSTMENT_OUT','TRANSFER_OUT','CONSUMPTION','DISPENSE','WRITE_OFF'].includes(txn.transactionType) &&
      base.available < txn.quantity
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVENTORY_STATE_CONFLICT',
          message: `Available stock ${base.available} is below requested quantity ${txn.quantity}.`,
        },
      };
    }

    const canonicalTxn: StockTransaction = {
      ...txn,
      tenantId: context.tenantId,
      performedBy: {
        ...(txn.performedBy || { userId: context.actorId, userName: context.actorId, role: context.roles[0] || 'AUTHENTICATED_USER' }),
        userId: context.actorId,
        role: context.roles[0] || txn.performedBy?.role || 'AUTHENTICATED_USER',
      },
      idempotencyKey,
      source: 'OFFLINE_SYNC',
      recordedAt: new Date().toISOString(),
    };
    const nextBalance = calculateDerivedBalance(base, canonicalTxn);

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'AUTHENTICATED_USER',
      aggregateType: 'STOCK_TRANSACTION',
      aggregateId: canonicalTxn.transactionId,
      eventType: 'STOCK_TRANSACTION_RECORDED',
      eventPayload: {
        transactionId: canonicalTxn.transactionId,
        itemId: canonicalTxn.itemId,
        quantity: canonicalTxn.quantity,
        transactionType: canonicalTxn.transactionType,
        balanceId,
      },
      auditAction: 'STOCK_TRANSACTION_RECORDED',
      auditResourceType: 'STOCK_TRANSACTION',
      auditResourceId: canonicalTxn.transactionId,
      auditReason: `${canonicalTxn.transactionType} ${canonicalTxn.quantity} ${canonicalTxn.uom} ${canonicalTxn.itemName}`,
      outboxTopic: 'g-hims-scm-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: canonicalTxn,
      additionalStateWrites: [
        { entityType: 'INVENTORY_BALANCE', entityId: balanceId, domainState: nextBalance },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: canonicalTxn.transactionId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: { transaction: canonicalTxn, balance: nextBalance },
    };
  }

  public static async recordPatientConsumption(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Record<string, unknown>
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['NURSE', 'DOCTOR', 'CONSULTANT', 'PHARMACIST', 'SYSTEM_ADMIN'],
    });
    if (!auth.authorized) {
      return { success:false, commandId, idempotencyKey, error:{ code:auth.code || 'UNAUTHORIZED', message:auth.reason || 'Clinical consumption authority required.' } };
    }

    const consumption = payload as unknown as PatientConsumptionRecord;
    if (!consumption.consumptionId || !consumption.patientId || !consumption.itemId || !(consumption.quantity > 0)) {
      return { success:false, commandId, idempotencyKey, error:{ code:'INVALID_PATIENT_CONSUMPTION', message:'Consumption identity, patient, item and positive quantity are required.' } };
    }

    const canonical = {
      ...consumption,
      tenantId: context.tenantId,
      documentedBy: context.actorId,
      consumedAt: consumption.consumedAt || new Date().toISOString(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'PATIENT_CONSUMPTION',
      entityId: canonical.consumptionId,
      eventType: 'PATIENT_CONSUMPTION_RECORDED',
      domainState: canonical,
      eventPayload: {
        consumptionId: canonical.consumptionId,
        patientId: canonical.patientId,
        encounterId: canonical.encounterId,
        itemId: canonical.itemId,
        batchId: canonical.batchId,
        quantity: canonical.quantity,
      },
      auditReason: `Recorded patient consumption of ${canonical.itemName}`,
      outboxTopic: 'g-hims-scm-events',
    });

    return {
      success:true,
      commandId,
      idempotencyKey,
      entityId: canonical.consumptionId,
      eventId:tx.event.eventId,
      auditId:tx.audit.auditId,
      outboxId:tx.outbox.outboxId,
      data:canonical,
    };
  }

  public static async submitPurchaseRequisition(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Record<string, unknown>
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['SCM_MANAGER', 'INVENTORY_OFFICER', 'PHARMACIST', 'DEPARTMENT_HEAD', 'SYSTEM_ADMIN', 'ADMINISTRATOR'],
    });
    if (!auth.authorized) {
      return { success:false, commandId, idempotencyKey, error:{ code:auth.code || 'UNAUTHORIZED', message:auth.reason || 'Requisition submission authority required.' } };
    }

    const requisition = payload as unknown as PurchaseRequisition;
    if (!requisition.requisitionId || !Array.isArray(requisition.items) || requisition.items.length === 0) {
      return { success:false, commandId, idempotencyKey, error:{ code:'INVALID_REQUISITION', message:'Requisition identity and at least one line item are required.' } };
    }

    const canonical: PurchaseRequisition = {
      ...requisition,
      tenantId: context.tenantId,
      status: requisition.status === 'DRAFT' ? 'SUBMITTED' : requisition.status,
      updatedAt: new Date().toISOString(),
    };

    const tx = await TransactionManager.executeAtomicWrite(context, commandId, idempotencyKey, {
      entityType: 'PURCHASE_REQUISITION',
      entityId: canonical.requisitionId,
      eventType: 'PR_SUBMITTED',
      domainState: canonical,
      eventPayload: {
        requisitionId: canonical.requisitionId,
        priority: canonical.priority,
        requestingDepartment: canonical.requestingDepartment,
        itemsCount: canonical.items.length,
      },
      auditReason: `Submitted purchase requisition ${canonical.requisitionNumber}`,
      outboxTopic: 'g-hims-scm-events',
    });

    return {
      success:true,
      commandId,
      idempotencyKey,
      entityId:canonical.requisitionId,
      eventId:tx.event.eventId,
      auditId:tx.audit.auditId,
      outboxId:tx.outbox.outboxId,
      data:canonical,
    };
  }
}
