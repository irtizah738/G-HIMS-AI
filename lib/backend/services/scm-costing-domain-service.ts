import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type {
  InventoryBalance,
  ItemMaster,
  StockTransaction,
} from '@/types/scm-domain';
import type {
  ApproveCycleCountPayload,
  FinalizeInventoryPeriodClosePayload,
  GovernedCycleCountRecord,
  InventoryAdjustmentPosting,
  InventoryPeriodCloseRecord,
  StartInventoryPeriodClosePayload,
  SubmitCycleCountPayload,
} from '@/types/scm-costing';
import {
  buildInventoryMovementValuation,
  buildJournalInventoryMovement,
  INVENTORY_VALUATION_METHOD,
  inventoryAccountForItemType,
  inventoryPeriodCloseId,
  isInventoryPeriodBlocked,
  periodKeyFromIso,
  toMinorUnits,
} from '@/lib/supply-chain/inventory-costing';

const VARIANCE_ACCOUNT = {
  id: '6040',
  name: 'Inventory Shrinkage, Count Variance & Write-Off Expense',
};

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
  const administrative = context.roles.some((role) =>
    ['SYSTEM_ADMIN', 'ADMINISTRATOR'].includes(role)
  );
  if (
    !administrative &&
    context.facilityIds?.length &&
    !context.facilityIds.includes(facilityId)
  ) {
    throw new AtomicMutationRejectedError(
      'FACILITY_SCOPE_MISMATCH',
      'The requested inventory control mutation is outside the actor facility scope.'
    );
  }
}

function validateClosePeriod(
  payload: StartInventoryPeriodClosePayload | FinalizeInventoryPeriodClosePayload
): { periodKey: string; closeId: string } {
  if (
    !Number.isInteger(payload.fiscalYear) ||
    payload.fiscalYear < 2000 ||
    !Number.isInteger(payload.postingPeriod) ||
    payload.postingPeriod < 1 ||
    payload.postingPeriod > 12
  ) {
    throw new AtomicMutationRejectedError(
      'INVALID_INVENTORY_CLOSE_PERIOD',
      'Fiscal year and posting period are invalid.'
    );
  }

  const startMs = Date.parse(payload.periodStart);
  const endMs = Date.parse(payload.periodEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new AtomicMutationRejectedError(
      'INVALID_INVENTORY_CLOSE_PERIOD',
      'Inventory close period dates are invalid.'
    );
  }

  const periodKey = periodKeyFromIso(payload.periodStart);
  if (periodKey !== periodKeyFromIso(payload.periodEnd)) {
    throw new AtomicMutationRejectedError(
      'INVENTORY_CLOSE_MUST_BE_SINGLE_MONTH',
      'Inventory period close must remain within one calendar month.'
    );
  }
  const expectedMonth = String(payload.postingPeriod).padStart(2, '0');
  if (periodKey !== `${payload.fiscalYear}-${expectedMonth}`) {
    throw new AtomicMutationRejectedError(
      'INVENTORY_CLOSE_PERIOD_MISMATCH',
      'Fiscal year/posting period do not match the supplied close dates.'
    );
  }

  const closeId = inventoryPeriodCloseId(payload.facilityId, periodKey);
  if (payload.closeId !== closeId) {
    throw new AtomicMutationRejectedError(
      'INVENTORY_CLOSE_ID_MISMATCH',
      'Inventory close ID must be deterministic for facility and period.'
    );
  }

  return { periodKey, closeId };
}

function buildJournalState(params: {
  journalId: string;
  tenantId: string;
  fiscalYear: number;
  postingPeriod: number;
  postingDate: number;
  referenceDocumentId: string;
  documentHeader: string;
  currency: string;
  lines: Array<{
    glAccountId: string;
    glAccountName: string;
    debitMinorUnits: number;
    creditMinorUnits: number;
    lineDescription: string;
  }>;
  postedBy: string;
}) {
  const totalDebits = params.lines.reduce(
    (sum, line) => sum + line.debitMinorUnits,
    0
  );
  const totalCredits = params.lines.reduce(
    (sum, line) => sum + line.creditMinorUnits,
    0
  );
  if (
    !Number.isSafeInteger(totalDebits) ||
    totalDebits <= 0 ||
    totalDebits !== totalCredits
  ) {
    throw new AtomicMutationRejectedError(
      'UNBALANCED_INVENTORY_ADJUSTMENT_JOURNAL',
      `Inventory adjustment journal is not balanced: debits=${totalDebits}, credits=${totalCredits}.`
    );
  }

  return {
    journalId: params.journalId,
    tenantId: params.tenantId,
    fiscalYear: params.fiscalYear,
    postingPeriod: params.postingPeriod,
    documentDate: params.postingDate,
    postingDate: params.postingDate,
    referenceDocumentId: params.referenceDocumentId,
    documentHeader: params.documentHeader,
    currency: params.currency,
    totalAmountMinorUnits: totalDebits,
    lines: params.lines,
    status: 'POSTED',
    postedBy: params.postedBy,
    postedAt: Date.now(),
  };
}

export class ScmCostingDomainService {
  public static async submitCycleCount(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: SubmitCycleCountPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'INVENTORY_OFFICER',
        'STORE_KEEPER',
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
        auth.reason || 'Cycle count submission authority required.'
      );
    }

    if (!payload.lines?.length || payload.lines.length > 500) {
      return rejection(
        commandId,
        idempotencyKey,
        'INVALID_CYCLE_COUNT',
        'Cycle count requires between 1 and 500 balance lines.'
      );
    }

    try {
      assertFacilityScope(context, payload.facilityId);
      const periodKey = periodKeyFromIso(payload.countedAt);
      const closeId = inventoryPeriodCloseId(payload.facilityId, periodKey);
      const uniqueBalanceIds = new Set(payload.lines.map((line) => line.balanceId));
      if (uniqueBalanceIds.size !== payload.lines.length) {
        throw new AtomicMutationRejectedError(
          'DUPLICATE_CYCLE_COUNT_BALANCE',
          'Each inventory balance may appear only once in a cycle count.'
        );
      }

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'CYCLE_COUNT',
        aggregateId: payload.countId,
        eventType: 'CYCLE_COUNT_SUBMITTED',
        auditAction: 'CYCLE_COUNT_SUBMITTED',
        auditResourceType: 'CYCLE_COUNT',
        auditResourceId: payload.countId,
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'periodClose',
            entityType: 'INVENTORY_PERIOD_CLOSE',
            entityId: closeId,
            required: false,
          },
          ...payload.lines.map((line, index) => ({
            key: `balance:${index}`,
            entityType: 'INVENTORY_BALANCE',
            entityId: line.balanceId,
            required: true,
          })),
        ],
        prepare: (current) => {
          if (isInventoryPeriodBlocked(current.periodClose)) {
            throw new AtomicMutationRejectedError(
              'INVENTORY_PERIOD_BLOCKED',
              `Inventory period ${periodKey} is closing or closed.`
            );
          }

          const lines = payload.lines.map((line, index) => {
            const balance = current[`balance:${index}`] as unknown as InventoryBalance;
            if (
              balance.facilityId !== payload.facilityId ||
              balance.locationId !== payload.locationId
            ) {
              throw new AtomicMutationRejectedError(
                'CYCLE_COUNT_BALANCE_SCOPE_MISMATCH',
                'Cycle count balance does not belong to the selected facility/location.'
              );
            }
            if (
              !Number.isFinite(line.countedQuantity) ||
              line.countedQuantity < 0
            ) {
              throw new AtomicMutationRejectedError(
                'INVALID_COUNTED_QUANTITY',
                'Counted quantity must be a non-negative finite number.'
              );
            }

            const varianceQuantity =
              line.countedQuantity - Number(balance.onHand || 0);
            const unitCostMinorUnits = toMinorUnits(balance.unitCost);
            const varianceValueMinorUnits = Math.round(
              varianceQuantity * unitCostMinorUnits
            );

            return {
              balanceId: balance.balanceId,
              itemId: balance.itemId,
              itemCode: balance.itemCode,
              itemName: balance.itemName,
              itemType: balance.itemType,
              batchId: balance.batchId,
              batchNumber: balance.batchNumber,
              uom: balance.uom,
              expectedQuantity: balance.onHand,
              countedQuantity: line.countedQuantity,
              varianceQuantity,
              unitCostMinorUnits,
              varianceValueMinorUnits,
              inventoryAccountCode: inventoryAccountForItemType(balance.itemType),
              status:
                varianceQuantity === 0
                  ? ('MATCH' as const)
                  : ('VARIANCE_FLAGGED' as const),
            };
          });

          const now = new Date().toISOString();
          const record: GovernedCycleCountRecord = {
            countId: payload.countId,
            tenantId: context.tenantId,
            facilityId: payload.facilityId,
            locationId: payload.locationId,
            locationName:
              payload.locationName ||
              (current['balance:0'] as unknown as InventoryBalance).locationName,
            valuationMethod: INVENTORY_VALUATION_METHOD,
            isBlindCount: payload.isBlindCount,
            countedAt: payload.countedAt,
            submittedAt: now,
            submittedBy: context.actorId,
            lines,
            totalAbsoluteVarianceMinorUnits: lines.reduce(
              (sum, line) => sum + Math.abs(line.varianceValueMinorUnits),
              0
            ),
            status: 'SUBMITTED_FOR_REVIEW',
            notes: payload.notes,
          };

          return {
            domainState: record,
            eventPayload: {
              countId: record.countId,
              facilityId: record.facilityId,
              locationId: record.locationId,
              lineCount: record.lines.length,
              varianceLineCount: record.lines.filter(
                (line) => line.varianceQuantity !== 0
              ).length,
              totalAbsoluteVarianceMinorUnits:
                record.totalAbsoluteVarianceMinorUnits,
            },
            auditReason: `Submitted blind inventory cycle count ${record.countId} for ${record.locationName}.`,
            resultData: record,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.countId,
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

  public static async approveCycleCount(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ApproveCycleCountPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'SCM_MANAGER',
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
        auth.reason || 'Cycle count approval authority required.'
      );
    }

    try {
      const unique = [...new Set(payload.balanceIds)];
      if (!unique.length || unique.length !== payload.balanceIds.length) {
        throw new AtomicMutationRejectedError(
          'INVALID_CYCLE_COUNT_BALANCE_SET',
          'Cycle count approval requires a unique authoritative balance ID set.'
        );
      }

      const preflight = await DomainStateRepository.getById<GovernedCycleCountRecord>(
        context.tenantId,
        'scmCycleCounts',
        payload.countId
      );
      if (preflight) {
        const expected = [...preflight.lines.map((line) => line.balanceId)].sort();
        const supplied = [...unique].sort();
        if (
          expected.length !== supplied.length ||
          expected.some((value, index) => value !== supplied[index])
        ) {
          throw new AtomicMutationRejectedError(
            'CYCLE_COUNT_BALANCE_SET_MISMATCH',
            'Approval balance set does not match the authoritative cycle count.'
          );
        }
      }

      const periodKey = preflight
        ? periodKeyFromIso(preflight.countedAt)
        : '';
      const closeId = preflight
        ? inventoryPeriodCloseId(preflight.facilityId, periodKey)
        : '';

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'CYCLE_COUNT',
        aggregateId: payload.countId,
        eventType:
          payload.decision === 'APPROVE'
            ? 'CYCLE_COUNT_APPROVED_AND_POSTED'
            : 'CYCLE_COUNT_REJECTED',
        auditAction:
          payload.decision === 'APPROVE'
            ? 'CYCLE_COUNT_APPROVED_AND_POSTED'
            : 'CYCLE_COUNT_REJECTED',
        auditResourceType: 'CYCLE_COUNT',
        auditResourceId: payload.countId,
        outboxTopic: 'g-hims-scm-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'count',
            entityType: 'CYCLE_COUNT',
            entityId: payload.countId,
            required: true,
          },
          ...(closeId
            ? [{
                key: 'periodClose',
                entityType: 'INVENTORY_PERIOD_CLOSE',
                entityId: closeId,
                required: false,
              }]
            : []),
          ...unique.map((balanceId, index) => ({
            key: `balance:${index}`,
            entityType: 'INVENTORY_BALANCE',
            entityId: balanceId,
            required: true,
          })),
        ],
        prepare: (current) => {
          const count = current.count as unknown as GovernedCycleCountRecord;
          assertFacilityScope(context, count.facilityId);

          if (count.status !== 'SUBMITTED_FOR_REVIEW') {
            throw new AtomicMutationRejectedError(
              'CYCLE_COUNT_NOT_REVIEWABLE',
              `Cycle count status ${count.status} cannot be reviewed.`
            );
          }
          if (count.submittedBy === context.actorId) {
            throw new AtomicMutationRejectedError(
              'SCM_SEGREGATION_OF_DUTIES',
              'The counter cannot approve their own cycle count.'
            );
          }
          if (current.periodClose && isInventoryPeriodBlocked(current.periodClose)) {
            throw new AtomicMutationRejectedError(
              'INVENTORY_PERIOD_BLOCKED',
              'Cycle count adjustments cannot post into a closing or closed period.'
            );
          }

          const expectedIds = [...count.lines.map((line) => line.balanceId)].sort();
          const suppliedIds = [...unique].sort();
          if (
            expectedIds.length !== suppliedIds.length ||
            expectedIds.some((value, index) => value !== suppliedIds[index])
          ) {
            throw new AtomicMutationRejectedError(
              'CYCLE_COUNT_BALANCE_SET_MISMATCH',
              'Approval balance set does not match the authoritative cycle count.'
            );
          }

          const now = new Date().toISOString();
          if (payload.decision === 'REJECT') {
            const rejected: GovernedCycleCountRecord = {
              ...count,
              status: 'REJECTED',
              rejectedAt: now,
              rejectedBy: context.actorId,
              reviewReason: payload.reason,
              lines: count.lines.map((line) => ({
                ...line,
                status:
                  line.varianceQuantity === 0 ? 'MATCH' : 'REJECTED',
              })),
            };
            return {
              domainState: rejected,
              eventPayload: {
                countId: count.countId,
                decision: 'REJECT',
                reason: payload.reason,
              },
              auditReason: `Rejected cycle count ${count.countId}: ${payload.reason}`,
              resultData: rejected,
            };
          }

          const writes: Array<{
            entityType: string;
            entityId: string;
            domainState: unknown;
          }> = [];
          const journalByAccount = new Map<
            string,
            { debit: number; credit: number; name: string }
          >();
          let totalAdjustedMinorUnits = 0;

          count.lines.forEach((countLine) => {
            const index = unique.indexOf(countLine.balanceId);
            const balance =
              current[`balance:${index}`] as unknown as InventoryBalance;

            if (
              balance.facilityId !== count.facilityId ||
              balance.locationId !== count.locationId ||
              balance.itemId !== countLine.itemId ||
              balance.batchId !== countLine.batchId
            ) {
              throw new AtomicMutationRejectedError(
                'CYCLE_COUNT_BALANCE_SCOPE_MISMATCH',
                'Authoritative balance identity changed after count submission.'
              );
            }
            if (Number(balance.onHand) !== Number(countLine.expectedQuantity)) {
              throw new AtomicMutationRejectedError(
                'CYCLE_COUNT_STALE_BALANCE',
                'Inventory moved after the cycle count. Recount is required before adjustment.',
                {
                  balanceId: balance.balanceId,
                  countedAgainst: countLine.expectedQuantity,
                  currentOnHand: balance.onHand,
                }
              );
            }

            const unavailable =
              Number(balance.reserved || 0) +
              Number(balance.quarantined || 0) +
              Number(balance.damaged || 0) +
              Number(balance.expired || 0);
            if (countLine.countedQuantity < unavailable) {
              throw new AtomicMutationRejectedError(
                'COUNT_BELOW_CONTROLLED_QUANTITY',
                'Physical count cannot be below quantities already reserved/quarantined/damaged/expired.'
              );
            }

            if (countLine.varianceQuantity === 0) return;

            const nextBalance: InventoryBalance = {
              ...balance,
              onHand: countLine.countedQuantity,
              available: Math.max(0, countLine.countedQuantity - unavailable),
              totalValuation:
                Math.round(countLine.countedQuantity * balance.unitCost * 100) / 100,
              lastCountAt: count.countedAt,
              lastMovementAt: now,
              version: Number(balance.version || 0) + 1,
            };
            writes.push({
              entityType: 'INVENTORY_BALANCE',
              entityId: balance.balanceId,
              domainState: nextBalance,
            });

            const adjustmentId = `adj_${count.countId}_${balance.balanceId}`;
            const stockTransactionId = `txn_${adjustmentId}`;
            const quantity = Math.abs(countLine.varianceQuantity);
            const transactionType =
              countLine.varianceQuantity > 0
                ? ('ADJUSTMENT_IN' as const)
                : ('ADJUSTMENT_OUT' as const);

            const stockTxn: StockTransaction = {
              transactionId: stockTransactionId,
              tenantId: context.tenantId,
              facilityId: count.facilityId,
              itemId: balance.itemId,
              itemCode: balance.itemCode,
              itemName: balance.itemName,
              batchId: balance.batchId,
              batchNumber: balance.batchNumber,
              expirationDate: balance.expiryDate,
              fromLocationId:
                transactionType === 'ADJUSTMENT_OUT'
                  ? count.locationId
                  : undefined,
              fromLocationName:
                transactionType === 'ADJUSTMENT_OUT'
                  ? count.locationName
                  : undefined,
              toLocationId:
                transactionType === 'ADJUSTMENT_IN'
                  ? count.locationId
                  : undefined,
              toLocationName:
                transactionType === 'ADJUSTMENT_IN'
                  ? count.locationName
                  : undefined,
              quantity,
              uom: balance.uom,
              normalizedQuantity: quantity,
              unitCost: balance.unitCost,
              totalCost: Math.round(quantity * balance.unitCost * 100) / 100,
              currency: 'USD',
              transactionType,
              referenceType: 'CYCLE_COUNT',
              referenceId: count.countId,
              reasonCode: 'COUNT_VARIANCE',
              performedBy: {
                userId: count.submittedBy,
                userName: count.submittedBy,
                role: 'INVENTORY_COUNTER',
              },
              authorizedBy: {
                userId: context.actorId,
                userName: context.actorId,
                role: context.roles[0] || 'AUTHORIZED_REVIEWER',
              },
              occurredAt: count.countedAt,
              recordedAt: now,
              idempotencyKey,
              source: 'SYSTEM',
              metadata: {
                adjustmentId,
                valuationMethod: INVENTORY_VALUATION_METHOD,
              },
            };
            writes.push({
              entityType: 'STOCK_TRANSACTION',
              entityId: stockTransactionId,
              domainState: stockTxn,
            });

            const adjustment: InventoryAdjustmentPosting = {
              adjustmentId,
              tenantId: context.tenantId,
              countId: count.countId,
              facilityId: count.facilityId,
              locationId: count.locationId,
              balanceId: balance.balanceId,
              itemId: balance.itemId,
              itemCode: balance.itemCode,
              itemName: balance.itemName,
              itemType: balance.itemType,
              batchId: balance.batchId,
              batchNumber: balance.batchNumber,
              uom: balance.uom,
              systemQuantityBefore: countLine.expectedQuantity,
              countedQuantity: countLine.countedQuantity,
              varianceQuantity: countLine.varianceQuantity,
              unitCostMinorUnits: countLine.unitCostMinorUnits,
              varianceValueMinorUnits: countLine.varianceValueMinorUnits,
              inventoryAccountCode: countLine.inventoryAccountCode,
              varianceAccountCode: '6040',
              reasonCode: 'COUNT_VARIANCE',
              approvedBy: context.actorId,
              approvedAt: now,
              stockTransactionId,
            };
            writes.push({
              entityType: 'STOCK_ADJUSTMENT',
              entityId: adjustmentId,
              domainState: adjustment,
            });

            const amount = Math.abs(countLine.varianceValueMinorUnits);
            if (amount > 0) {
              const inventory = journalByAccount.get(
                countLine.inventoryAccountCode
              ) || {
                debit: 0,
                credit: 0,
                name:
                  countLine.inventoryAccountCode === '1210'
                    ? 'Pharmacy Formulary Inventory'
                    : 'Surgical & Sterile Medical Supplies Inventory',
              };
              const variance = journalByAccount.get(VARIANCE_ACCOUNT.id) || {
                debit: 0,
                credit: 0,
                name: VARIANCE_ACCOUNT.name,
              };

              if (countLine.varianceQuantity > 0) {
                inventory.debit += amount;
                variance.credit += amount;
              } else {
                inventory.credit += amount;
                variance.debit += amount;
              }
              journalByAccount.set(countLine.inventoryAccountCode, inventory);
              journalByAccount.set(VARIANCE_ACCOUNT.id, variance);
              totalAdjustedMinorUnits += amount;
            }
          });

          let journalId: string | undefined;
          if (totalAdjustedMinorUnits > 0) {
            const countedMs = Date.parse(count.countedAt);
            const countedDate = new Date(countedMs);
            const fiscalYear = countedDate.getUTCFullYear();
            const postingPeriod = countedDate.getUTCMonth() + 1;
            const lines = [...journalByAccount.entries()]
              .filter(([, values]) => values.debit > 0 || values.credit > 0)
              .map(([accountId, values]) => ({
                glAccountId: accountId,
                glAccountName: values.name,
                debitMinorUnits: values.debit,
                creditMinorUnits: values.credit,
                lineDescription: `Cycle count adjustment ${count.countId}`,
              }));

            journalId = `je_inv_adj_${count.countId}`;
            const journal = buildJournalState({
              journalId,
              tenantId: context.tenantId,
              fiscalYear,
              postingPeriod,
              postingDate: countedMs,
              referenceDocumentId: count.countId,
              documentHeader: `Inventory cycle count adjustment ${count.countId}`,
              currency: 'USD',
              lines,
              postedBy: context.actorId,
            });
            writes.push({
              entityType: 'JOURNAL_ENTRY',
              entityId: journalId,
              domainState: journal,
            });

            for (const write of writes) {
              if (write.entityType !== 'STOCK_ADJUSTMENT') continue;
              (write.domainState as InventoryAdjustmentPosting).journalEntryId =
                journalId;
            }
          }

          const completed: GovernedCycleCountRecord = {
            ...count,
            status: 'COMPLETED',
            approvedAt: now,
            approvedBy: context.actorId,
            reviewReason: payload.reason,
            lines: count.lines.map((line) => ({
              ...line,
              status:
                line.varianceQuantity === 0 ? 'MATCH' : 'ADJUSTED',
            })),
          };

          return {
            domainState: completed,
            additionalStateWrites: writes,
            eventPayload: {
              countId: count.countId,
              decision: 'APPROVE',
              adjustmentCount: writes.filter(
                (write) => write.entityType === 'STOCK_ADJUSTMENT'
              ).length,
              journalId,
              totalAdjustedMinorUnits,
            },
            auditReason: `Approved and posted cycle count ${count.countId}; inventory and financial variance were committed atomically.`,
            resultData: {
              count: completed,
              journalId,
              totalAdjustedMinorUnits,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: payload.countId,
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

  public static async startInventoryPeriodClose(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: StartInventoryPeriodClosePayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'FINANCE_MANAGER',
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
        auth.reason || 'Inventory period close authority required.'
      );
    }

    try {
      assertFacilityScope(context, payload.facilityId);
      const { periodKey, closeId } = validateClosePeriod(payload);
      const currency = payload.currency.trim().toUpperCase();

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'INVENTORY_PERIOD_CLOSE',
        aggregateId: closeId,
        eventType: 'INVENTORY_PERIOD_CLOSE_STARTED',
        auditAction: 'INVENTORY_PERIOD_CLOSE_STARTED',
        auditResourceType: 'INVENTORY_PERIOD_CLOSE',
        auditResourceId: closeId,
        outboxTopic: 'g-hims-scm-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'close',
            entityType: 'INVENTORY_PERIOD_CLOSE',
            entityId: closeId,
            required: false,
          },
        ],
        prepare: (current) => {
          const existing = current.close as unknown as InventoryPeriodCloseRecord | null;
          if (existing?.status === 'CLOSED') {
            throw new AtomicMutationRejectedError(
              'INVENTORY_PERIOD_ALREADY_CLOSED',
              'Inventory period is already closed.'
            );
          }
          if (existing?.status === 'CLOSING') {
            throw new AtomicMutationRejectedError(
              'INVENTORY_PERIOD_ALREADY_CLOSING',
              'Inventory period close is already in progress.'
            );
          }

          const now = new Date().toISOString();
          const close: InventoryPeriodCloseRecord = {
            closeId,
            tenantId: context.tenantId,
            facilityId: payload.facilityId,
            fiscalYear: payload.fiscalYear,
            postingPeriod: payload.postingPeriod,
            periodKey,
            periodStart: payload.periodStart,
            periodEnd: payload.periodEnd,
            currency,
            valuationMethod: INVENTORY_VALUATION_METHOD,
            status: 'CLOSING',
            startedAt: now,
            startedBy: context.actorId,
          };

          return {
            domainState: close,
            eventPayload: {
              closeId,
              facilityId: payload.facilityId,
              periodKey,
              valuationMethod: INVENTORY_VALUATION_METHOD,
            },
            auditReason: `Started inventory close for ${payload.facilityId} period ${periodKey}; period-dated SCM movements are now frozen.`,
            resultData: close,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: closeId,
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

  public static async finalizeInventoryPeriodClose(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: FinalizeInventoryPeriodClosePayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
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
        auth.reason || 'Inventory period finalization authority required.'
      );
    }

    try {
      assertFacilityScope(context, payload.facilityId);
      const { periodKey, closeId } = validateClosePeriod(payload);

      const [transactions, items, journals] = await Promise.all([
        DomainStateRepository.queryAllEqual<StockTransaction>(
          context.tenantId,
          'stockTransactions',
          'facilityId',
          payload.facilityId,
          { pageSize: 500, maxRows: 200000 }
        ),
        DomainStateRepository.list<ItemMaster>(
          context.tenantId,
          'items',
          50000
        ),
        DomainStateRepository.queryAllEqual<Record<string, unknown>>(
          context.tenantId,
          'journalEntries',
          'fiscalYear',
          payload.fiscalYear,
          { pageSize: 500, maxRows: 200000 }
        ),
      ]);

      const stock = buildInventoryMovementValuation({
        transactions,
        items,
        periodStart: payload.periodStart,
        periodEnd: payload.periodEnd,
      });
      const ledger = buildJournalInventoryMovement({
        journals,
        fiscalYear: payload.fiscalYear,
        postingPeriod: payload.postingPeriod,
      });

      const deltas: Record<string, number> = {
        '1210':
          stock.movementMinorUnitsByAccount['1210'] -
          ledger.movementMinorUnitsByAccount['1210'],
        '1220':
          stock.movementMinorUnitsByAccount['1220'] -
          ledger.movementMinorUnitsByAccount['1220'],
      };

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        aggregateType: 'INVENTORY_PERIOD_CLOSE',
        aggregateId: closeId,
        eventType: 'INVENTORY_PERIOD_CLOSED',
        auditAction: 'INVENTORY_PERIOD_CLOSED',
        auditResourceType: 'INVENTORY_PERIOD_CLOSE',
        auditResourceId: closeId,
        outboxTopic: 'g-hims-scm-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'close',
            entityType: 'INVENTORY_PERIOD_CLOSE',
            entityId: closeId,
            required: true,
          },
        ],
        prepare: (current) => {
          const close = current.close as unknown as InventoryPeriodCloseRecord;
          if (
            close.status !== 'CLOSING' ||
            close.facilityId !== payload.facilityId ||
            close.fiscalYear !== payload.fiscalYear ||
            close.postingPeriod !== payload.postingPeriod ||
            close.periodKey !== periodKey
          ) {
            throw new AtomicMutationRejectedError(
              'INVENTORY_CLOSE_STATE_MISMATCH',
              'Inventory close state does not match the requested period finalization.'
            );
          }

          const unreconciled = Object.entries(deltas).filter(
            ([, delta]) => Math.abs(delta) > 1
          );
          if (unreconciled.length) {
            throw new AtomicMutationRejectedError(
              'INVENTORY_GL_RECONCILIATION_FAILED',
              'Inventory subledger movement does not reconcile to Universal Journal inventory accounts.',
              {
                stockMovementMinorUnitsByAccount:
                  stock.movementMinorUnitsByAccount,
                journalMovementMinorUnitsByAccount:
                  ledger.movementMinorUnitsByAccount,
                deltas,
              }
            );
          }

          const now = new Date().toISOString();
          const finalized: InventoryPeriodCloseRecord = {
            ...close,
            status: 'CLOSED',
            finalizedAt: now,
            finalizedBy: context.actorId,
            stockMovementMinorUnitsByAccount: {
              ...stock.movementMinorUnitsByAccount,
            },
            journalMovementMinorUnitsByAccount: {
              ...ledger.movementMinorUnitsByAccount,
            },
            reconciliationDeltaMinorUnitsByAccount: deltas,
            stockTransactionCount: stock.transactionCount,
            journalEntryCount: ledger.journalEntryCount,
          };

          return {
            domainState: finalized,
            eventPayload: {
              closeId,
              facilityId: payload.facilityId,
              periodKey,
              stockTransactionCount: stock.transactionCount,
              journalEntryCount: ledger.journalEntryCount,
              deltas,
            },
            auditReason: `Closed inventory period ${periodKey} after stock-to-GL reconciliation completed within one minor currency unit.`,
            resultData: finalized,
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: closeId,
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
}
