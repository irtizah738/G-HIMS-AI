import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { AtomicMutationRejectedError, TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import type {
  BatchLotRecord,
  InventoryBalance,
  ItemMaster,
  PatientConsumptionRecord,
  PurchaseRequisition,
  StockTransaction,
} from '@/types/scm-domain';
import { calculateDerivedBalance } from '@/lib/supply-chain/scm-engine';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';

function stockBalanceId(
  tenantId: string,
  facilityId: string,
  locationId: string,
  itemId: string,
  batchId?: string
): string {
  return [
    tenantId,
    facilityId,
    locationId,
    itemId,
    batchId || 'UNBATCHED',
  ].join('_');
}

function requiresAvailableStock(type: StockTransaction['transactionType']): boolean {
  return [
    'ISSUE',
    'ADJUSTMENT_OUT',
    'TRANSFER_OUT',
    'CONSUMPTION',
    'DISPENSE',
    'WRITE_OFF',
    'RESERVATION',
    'QUARANTINE',
    'DAMAGE',
    'EXPIRY',
    'RECALL',
  ].includes(type);
}

function validateMovementAgainstBalance(
  balance: InventoryBalance,
  type: StockTransaction['transactionType'],
  quantity: number
): void {
  if (requiresAvailableStock(type) && balance.available < quantity) {
    throw new AtomicMutationRejectedError(
      'INVENTORY_STATE_CONFLICT',
      `Available stock ${balance.available} is below requested quantity ${quantity}.`,
      {
        balanceId: balance.balanceId,
        available: balance.available,
        requested: quantity,
        transactionType: type,
      }
    );
  }

  if (type === 'UNRESERVATION' && balance.reserved < quantity) {
    throw new AtomicMutationRejectedError(
      'INVENTORY_RESERVATION_CONFLICT',
      'Cannot unreserve more stock than is currently reserved.'
    );
  }

  if (type === 'RELEASE' && balance.quarantined < quantity) {
    throw new AtomicMutationRejectedError(
      'INVENTORY_QUARANTINE_CONFLICT',
      'Cannot release more stock than is currently quarantined.'
    );
  }
}

function newBalance(params: {
  tenantId: string;
  facilityId: string;
  locationId: string;
  locationName: string;
  item: ItemMaster;
  batch?: BatchLotRecord | null;
  unitCost: number;
}): InventoryBalance {
  const batchId = params.batch?.batchId || 'UNBATCHED';
  return {
    balanceId: stockBalanceId(
      params.tenantId,
      params.facilityId,
      params.locationId,
      params.item.itemId,
      batchId
    ),
    tenantId: params.tenantId,
    facilityId: params.facilityId,
    locationId: params.locationId,
    locationName: params.locationName,
    itemId: params.item.itemId,
    itemCode: params.item.itemCode,
    itemName: params.item.name,
    itemType: params.item.itemType,
    batchId,
    batchNumber: params.batch?.batchNumber || '',
    expiryDate: params.batch?.expiryDate || '',
    onHand: 0,
    reserved: 0,
    quarantined: 0,
    damaged: 0,
    expired: 0,
    inTransit: 0,
    available: 0,
    uom: params.item.stockUOM,
    minimumStock: params.item.minimumStock,
    maximumStock: params.item.maximumStock,
    reorderPoint: params.item.reorderPoint,
    unitCost: params.unitCost,
    totalValuation: 0,
    lastMovementAt: new Date().toISOString(),
    version: 0,
  };
}

export class ScmOfflineDomainService {
  public static async recordStockTransaction(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Record<string, unknown>
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'PHARMACIST',
        'SCM_MANAGER',
        'INVENTORY_OFFICER',
        'STORE_KEEPER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
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
    const quantity = Number(txn.quantity);
    if (
      !txn.transactionId ||
      !txn.itemId ||
      !txn.transactionType ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !txn.facilityId ||
      !txn.uom
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_STOCK_TRANSACTION',
          message:
            'Transaction identity, facility, item, type, UOM and positive quantity are required.',
        },
      };
    }

    const isTransfer =
      txn.transactionType === 'TRANSFER_OUT' ||
      txn.transactionType === 'TRANSFER_IN';

    if (
      isTransfer &&
      (!txn.fromLocationId ||
        !txn.toLocationId ||
        txn.fromLocationId === txn.toLocationId)
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_STOCK_TRANSFER',
          message:
            'Transfers require distinct authoritative source and destination locations.',
        },
      };
    }

    const inbound = ['RECEIPT', 'ADJUSTMENT_IN'].includes(txn.transactionType);
    const sourceLocationId = isTransfer
      ? String(txn.fromLocationId)
      : inbound
        ? ''
        : String(txn.fromLocationId || txn.toLocationId || '');
    const destinationLocationId = isTransfer
      ? String(txn.toLocationId)
      : inbound
        ? String(txn.toLocationId || '')
        : '';

    if (!sourceLocationId && !destinationLocationId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVENTORY_LOCATION_REQUIRED',
          message: 'A source or destination inventory location is required.',
        },
      };
    }

    const batchId = String(txn.batchId || '').trim();
    const sourceBalanceId = sourceLocationId
      ? stockBalanceId(
          context.tenantId,
          txn.facilityId,
          sourceLocationId,
          txn.itemId,
          batchId || undefined
        )
      : '';
    const destinationBalanceId = destinationLocationId
      ? stockBalanceId(
          context.tenantId,
          txn.facilityId,
          destinationLocationId,
          txn.itemId,
          batchId || undefined
        )
      : '';

    const readTargets = [
      {
        key: 'item',
        entityType: 'ITEM_MASTER',
        entityId: txn.itemId,
        required: true,
      },
      ...(batchId
        ? [
            {
              key: 'batch',
              entityType: 'BATCH_LOT',
              entityId: batchId,
              required: true,
            },
          ]
        : []),
      ...(sourceBalanceId
        ? [
            {
              key: 'sourceBalance',
              entityType: 'INVENTORY_BALANCE',
              entityId: sourceBalanceId,
              required: true,
            },
          ]
        : []),
      ...(destinationBalanceId
        ? [
            {
              key: 'destinationBalance',
              entityType: 'INVENTORY_BALANCE',
              entityId: destinationBalanceId,
              required: false,
            },
          ]
        : []),
    ];

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'STOCK_TRANSACTION',
        aggregateId: txn.transactionId,
        eventType: isTransfer
          ? 'STOCK_TRANSFER_COMMITTED'
          : 'STOCK_TRANSACTION_RECORDED',
        auditAction: isTransfer
          ? 'STOCK_TRANSFER_COMMITTED'
          : 'STOCK_TRANSACTION_RECORDED',
        auditResourceType: 'STOCK_TRANSACTION',
        auditResourceId: txn.transactionId,
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets,
        prepare: (current) => {
          const item = current.item as unknown as ItemMaster | null;
          if (!item || item.itemId !== txn.itemId || item.isActive === false) {
            throw new AtomicMutationRejectedError(
              'SCM_ITEM_NOT_ACTIVE',
              'The authoritative item master is missing or inactive.'
            );
          }

          if (txn.uom !== item.stockUOM && txn.uom !== item.issueUOM) {
            throw new AtomicMutationRejectedError(
              'SCM_UOM_MISMATCH',
              `Transaction UOM ${txn.uom} is not an authorized stock/issue UOM for ${item.itemCode}.`
            );
          }

          const batch = batchId
            ? (current.batch as unknown as BatchLotRecord | null)
            : null;
          if (batch) {
            if (batch.itemId !== item.itemId) {
              throw new AtomicMutationRejectedError(
                'SCM_BATCH_ITEM_MISMATCH',
                'Batch does not belong to the authoritative item.'
              );
            }
            if (
              ['QUARANTINED', 'RECALLED', 'EXPIRED', 'DAMAGED', 'BLOCKED'].includes(
                batch.status
              ) &&
              !['QUARANTINE', 'RECALL', 'EXPIRY', 'DAMAGE', 'WRITE_OFF'].includes(
                txn.transactionType
              )
            ) {
              throw new AtomicMutationRejectedError(
                'SCM_BATCH_NOT_ISSUABLE',
                `Batch status ${batch.status} blocks this stock movement.`
              );
            }
          }

          const now = new Date().toISOString();
          const canonicalTxn: StockTransaction = {
            ...txn,
            tenantId: context.tenantId,
            quantity,
            normalizedQuantity:
              Number.isFinite(Number(txn.normalizedQuantity)) &&
              Number(txn.normalizedQuantity) > 0
                ? Number(txn.normalizedQuantity)
                : quantity,
            itemCode: item.itemCode,
            itemName: item.name,
            batchNumber: batch?.batchNumber || txn.batchNumber,
            expirationDate: batch?.expiryDate || txn.expirationDate,
            unitCost:
              Number.isFinite(Number(txn.unitCost)) && Number(txn.unitCost) >= 0
                ? Number(txn.unitCost)
                : Number(batch?.unitCost || item.unitCost || 0),
            totalCost:
              quantity *
              (Number.isFinite(Number(txn.unitCost)) && Number(txn.unitCost) >= 0
                ? Number(txn.unitCost)
                : Number(batch?.unitCost || item.unitCost || 0)),
            currency: String(txn.currency || item.currency || '').toUpperCase(),
            performedBy: {
              userId: context.actorId,
              userName: context.actorId,
              role: context.roles[0] || 'AUTHENTICATED_USER',
            },
            idempotencyKey,
            source:
              String(txn.source || '').toUpperCase() === 'OFFLINE_SYNC'
                ? 'OFFLINE_SYNC'
                : 'ONLINE',
            occurredAt: txn.occurredAt || now,
            recordedAt: now,
          };

          const writes: Array<{
            entityType: string;
            entityId: string;
            domainState: unknown;
          }> = [];

          let sourceBalance: InventoryBalance | undefined;
          let destinationBalance: InventoryBalance | undefined;

          if (sourceBalanceId) {
            sourceBalance = current.sourceBalance as unknown as InventoryBalance;
            validateMovementAgainstBalance(
              sourceBalance,
              isTransfer ? 'TRANSFER_OUT' : canonicalTxn.transactionType,
              quantity
            );

            const sourceTxn = {
              ...canonicalTxn,
              transactionType: isTransfer
                ? ('TRANSFER_OUT' as const)
                : canonicalTxn.transactionType,
            };
            const nextSource = calculateDerivedBalance(sourceBalance, sourceTxn);
            writes.push({
              entityType: 'INVENTORY_BALANCE',
              entityId: sourceBalanceId,
              domainState: nextSource,
            });
            sourceBalance = nextSource;
          }

          if (destinationBalanceId) {
            const existingDestination =
              (current.destinationBalance as unknown as InventoryBalance | null) ||
              newBalance({
                tenantId: context.tenantId,
                facilityId: txn.facilityId,
                locationId: destinationLocationId,
                locationName:
                  txn.toLocationName || destinationLocationId,
                item,
                batch,
                unitCost: canonicalTxn.unitCost,
              });

            const destinationTxn = {
              ...canonicalTxn,
              transactionType: isTransfer
                ? ('TRANSFER_IN' as const)
                : canonicalTxn.transactionType,
            };
            const nextDestination = calculateDerivedBalance(
              existingDestination,
              destinationTxn
            );
            writes.push({
              entityType: 'INVENTORY_BALANCE',
              entityId: destinationBalanceId,
              domainState: nextDestination,
            });
            destinationBalance = nextDestination;
          }

          return {
            domainState: canonicalTxn,
            additionalStateWrites: writes,
            eventPayload: {
              transactionId: canonicalTxn.transactionId,
              itemId: canonicalTxn.itemId,
              batchId: canonicalTxn.batchId,
              quantity,
              transactionType: canonicalTxn.transactionType,
              fromLocationId: canonicalTxn.fromLocationId,
              toLocationId: canonicalTxn.toLocationId,
              sourceBalanceId: sourceBalanceId || undefined,
              destinationBalanceId: destinationBalanceId || undefined,
            },
            auditReason: isTransfer
              ? `Transferred ${quantity} ${canonicalTxn.uom} of ${canonicalTxn.itemName} from ${canonicalTxn.fromLocationId} to ${canonicalTxn.toLocationId}`
              : `${canonicalTxn.transactionType} ${quantity} ${canonicalTxn.uom} ${canonicalTxn.itemName}`,
            resultData: {
              transaction: canonicalTxn,
              sourceBalance,
              destinationBalance,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: txn.transactionId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        };
      }
      throw error;
    }
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
