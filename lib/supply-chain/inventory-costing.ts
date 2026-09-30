import type { ItemMaster, ItemType, StockTransaction } from '@/types/scm-domain';
import type { InventoryValuationResult } from '@/types/scm-costing';

export const INVENTORY_VALUATION_METHOD = 'BATCH_ACTUAL_FEFO' as const;

export function toMinorUnits(value: number): number {
  const normalized = Number(value || 0);
  if (!Number.isFinite(normalized)) {
    throw new Error('INVALID_MONETARY_VALUE');
  }
  return Math.round(normalized * 100);
}

export function inventoryAccountForItemType(itemType: ItemType): '1210' | '1220' {
  return itemType === 'MEDICATION' ? '1210' : '1220';
}

export function periodKeyFromIso(value: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('INVALID_INVENTORY_PERIOD_DATE');
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function inventoryPeriodCloseId(facilityId: string, periodKey: string): string {
  const safeFacility = facilityId.trim().replace(/[^A-Za-z0-9_-]/g, '_');
  const safePeriod = periodKey.trim().replace(/[^0-9-]/g, '_');
  return `iclose_${safeFacility}_${safePeriod}`;
}

export function isInventoryPeriodBlocked(
  close: { status?: string } | null | undefined
): boolean {
  return close?.status === 'CLOSING' || close?.status === 'CLOSED';
}

export function isGovernedAdjustmentType(type: StockTransaction['transactionType']): boolean {
  return ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'WRITE_OFF', 'RETURN_TO_SUPPLIER'].includes(type);
}

export function isExpensedOutboundType(type: StockTransaction['transactionType']): boolean {
  return ['ISSUE', 'CONSUMPTION', 'DISPENSE'].includes(type);
}

export function movementSign(type: StockTransaction['transactionType']): -1 | 0 | 1 {
  if (['RECEIPT', 'ADJUSTMENT_IN', 'RETURN'].includes(type)) return 1;
  if (['ISSUE', 'ADJUSTMENT_OUT', 'CONSUMPTION', 'DISPENSE', 'WRITE_OFF', 'RETURN_TO_SUPPLIER'].includes(type)) return -1;
  return 0;
}

export function buildInventoryMovementValuation(params: {
  transactions: StockTransaction[];
  items: ItemMaster[];
  periodStart: string;
  periodEnd: string;
  currency: string;
}): InventoryValuationResult {
  const startMs = Date.parse(params.periodStart);
  const endMs = Date.parse(params.periodEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error('INVALID_INVENTORY_CLOSE_PERIOD');
  }

  const items = new Map(params.items.map((item) => [item.itemId, item]));
  const movementMinorUnitsByAccount: Record<'1210' | '1220', number> = {
    '1210': 0,
    '1220': 0,
  };
  const endingValuationMinorUnitsByAccount: Record<'1210' | '1220', number> = {
    '1210': 0,
    '1220': 0,
  };
  let transactionCount = 0;

  for (const transaction of params.transactions) {
    const occurredMs = Date.parse(transaction.occurredAt);
    if (!Number.isFinite(occurredMs) || occurredMs > endMs) {
      continue;
    }

    const sign = movementSign(transaction.transactionType);
    if (sign === 0) continue;

    const transactionCurrency = String(transaction.currency || '').trim().toUpperCase();
    if (transactionCurrency !== params.currency.trim().toUpperCase()) {
      throw new Error(
        `INVENTORY_VALUATION_CURRENCY_MISMATCH:${transaction.transactionId}:${transactionCurrency}`
      );
    }

    const item = items.get(transaction.itemId);
    if (!item) {
      throw new Error(`INVENTORY_VALUATION_ITEM_MISSING:${transaction.itemId}`);
    }

    const unitCostMinorUnits = toMinorUnits(transaction.unitCost);
    const valueMinorUnits = Math.round(
      Number(transaction.normalizedQuantity || transaction.quantity) * unitCostMinorUnits
    );
    const account = inventoryAccountForItemType(item.itemType);
    endingValuationMinorUnitsByAccount[account] += sign * valueMinorUnits;
    if (occurredMs >= startMs) {
      movementMinorUnitsByAccount[account] += sign * valueMinorUnits;
      transactionCount += 1;
    }
  }

  return {
    movementMinorUnitsByAccount,
    endingValuationMinorUnitsByAccount,
    transactionCount,
  };
}

export function buildJournalInventoryMovement(params: {
  journals: Array<Record<string, unknown>>;
  fiscalYear: number;
  postingPeriod: number;
  currency: string;
}): {
  movementMinorUnitsByAccount: Record<'1210' | '1220', number>;
  journalEntryCount: number;
} {
  const movementMinorUnitsByAccount: Record<'1210' | '1220', number> = {
    '1210': 0,
    '1220': 0,
  };
  let journalEntryCount = 0;

  for (const journal of params.journals) {
    if (
      Number(journal.fiscalYear) !== params.fiscalYear ||
      Number(journal.postingPeriod) !== params.postingPeriod ||
      String(journal.status || '').toUpperCase() !== 'POSTED'
    ) {
      continue;
    }

    const journalCurrency = String(journal.currency || '').trim().toUpperCase();
    const lines = Array.isArray(journal.lines)
      ? (journal.lines as Array<Record<string, unknown>>)
      : [];
    let touchedInventory = false;

    for (const line of lines) {
      const account = String(line.glAccountId || '');
      if (account !== '1210' && account !== '1220') continue;
      if (journalCurrency !== params.currency.trim().toUpperCase()) {
        throw new Error(
          `INVENTORY_JOURNAL_CURRENCY_MISMATCH:${String(journal.journalId || '')}:${journalCurrency}`
        );
      }
      const debit = Number(line.debitMinorUnits || 0);
      const credit = Number(line.creditMinorUnits || 0);
      if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) {
        throw new Error('INVALID_INVENTORY_JOURNAL_MINOR_UNITS');
      }
      movementMinorUnitsByAccount[account] += debit - credit;
      touchedInventory = true;
    }

    if (touchedInventory) journalEntryCount += 1;
  }

  return { movementMinorUnitsByAccount, journalEntryCount };
}
