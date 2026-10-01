import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import type {
  BatchLotRecord,
  GoodsReceiptNote,
  InventoryBalance,
  InventoryLocation,
  ItemMaster,
  PurchaseOrderRecord,
  PurchaseRequisition,
  SupplierMaster,
} from '@/types/scm-domain';
import {
  inventoryPeriodCloseId,
  isInventoryPeriodBlocked,
  periodKeyFromIso,
} from '@/lib/supply-chain/inventory-costing';
import type { SupplierContract } from '@/types/scm-sourcing';
import { validatePurchaseOrderAgainstContract } from '@/lib/supply-chain/supplier-sourcing';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';

type RequisitionDecision = 'APPROVED' | 'REJECTED';
type PurchaseOrderDecision = 'APPROVED' | 'REJECTED';

interface ApproveRequisitionPayload {
  requisitionId: string;
  decision: RequisitionDecision;
  comments?: string;
  approvedLines?: Array<{
    itemId: string;
    approvedQuantity: number;
  }>;
}

interface CreatePurchaseOrderPayload {
  poId: string;
  poNumber: string;
  requisitionId: string;
  supplierId: string;
  contractId?: string;
  emergencyWaiverReason?: string;
  currency: string;
  paymentTerms: string;
  expectedDeliveryDate: string;
  destinationLocationId: string;
  destinationLocationName?: string;
  items: Array<{
    lineId: string;
    itemId: string;
    quantityOrdered: number;
    uom: string;
    unitPrice: number;
    discount?: number;
    taxPercent?: number;
  }>;
}

interface ApprovePurchaseOrderPayload {
  poId: string;
  decision: PurchaseOrderDecision;
  comments?: string;
}

interface ReceiptLinePayload {
  itemId: string;
  batchId?: string;
  batchNumber?: string;
  lotNumber?: string;
  quantityReceived: number;
  quantityAccepted: number;
  quantityRejected: number;
  quantityDamaged: number;
  uom: string;
  expiryDate?: string;
  manufactureDate?: string;
  manufacturer?: string;
  recordedTemperatureCelsius?: number;
  temperatureExcursion?: boolean;
  inspectionPassed: boolean;
  inspectionNotes?: string;
  unitCost: number;
}

interface RecordGoodsReceiptPayload {
  grnId: string;
  facilityId: string;
  grnNumber: string;
  purchaseOrderId: string;
  deliveryNoteNumber: string;
  supplierInvoiceReference?: string;
  receivedAt: string;
  inspectionStatus: 'PASSED' | 'FAILED' | 'PARTIAL' | 'QUARANTINED';
  destinationLocationId: string;
  destinationLocationName?: string;
  notes?: string;
  items: ReceiptLinePayload[];
}

function isAdministrative(context: CommandContext): boolean {
  return (
    context.roles.includes('SYSTEM_ADMIN') ||
    context.roles.includes('ADMINISTRATOR')
  );
}

function assertFacilityScope(
  context: CommandContext,
  facilityId: string
): void {
  if (
    !isAdministrative(context) &&
    context.facilityIds?.length &&
    !context.facilityIds.includes(facilityId)
  ) {
    throw new AtomicMutationRejectedError(
      'FACILITY_SCOPE_MISMATCH',
      'Supply-chain facility is outside the authenticated actor scope.'
    );
  }
}

function balanceId(
  tenantId: string,
  facilityId: string,
  locationId: string,
  itemId: string,
  batchId: string
): string {
  return [tenantId, facilityId, locationId, itemId, batchId].join('_');
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function toStockQuantity(
  item: ItemMaster,
  quantity: number,
  fromUom: string
): { quantity: number; factor: number } {
  if (fromUom === item.stockUOM) {
    return { quantity, factor: 1 };
  }

  const direct = (item.conversionRules || []).find(
    (rule) =>
      rule.fromUOM === fromUom &&
      rule.toUOM === item.stockUOM &&
      Number.isFinite(Number(rule.factor)) &&
      Number(rule.factor) > 0
  );
  if (!direct) {
    throw new AtomicMutationRejectedError(
      'SCM_UOM_CONVERSION_MISSING',
      `No authoritative conversion exists from ${fromUom} to stock UOM ${item.stockUOM} for ${item.itemCode}.`
    );
  }

  return {
    quantity: quantity * Number(direct.factor),
    factor: Number(direct.factor),
  };
}

function recomputeAvailable(balance: InventoryBalance): InventoryBalance {
  const next = { ...balance };
  next.available = Math.max(
    0,
    next.onHand -
      next.reserved -
      next.quarantined -
      next.damaged -
      next.expired
  );
  next.totalValuation = roundMoney(next.onHand * next.unitCost);
  next.version = (next.version || 0) + 1;
  next.lastMovementAt = new Date().toISOString();
  return next;
}

function rejection(
  commandId: string,
  idempotencyKey: string,
  code: string,
  message: string,
  details?: unknown
): CommandResult {
  return {
    success: false,
    commandId,
    idempotencyKey,
    error: { code, message, details },
  };
}

export class ScmProcurementDomainService {
  public static async approvePurchaseRequisition(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ApproveRequisitionPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
        'PROCUREMENT_MANAGER',
        'DEPARTMENT_HEAD',
        'FINANCE_MANAGER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Requisition approval authority required.'
      );
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'PURCHASE_REQUISITION',
        aggregateId: payload.requisitionId,
        eventType:
          payload.decision === 'APPROVED' ? 'PR_APPROVED' : 'PR_REJECTED',
        auditAction:
          payload.decision === 'APPROVED' ? 'PR_APPROVED' : 'PR_REJECTED',
        auditResourceType: 'PURCHASE_REQUISITION',
        auditResourceId: payload.requisitionId,
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'requisition',
            entityType: 'PURCHASE_REQUISITION',
            entityId: payload.requisitionId,
            required: true,
          },
        ],
        prepare: (current) => {
          const requisition =
            current.requisition as unknown as PurchaseRequisition;

          assertFacilityScope(context, requisition.facilityId);

          if (!['SUBMITTED', 'PENDING_APPROVAL'].includes(requisition.status)) {
            throw new AtomicMutationRejectedError(
              'PR_STATE_CONFLICT',
              `Requisition cannot be reviewed from status ${requisition.status}.`
            );
          }

          if (requisition.requestedBy?.userId === context.actorId) {
            throw new AtomicMutationRejectedError(
              'SCM_SEGREGATION_OF_DUTIES',
              'The requisition requester cannot approve or reject their own requisition.'
            );
          }

          const approvedByItem = new Map(
            (payload.approvedLines || []).map((line) => [
              line.itemId,
              line.approvedQuantity,
            ])
          );

          const items = requisition.items.map((line) => {
            const approved =
              payload.decision === 'REJECTED'
                ? 0
                : approvedByItem.has(line.itemId)
                  ? Number(approvedByItem.get(line.itemId))
                  : line.requestedQuantity;

            if (
              !Number.isFinite(approved) ||
              approved < 0 ||
              approved > line.requestedQuantity
            ) {
              throw new AtomicMutationRejectedError(
                'INVALID_PR_APPROVED_QUANTITY',
                `Approved quantity for ${line.itemCode} exceeds the requested quantity or is invalid.`
              );
            }

            return {
              ...line,
              approvedQuantity: approved,
            };
          });

          if (
            payload.decision === 'APPROVED' &&
            !items.some((line) => Number(line.approvedQuantity || 0) > 0)
          ) {
            throw new AtomicMutationRejectedError(
              'PR_EMPTY_APPROVAL',
              'An approved requisition must contain at least one approved line.'
            );
          }

          const now = new Date().toISOString();
          const next: PurchaseRequisition = {
            ...requisition,
            items,
            status:
              payload.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
            approvalHistory: [
              ...(requisition.approvalHistory || []),
              {
                level: 'PROCUREMENT_APPROVAL',
                approverName: context.actorId,
                decision: payload.decision,
                comments: payload.comments,
                timestamp: now,
              },
            ],
            updatedAt: now,
          };

          return {
            domainState: next,
            eventPayload: {
              requisitionId: next.requisitionId,
              requisitionNumber: next.requisitionNumber,
              decision: payload.decision,
              approverId: context.actorId,
              approvedLines: items.map((line) => ({
                itemId: line.itemId,
                approvedQuantity: line.approvedQuantity || 0,
              })),
            },
            auditReason: `${payload.decision} purchase requisition ${next.requisitionNumber}`,
            resultData: next,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.requisitionId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async createPurchaseOrder(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CreatePurchaseOrderPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'PROCUREMENT',
        'PROCUREMENT_OFFICER',
        'PROCUREMENT_MANAGER',
        'SCM_MANAGER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Purchase order creation authority required.'
      );
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'PURCHASE_ORDER',
        aggregateId: payload.poId,
        eventType: 'PO_GENERATED',
        auditAction: 'PO_GENERATED',
        auditResourceType: 'PURCHASE_ORDER',
        auditResourceId: payload.poId,
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'requisition',
            entityType: 'PURCHASE_REQUISITION',
            entityId: payload.requisitionId,
            required: true,
          },
          {
            key: 'supplier',
            entityType: 'SUPPLIER_MASTER',
            entityId: payload.supplierId,
            required: true,
          },
          {
            key: 'destination',
            entityType: 'INVENTORY_LOCATION',
            entityId: payload.destinationLocationId,
            required: true,
          },
          ...(payload.contractId
            ? [{
                key: 'contract',
                entityType: 'SUPPLIER_CONTRACT',
                entityId: payload.contractId,
                required: true,
              }]
            : []),
        ],
        prepare: (current) => {
          const requisition =
            current.requisition as unknown as PurchaseRequisition;
          const supplier = current.supplier as unknown as SupplierMaster;
          const destination =
            current.destination as unknown as InventoryLocation;
          const contract = payload.contractId
            ? (current.contract as unknown as SupplierContract)
            : null;

          assertFacilityScope(context, requisition.facilityId);

          if (requisition.status !== 'APPROVED') {
            throw new AtomicMutationRejectedError(
              'PR_NOT_APPROVED',
              'A purchase order can only be created from an approved requisition.'
            );
          }
          if (requisition.convertedPOId) {
            throw new AtomicMutationRejectedError(
              'PR_ALREADY_CONVERTED',
              'This requisition has already been converted to a purchase order.'
            );
          }
          if (supplier.status !== 'ACTIVE') {
            throw new AtomicMutationRejectedError(
              'SUPPLIER_NOT_ACTIVE',
              'Purchase orders may only be issued to an active supplier.'
            );
          }

          const emergencyWaiverReason = String(
            payload.emergencyWaiverReason || ''
          ).trim();
          if (!contract) {
            if (
              requisition.priority !== 'EMERGENCY' ||
              emergencyWaiverReason.length < 20
            ) {
              throw new AtomicMutationRejectedError(
                'SUPPLIER_CONTRACT_REQUIRED',
                'Routine purchase orders require an active supplier contract. Emergency off-contract procurement requires a substantive waiver reason.'
              );
            }
          }
          if (
            destination.facilityId !== requisition.facilityId ||
            !destination.active
          ) {
            throw new AtomicMutationRejectedError(
              'PO_DESTINATION_INVALID',
              'Purchase order destination must be an active location in the requisition facility.'
            );
          }

          const requisitionByItem = new Map(
            requisition.items.map((line) => [line.itemId, line])
          );

          const seenPoItemIds = new Set<string>();
          const poLines = payload.items.map((line) => {
            if (seenPoItemIds.has(line.itemId)) {
              throw new AtomicMutationRejectedError(
                'DUPLICATE_PO_ITEM',
                `Purchase order cannot contain duplicate item ${line.itemId}.`
              );
            }
            seenPoItemIds.add(line.itemId);
            const reqLine = requisitionByItem.get(line.itemId);
            if (!reqLine) {
              throw new AtomicMutationRejectedError(
                'PO_ITEM_NOT_IN_REQUISITION',
                `Item ${line.itemId} was not approved on the source requisition.`
              );
            }

            const approvedQuantity = Number(
              reqLine.approvedQuantity ?? reqLine.requestedQuantity
            );
            if (
              !Number.isFinite(line.quantityOrdered) ||
              line.quantityOrdered <= 0 ||
              line.quantityOrdered > approvedQuantity ||
              !Number.isFinite(line.unitPrice) ||
              line.unitPrice < 0 ||
              line.uom !== reqLine.uom
            ) {
              throw new AtomicMutationRejectedError(
                'INVALID_PO_LINE',
                `PO line for ${reqLine.itemCode} exceeds approved quantity, has invalid price, or uses an unauthorized UOM.`
              );
            }

            const discount = Number(line.discount || 0);
            const taxPercent = Number(line.taxPercent || 0);
            if (
              !Number.isFinite(discount) ||
              discount < 0 ||
              !Number.isFinite(taxPercent) ||
              taxPercent < 0
            ) {
              throw new AtomicMutationRejectedError(
                'INVALID_PO_LINE_FINANCIALS',
                'PO discount and tax values must be non-negative finite numbers.'
              );
            }

            const gross = line.quantityOrdered * line.unitPrice;
            const netBeforeTax = Math.max(0, gross - discount);
            const tax = netBeforeTax * (taxPercent / 100);

            return {
              lineId: line.lineId,
              itemId: reqLine.itemId,
              itemCode: reqLine.itemCode,
              itemName: reqLine.itemName,
              description: reqLine.itemName,
              quantityOrdered: line.quantityOrdered,
              quantityReceived: 0,
              quantityRemaining: line.quantityOrdered,
              uom: reqLine.uom,
              unitPrice: roundMoney(line.unitPrice),
              unitCost: roundMoney(line.unitPrice),
              discount: roundMoney(discount),
              taxPercent,
              taxRate: taxPercent,
              lineTotal: roundMoney(netBeforeTax + tax),
              deliveryStatus: 'OPEN',
            };
          });

          if (poLines.length === 0) {
            throw new AtomicMutationRejectedError(
              'EMPTY_PURCHASE_ORDER',
              'Purchase order requires at least one approved line.'
            );
          }

          if (contract) {
            try {
              validatePurchaseOrderAgainstContract({
                contract,
                po: {
                  supplierId: supplier.supplierId,
                  currency: payload.currency,
                  paymentTerms: payload.paymentTerms,
                  orderDate: new Date().toISOString(),
                  lines: poLines.map((line) => ({
                    itemId: line.itemId,
                    uom: line.uom,
                    unitPriceMinorUnits: Math.round(line.unitPrice * 100),
                    quantity: line.quantityOrdered,
                  })),
                },
              });
            } catch (error) {
              throw new AtomicMutationRejectedError(
                'SUPPLIER_CONTRACT_VALIDATION_FAILED',
                error instanceof Error
                  ? error.message
                  : 'Purchase order violates supplier contract controls.'
              );
            }
          }

          const subtotal = roundMoney(
            poLines.reduce(
              (sum, line) =>
                sum + line.quantityOrdered * line.unitPrice,
              0
            )
          );
          const discountTotal = roundMoney(
            poLines.reduce((sum, line) => sum + Number(line.discount || 0), 0)
          );
          const taxTotal = roundMoney(
            poLines.reduce((sum, line) => {
              const gross = line.quantityOrdered * line.unitPrice;
              const net = Math.max(0, gross - Number(line.discount || 0));
              return sum + net * (Number(line.taxPercent || 0) / 100);
            }, 0)
          );
          const totalAmount = roundMoney(
            subtotal - discountTotal + taxTotal
          );
          const contractSpendMinorUnits = contract
            ? poLines.reduce(
                (sum, line) =>
                  sum +
                  Math.round(
                    line.quantityOrdered * line.unitPrice * 100
                  ),
                0
              )
            : 0;
          const reservedContract = contract
            ? {
                ...contract,
                reservedSpendMinorUnits:
                  Number(contract.reservedSpendMinorUnits || 0) +
                  contractSpendMinorUnits,
                reservedQuantityByItem: poLines.reduce(
                  (acc, line) => ({
                    ...acc,
                    [line.itemId]:
                      Number(
                        contract.reservedQuantityByItem?.[line.itemId] || 0
                      ) + line.quantityOrdered,
                  }),
                  { ...(contract.reservedQuantityByItem || {}) }
                ),
                updatedAt: new Date().toISOString(),
              }
            : null;
          const now = new Date().toISOString();

          const po: PurchaseOrderRecord = {
            poId: payload.poId,
            tenantId: context.tenantId,
            facilityId: requisition.facilityId,
            poNumber: payload.poNumber,
            requisitionId: requisition.requisitionId,
            requisitionNumber: requisition.requisitionNumber,
            supplierId: supplier.supplierId,
            supplierName: supplier.displayName || supplier.legalName,
            contractId: contract?.contractId,
            contractNumber: contract?.contractNumber,
            contractReservedSpendMinorUnits:
              contract ? contractSpendMinorUnits : undefined,
            emergencyContractWaiver: contract
              ? undefined
              : { reason: emergencyWaiverReason },
            items: poLines,
            currency: payload.currency.toUpperCase(),
            subtotal,
            discountTotal,
            taxTotal,
            taxAmount: taxTotal,
            shippingCost: 0,
            shippingCharges: 0,
            totalAmount,
            paymentTerms: payload.paymentTerms,
            expectedDeliveryDate: payload.expectedDeliveryDate,
            orderDate: now,
            status: 'PENDING_APPROVAL',
            createdBy: {
              userId: context.actorId,
              userName: context.actorId,
              role: context.roles[0] || 'AUTHENTICATED_USER',
            },
            destinationLocationId: destination.locationId,
            destinationLocationName:
              payload.destinationLocationName || destination.name,
            grnIds: [],
            createdAt: now,
            updatedAt: now,
          };

          const convertedRequisition: PurchaseRequisition = {
            ...requisition,
            status: 'CONVERTED_TO_PO',
            convertedPOId: po.poId,
            updatedAt: now,
          };

          return {
            domainState: po,
            additionalStateWrites: [
              {
                entityType: 'PURCHASE_REQUISITION',
                entityId: requisition.requisitionId,
                domainState: convertedRequisition,
              },
              ...(reservedContract
                ? [{
                    entityType: 'SUPPLIER_CONTRACT',
                    entityId: reservedContract.contractId,
                    domainState: reservedContract,
                  }]
                : []),
            ],
            eventPayload: {
              poId: po.poId,
              poNumber: po.poNumber,
              requisitionId: po.requisitionId,
              supplierId: po.supplierId,
              contractId: po.contractId,
              emergencyContractWaiver: Boolean(po.emergencyContractWaiver),
              facilityId: po.facilityId,
              totalAmount: po.totalAmount,
              currency: po.currency,
              itemCount: po.items.length,
            },
            auditReason: `Generated purchase order ${po.poNumber} from requisition ${requisition.requisitionNumber}`,
            resultData: po,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.poId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async approvePurchaseOrder(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ApprovePurchaseOrderPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
        'PROCUREMENT_MANAGER',
        'FINANCE_MANAGER',
        'CFO',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
      requiredPermissions: ['SCM_PURCHASE_ORDER:APPROVE'],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Purchase order approval authority required.'
      );
    }

    try {
      const poPreflight = await DomainStateRepository.getById<PurchaseOrderRecord>(
        context.tenantId,
        'scmPurchaseOrders',
        payload.poId
      );

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'PURCHASE_ORDER',
        aggregateId: payload.poId,
        eventType:
          payload.decision === 'APPROVED' ? 'PO_APPROVED' : 'PO_REJECTED',
        auditAction:
          payload.decision === 'APPROVED' ? 'PO_APPROVED' : 'PO_REJECTED',
        auditResourceType: 'PURCHASE_ORDER',
        auditResourceId: payload.poId,
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'po',
            entityType: 'PURCHASE_ORDER',
            entityId: payload.poId,
            required: true,
          },
          ...(poPreflight?.contractId
            ? [{
                key: 'contract',
                entityType: 'SUPPLIER_CONTRACT',
                entityId: poPreflight.contractId,
                required: true,
              }]
            : []),
        ],
        prepare: (current) => {
          const po = current.po as unknown as PurchaseOrderRecord;
          const contract = po.contractId
            ? (current.contract as unknown as SupplierContract)
            : null;
          assertFacilityScope(context, po.facilityId);

          if (!['PENDING_APPROVAL', 'SUBMITTED'].includes(po.status)) {
            throw new AtomicMutationRejectedError(
              'PO_STATE_CONFLICT',
              `Purchase order cannot be reviewed from status ${po.status}.`
            );
          }
          if (po.createdBy?.userId === context.actorId) {
            throw new AtomicMutationRejectedError(
              'SCM_SEGREGATION_OF_DUTIES',
              'Purchase order creator cannot approve or reject their own order.'
            );
          }

          let nextContract: SupplierContract | null = null;
          if (po.contractId) {
            if (!contract || contract.contractId !== po.contractId) {
              throw new AtomicMutationRejectedError(
                'PO_CONTRACT_STATE_MISSING',
                'Purchase order contract reservation is missing.'
              );
            }
            const reservedSpend = Number(
              po.contractReservedSpendMinorUnits || 0
            );
            if (
              reservedSpend <= 0 ||
              Number(contract.reservedSpendMinorUnits || 0) < reservedSpend
            ) {
              throw new AtomicMutationRejectedError(
                'PO_CONTRACT_RESERVATION_CONFLICT',
                'Contract spend reservation is inconsistent with the purchase order.'
              );
            }

            const nextReservedQuantities = {
              ...(contract.reservedQuantityByItem || {}),
            };
            const nextCommittedQuantities = {
              ...(contract.committedQuantityByItem || {}),
            };
            for (const line of po.items) {
              const reserved = Number(
                nextReservedQuantities[line.itemId] || 0
              );
              if (reserved < line.quantityOrdered) {
                throw new AtomicMutationRejectedError(
                  'PO_CONTRACT_QUANTITY_RESERVATION_CONFLICT',
                  `Contract quantity reservation is inconsistent for ${line.itemId}.`
                );
              }
              nextReservedQuantities[line.itemId] =
                reserved - line.quantityOrdered;
              if (payload.decision === 'APPROVED') {
                nextCommittedQuantities[line.itemId] =
                  Number(nextCommittedQuantities[line.itemId] || 0) +
                  line.quantityOrdered;
              }
            }

            nextContract = {
              ...contract,
              reservedSpendMinorUnits:
                Number(contract.reservedSpendMinorUnits || 0) -
                reservedSpend,
              committedSpendMinorUnits:
                Number(contract.committedSpendMinorUnits || 0) +
                (payload.decision === 'APPROVED' ? reservedSpend : 0),
              reservedQuantityByItem: nextReservedQuantities,
              committedQuantityByItem: nextCommittedQuantities,
              updatedAt: new Date().toISOString(),
            };
          }

          const now = new Date().toISOString();
          const next: PurchaseOrderRecord = {
            ...po,
            status:
              payload.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
            emergencyContractWaiver:
              payload.decision === 'APPROVED' && po.emergencyContractWaiver
                ? {
                    ...po.emergencyContractWaiver,
                    approvedBy: context.actorId,
                  }
                : po.emergencyContractWaiver,
            ...(payload.decision === 'APPROVED'
              ? {
                  approvedBy: {
                    userId: context.actorId,
                    userName: context.actorId,
                    approvalTier: 'PROCUREMENT_APPROVER',
                    approvedAt: now,
                  },
                  approverId: context.actorId,
                  approvedAt: now,
                }
              : {}),
            approvalSignatures: [
              ...(po.approvalSignatures || []),
              {
                role: context.roles[0] || 'AUTHENTICATED_USER',
                signedBy: context.actorId,
                signedAt: now,
                signatureHash: `cmd:${commandId}`,
                approved: payload.decision === 'APPROVED',
                comments: payload.comments,
              },
            ],
            updatedAt: now,
          };

          return {
            domainState: next,
            additionalStateWrites: nextContract
              ? [{
                  entityType: 'SUPPLIER_CONTRACT',
                  entityId: nextContract.contractId,
                  domainState: nextContract,
                }]
              : [],
            eventPayload: {
              poId: next.poId,
              poNumber: next.poNumber,
              decision: payload.decision,
              approverId: context.actorId,
              totalAmount: next.totalAmount,
              currency: next.currency,
            },
            auditReason: `${payload.decision} purchase order ${next.poNumber}`,
            resultData: next,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.poId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }

  public static async recordGoodsReceipt(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: RecordGoodsReceiptPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'STORE_KEEPER',
        'INVENTORY_OFFICER',
        'SCM_MANAGER',
        'PHARMACIST',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Goods receipt authority required.'
      );
    }

    if (!Number.isFinite(Date.parse(payload.receivedAt))) {
      return rejection(
        commandId,
        idempotencyKey,
        'INVALID_GRN_RECEIVED_DATE',
        'Goods receipt date is invalid.'
      );
    }
    const periodCloseId = inventoryPeriodCloseId(
      payload.facilityId,
      periodKeyFromIso(payload.receivedAt)
    );

    const normalizedLines = payload.items.map((line) => ({
      ...line,
      batchId:
        String(line.batchId || '').trim() ||
        `UNBATCHED_${line.itemId}`,
    }));

    const readTargets = [
      {
        key: 'periodClose',
        entityType: 'INVENTORY_PERIOD_CLOSE',
        entityId: periodCloseId,
        required: false,
      },
      {
        key: 'po',
        entityType: 'PURCHASE_ORDER',
        entityId: payload.purchaseOrderId,
        required: true,
      },
      {
        key: 'destination',
        entityType: 'INVENTORY_LOCATION',
        entityId: payload.destinationLocationId,
        required: true,
      },
      ...normalizedLines.flatMap((line, index) => [
        {
          key: `item:${index}`,
          entityType: 'ITEM_MASTER',
          entityId: line.itemId,
          required: true,
        },
        {
          key: `batch:${index}`,
          entityType: 'BATCH_LOT',
          entityId: line.batchId,
          required: false,
        },
        {
          key: `balance:${index}`,
          entityType: 'INVENTORY_BALANCE',
          entityId: balanceId(
            context.tenantId,
            payload.facilityId,
            payload.destinationLocationId,
            line.itemId,
            line.batchId
          ),
          required: false,
        },
      ]),
    ];

    try {
      const poSnapshot = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'GOODS_RECEIPT_NOTE',
        aggregateId: payload.grnId,
        eventType:
          payload.inspectionStatus === 'FAILED'
            ? 'GRN_INSPECTION_FAILED'
            : payload.inspectionStatus === 'QUARANTINED'
              ? 'GRN_QUARANTINED'
              : 'GRN_RECORDED',
        auditAction:
          payload.inspectionStatus === 'FAILED'
            ? 'GRN_INSPECTION_FAILED'
            : payload.inspectionStatus === 'QUARANTINED'
              ? 'GRN_QUARANTINED'
              : 'GRN_RECORDED',
        auditResourceType: 'GOODS_RECEIPT_NOTE',
        auditResourceId: payload.grnId,
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets,
        prepare: (current) => {
          if (isInventoryPeriodBlocked(current.periodClose)) {
            throw new AtomicMutationRejectedError(
              'INVENTORY_PERIOD_BLOCKED',
              'Goods receipt cannot post into an inventory period that is closing or closed.'
            );
          }

          const po = current.po as unknown as PurchaseOrderRecord;
          const destination =
            current.destination as unknown as InventoryLocation;
          assertFacilityScope(context, po.facilityId);

          if (
            po.facilityId !== payload.facilityId ||
            destination.facilityId !== po.facilityId ||
            !destination.active
          ) {
            throw new AtomicMutationRejectedError(
              'GRN_FACILITY_OR_LOCATION_MISMATCH',
              'GRN facility and destination must match an active location on the authoritative purchase order.'
            );
          }

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
              'PO_NOT_RECEIVABLE',
              `Goods cannot be received against PO status ${po.status}.`
            );
          }

          const destinationLocationId = destination.locationId;
          if (
            po.destinationLocationId &&
            po.destinationLocationId !== destinationLocationId
          ) {
            throw new AtomicMutationRejectedError(
              'GRN_DESTINATION_MISMATCH',
              'GRN destination does not match the authoritative PO destination.'
            );
          }

          const poLines = new Map(
            po.items.map((line) => [line.itemId, line])
          );
          const writes: Array<{
            entityType: string;
            entityId: string;
            domainState: unknown;
          }> = [];
          const canonicalItems: GoodsReceiptNote['items'] = [];
          const nextPoLines = po.items.map((line) => ({ ...line }));
          const receiptTransactionIds: string[] = [];
          const seenReceiptItems = new Set<string>();
          let grniAccrualMinorUnits = 0;
          let grniPharmacyInventoryMinorUnits = 0;
          let grniSuppliesInventoryMinorUnits = 0;

          for (let index = 0; index < normalizedLines.length; index += 1) {
            const line = normalizedLines[index];
            const poLine = poLines.get(line.itemId);
            const item = current[`item:${index}`] as unknown as ItemMaster;
            const existingBatch =
              current[`batch:${index}`] as unknown as BatchLotRecord | null;

            if (seenReceiptItems.has(line.itemId)) {
              throw new AtomicMutationRejectedError(
                'DUPLICATE_GRN_ITEM',
                `GRN cannot contain duplicate item ${line.itemId}; consolidate quantities per item/batch receipt.`
              );
            }
            seenReceiptItems.add(line.itemId);

            if (!poLine) {
              throw new AtomicMutationRejectedError(
                'GRN_ITEM_NOT_ON_PO',
                `Item ${line.itemId} is not present on the purchase order.`
              );
            }
            if (!item || item.isActive === false) {
              throw new AtomicMutationRejectedError(
                'SCM_ITEM_NOT_ACTIVE',
                'Goods receipt references an inactive or missing item.'
              );
            }

            const received = Number(line.quantityReceived);
            const accepted = Number(line.quantityAccepted);
            const rejected = Number(line.quantityRejected);
            const damaged = Number(line.quantityDamaged);

            if (
              ![received, accepted, rejected, damaged].every(
                (value) => Number.isFinite(value) && value >= 0
              ) ||
              received <= 0 ||
              roundMoney(accepted + rejected + damaged) !==
                roundMoney(received)
            ) {
              throw new AtomicMutationRejectedError(
                'INVALID_GRN_QUANTITIES',
                'Received quantity must equal accepted + rejected + damaged quantities.'
              );
            }

            if (payload.inspectionStatus === 'FAILED' && accepted > 0) {
              throw new AtomicMutationRejectedError(
                'FAILED_INSPECTION_CANNOT_ACCEPT_STOCK',
                'A failed inspection cannot place accepted stock into inventory.'
              );
            }
            if (
              payload.inspectionStatus === 'PASSED' &&
              (rejected > 0 || damaged > 0 || !line.inspectionPassed)
            ) {
              throw new AtomicMutationRejectedError(
                'GRN_INSPECTION_STATUS_CONFLICT',
                'PASSED inspection status cannot contain rejected, damaged, or failed-inspection lines.'
              );
            }
            if (
              item.requiresTemperatureTracking &&
              !Number.isFinite(Number(line.recordedTemperatureCelsius))
            ) {
              throw new AtomicMutationRejectedError(
                'GRN_TEMPERATURE_REQUIRED',
                `Temperature-tracked item ${item.itemCode} requires a recorded receipt temperature.`
              );
            }

            const alreadyReceived = Number(poLine.quantityReceived || 0);
            const remaining = Math.max(
              0,
              poLine.quantityOrdered - alreadyReceived
            );
            if (received > remaining) {
              throw new AtomicMutationRejectedError(
                'GRN_EXCEEDS_PO_REMAINDER',
                `Received quantity for ${poLine.itemCode} exceeds remaining PO quantity.`,
                { remaining, received }
              );
            }
            if (line.uom !== poLine.uom) {
              throw new AtomicMutationRejectedError(
                'GRN_UOM_MISMATCH',
                'Goods receipt UOM must match the purchase order UOM.'
              );
            }
            if (
              item.requiresBatchTracking &&
              (!String(line.batchNumber || '').trim() ||
                line.batchId.startsWith('UNBATCHED_'))
            ) {
              throw new AtomicMutationRejectedError(
                'GRN_BATCH_REQUIRED',
                `Batch-tracked item ${item.itemCode} requires a batch identity and batch number.`
              );
            }
            if (
              item.requiresExpiryTracking &&
              !String(line.expiryDate || '').trim()
            ) {
              throw new AtomicMutationRejectedError(
                'GRN_EXPIRY_REQUIRED',
                `Expiry-tracked item ${item.itemCode} requires an expiry date.`
              );
            }

            const expiryMs = line.expiryDate
              ? Date.parse(line.expiryDate)
              : Number.POSITIVE_INFINITY;
            if (
              line.expiryDate &&
              (!Number.isFinite(expiryMs) ||
                expiryMs <= Date.parse(payload.receivedAt))
            ) {
              throw new AtomicMutationRejectedError(
                'GRN_EXPIRED_STOCK',
                `Received batch for ${item.itemCode} is already expired or has an invalid expiry date.`
              );
            }

            const poUnitCost = Number(poLine.unitPrice);
            if (!Number.isFinite(poUnitCost) || poUnitCost < 0) {
              throw new AtomicMutationRejectedError(
                'INVALID_PO_UNIT_COST',
                'Authoritative PO unit cost is invalid.'
              );
            }
            const acceptedStock = toStockQuantity(item, accepted, line.uom);
            const poDiscountMinorUnits = Math.round(
              Number(poLine.discount || 0) * 100
            );
            const allocatedDiscountMinorUnits =
              poLine.quantityOrdered > 0
                ? Math.round(
                    (accepted / poLine.quantityOrdered) *
                      poDiscountMinorUnits
                  )
                : 0;
            const acceptedAccrualMinorUnits = Math.max(
              0,
              Math.round(accepted * poUnitCost * 100) -
                allocatedDiscountMinorUnits
            );
            grniAccrualMinorUnits += acceptedAccrualMinorUnits;
            if (item.itemType === 'MEDICATION') {
              grniPharmacyInventoryMinorUnits += acceptedAccrualMinorUnits;
            } else {
              grniSuppliesInventoryMinorUnits += acceptedAccrualMinorUnits;
            }
            const stockUnitCost =
              acceptedStock.factor > 0
                ? roundMoney(poUnitCost / acceptedStock.factor)
                : poUnitCost;

            const quarantined =
              payload.inspectionStatus === 'QUARANTINED' ||
              Boolean(line.temperatureExcursion) ||
              (item.requiresQualityInspection && !line.inspectionPassed);

            if (existingBatch && existingBatch.itemId !== item.itemId) {
              throw new AtomicMutationRejectedError(
                'SCM_BATCH_ITEM_MISMATCH',
                'Existing batch identity belongs to a different item.'
              );
            }
            if (
              existingBatch &&
              String(line.batchNumber || '').trim() &&
              existingBatch.batchNumber !== String(line.batchNumber).trim()
            ) {
              throw new AtomicMutationRejectedError(
                'SCM_BATCH_NUMBER_CONFLICT',
                'Existing batch identity cannot be reused with a different batch number.'
              );
            }
            if (
              existingBatch &&
              line.expiryDate &&
              existingBatch.expiryDate !== line.expiryDate
            ) {
              throw new AtomicMutationRejectedError(
                'SCM_BATCH_EXPIRY_CONFLICT',
                'Existing batch identity cannot be reused with a different expiry date.'
              );
            }

            const now = new Date().toISOString();

            if (accepted > 0) {
              const batch: BatchLotRecord = {
                ...(existingBatch || {
                  batchId: line.batchId,
                  tenantId: context.tenantId,
                  itemId: item.itemId,
                  itemCode: item.itemCode,
                  itemName: item.name,
                  batchNumber:
                    String(line.batchNumber || '').trim() ||
                    `UNBATCHED-${item.itemCode}`,
                  lotNumber: line.lotNumber,
                  manufacturer:
                    String(line.manufacturer || item.manufacturerName || '').trim() ||
                    'UNSPECIFIED',
                  manufactureDate: String(line.manufactureDate || payload.receivedAt),
                  expiryDate: String(line.expiryDate || '2999-12-31T00:00:00.000Z'),
                  receivedDate: payload.receivedAt,
                  supplierId: po.supplierId,
                  supplierName: po.supplierName,
                  purchaseOrderId: po.poId,
                  grnId: payload.grnId,
                  unitCost: stockUnitCost,
                  currency: po.currency,
                  quantityReceived: 0,
                  quantityRemaining: 0,
                  quantityReserved: 0,
                  storageCondition: item.storageRequirements,
                  status: quarantined ? 'QUARANTINED' : 'AVAILABLE',
                  createdAt: now,
                  updatedAt: now,
                }),
                quantityReceived:
                  Number(existingBatch?.quantityReceived || 0) +
                  acceptedStock.quantity,
                quantityRemaining:
                  Number(existingBatch?.quantityRemaining || 0) +
                  acceptedStock.quantity,
                unitCost: stockUnitCost,
                currency: po.currency,
                grnId: existingBatch?.grnId || payload.grnId,
                status:
                  existingBatch && existingBatch.status !== 'AVAILABLE'
                    ? existingBatch.status
                    : quarantined
                      ? 'QUARANTINED'
                      : 'AVAILABLE',
                temperatureExcursionDetected:
                  Boolean(existingBatch?.temperatureExcursionDetected) ||
                  Boolean(line.temperatureExcursion),
                ...(line.temperatureExcursion &&
                Number.isFinite(Number(line.recordedTemperatureCelsius))
                  ? {
                      excursionDetails: {
                        recordedTemp: Number(line.recordedTemperatureCelsius),
                        durationHours: 0,
                        flaggedAt: now,
                      },
                    }
                  : {}),
                ...(quarantined
                  ? {
                      quarantineReason: line.temperatureExcursion
                        ? 'TEMPERATURE_EXCURSION'
                        : 'QUALITY_INSPECTION_HOLD',
                    }
                  : {}),
                updatedAt: now,
              };

              const existingBalanceId = balanceId(
                context.tenantId,
                po.facilityId,
                destinationLocationId,
                item.itemId,
                line.batchId
              );
              const currentBalance =
                current[`balance:${index}`] as unknown as InventoryBalance | null;

              const balance: InventoryBalance = recomputeAvailable({
                ...(currentBalance || {
                  balanceId: existingBalanceId,
                  tenantId: context.tenantId,
                  facilityId: po.facilityId,
                  locationId: destinationLocationId,
                  locationName:
                    payload.destinationLocationName ||
                    destination.name ||
                    po.destinationLocationName ||
                    destinationLocationId,
                  itemId: item.itemId,
                  itemCode: item.itemCode,
                  itemName: item.name,
                  itemType: item.itemType,
                  batchId: line.batchId,
                  batchNumber: batch.batchNumber,
                  expiryDate: batch.expiryDate,
                  onHand: 0,
                  reserved: 0,
                  quarantined: 0,
                  damaged: 0,
                  expired: 0,
                  inTransit: 0,
                  available: 0,
                  uom: item.stockUOM,
                  minimumStock: item.minimumStock,
                  maximumStock: item.maximumStock,
                  reorderPoint: item.reorderPoint,
                  unitCost: stockUnitCost,
                  totalValuation: 0,
                  lastMovementAt: now,
                  version: 0,
                }),
                onHand:
                  Number(currentBalance?.onHand || 0) +
                  acceptedStock.quantity,
                quarantined:
                  Number(currentBalance?.quarantined || 0) +
                  (quarantined ? acceptedStock.quantity : 0),
                unitCost: stockUnitCost,
              });

              const stockTransactionId = `txn_grn_${payload.grnId}_${index + 1}`;
              receiptTransactionIds.push(stockTransactionId);

              writes.push(
                {
                  entityType: 'BATCH_LOT',
                  entityId: batch.batchId,
                  domainState: batch,
                },
                {
                  entityType: 'INVENTORY_BALANCE',
                  entityId: balance.balanceId,
                  domainState: balance,
                },
                {
                  entityType: 'STOCK_TRANSACTION',
                  entityId: stockTransactionId,
                  domainState: {
                    transactionId: stockTransactionId,
                    tenantId: context.tenantId,
                    facilityId: po.facilityId,
                    itemId: item.itemId,
                    itemCode: item.itemCode,
                    itemName: item.name,
                    batchId: batch.batchId,
                    batchNumber: batch.batchNumber,
                    expirationDate: batch.expiryDate,
                    toLocationId: destinationLocationId,
                    toLocationName: balance.locationName,
                    quantity: acceptedStock.quantity,
                    normalizedQuantity: acceptedStock.quantity,
                    uom: item.stockUOM,
                    unitCost: stockUnitCost,
                    totalCost: roundMoney(accepted * poUnitCost),
                    currency: po.currency,
                    transactionType: 'RECEIPT',
                    referenceType: 'GOODS_RECEIPT_NOTE',
                    referenceId: payload.grnId,
                    performedBy: {
                      userId: context.actorId,
                      userName: context.actorId,
                      role: context.roles[0] || 'AUTHENTICATED_USER',
                    },
                    occurredAt: payload.receivedAt,
                    recordedAt: now,
                    idempotencyKey,
                    source: 'ONLINE',
                    metadata: {
                      poId: po.poId,
                      inspectionStatus: payload.inspectionStatus,
                      quarantined,
                      receiptUom: line.uom,
                      acceptedReceiptQuantity: accepted,
                      conversionFactorToStockUom: acceptedStock.factor,
                    },
                  },
                }
              );
            }

            const poLineIndex = nextPoLines.findIndex(
              (candidate) => candidate.itemId === line.itemId
            );
            // Only accepted quantity fulfils the purchase commitment.
            // Rejected/damaged units remain open for replacement or supplier credit.
            const newReceived = alreadyReceived + accepted;
            nextPoLines[poLineIndex] = {
              ...nextPoLines[poLineIndex],
              quantityReceived: newReceived,
              quantityRemaining: Math.max(
                0,
                poLine.quantityOrdered - newReceived
              ),
              deliveryStatus:
                newReceived >= poLine.quantityOrdered
                  ? 'FULLY_RECEIVED'
                  : 'PARTIALLY_RECEIVED',
            };

            canonicalItems.push({
              itemId: item.itemId,
              itemCode: item.itemCode,
              itemName: item.name,
              quantityOrdered: poLine.quantityOrdered,
              quantityReceived: received,
              quantityAccepted: accepted,
              quantityRejected: rejected,
              quantityDamaged: damaged,
              uom: line.uom as GoodsReceiptNote['items'][number]['uom'],
              batchNumber:
                String(line.batchNumber || '').trim() ||
                `UNBATCHED-${item.itemCode}`,
              lotNumber: line.lotNumber,
              expiryDate: String(line.expiryDate || '2999-12-31T00:00:00.000Z'),
              manufactureDate: String(line.manufactureDate || payload.receivedAt),
              manufacturer:
                String(line.manufacturer || item.manufacturerName || '').trim() ||
                'UNSPECIFIED',
              recordedTemperatureCelsius: line.recordedTemperatureCelsius,
              temperatureExcursion: Boolean(line.temperatureExcursion),
              inspectionPassed: line.inspectionPassed,
              inspectionNotes: line.inspectionNotes,
              putawayLocationId: destinationLocationId,
              unitCost: poUnitCost,
            });
          }

          const fullyReceived = nextPoLines.every(
            (line) => Number(line.quantityRemaining || 0) <= 0
          );
          const now = new Date().toISOString();
          const receivedAtMs = Date.parse(payload.receivedAt);
          if (!Number.isFinite(receivedAtMs)) {
            throw new AtomicMutationRejectedError(
              'INVALID_GRN_RECEIPT_DATE',
              'Goods receipt requires a valid receivedAt timestamp.'
            );
          }
          const postingDate = new Date(receivedAtMs);
          const grniJournalId =
            grniAccrualMinorUnits > 0
              ? `je_grni_${payload.grnId}`
              : undefined;

          if (grniJournalId) {
            writes.push({
              entityType: 'JOURNAL_ENTRY',
              entityId: grniJournalId,
              domainState: {
                journalId: grniJournalId,
                tenantId: context.tenantId,
                fiscalYear: postingDate.getUTCFullYear(),
                postingPeriod: postingDate.getUTCMonth() + 1,
                documentDate: receivedAtMs,
                postingDate: receivedAtMs,
                referenceDocumentId: payload.grnId,
                documentHeader: `GRNI accrual: ${payload.grnNumber} / ${po.poNumber}`,
                currency: po.currency,
                totalAmountMinorUnits: grniAccrualMinorUnits,
                lines: [
                  ...(grniPharmacyInventoryMinorUnits > 0
                    ? [
                        {
                          glAccountId: '1210',
                          glAccountName: 'Pharmacy Formulary Inventory',
                          debitMinorUnits: grniPharmacyInventoryMinorUnits,
                          creditMinorUnits: 0,
                          lineDescription: `Pharmacy inventory received under ${payload.grnNumber}`,
                        },
                      ]
                    : []),
                  ...(grniSuppliesInventoryMinorUnits > 0
                    ? [
                        {
                          glAccountId: '1220',
                          glAccountName: 'Surgical & Sterile Medical Supplies Inventory',
                          debitMinorUnits: grniSuppliesInventoryMinorUnits,
                          creditMinorUnits: 0,
                          lineDescription: `Medical/general inventory received under ${payload.grnNumber}`,
                        },
                      ]
                    : []),
                  {
                    glAccountId: '2030',
                    glAccountName: 'Goods Received Not Invoiced (GRNI)',
                    debitMinorUnits: 0,
                    creditMinorUnits: grniAccrualMinorUnits,
                    lineDescription: `GRNI liability for ${payload.grnNumber}`,
                  },
                ],
                status: 'POSTED',
                postedBy: context.actorId,
                postedAt: Date.now(),
              },
            });
          }
          const nextPo: PurchaseOrderRecord = {
            ...po,
            items: nextPoLines,
            status: fullyReceived
              ? 'FULLY_RECEIVED'
              : 'PARTIALLY_RECEIVED',
            grnIds: Array.from(new Set([...(po.grnIds || []), payload.grnId])),
            updatedAt: now,
          };

          writes.push({
            entityType: 'PURCHASE_ORDER',
            entityId: po.poId,
            domainState: nextPo,
          });

          const grn: GoodsReceiptNote = {
            grnId: payload.grnId,
            tenantId: context.tenantId,
            facilityId: po.facilityId,
            grnNumber: payload.grnNumber,
            purchaseOrderId: po.poId,
            poNumber: po.poNumber,
            supplierId: po.supplierId,
            supplierName: po.supplierName,
            receivedBy: {
              userId: context.actorId,
              userName: context.actorId,
            },
            receivedAt: payload.receivedAt,
            deliveryNoteNumber: payload.deliveryNoteNumber,
            supplierInvoiceReference: payload.supplierInvoiceReference,
            items: canonicalItems,
            inspectionStatus: payload.inspectionStatus,
            inspectorName: context.actorId,
            inspectedAt: now,
            status:
              payload.inspectionStatus === 'FAILED' ||
              payload.inspectionStatus === 'QUARANTINED'
                ? 'INSPECTED'
                : 'PUTAWAY_COMPLETED',
            notes: payload.notes,
            journalEntryId: grniJournalId,
            createdAt: now,
            updatedAt: now,
          };

          return {
            domainState: grn,
            additionalStateWrites: writes,
            eventPayload: {
              grnId: grn.grnId,
              grnNumber: grn.grnNumber,
              poId: po.poId,
              poNumber: po.poNumber,
              supplierId: po.supplierId,
              facilityId: po.facilityId,
              destinationLocationId,
              inspectionStatus: grn.inspectionStatus,
              lineCount: grn.items.length,
              stockTransactionIds: receiptTransactionIds,
              poStatus: nextPo.status,
              grniJournalId,
              grniAccrualMinorUnits,
              grniPharmacyInventoryMinorUnits,
              grniSuppliesInventoryMinorUnits,
            },
            auditReason: `Received and inspected goods for PO ${po.poNumber} under GRN ${grn.grnNumber}`,
            resultData: {
              grn,
              purchaseOrder: nextPo,
              receiptTransactionIds,
              grniJournalId,
              grniAccrualMinorUnits,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.grnId,
        eventId: poSnapshot.eventId,
        auditId: poSnapshot.auditId,
        outboxId: poSnapshot.outboxId,
        data: poSnapshot.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(
          commandId,
          idempotencyKey,
          error.code,
          error.message,
          error.details
        );
      }
      throw error;
    }
  }
}
