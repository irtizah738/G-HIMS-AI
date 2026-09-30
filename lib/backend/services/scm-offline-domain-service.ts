import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import type {
  InventoryBalance,
  PatientConsumptionRecord,
  GoodsReceiptNote,
  PurchaseOrderRecord,
  PurchaseRequisition,
  StockTransaction,
} from '@/types/scm-domain';
import { calculateDerivedBalance } from '@/lib/supply-chain/scm-engine';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
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
    if (
      !txn.transactionId ||
      !txn.itemId ||
      !txn.transactionType ||
      !Number.isFinite(txn.quantity) ||
      txn.quantity <= 0 ||
      !txn.uom
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_STOCK_TRANSACTION',
          message:
            'Stock transaction identity, item, type, UOM and positive quantity are required.',
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
        ],
        prepare: (current) => {
          const existing = current.balance as unknown as InventoryBalance | null;
          const base: InventoryBalance = existing || {
            balanceId,
            tenantId: context.tenantId,
            facilityId: canonicalTxn.facilityId,
            locationId,
            locationName:
              canonicalTxn.fromLocationId === locationId
                ? canonicalTxn.fromLocationName || locationId
                : canonicalTxn.toLocationName || locationId,
            itemId: canonicalTxn.itemId,
            itemCode: canonicalTxn.itemCode,
            itemName: canonicalTxn.itemName,
            itemType: 'MEDICAL_CONSUMABLE',
            batchId: canonicalTxn.batchId || '',
            batchNumber: canonicalTxn.batchNumber || '',
            expiryDate: canonicalTxn.expirationDate || '',
            onHand: 0,
            reserved: 0,
            quarantined: 0,
            damaged: 0,
            expired: 0,
            inTransit: 0,
            available: 0,
            uom: canonicalTxn.uom,
            minimumStock: 0,
            maximumStock: 0,
            reorderPoint: 0,
            unitCost: canonicalTxn.unitCost || 0,
            totalValuation: 0,
            lastMovementAt: canonicalTxn.recordedAt,
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
            deductionTypes.has(canonicalTxn.transactionType) &&
            base.available < canonicalTxn.quantity
          ) {
            throw new AtomicMutationRejectedError(
              'INVENTORY_STATE_CONFLICT',
              `Available stock ${base.available} is below requested quantity ${canonicalTxn.quantity}.`,
              {
                balanceId,
                available: base.available,
                requested: canonicalTxn.quantity,
              }
            );
          }

          const nextBalance = calculateDerivedBalance(base, canonicalTxn);
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

          return {
            domainState: canonicalTxn,
            additionalStateWrites: [
              {
                entityType: 'INVENTORY_BALANCE',
                entityId: balanceId,
                domainState: nextBalance,
              },
            ],
            eventPayload: {
              transactionId: canonicalTxn.transactionId,
              itemId: canonicalTxn.itemId,
              quantity: canonicalTxn.quantity,
              transactionType: canonicalTxn.transactionType,
              balanceId,
              locationId,
              batchId: canonicalTxn.batchId,
            },
            auditReason: `${canonicalTxn.transactionType} ${canonicalTxn.quantity} ${canonicalTxn.uom} ${canonicalTxn.itemName}`,
            resultData: {
              transaction: canonicalTxn,
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
            status: 'APPROVED',
            createdBy: {
              userId: context.actorId,
              userName: context.actorId,
              role: context.roles[0] || 'AUTHENTICATED_USER',
            },
            approvedBy: {
              userId: context.actorId,
              userName: context.actorId,
              approvalTier: 'SCM_APPROVED_PR_CONVERSION',
              approvedAt: now,
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
            ['CLOSED', 'CANCELLED', 'REJECTED'].includes(po.status)
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
