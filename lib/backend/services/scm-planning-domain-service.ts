import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  InventoryBalance,
  InventoryLocation,
  ItemMaster,
  PurchaseRequisition,
  StockTransaction,
  SupplierMaster,
} from '@/types/scm-domain';
import type {
  CompleteInternalReplenishmentOrderPayload,
  ExecuteReplenishmentPlanPayload,
  GenerateReplenishmentPlanPayload,
  InternalReplenishmentOrder,
  ReplenishmentPlan,
  ReplenishmentPolicy,
  ReviewReplenishmentPlanPayload,
  UpsertReplenishmentPolicyPayload,
} from '@/types/scm-planning';
import {
  buildDemandInputFingerprint,
  calculateDemandPlanLine,
} from '@/lib/supply-chain/demand-planning';

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

function assertFacilityScope(context: CommandContext, facilityId: string): void {
  const admin = context.roles.some((role) =>
    ['SYSTEM_ADMIN', 'ADMINISTRATOR'].includes(role)
  );
  if (
    !admin &&
    context.facilityIds?.length &&
    !context.facilityIds.includes(facilityId)
  ) {
    throw new AtomicMutationRejectedError(
      'FACILITY_SCOPE_MISMATCH',
      'Demand planning operation is outside the actor facility scope.'
    );
  }
}

function policyIdFor(
  facilityId: string,
  locationId: string,
  itemId: string
): string {
  const safe = (value: string) => value.trim().replace(/[^A-Za-z0-9_-]/g, '_');
  return `rpol_${safe(facilityId)}_${safe(locationId)}_${safe(itemId)}`;
}

function assertPolicyShape(payload: UpsertReplenishmentPolicyPayload): void {
  const values = [
    payload.minQuantity,
    payload.maxQuantity,
    payload.reorderPoint,
    payload.safetyStockQuantity,
    payload.safetyStockDays,
    payload.leadTimeDays,
  ];
  if (
    values.some((value) => !Number.isFinite(value) || value < 0) ||
    payload.maxQuantity <= 0 ||
    payload.minQuantity > payload.reorderPoint ||
    payload.reorderPoint > payload.maxQuantity ||
    payload.safetyStockQuantity > payload.maxQuantity ||
    payload.leadTimeDays <= 0
  ) {
    throw new AtomicMutationRejectedError(
      'INVALID_REPLENISHMENT_POLICY',
      'PAR, safety-stock and lead-time parameters are internally inconsistent.'
    );
  }
  if (
    payload.policyId !==
    policyIdFor(payload.facilityId, payload.locationId, payload.itemId)
  ) {
    throw new AtomicMutationRejectedError(
      'REPLENISHMENT_POLICY_ID_MISMATCH',
      'Policy ID must be deterministic for facility, location and item.'
    );
  }
  if (
    payload.sourceLocationId &&
    payload.sourceLocationId === payload.locationId
  ) {
    throw new AtomicMutationRejectedError(
      'REPLENISHMENT_SOURCE_EQUALS_DESTINATION',
      'Internal replenishment source and destination must differ.'
    );
  }
}

async function derivePlanSnapshot(params: {
  tenantId: string;
  facilityId: string;
  locationId: string;
  policyIds: string[];
  asOf: string;
  lookbackDays: number;
  currency: string;
}) {
  const asOfMs = Date.parse(params.asOf);
  if (!Number.isFinite(asOfMs)) {
    throw new AtomicMutationRejectedError(
      'INVALID_REPLENISHMENT_AS_OF',
      'Demand planning asOf timestamp is invalid.'
    );
  }
  if (
    !Number.isInteger(params.lookbackDays) ||
    params.lookbackDays < 7 ||
    params.lookbackDays > 365
  ) {
    throw new AtomicMutationRejectedError(
      'INVALID_REPLENISHMENT_LOOKBACK',
      'Demand planning lookback must be an integer from 7 to 365 days.'
    );
  }

  const [policies, balances, transactions, items] = await Promise.all([
    Promise.all(
      params.policyIds.map((policyId) =>
        DomainStateRepository.getById<ReplenishmentPolicy>(
          params.tenantId,
          'scmReplenishmentPolicies',
          policyId
        )
      )
    ),
    DomainStateRepository.queryAllEqual<InventoryBalance>(
      params.tenantId,
      'inventoryBalances',
      'facilityId',
      params.facilityId,
      { pageSize: 500, maxRows: 200000 }
    ),
    DomainStateRepository.queryAllEqual<StockTransaction>(
      params.tenantId,
      'stockTransactions',
      'facilityId',
      params.facilityId,
      { pageSize: 500, maxRows: 200000 }
    ),
    DomainStateRepository.list<ItemMaster>(params.tenantId, 'items', 50000),
  ]);

  if (policies.some((policy) => !policy)) {
    throw new AtomicMutationRejectedError(
      'REPLENISHMENT_POLICY_NOT_FOUND',
      'One or more replenishment policies do not exist.'
    );
  }
  const canonicalPolicies = policies as ReplenishmentPolicy[];
  if (
    canonicalPolicies.some(
      (policy) =>
        policy.facilityId !== params.facilityId ||
        policy.locationId !== params.locationId ||
        !policy.active
    )
  ) {
    throw new AtomicMutationRejectedError(
      'REPLENISHMENT_POLICY_SCOPE_MISMATCH',
      'All replenishment policies must be active and belong to the requested facility/location.'
    );
  }

  const itemById = new Map(items.map((item) => [item.itemId, item]));
  const currency = params.currency.trim().toUpperCase();
  const lines = canonicalPolicies.map((policy) => {
    const item = itemById.get(policy.itemId);
    if (!item || item.isActive === false) {
      throw new AtomicMutationRejectedError(
        'REPLENISHMENT_ITEM_NOT_ACTIVE',
        `Planning item ${policy.itemId} is missing or inactive.`
      );
    }
    if (String(item.currency || '').trim().toUpperCase() !== currency) {
      throw new AtomicMutationRejectedError(
        'REPLENISHMENT_CURRENCY_MISMATCH',
        'All planned items must share the plan currency.'
      );
    }

    const currentAvailable = balances
      .filter(
        (balance) =>
          balance.locationId === policy.locationId &&
          balance.itemId === policy.itemId
      )
      .reduce((sum, balance) => sum + Number(balance.available || 0), 0);
    const sourceAvailable = policy.sourceLocationId
      ? balances
          .filter(
            (balance) =>
              balance.locationId === policy.sourceLocationId &&
              balance.itemId === policy.itemId
          )
          .reduce((sum, balance) => sum + Number(balance.available || 0), 0)
      : 0;

    const historicalUsage = transactions
      .filter(
        (transaction) =>
          transaction.itemId === policy.itemId &&
          transaction.fromLocationId === policy.locationId &&
          ['ISSUE', 'CONSUMPTION', 'DISPENSE'].includes(
            transaction.transactionType
          )
      )
      .map((transaction) => ({
        quantity: Number(
          transaction.normalizedQuantity || transaction.quantity || 0
        ),
        occurredAt: transaction.occurredAt,
      }));

    return calculateDemandPlanLine({
      policy,
      currentAvailable,
      sourceAvailable,
      historicalUsage,
      itemUnitCost: Number(item.unitCost || 0),
      asOf: params.asOf,
      lookbackDays: params.lookbackDays,
    });
  });

  const fingerprint = buildDemandInputFingerprint({
    policies: canonicalPolicies
      .map((policy) => ({
        policyId: policy.policyId,
        updatedAt: policy.updatedAt,
        active: policy.active,
        minQuantity: policy.minQuantity,
        maxQuantity: policy.maxQuantity,
        reorderPoint: policy.reorderPoint,
        safetyStockQuantity: policy.safetyStockQuantity,
        safetyStockDays: policy.safetyStockDays,
        leadTimeDays: policy.leadTimeDays,
        mode: policy.mode,
        sourceLocationId: policy.sourceLocationId,
      }))
      .sort((a, b) => a.policyId.localeCompare(b.policyId)),
    balances: balances
      .filter((balance) =>
        canonicalPolicies.some(
          (policy) =>
            policy.itemId === balance.itemId &&
            (policy.locationId === balance.locationId ||
              policy.sourceLocationId === balance.locationId)
        )
      )
      .map((balance) => ({
        balanceId: balance.balanceId,
        version: balance.version,
        available: balance.available,
        lastMovementAt: balance.lastMovementAt,
      }))
      .sort((a, b) => a.balanceId.localeCompare(b.balanceId)),
    transactions: transactions
      .filter((transaction) =>
        canonicalPolicies.some(
          (policy) =>
            policy.itemId === transaction.itemId &&
            policy.locationId === transaction.fromLocationId &&
            ['ISSUE', 'CONSUMPTION', 'DISPENSE'].includes(
              transaction.transactionType
            )
        )
      )
      .map((transaction) => ({
        transactionId: transaction.transactionId,
        itemId: transaction.itemId,
        quantity:
          transaction.normalizedQuantity || transaction.quantity,
        occurredAt: transaction.occurredAt,
      }))
      .sort((a, b) => a.transactionId.localeCompare(b.transactionId)),
    asOf: params.asOf,
    lookbackDays: params.lookbackDays,
    currency,
  });

  return {
    lines,
    fingerprint,
    totalEstimatedCostMinorUnits: lines.reduce(
      (sum, line) => sum + line.estimatedCostMinorUnits,
      0
    ),
  };
}

export class ScmPlanningDomainService {
  public static async upsertReplenishmentPolicy(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: UpsertReplenishmentPolicyPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
        'INVENTORY_OFFICER',
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
        auth.reason || 'Replenishment policy authority required.'
      );
    }

    try {
      assertFacilityScope(context, payload.facilityId);
      assertPolicyShape(payload);

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'REPLENISHMENT_POLICY',
        aggregateId: payload.policyId,
        eventType: 'REPLENISHMENT_POLICY_UPSERTED',
        auditAction: 'REPLENISHMENT_POLICY_UPSERTED',
        auditResourceType: 'REPLENISHMENT_POLICY',
        auditResourceId: payload.policyId,
        outboxTopic: 'g-hims-scm-planning-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'policy',
            entityType: 'REPLENISHMENT_POLICY',
            entityId: payload.policyId,
            required: false,
          },
          {
            key: 'item',
            entityType: 'ITEM_MASTER',
            entityId: payload.itemId,
            required: true,
          },
          {
            key: 'destination',
            entityType: 'INVENTORY_LOCATION',
            entityId: payload.locationId,
            required: true,
          },
          ...(payload.sourceLocationId
            ? [{
                key: 'source',
                entityType: 'INVENTORY_LOCATION',
                entityId: payload.sourceLocationId,
                required: true,
              }]
            : []),
          ...(payload.preferredSupplierId
            ? [{
                key: 'supplier',
                entityType: 'SUPPLIER_MASTER',
                entityId: payload.preferredSupplierId,
                required: true,
              }]
            : []),
        ],
        prepare: (current) => {
          const existing =
            current.policy as unknown as ReplenishmentPolicy | null;
          const item = current.item as unknown as ItemMaster;
          const destination =
            current.destination as unknown as InventoryLocation;
          const source = payload.sourceLocationId
            ? (current.source as unknown as InventoryLocation)
            : null;
          const supplier = payload.preferredSupplierId
            ? (current.supplier as unknown as SupplierMaster)
            : null;

          if (
            item.isActive === false ||
            destination.active === false ||
            destination.facilityId !== payload.facilityId ||
            (source &&
              (source.active === false ||
                source.facilityId !== payload.facilityId))
          ) {
            throw new AtomicMutationRejectedError(
              'REPLENISHMENT_MASTER_DATA_INVALID',
              'Policy item and inventory locations must be active and facility-consistent.'
            );
          }
          if (supplier && supplier.status !== 'ACTIVE') {
            throw new AtomicMutationRejectedError(
              'REPLENISHMENT_SUPPLIER_NOT_ACTIVE',
              'Preferred supplier must be active.'
            );
          }
          if (
            payload.mode === 'INTERNAL_TRANSFER_ONLY' &&
            !payload.sourceLocationId
          ) {
            throw new AtomicMutationRejectedError(
              'REPLENISHMENT_SOURCE_REQUIRED',
              'Internal-transfer-only policy requires a source location.'
            );
          }

          const now = new Date().toISOString();
          const policy: ReplenishmentPolicy = {
            ...payload,
            tenantId: context.tenantId,
            itemCode: item.itemCode,
            itemName: item.name,
            uom: item.stockUOM,
            criticality: item.criticality,
            createdAt: existing?.createdAt || now,
            createdBy: existing?.createdBy || context.actorId,
            updatedAt: now,
            updatedBy: context.actorId,
          };

          return {
            domainState: policy,
            eventPayload: {
              policyId: policy.policyId,
              facilityId: policy.facilityId,
              locationId: policy.locationId,
              itemId: policy.itemId,
              mode: policy.mode,
              active: policy.active,
            },
            auditReason: `Upserted replenishment policy ${policy.policyId} for ${item.itemCode}.`,
            resultData: policy,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.policyId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  public static async generateReplenishmentPlan(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: GenerateReplenishmentPlanPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
        'INVENTORY_OFFICER',
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
        auth.reason || 'Demand planning authority required.'
      );
    }

    try {
      assertFacilityScope(context, payload.facilityId);
      if (
        !payload.policyIds.length ||
        payload.policyIds.length > 500 ||
        new Set(payload.policyIds).size !== payload.policyIds.length
      ) {
        throw new AtomicMutationRejectedError(
          'INVALID_REPLENISHMENT_POLICY_SET',
          'Planning requires 1-500 unique policy IDs.'
        );
      }
      const snapshot = await derivePlanSnapshot({
        tenantId: context.tenantId,
        ...payload,
      });

      const now = new Date().toISOString();
      const plan: ReplenishmentPlan = {
        planId: payload.planId,
        tenantId: context.tenantId,
        facilityId: payload.facilityId,
        locationId: payload.locationId,
        asOf: payload.asOf,
        lookbackDays: payload.lookbackDays,
        currency: payload.currency.trim().toUpperCase(),
        method: 'SIMPLE_MOVING_AVERAGE_LEAD_TIME',
        inputFingerprint: snapshot.fingerprint,
        lines: snapshot.lines,
        totalEstimatedCostMinorUnits:
          snapshot.totalEstimatedCostMinorUnits,
        status: 'DRAFT',
        generatedBy: context.actorId,
        generatedAt: now,
      };

      const tx = await TransactionManager.executeAtomicMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'REPLENISHMENT_PLAN',
        aggregateId: payload.planId,
        eventType: 'REPLENISHMENT_PLAN_GENERATED',
        auditAction: 'REPLENISHMENT_PLAN_GENERATED',
        auditResourceType: 'REPLENISHMENT_PLAN',
        auditResourceId: payload.planId,
        outboxTopic: 'g-hims-scm-planning-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        domainState: plan,
        eventPayload: {
          planId: plan.planId,
          facilityId: plan.facilityId,
          locationId: plan.locationId,
          method: plan.method,
          fingerprint: plan.inputFingerprint,
          replenishmentLines: plan.lines.filter(
            (line) => line.recommendedQuantity > 0
          ).length,
        },
        auditReason: `Generated explainable replenishment plan ${plan.planId} for ${plan.locationId}.`,
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.planId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: plan,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  public static async reviewReplenishmentPlan(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ReviewReplenishmentPlanPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
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
        auth.reason || 'Replenishment plan review authority required.'
      );
    }

    try {
      const preflight = await DomainStateRepository.getById<ReplenishmentPlan>(
        context.tenantId,
        'scmReplenishmentPlans',
        payload.planId
      );
      if (!preflight) {
        throw new AtomicMutationRejectedError(
          'REPLENISHMENT_PLAN_NOT_FOUND',
          'Replenishment plan does not exist.'
        );
      }
      assertFacilityScope(context, preflight.facilityId);

      let latestFingerprint = preflight.inputFingerprint;
      if (payload.decision === 'APPROVE') {
        const snapshot = await derivePlanSnapshot({
          tenantId: context.tenantId,
          facilityId: preflight.facilityId,
          locationId: preflight.locationId,
          policyIds: preflight.lines.map((line) => line.policyId),
          asOf: preflight.asOf,
          lookbackDays: preflight.lookbackDays,
          currency: preflight.currency,
        });
        latestFingerprint = snapshot.fingerprint;
        if (latestFingerprint !== preflight.inputFingerprint) {
          throw new AtomicMutationRejectedError(
            'REPLENISHMENT_PLAN_STALE_REGENERATE',
            'Inventory, demand history, or policy inputs changed after plan generation. Regenerate before approval.'
          );
        }
      }

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'REPLENISHMENT_PLAN',
        aggregateId: payload.planId,
        eventType:
          payload.decision === 'APPROVE'
            ? 'REPLENISHMENT_PLAN_APPROVED'
            : 'REPLENISHMENT_PLAN_REJECTED',
        auditAction:
          payload.decision === 'APPROVE'
            ? 'REPLENISHMENT_PLAN_APPROVED'
            : 'REPLENISHMENT_PLAN_REJECTED',
        auditResourceType: 'REPLENISHMENT_PLAN',
        auditResourceId: payload.planId,
        outboxTopic: 'g-hims-scm-planning-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [{
          key: 'plan',
          entityType: 'REPLENISHMENT_PLAN',
          entityId: payload.planId,
          required: true,
        }],
        prepare: (current) => {
          const plan = current.plan as unknown as ReplenishmentPlan;
          if (plan.status !== 'DRAFT') {
            throw new AtomicMutationRejectedError(
              'REPLENISHMENT_PLAN_NOT_REVIEWABLE',
              `Plan status ${plan.status} cannot be reviewed.`
            );
          }
          if (plan.generatedBy === context.actorId) {
            throw new AtomicMutationRejectedError(
              'SCM_SEGREGATION_OF_DUTIES',
              'Plan generator cannot approve their own replenishment plan.'
            );
          }
          if (
            payload.decision === 'APPROVE' &&
            plan.inputFingerprint !== latestFingerprint
          ) {
            throw new AtomicMutationRejectedError(
              'REPLENISHMENT_PLAN_STALE_REGENERATE',
              'Replenishment plan inputs changed before approval commit.'
            );
          }

          const now = new Date().toISOString();
          const next: ReplenishmentPlan = {
            ...plan,
            status:
              payload.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            reviewedBy: context.actorId,
            reviewedAt: now,
            reviewComments: payload.comments,
          };
          return {
            domainState: next,
            eventPayload: {
              planId: plan.planId,
              decision: payload.decision,
              reviewerId: context.actorId,
            },
            auditReason: `${payload.decision} replenishment plan ${plan.planId}.`,
            resultData: next,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.planId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  public static async executeReplenishmentPlan(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ExecuteReplenishmentPlanPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
        'PROCUREMENT_OFFICER',
        'PROCUREMENT_MANAGER',
        'INVENTORY_OFFICER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return rejection(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Replenishment execution authority required.'
      );
    }

    try {
      const plan = await DomainStateRepository.getById<ReplenishmentPlan>(
        context.tenantId,
        'scmReplenishmentPlans',
        payload.planId
      );
      if (!plan) {
        throw new AtomicMutationRejectedError(
          'REPLENISHMENT_PLAN_NOT_FOUND',
          'Replenishment plan does not exist.'
        );
      }
      assertFacilityScope(context, plan.facilityId);
      if (plan.status !== 'APPROVED') {
        throw new AtomicMutationRejectedError(
          'REPLENISHMENT_PLAN_NOT_APPROVED',
          'Only an approved replenishment plan may execute.'
        );
      }

      const latest = await derivePlanSnapshot({
        tenantId: context.tenantId,
        facilityId: plan.facilityId,
        locationId: plan.locationId,
        policyIds: plan.lines.map((line) => line.policyId),
        asOf: plan.asOf,
        lookbackDays: plan.lookbackDays,
        currency: plan.currency,
      });
      if (latest.fingerprint !== plan.inputFingerprint) {
        throw new AtomicMutationRejectedError(
          'REPLENISHMENT_PLAN_STALE_REGENERATE',
          'Inventory or demand inputs changed after approval. Regenerate the plan before execution.'
        );
      }

      const purchaseLines = plan.lines.filter(
        (line) => line.action === 'PURCHASE' && line.recommendedQuantity > 0
      );
      const internalLines = plan.lines.filter(
        (line) =>
          line.action === 'INTERNAL_TRANSFER' &&
          line.recommendedQuantity > 0
      );

      if (
        purchaseLines.length &&
        (!payload.purchaseRequisitionId ||
          !payload.purchaseRequisitionNumber)
      ) {
        throw new AtomicMutationRejectedError(
          'PURCHASE_REQUISITION_IDENTITY_REQUIRED',
          'Purchase replenishment execution requires requisition identity and number.'
        );
      }
      if (
        internalLines.length &&
        (!payload.replenishmentOrderId ||
          !payload.replenishmentOrderNumber)
      ) {
        throw new AtomicMutationRejectedError(
          'REPLENISHMENT_ORDER_IDENTITY_REQUIRED',
          'Internal replenishment execution requires order identity and number.'
        );
      }

      const sourceGroups = new Map<string, typeof internalLines>();
      for (const line of internalLines) {
        const source = String(line.sourceLocationId || '').trim();
        if (!source) {
          throw new AtomicMutationRejectedError(
            'INTERNAL_REPLENISHMENT_SOURCE_REQUIRED',
            'Internal replenishment line has no source location.'
          );
        }
        sourceGroups.set(source, [
          ...(sourceGroups.get(source) || []),
          line,
        ]);
      }

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'REPLENISHMENT_PLAN',
        aggregateId: plan.planId,
        eventType: 'REPLENISHMENT_PLAN_EXECUTED',
        auditAction: 'REPLENISHMENT_PLAN_EXECUTED',
        auditResourceType: 'REPLENISHMENT_PLAN',
        auditResourceId: plan.planId,
        outboxTopic: 'g-hims-scm-planning-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [{
          key: 'plan',
          entityType: 'REPLENISHMENT_PLAN',
          entityId: plan.planId,
          required: true,
        }],
        prepare: (current) => {
          const authoritative =
            current.plan as unknown as ReplenishmentPlan;
          if (
            authoritative.status !== 'APPROVED' ||
            authoritative.inputFingerprint !== latest.fingerprint
          ) {
            throw new AtomicMutationRejectedError(
              'REPLENISHMENT_PLAN_EXECUTION_CONFLICT',
              'Authoritative replenishment plan changed before execution.'
            );
          }

          const writes: Array<{
            entityType: string;
            entityId: string;
            domainState: unknown;
          }> = [];
          const now = new Date().toISOString();
          let purchaseRequisitionId: string | undefined;
          const replenishmentOrderIds: string[] = [];

          if (purchaseLines.length) {
            purchaseRequisitionId = payload.purchaseRequisitionId;
            const requisition: PurchaseRequisition = {
              requisitionId: payload.purchaseRequisitionId!,
              tenantId: context.tenantId,
              facilityId: plan.facilityId,
              requisitionNumber: payload.purchaseRequisitionNumber!,
              requestingDepartment: 'AUTOMATED_REPLENISHMENT',
              requestingLocationId: plan.locationId,
              requestedBy: {
                userId: context.actorId,
                userName: context.actorId,
                role: context.roles[0] || 'AUTHENTICATED_USER',
              },
              priority: purchaseLines.some(
                (line) => line.urgency === 'CRITICAL'
              )
                ? 'URGENT'
                : 'NORMAL',
              items: purchaseLines.map((line) => ({
                itemId: line.itemId,
                itemCode: line.itemCode,
                itemName: line.itemName,
                requestedQuantity: line.recommendedQuantity,
                uom: line.uom,
                currentStock: line.currentAvailable,
                reorderPoint: line.effectiveReorderPoint,
                suggestedQuantity: line.recommendedQuantity,
                estimatedUnitCost: line.estimatedUnitCost,
                estimatedTotal:
                  Math.round(
                    line.recommendedQuantity *
                      line.estimatedUnitCost *
                      100
                  ) / 100,
                justification:
                  line.explanation.join(' '),
              })),
              justification:
                `Governed demand plan ${plan.planId}; deterministic ${plan.method}.`,
              requiredByDate: payload.requiredByDate,
              estimatedTotalCost:
                purchaseLines.reduce(
                  (sum, line) =>
                    sum +
                    line.recommendedQuantity *
                      line.estimatedUnitCost,
                  0
                ),
              currency: plan.currency,
              clinicalCriticality: purchaseLines.some(
                (line) => line.criticality === 'VITAL'
              )
                ? 'VITAL'
                : purchaseLines.some(
                      (line) => line.criticality === 'ESSENTIAL'
                    )
                  ? 'ESSENTIAL'
                  : 'DESIRABLE',
              status: 'SUBMITTED',
              approvalHistory: [],
              createdAt: now,
              updatedAt: now,
            };
            writes.push({
              entityType: 'PURCHASE_REQUISITION',
              entityId: requisition.requisitionId,
              domainState: requisition,
            });
          }

          let groupIndex = 0;
          for (const [sourceLocationId, lines] of sourceGroups) {
            groupIndex += 1;
            const orderId =
              sourceGroups.size === 1
                ? payload.replenishmentOrderId!
                : `${payload.replenishmentOrderId}_${groupIndex}`;
            const orderNumber =
              sourceGroups.size === 1
                ? payload.replenishmentOrderNumber!
                : `${payload.replenishmentOrderNumber}-${groupIndex}`;
            const order: InternalReplenishmentOrder = {
              orderId,
              tenantId: context.tenantId,
              orderNumber,
              planId: plan.planId,
              facilityId: plan.facilityId,
              sourceLocationId,
              destinationLocationId: plan.locationId,
              lines: lines.map((line) => ({
                itemId: line.itemId,
                itemCode: line.itemCode,
                itemName: line.itemName,
                uom: line.uom,
                requestedQuantity: line.recommendedQuantity,
                fulfilledQuantity: 0,
              })),
              status: 'READY_TO_PICK',
              createdBy: context.actorId,
              createdAt: now,
            };
            replenishmentOrderIds.push(orderId);
            writes.push({
              entityType: 'REPLENISHMENT_ORDER',
              entityId: orderId,
              domainState: order,
            });
          }

          const executed: ReplenishmentPlan = {
            ...authoritative,
            status: 'EXECUTED',
            executedBy: context.actorId,
            executedAt: now,
            purchaseRequisitionId,
            replenishmentOrderIds,
          };

          return {
            domainState: executed,
            additionalStateWrites: writes,
            eventPayload: {
              planId: plan.planId,
              purchaseRequisitionId,
              replenishmentOrderIds,
              purchaseLineCount: purchaseLines.length,
              internalLineCount: internalLines.length,
            },
            auditReason: `Executed approved replenishment plan ${plan.planId} into governed downstream work.`,
            resultData: {
              plan: executed,
              purchaseRequisitionId,
              replenishmentOrderIds,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: plan.planId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }

  public static async completeInternalReplenishmentOrder(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: CompleteInternalReplenishmentOrderPayload
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
        auth.reason || 'Internal replenishment completion authority required.'
      );
    }

    try {
      const preflight =
        await DomainStateRepository.getById<InternalReplenishmentOrder>(
          context.tenantId,
          'scmReplenishmentOrders',
          payload.orderId
        );
      if (!preflight) {
        throw new AtomicMutationRejectedError(
          'REPLENISHMENT_ORDER_NOT_FOUND',
          'Internal replenishment order does not exist.'
        );
      }
      assertFacilityScope(context, preflight.facilityId);
      if (
        !payload.stockTransactionIds.length ||
        payload.stockTransactionIds.length > 1000 ||
        new Set(payload.stockTransactionIds).size !==
          payload.stockTransactionIds.length
      ) {
        throw new AtomicMutationRejectedError(
          'INVALID_REPLENISHMENT_TRANSACTION_SET',
          'Completion requires a unique set of governed stock transaction IDs.'
        );
      }

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'REPLENISHMENT_ORDER',
        aggregateId: payload.orderId,
        eventType: 'INTERNAL_REPLENISHMENT_COMPLETED',
        auditAction: 'INTERNAL_REPLENISHMENT_COMPLETED',
        auditResourceType: 'REPLENISHMENT_ORDER',
        auditResourceId: payload.orderId,
        outboxTopic: 'g-hims-scm-planning-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'order',
            entityType: 'REPLENISHMENT_ORDER',
            entityId: payload.orderId,
            required: true,
          },
          ...payload.stockTransactionIds.map((transactionId, index) => ({
            key: `transaction:${index}`,
            entityType: 'STOCK_TRANSACTION',
            entityId: transactionId,
            required: true,
          })),
        ],
        prepare: (current) => {
          const order =
            current.order as unknown as InternalReplenishmentOrder;
          if (
            !['READY_TO_PICK', 'PARTIALLY_FULFILLED'].includes(order.status)
          ) {
            throw new AtomicMutationRejectedError(
              'REPLENISHMENT_ORDER_NOT_OPEN',
              `Order status ${order.status} cannot be completed.`
            );
          }

          const transferredByItem = new Map<string, number>();
          payload.stockTransactionIds.forEach((_, index) => {
            const transaction =
              current[`transaction:${index}`] as unknown as StockTransaction;
            if (
              transaction.referenceType !== 'INTERNAL_REQUEST' ||
              transaction.referenceId !== order.orderId ||
              transaction.facilityId !== order.facilityId ||
              transaction.fromLocationId !== order.sourceLocationId ||
              transaction.toLocationId !== order.destinationLocationId ||
              transaction.transactionType !== 'TRANSFER_OUT'
            ) {
              throw new AtomicMutationRejectedError(
                'REPLENISHMENT_TRANSFER_EVIDENCE_INVALID',
                'Stock transaction is not valid transfer evidence for this replenishment order.'
              );
            }
            transferredByItem.set(
              transaction.itemId,
              Number(transferredByItem.get(transaction.itemId) || 0) +
                Number(
                  transaction.normalizedQuantity ||
                    transaction.quantity ||
                    0
                )
            );
          });

          const lines = order.lines.map((line) => ({
            ...line,
            fulfilledQuantity: Number(
              transferredByItem.get(line.itemId) || 0
            ),
          }));
          const complete = lines.every(
            (line) =>
              line.fulfilledQuantity + 0.000001 >=
              line.requestedQuantity
          );
          if (!complete) {
            throw new AtomicMutationRejectedError(
              'REPLENISHMENT_ORDER_UNDERFULFILLED',
              'Governed transfer evidence does not fulfil every replenishment line.',
              { lines }
            );
          }

          const now = new Date().toISOString();
          const next: InternalReplenishmentOrder = {
            ...order,
            lines,
            status: 'COMPLETED',
            completedBy: context.actorId,
            completedAt: now,
          };
          return {
            domainState: next,
            eventPayload: {
              orderId: order.orderId,
              transactionIds: payload.stockTransactionIds,
              lineCount: lines.length,
            },
            auditReason: `Completed internal replenishment order ${order.orderNumber} from governed stock-transfer evidence.`,
            resultData: next,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.orderId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return rejection(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }
}
