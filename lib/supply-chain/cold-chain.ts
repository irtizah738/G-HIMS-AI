export function temperatureWithinRange(params: {
  temperatureCelsius: number;
  minCelsius: number;
  maxCelsius: number;
}): boolean {
  const { temperatureCelsius, minCelsius, maxCelsius } = params;
  if (
    ![temperatureCelsius, minCelsius, maxCelsius].every(Number.isFinite) ||
    minCelsius > maxCelsius
  ) {
    throw new Error('INVALID_COLD_CHAIN_RANGE');
  }
  return (
    temperatureCelsius >= minCelsius &&
    temperatureCelsius <= maxCelsius
  );
}

export function requiresStockEvidence(action: string): boolean {
  return ['ISSUE', 'RETURN', 'WASTE_WITNESS'].includes(action);
}

export function controlledCustodyEvidenceMatches(params: {
  action: string;
  quantity: number;
  itemId: string;
  batchId: string;
  transaction?: {
    itemId?: string;
    batchId?: string;
    quantity?: number;
    transactionType?: string;
  } | null;
}): boolean {
  if (!requiresStockEvidence(params.action)) return true;
  const transaction = params.transaction;
  if (!transaction) return false;
  if (
    transaction.itemId !== params.itemId ||
    transaction.batchId !== params.batchId ||
    Math.abs(Number(transaction.quantity || 0) - params.quantity) > 0.000001
  ) {
    return false;
  }
  const allowed: Record<string, string[]> = {
    ISSUE: ['ISSUE', 'CONSUMPTION', 'DISPENSE'],
    RETURN: ['RETURN'],
    WASTE_WITNESS: ['ADJUSTMENT_OUT', 'WRITE_OFF'],
  };
  return (allowed[params.action] || []).includes(
    String(transaction.transactionType || '')
  );
}
