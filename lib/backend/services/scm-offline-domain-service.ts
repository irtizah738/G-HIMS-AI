import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import type {
  BatchLotRecord,
  InventoryBalance,
  PatientConsumptionRecord,
  GoodsReceiptNote,
  PurchaseOrderRecord,
  PurchaseRequisition,
  StockTransaction,
} from '@/types/scm-domain';
import { calculateDerivedBalance } from '@/lib/supply-chain/scm-engine';
import crypto from 'node:crypto';

function inventoryLocationForTransaction(txn: StockTransaction): string {
  const inbound = new Set([
    'RECEIPT',
    'RETURN',
    'TRANSFER_IN',
    'ADJUSTMENT_IN',
  ]);
  if (inbound.has(txn.transactionType)) {
    return String(txn.toLocationId || '').trim();
  }
  return String(txn.fromLocationId || txn.toLocationId || '').trim();
}

function stockBalanceId(tenantId: string, txn: StockTransaction): string {
  const facilityId = String(txn.facilityId || '').trim();
  const locationId = inventoryLocationForTransaction(txn);
  const batchId = String(txn.batchId || '').trim();

  if (!facilityId || !locationId || !txn.itemId || !batchId) {
    throw new Error(
      'INVALID_STOCK_SCOPE: facilityId, locationId, itemId and batchId are required for authoritative stock movement.'
    );
  }

  return `${tenantId}_${facilityId}_${locationId}_${txn.itemId}_${batchId}`;
}

function newProcurementId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
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
    const allowedTransactionTypes = new Set([
      'RECEIPT',
      'ISSUE',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'RETURN',
      'ADJUSTMENT_IN',
      'ADJUSTMENT_OUT',
      'DAMAGE',
      'EXPIRY',
      'QUARANTINE',
      'RELEASE',
      'RESERVATION',
      'UNRESERVATION',
      'CONSUMPTION',
      'DISPENSE',
      'RECALL',
      'WRITE_OFF',
    ]);
    if (
      !txn.transactionId ||
      !txn.itemId ||
      !allowedTransactionTypes.has(String(txn.transactionType || '')) ||
      !Number.isFinite(txn.quantity) ||
      txn.quantity <= 0 ||
      !txn.uom ||
      !txn.referenceType ||
      !txn.referenceId
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_STOCK_TRANSACTION',
          message:
            'Stock transaction identity, item, supported type, UOM, reference and positive quantity are required.',
        },
      };
    }

    const privilegedAcrossFacilities = context.roles.some((role) =>
      ['SYSTEM_ADMIN', 'ADMINISTRATOR'].includes(role.toUpperCase())
    );
    const facilityScope = new Set(
      (context.facilityIds || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    if (
      !privilegedAcrossFacilities &&
      facilityScope.size > 0 &&
      !facilityScope.has(String(txn.facilityId || '').trim())
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'FACILITY_SCOPE_MISMATCH',
          message: 'Inventory movement is outside the actor assigned facility scope.',
        },
      };
    }

    let balanceId: string;
    try {
      balanceId = stockBalanceId(context.tenantId, txn);
    } catch (error) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_STOCK_SCOPE',
          message: error instanceof Error ? error.message : 'Invalid stock scope.',
        },
      };
    }

    const locationId = inventoryLocationForTransaction(txn);
    const canonicalTxn: StockTransaction = {
      ...txn,
      tenantId: context.tenantId,
      performedBy: {
        userId: context.actorId,
        userName: txn.performedBy?.userName || context.actorId,
        role: context.roles[0] || 'AUTHENTICATED_USER',
      },
      idempotencyKey,
      source: txn.source === 'OFFLINE_SYNC' ? 'OFFLINE_SYNC' : 'ONLINE',
      recordedAt: new Date().toISOString(),
    };

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'STOCK_TRANSACTION',
        aggregateId: canonicalTxn.transactionId,
        eventType: 'STOCK_TRANSACTION_RECORDED',
        auditAction: 'STOCK_TRANSACTION_RECORDED',
        auditResourceType: 'STOCK_TRANSACTION',
        auditResourceId: canonicalTxn.transactionId,
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'balance',
            entityType: 'INVENTORY_BALANCE',
            entityId: balanceId,
            required: false,
          },
          {
            key: 'item',
            entityType: 'ITEM_MASTER',
            entityId: canonicalTxn.itemId,
            required: true,
          },
          {
            key: 'batch',
            entityType: 'BATCH_LOT',
            entityId: String(canonicalTxn.batchId || ''),
            required: true,
          },
        ],
        prepare: (current) => {
          const item = current.item || {};
          const batch = current.batch as unknown as BatchLotRecord;
          const existing = current.balance as unknown as InventoryBalance | null;

          if (item.isActive === false) {
            throw new AtomicMutationRejectedError(
              'INVENTORY_ITEM_INACTIVE',
              'Inactive item cannot participate in stock movement.'
            );
          }
          if (
            String(batch.itemId || '') !== canonicalTxn.itemId ||
            String(batch.batchId || '') !== String(canonicalTxn.batchId || '')
          ) {
            throw new AtomicMutationRejectedError(
              'BATCH_ITEM_MISMATCH',
              'Batch does not belong to the requested inventory item.'
            );
          }

          const clinicallyUsableOutbound = new Set([
            'ISSUE',
            'TRANSFER_OUT',
            'CONSUMPTION',
            'DISPENSE',
            'RESERVATION',
          ]);
          const batchStatus = String(batch.status || '').toUpperCase();
          const expiryAt = Date.parse(String(batch.expiryDate || ''));

          if (
            clinicallyUsableOutbound.has(canonicalTxn.transactionType) &&
            batchStatus !== 'AVAILABLE'
          ) {
            throw new AtomicMutationRejectedError(
              'BATCH_NOT_AVAILABLE',
              `Batch status ${batchStatus || 'UNKNOWN'} does not permit clinical issue.`
            );
          }
          if (
            clinicallyUsableOutbound.has(canonicalTxn.transactionType) &&
            (!Number.isFinite(expiryAt) || expiryAt <= Date.now())
          ) {
            throw new AtomicMutationRejectedError(
              'BATCH_EXPIRED',
              'Expired or invalid-dated batch cannot be issued, dispensed, consumed, transferred or reserved.'
            );
          }

          const authoritativeTxn: StockTransaction = {
            ...canonicalTxn,
            itemCode: String(item.itemCode || canonicalTxn.itemCode || ''),
            itemName: String(item.name || canonicalTxn.itemName || ''),
            batchNumber: String(batch.batchNumber || canonicalTxn.batchNumber || ''),
            manufactureDate: batch.manufactureDate || canonicalTxn.manufactureDate,
            expirationDate: batch.expiryDate || canonicalTxn.expirationDate,
            uom: (item.unitOfMeasure || canonicalTxn.uom) as StockTransaction['uom'],
            unitCost: Number(batch.unitCost ?? item.unitCost ?? canonicalTxn.unitCost ?? 0),
            totalCost:
              Math.round(
                Number(batch.unitCost ?? item.unitCost ?? canonicalTxn.unitCost ?? 0) *
                  canonicalTxn.quantity *
                  100
              ) / 100,
          };

          const base: InventoryBalance = existing || {
            balanceId,
            tenantId: context.tenantId,
            facilityId: authoritativeTxn.facilityId,
            locationId,
            locationName:
              authoritativeTxn.fromLocationId === locationId
                ? authoritativeTxn.fromLocationName || locationId
                : authoritativeTxn.toLocationName || locationId,
            itemId: authoritativeTxn.itemId,
            itemCode: authoritativeTxn.itemCode,
            itemName: authoritativeTxn.itemName,
            itemType: (item.itemType || 'MEDICAL_CONSUMABLE') as InventoryBalance['itemType'],
            batchId: authoritativeTxn.batchId || '',
            batchNumber: authoritativeTxn.batchNumber || '',
            expiryDate: authoritativeTxn.expirationDate || '',
            onHand: 0,
            reserved: 0,
            quarantined: 0,
            damaged: 0,
            expired: 0,
            inTransit: 0,
            available: 0,
            uom: authoritativeTxn.uom,
            minimumStock: Number(item.minimumStock || 0),
            maximumStock: Number(item.maximumStock || 0),
            reorderPoint: Number(item.reorderPoint || 0),
            unitCost: authoritativeTxn.unitCost || 0,
            totalValuation: 0,
            lastMovementAt: authoritativeTxn.recordedAt,
            version: 0,
          };

          const deductionTypes = new Set([
            'ISSUE',
            'ADJUSTMENT_OUT',
            'TRANSFER_OUT',
            'CONSUMPTION',
            'DISPENSE',
            'WRITE_OFF',
            'DAMAGE',
            'EXPIRY',
            'QUARANTINE',
            'RECALL',
            'RESERVATION',
          ]);

          if (
            deductionTypes.has(authoritativeTxn.transactionType) &&
            base.available < authoritativeTxn.quantity
          ) {
            throw new AtomicMutationRejectedError(
              'INVENTORY_STATE_CONFLICT',
              `Available stock ${base.available} is below requested quantity ${authoritativeTxn.quantity}.`,
              {
                balanceId,
                available: base.available,
                requested: authoritativeTxn.quantity,
              }
            );
          }

          const nextBalance = calculateDerivedBalance(base, authoritativeTxn);
          if (
            nextBalance.onHand < 0 ||
            nextBalance.available < 0 ||
            nextBalance.reserved < 0 ||
            nextBalance.quarantined < 0
          ) {
            throw new AtomicMutationRejectedError(
              'INVENTORY_INVARIANT_VIOLATION',
              'Stock movement would violate inventory invariants.'
            );
          }

          const nextBatch: BatchLotRecord = {
            ...batch,
            updatedAt: authoritativeTxn.recordedAt,
          };
          const batchDeduction = new Set([
            'ISSUE',
            'ADJUSTMENT_OUT',
            'TRANSFER_OUT',
            'CONSUMPTION',
            'DISPENSE',
            'WRITE_OFF',
            'DAMAGE',
            'EXPIRY',
          ]);
          const batchAddition = new Set([
            'RECEIPT',
            'RETURN',
            'TRANSFER_IN',
            'ADJUSTMENT_IN',
          ]);

          if (batchDeduction.has(authoritativeTxn.transactionType)) {
            if (nextBatch.quantityRemaining < authoritativeTxn.quantity) {
              throw new AtomicMutationRejectedError(
                'BATCH_QUANTITY_CONFLICT',
                'Batch remaining quantity is below the requested stock movement.'
              );
            }
            nextBatch.quantityRemaining -= authoritativeTxn.quantity;
          } else if (batchAddition.has(authoritativeTxn.transactionType)) {
            nextBatch.quantityRemaining += authoritativeTxn.quantity;
          } else if (authoritativeTxn.transactionType === 'RESERVATION') {
            nextBatch.quantityReserved =
              Number(nextBatch.quantityReserved || 0) + authoritativeTxn.quantity;
          } else if (authoritativeTxn.transactionType === 'UNRESERVATION') {
            nextBatch.quantityReserved = Math.max(
              0,
              Number(nextBatch.quantityReserved || 0) - authoritativeTxn.quantity
            );
          } else if (authoritativeTxn.transactionType === 'QUARANTINE') {
            nextBatch.status = 'QUARANTINED';
          } else if (authoritativeTxn.transactionType === 'RECALL') {
            nextBatch.status = 'RECALLED';
          } else if (authoritativeTxn.transactionType === 'RELEASE') {
            nextBatch.status = 'AVAILABLE';
          }

          if (nextBatch.quantityRemaining === 0) {
            nextBatch.status = 'DEPLETED';
          }

          return {
            domainState: authoritativeTxn,
            additionalStateWrites: [
              {
                entityType: 'INVENTORY_BALANCE',
                entityId: balanceId,
                domainState: nextBalance,
              },
              {
                entityType: 'BATCH_LOT',
                entityId: nextBatch.batchId,
                domainState: nextBatch,
              },
            ],
            eventPayload: {
              transactionId: authoritativeTxn.transactionId,
              itemId: authoritativeTxn.itemId,
              quantity: authoritativeTxn.quantity,
              transactionType: authoritativeTxn.transactionType,
              balanceId,
              locationId,
              batchId: authoritativeTxn.batchId,
            },
            auditReason: `${authoritativeTxn.transactionType} ${authoritativeTxn.quantity} ${authoritativeTxn.uom} ${authoritativeTxn.itemName}`,
            resultData: {
              transaction: authoritativeTxn,
              balance: nextBalance,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: canonicalTxn.transactionId,
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
      requiredRoles: [
        'SCM_MANAGER',
        'INVENTORY_OFFICER',
        'PHARMACIST',
        'DEPARTMENT_HEAD',
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
          message: auth.reason || 'Requisition submission authority required.',
        },
      };
    }

    const requisition = payload as unknown as PurchaseRequisition;
    if (
      !requisition.requisitionId ||
      !Array.isArray(requisition.items) ||
      requisition.items.length === 0 ||
      !requisition.facilityId ||
      !requisition.requestingLocationId ||
      !requisition.requestingDepartment ||
      !requisition.priority
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_REQUISITION',
          message:
            'Requisition identity, facility, department, location, priority and at least one line item are required.',
        },
      };
    }

    const requisitionFacilityScope = new Set(
      (context.facilityIds || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    const requisitionAdmin = context.roles.some((role) =>
      ['SYSTEM_ADMIN', 'ADMINISTRATOR'].includes(role.toUpperCase())
    );
    if (
      !requisitionAdmin &&
      requisitionFacilityScope.size > 0 &&
      !requisitionFacilityScope.has(requisition.facilityId)
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'FACILITY_SCOPE_MISMATCH',
          message: 'Purchase requisition is outside the actor assigned facility scope.',
        },
      };
    }

    const uniqueItemIds = Array.from(
      new Set(
        requisition.items
          .map((line) => String(line.itemId || '').trim())
          .filter(Boolean)
      )
    );

    if (uniqueItemIds.length !== requisition.items.length) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_REQUISITION_ITEMS',
          message:
            'Every requisition line must reference one unique authoritative item.',
        },
      };
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'PURCHASE_REQUISITION',
        aggregateId: requisition.requisitionId,
        eventType: 'PR_SUBMITTED',
        auditAction: 'PR_SUBMITTED',
        auditResourceType: 'PURCHASE_REQUISITION',
        auditResourceId: requisition.requisitionId,
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: uniqueItemIds.map((itemId) => ({
          key: `item:${itemId}`,
          entityType: 'ITEM_MASTER',
          entityId: itemId,
          required: true,
        })),
        prepare: (current) => {
          const now = new Date().toISOString();

          const canonicalItems = requisition.items.map((line) => {
            const item = current[`item:${line.itemId}`] || {};
            if (item.isActive === false) {
              throw new AtomicMutationRejectedError(
                'REQUISITION_ITEM_INACTIVE',
                `Item ${line.itemId} is inactive and cannot be requisitioned.`
              );
            }

            const requestedQuantity = Number(line.requestedQuantity);
            const unitCost = Number(item.unitCost);
            if (
              !Number.isFinite(requestedQuantity) ||
              requestedQuantity <= 0 ||
              !Number.isFinite(unitCost) ||
              unitCost < 0
            ) {
              throw new AtomicMutationRejectedError(
                'REQUISITION_LINE_INVALID',
                `Requisition line ${line.itemId} has invalid quantity or authoritative cost.`
              );
            }

            return {
              ...line,
              itemId: String(item.itemId || line.itemId),
              itemCode: String(item.itemCode || line.itemCode || ''),
              itemName: String(item.name || line.itemName || ''),
              uom: (item.unitOfMeasure || line.uom) as typeof line.uom,
              reorderPoint: Number(item.reorderPoint || 0),
              suggestedQuantity: Number(
                item.reorderQuantity || line.suggestedQuantity || requestedQuantity
              ),
              estimatedUnitCost: unitCost,
              estimatedTotal:
                Math.round(requestedQuantity * unitCost * 100) / 100,
              requestedQuantity,
            };
          });

          const estimatedTotalCost =
            Math.round(
              canonicalItems.reduce(
                (sum, line) => sum + line.estimatedTotal,
                0
              ) * 100
            ) / 100;

          const canonical: PurchaseRequisition = {
            ...requisition,
            tenantId: context.tenantId,
            requestedBy: {
              userId: context.actorId,
              userName: context.actorId,
              role: context.roles[0] || 'AUTHENTICATED_USER',
            },
            items: canonicalItems,
            estimatedTotalCost,
            status: 'PENDING_APPROVAL',
            approvalHistory: [],
            createdAt: requisition.createdAt || now,
            updatedAt: now,
          };

          return {
            domainState: canonical,
            eventPayload: {
              requisitionId: canonical.requisitionId,
              priority: canonical.priority,
              facilityId: canonical.facilityId,
              requestingDepartment: canonical.requestingDepartment,
              itemsCount: canonical.items.length,
              estimatedTotalCost,
              currency: canonical.currency,
            },
            auditReason: `Submitted purchase requisition ${canonical.requisitionNumber}`,
            resultData: canonical,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: requisition.requisitionId,
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

  public static async reviewPurchaseRequisition(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Record<string, unknown>
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
        'DEPARTMENT_HEAD',
        'MEDICAL_DIRECTOR',
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
          message: auth.reason || 'Purchase requisition approval authority required.',
        },
      };
    }

    const requisitionId = String(payload.requisitionId || '').trim();
    const decision = String(payload.decision || '').trim().toUpperCase();
    const comments = String(payload.comments || '').trim();
    if (
      !requisitionId ||
      !['APPROVED', 'REJECTED'].includes(decision) ||
      (decision === 'REJECTED' && comments.length < 5)
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_REQUISITION_REVIEW',
          message: 'Valid requisitionId, decision and rejection reason are required.',
        },
      };
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'PURCHASE_REQUISITION',
        aggregateId: requisitionId,
        eventType:
          decision === 'APPROVED' ? 'PR_APPROVED' : 'PR_REJECTED',
        auditAction:
          decision === 'APPROVED' ? 'PR_APPROVED' : 'PR_REJECTED',
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'requisition',
            entityType: 'PURCHASE_REQUISITION',
            entityId: requisitionId,
            required: true,
          },
        ],
        prepare: (current) => {
          const requisition = current.requisition as unknown as PurchaseRequisition;
          if (
            !['SUBMITTED', 'PENDING_APPROVAL'].includes(requisition.status)
          ) {
            throw new AtomicMutationRejectedError(
              'REQUISITION_STATE_CONFLICT',
              `Requisition in state ${requisition.status} cannot be reviewed.`
            );
          }

          const now = new Date().toISOString();
          const next: PurchaseRequisition = {
            ...requisition,
            status: decision as 'APPROVED' | 'REJECTED',
            approvalHistory: [
              ...(requisition.approvalHistory || []),
              {
                level: 'SCM_APPROVAL',
                approverName: context.actorId,
                decision: decision as 'APPROVED' | 'REJECTED',
                comments: comments || undefined,
                timestamp: now,
              },
            ],
            updatedAt: now,
          };

          return {
            domainState: next,
            eventPayload: {
              requisitionId,
              decision,
              approverId: context.actorId,
              comments: comments || undefined,
            },
            auditReason: `${decision} purchase requisition ${requisition.requisitionNumber}`,
            resultData: next,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: requisitionId,
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

  public static async convertPurchaseRequisitionToOrder(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Record<string, unknown>
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
        'PROCUREMENT',
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
          message: auth.reason || 'Purchase order creation authority required.',
        },
      };
    }

    const requisitionId = String(payload.requisitionId || '').trim();
    const supplierId = String(payload.supplierId || '').trim();
    const paymentTerms = String(payload.paymentTerms || 'Net 30').trim();
    const expectedDeliveryDate = String(payload.expectedDeliveryDate || '').trim();
    const notes = String(payload.notes || '').trim();

    if (!requisitionId || !supplierId || !expectedDeliveryDate) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_PO_CONVERSION',
          message:
            'requisitionId, supplierId and expectedDeliveryDate are required.',
        },
      };
    }

    const poId = newProcurementId('po');

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'PURCHASE_REQUISITION',
        aggregateId: requisitionId,
        eventType: 'PR_CONVERTED_TO_PO',
        auditAction: 'PR_CONVERTED_TO_PO',
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'requisition',
            entityType: 'PURCHASE_REQUISITION',
            entityId: requisitionId,
            required: true,
          },
          {
            key: 'supplier',
            entityType: 'SUPPLIER_MASTER',
            entityId: supplierId,
            required: true,
          },
        ],
        prepare: (current) => {
          const requisition = current.requisition as unknown as PurchaseRequisition;
          const supplier = current.supplier || {};

          if (requisition.status !== 'APPROVED') {
            throw new AtomicMutationRejectedError(
              'REQUISITION_NOT_APPROVED',
              'Only an approved purchase requisition may be converted to a purchase order.'
            );
          }
          if (requisition.convertedPOId) {
            throw new AtomicMutationRejectedError(
              'REQUISITION_ALREADY_CONVERTED',
              'Purchase requisition already has a purchase order.'
            );
          }

          const supplierStatus = String(supplier.status || '').toUpperCase();
          if (supplierStatus && !['ACTIVE', 'APPROVED'].includes(supplierStatus)) {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_NOT_APPROVED',
              'Supplier is not active/approved for procurement.'
            );
          }

          const now = new Date().toISOString();
          const totalAmount = requisition.items.reduce(
            (sum, line) =>
              sum +
              Number(line.approvedQuantity || line.requestedQuantity || 0) *
                Number(line.estimatedUnitCost || 0),
            0
          );

          const po: PurchaseOrderRecord = {
            poId,
            tenantId: context.tenantId,
            facilityId: requisition.facilityId,
            poNumber: `PO-${new Date().getUTCFullYear()}-${poId.slice(-8).toUpperCase()}`,
            requisitionId: requisition.requisitionId,
            requisitionNumber: requisition.requisitionNumber,
            supplierId,
            supplierName: String(
              supplier.displayName || supplier.legalName || supplier.name || supplierId
            ),
            items: requisition.items.map((line, index) => ({
              lineId: `${poId}-line-${index + 1}`,
              itemId: line.itemId,
              itemCode: line.itemCode,
              itemName: line.itemName,
              description: line.itemName,
              quantityOrdered:
                line.approvedQuantity || line.requestedQuantity,
              quantityReceived: 0,
              quantityRemaining:
                line.approvedQuantity || line.requestedQuantity,
              uom: line.uom,
              unitPrice: line.estimatedUnitCost,
              unitCost: line.estimatedUnitCost,
              discount: 0,
              taxRate: 0,
              lineTotal:
                (line.approvedQuantity || line.requestedQuantity) *
                line.estimatedUnitCost,
            })),
            currency: requisition.currency,
            subtotal: totalAmount,
            discountTotal: 0,
            taxTotal: 0,
            totalAmount,
            paymentTerms,
            expectedDeliveryDate,
            status: 'PENDING_APPROVAL',
            createdBy: {
              userId: context.actorId,
              userName: context.actorId,
              role: context.roles[0] || 'AUTHENTICATED_USER',
            },
            destinationLocationId: requisition.requestingLocationId,
            notes,
            grnIds: [],
            createdAt: now,
            updatedAt: now,
          } as PurchaseOrderRecord;

          const nextRequisition: PurchaseRequisition = {
            ...requisition,
            status: 'CONVERTED_TO_PO',
            convertedPOId: poId,
            updatedAt: now,
          };

          return {
            domainState: nextRequisition,
            additionalStateWrites: [
              {
                entityType: 'PURCHASE_ORDER',
                entityId: poId,
                domainState: po,
              },
            ],
            eventPayload: {
              requisitionId,
              poId,
              supplierId,
              totalAmount,
              currency: requisition.currency,
            },
            auditReason: `Converted requisition ${requisition.requisitionNumber} to ${po.poNumber}`,
            resultData: {
              requisition: nextRequisition,
              purchaseOrder: po,
              nextRequiredAction: 'PO_APPROVAL_REQUIRED_BEFORE_VENDOR_DISPATCH',
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: poId,
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


  public static async reviewPurchaseOrder(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Record<string, unknown>
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
        'FINANCE',
        'FINANCE_MANAGER',
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
          message: auth.reason || 'Purchase order approval authority required.',
        },
      };
    }

    const purchaseOrderId = String(payload.purchaseOrderId || '').trim();
    const decision = String(payload.decision || '').trim().toUpperCase();
    const comments = String(payload.comments || '').trim();

    if (
      !purchaseOrderId ||
      !['APPROVED', 'REJECTED'].includes(decision) ||
      (decision === 'REJECTED' && comments.length < 5)
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_PURCHASE_ORDER_REVIEW',
          message:
            'purchaseOrderId, valid decision, and rejection reason when applicable are required.',
        },
      };
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'PURCHASE_ORDER',
        aggregateId: purchaseOrderId,
        eventType:
          decision === 'APPROVED' ? 'PO_APPROVED' : 'PO_REJECTED',
        auditAction:
          decision === 'APPROVED' ? 'PO_APPROVED' : 'PO_REJECTED',
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'purchaseOrder',
            entityType: 'PURCHASE_ORDER',
            entityId: purchaseOrderId,
            required: true,
          },
        ],
        prepare: (current) => {
          const po = current.purchaseOrder as unknown as PurchaseOrderRecord;
          if (po.status !== 'PENDING_APPROVAL') {
            throw new AtomicMutationRejectedError(
              'PURCHASE_ORDER_STATE_CONFLICT',
              `Purchase order in state ${po.status} cannot be reviewed.`
            );
          }

          const creatorId = String(po.createdBy?.userId || '').trim();
          const elevatedAdmin = context.roles.some((role) =>
            ['SYSTEM_ADMIN', 'ADMINISTRATOR'].includes(role.toUpperCase())
          );
          if (
            creatorId &&
            creatorId === context.actorId &&
            !elevatedAdmin
          ) {
            throw new AtomicMutationRejectedError(
              'PURCHASE_ORDER_SELF_APPROVAL_DENIED',
              'Purchase order creator cannot approve their own financial commitment.'
            );
          }

          const now = new Date().toISOString();
          const approved = decision === 'APPROVED';
          const next: PurchaseOrderRecord = {
            ...po,
            status: decision as 'APPROVED' | 'REJECTED',
            approvedBy: approved
              ? {
                  userId: context.actorId,
                  userName: context.actorId,
                  approvalTier: 'SCM_FINANCIAL_APPROVAL',
                  approvedAt: now,
                }
              : undefined,
            approverId: context.actorId,
            approvedAt: approved ? now : undefined,
            approvalSignatures: [
              ...(po.approvalSignatures || []),
              {
                role: context.roles[0] || 'AUTHENTICATED_USER',
                signedBy: context.actorId,
                signedAt: now,
                signatureHash: crypto
                  .createHash('sha256')
                  .update(
                    [
                      context.tenantId,
                      po.poId,
                      decision,
                      context.actorId,
                      now,
                    ].join('|')
                  )
                  .digest('hex'),
                approved,
                tier: 'SCM_FINANCIAL_APPROVAL',
                comments: comments || undefined,
              },
            ],
            updatedAt: now,
          };

          return {
            domainState: next,
            eventPayload: {
              purchaseOrderId,
              poNumber: po.poNumber,
              decision,
              approverId: context.actorId,
              totalAmount: po.totalAmount,
              currency: po.currency,
            },
            auditReason: `${decision} purchase order ${po.poNumber}`,
            resultData: next,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: purchaseOrderId,
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

  public static async receivePurchaseOrder(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: Record<string, unknown>
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
        'INVENTORY_OFFICER',
        'PHARMACIST',
        'PROCUREMENT',
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
          message: auth.reason || 'Goods receiving authority required.',
        },
      };
    }

    const purchaseOrderId = String(payload.purchaseOrderId || '').trim();
    const deliveryNoteNumber = String(payload.deliveryNoteNumber || '').trim();
    const supplierInvoiceReference = String(
      payload.supplierInvoiceReference || ''
    ).trim();
    const incomingItems = Array.isArray(payload.items)
      ? (payload.items as GoodsReceiptNote['items'])
      : [];

    if (!purchaseOrderId || !deliveryNoteNumber || incomingItems.length === 0) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_GOODS_RECEIPT',
          message:
            'purchaseOrderId, deliveryNoteNumber and at least one received line are required.',
        },
      };
    }

    const grnId = newProcurementId('grn');

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'PURCHASE_ORDER',
        aggregateId: purchaseOrderId,
        eventType: 'GOODS_RECEIVED',
        auditAction: 'GOODS_RECEIVED',
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'purchaseOrder',
            entityType: 'PURCHASE_ORDER',
            entityId: purchaseOrderId,
            required: true,
          },
        ],
        prepare: (current) => {
          const po = current.purchaseOrder as unknown as PurchaseOrderRecord;
          if (
            ![
              'APPROVED',
              'SENT',
              'SENT_TO_SUPPLIER',
              'ACKNOWLEDGED',
              'PARTIALLY_RECEIVED',
            ].includes(po.status)
          ) {
            throw new AtomicMutationRejectedError(
              'PURCHASE_ORDER_NOT_RECEIVABLE',
              `Purchase order in state ${po.status} cannot receive goods.`
            );
          }

          const nextLines = po.items.map((poLine) => {
            const receiptLine = incomingItems.find(
              (line) => line.itemId === poLine.itemId
            );
            if (!receiptLine) return poLine;

            const remaining =
              poLine.quantityRemaining ??
              Math.max(
                0,
                poLine.quantityOrdered - Number(poLine.quantityReceived || 0)
              );
            if (
              receiptLine.quantityReceived < 0 ||
              receiptLine.quantityAccepted < 0 ||
              receiptLine.quantityRejected < 0 ||
              receiptLine.quantityDamaged < 0 ||
              receiptLine.quantityAccepted +
                receiptLine.quantityRejected +
                receiptLine.quantityDamaged >
                receiptLine.quantityReceived ||
              receiptLine.quantityReceived > remaining
            ) {
              throw new AtomicMutationRejectedError(
                'GOODS_RECEIPT_QUANTITY_INVALID',
                `Receipt quantity for item ${poLine.itemId} exceeds remaining ordered quantity or has invalid inspection totals.`
              );
            }

            const manufacture = Date.parse(receiptLine.manufactureDate);
            const expiry = Date.parse(receiptLine.expiryDate);
            if (
              !receiptLine.batchNumber ||
              !Number.isFinite(manufacture) ||
              !Number.isFinite(expiry) ||
              expiry <= manufacture
            ) {
              throw new AtomicMutationRejectedError(
                'GOODS_RECEIPT_BATCH_INVALID',
                `Valid batch and manufacture/expiry dates are required for ${poLine.itemId}.`
              );
            }

            const received =
              Number(poLine.quantityReceived || 0) +
              receiptLine.quantityReceived;
            return {
              ...poLine,
              quantityReceived: received,
              quantityRemaining: Math.max(
                0,
                poLine.quantityOrdered - received
              ),
              deliveryStatus:
                received >= poLine.quantityOrdered
                  ? 'FULLY_RECEIVED'
                  : 'PARTIALLY_RECEIVED',
            };
          });

          for (const line of incomingItems) {
            if (!po.items.some((poLine) => poLine.itemId === line.itemId)) {
              throw new AtomicMutationRejectedError(
                'GOODS_RECEIPT_ITEM_NOT_ORDERED',
                `Item ${line.itemId} is not on the authoritative purchase order.`
              );
            }
          }

          const allReceived = nextLines.every(
            (line) => Number(line.quantityRemaining || 0) === 0
          );
          const anyReceived = nextLines.some(
            (line) => Number(line.quantityReceived || 0) > 0
          );
          const now = new Date().toISOString();

          const grn: GoodsReceiptNote = {
            grnId,
            tenantId: context.tenantId,
            facilityId: po.facilityId,
            grnNumber: `GRN-${new Date().getUTCFullYear()}-${grnId.slice(-8).toUpperCase()}`,
            purchaseOrderId: po.poId,
            poNumber: po.poNumber,
            supplierId: po.supplierId,
            supplierName: po.supplierName,
            receivedBy: {
              userId: context.actorId,
              userName: context.actorId,
            },
            receivedAt: now,
            deliveryNoteNumber,
            supplierInvoiceReference: supplierInvoiceReference || undefined,
            items: incomingItems,
            inspectionStatus: incomingItems.some(
              (line) => line.temperatureExcursion || !line.inspectionPassed
            )
              ? 'QUARANTINED'
              : 'PASSED',
            status: 'INSPECTED',
            createdAt: now,
            updatedAt: now,
          };

          const nextPo: PurchaseOrderRecord = {
            ...po,
            items: nextLines,
            status: allReceived
              ? 'FULLY_RECEIVED'
              : anyReceived
                ? 'PARTIALLY_RECEIVED'
                : po.status,
            grnIds: Array.from(new Set([...(po.grnIds || []), grnId])),
            updatedAt: now,
          };

          return {
            domainState: nextPo,
            additionalStateWrites: [
              {
                entityType: 'GOODS_RECEIPT_NOTE',
                entityId: grnId,
                domainState: grn,
              },
            ],
            eventPayload: {
              grnId,
              purchaseOrderId: po.poId,
              poNumber: po.poNumber,
              inspectionStatus: grn.inspectionStatus,
              receivedLineCount: incomingItems.length,
            },
            auditReason: `Received goods against ${po.poNumber} as ${grn.grnNumber}`,
            resultData: {
              purchaseOrder: nextPo,
              goodsReceiptNote: grn,
              stockAvailabilityChanged: false,
              nextRequiredAction:
                'PUTAWAY_AND_RELEASE_REQUIRED_BEFORE_STOCK_BECOMES_AVAILABLE',
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: grnId,
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

}
