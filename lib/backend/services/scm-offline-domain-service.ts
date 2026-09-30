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
      requiredRoles: [
        'NURSE',
        'DOCTOR',
        'CONSULTANT',
        'PHARMACIST',
        'SURGEON',
        'SYSTEM_ADMIN',
      ],
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Clinical consumption authority required.',
        },
      };
    }

    const consumption = payload as unknown as PatientConsumptionRecord & {
      facilityId?: string;
      sourceLocationId?: string;
      sourceLocationName?: string;
      stockTransactionId?: string;
    };

    const facilityId = String(
      consumption.facilityId || context.facilityIds?.[0] || ''
    ).trim();
    const sourceLocationId = String(
      consumption.sourceLocationId || ''
    ).trim();
    const batchId = String(consumption.batchId || '').trim();
    const quantity = Number(consumption.quantity);

    if (
      !consumption.consumptionId ||
      !consumption.patientId ||
      !consumption.encounterId ||
      !consumption.itemId ||
      !batchId ||
      !facilityId ||
      !sourceLocationId ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_PATIENT_CONSUMPTION',
          message:
            'Consumption identity, patient, encounter, facility, source location, batch, item and positive quantity are required.',
        },
      };
    }

    const balanceId = stockBalanceId(
      context.tenantId,
      facilityId,
      sourceLocationId,
      consumption.itemId,
      batchId
    );
    const stockTransactionId =
      consumption.stockTransactionId ||
      `txn_consumption_${consumption.consumptionId}`;

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'PATIENT_CONSUMPTION',
        aggregateId: consumption.consumptionId,
        eventType: 'PATIENT_CONSUMPTION_STOCK_COMMITTED',
        auditAction: 'PATIENT_CONSUMPTION_STOCK_COMMITTED',
        auditResourceType: 'PATIENT_CONSUMPTION',
        auditResourceId: consumption.consumptionId,
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'patient',
            entityType: 'PATIENT_MPI',
            entityId: consumption.patientId,
            required: true,
          },
          {
            key: 'encounter',
            entityType: 'ENCOUNTER',
            entityId: consumption.encounterId,
            required: true,
          },
          {
            key: 'item',
            entityType: 'ITEM_MASTER',
            entityId: consumption.itemId,
            required: true,
          },
          {
            key: 'batch',
            entityType: 'BATCH_LOT',
            entityId: batchId,
            required: true,
          },
          {
            key: 'balance',
            entityType: 'INVENTORY_BALANCE',
            entityId: balanceId,
            required: true,
          },
        ],
        prepare: (current) => {
          const encounter = current.encounter || {};
          if (
            String(encounter.patientId || '') !== consumption.patientId
          ) {
            throw new AtomicMutationRejectedError(
              'SCM_ENCOUNTER_PATIENT_MISMATCH',
              'Encounter does not belong to the supplied patient.'
            );
          }

          const item = current.item as unknown as ItemMaster;
          const batch = current.batch as unknown as BatchLotRecord;
          const balance = current.balance as unknown as InventoryBalance;

          if (!item || item.isActive === false) {
            throw new AtomicMutationRejectedError(
              'SCM_ITEM_NOT_ACTIVE',
              'The authoritative item master is inactive.'
            );
          }
          if (batch.itemId !== item.itemId) {
            throw new AtomicMutationRejectedError(
              'SCM_BATCH_ITEM_MISMATCH',
              'Batch does not belong to the authoritative item.'
            );
          }
          if (batch.status !== 'AVAILABLE') {
            throw new AtomicMutationRejectedError(
              'SCM_BATCH_NOT_ISSUABLE',
              `Batch status ${batch.status} blocks patient consumption.`
            );
          }

          validateMovementAgainstBalance(
            balance,
            'CONSUMPTION',
            quantity
          );

          const now = new Date().toISOString();
          const stockTxn: StockTransaction = {
            transactionId: stockTransactionId,
            tenantId: context.tenantId,
            facilityId,
            itemId: item.itemId,
            itemCode: item.itemCode,
            itemName: item.name,
            batchId,
            batchNumber: batch.batchNumber,
            expirationDate: batch.expiryDate,
            serialId: consumption.serialNumber,
            fromLocationId: sourceLocationId,
            fromLocationName:
              consumption.sourceLocationName || balance.locationName,
            quantity,
            uom: consumption.uom,
            normalizedQuantity: quantity,
            unitCost: Number(batch.unitCost || item.unitCost || 0),
            totalCost:
              quantity * Number(batch.unitCost || item.unitCost || 0),
            currency: String(batch.currency || item.currency || '').toUpperCase(),
            transactionType: 'CONSUMPTION',
            referenceType: consumption.procedureId
              ? 'SURGICAL_PROCEDURE'
              : 'PATIENT_ENCOUNTER',
            referenceId:
              consumption.procedureId || consumption.encounterId,
            patientId: consumption.patientId,
            encounterId: consumption.encounterId,
            procedureId: consumption.procedureId,
            performedBy: {
              userId: context.actorId,
              userName: context.actorId,
              role: context.roles[0] || 'AUTHENTICATED_USER',
            },
            occurredAt: consumption.consumedAt || now,
            recordedAt: now,
            idempotencyKey,
            source: 'ONLINE',
            metadata: {
              consumptionId: consumption.consumptionId,
            },
          };

          const nextBalance = calculateDerivedBalance(balance, stockTxn);

          const canonicalConsumption: PatientConsumptionRecord = {
            ...consumption,
            tenantId: context.tenantId,
            itemCode: item.itemCode,
            itemName: item.name,
            itemType: item.itemType,
            batchNumber: batch.batchNumber,
            supplierId: batch.supplierId,
            supplierName: batch.supplierName,
            purchaseOrderId: batch.purchaseOrderId,
            grnId: batch.grnId,
            quantity,
            documentedBy: context.actorId,
            consumedAt: consumption.consumedAt || now,
          };

          return {
            domainState: canonicalConsumption,
            additionalStateWrites: [
              {
                entityType: 'STOCK_TRANSACTION',
                entityId: stockTransactionId,
                domainState: stockTxn,
              },
              {
                entityType: 'INVENTORY_BALANCE',
                entityId: balanceId,
                domainState: nextBalance,
              },
            ],
            eventPayload: {
              consumptionId: canonicalConsumption.consumptionId,
              stockTransactionId,
              patientId: canonicalConsumption.patientId,
              encounterId: canonicalConsumption.encounterId,
              procedureId: canonicalConsumption.procedureId,
              itemId: canonicalConsumption.itemId,
              batchId,
              sourceLocationId,
              quantity,
              balanceId,
            },
            auditReason: `Consumed ${quantity} ${canonicalConsumption.uom} of ${item.name} for patient encounter ${canonicalConsumption.encounterId}`,
            resultData: {
              consumption: canonicalConsumption,
              transaction: stockTxn,
              balance: nextBalance,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: consumption.consumptionId,
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
