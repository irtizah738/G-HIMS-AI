import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = (relPath: string) => readFile(join(process.cwd(), relPath), 'utf8');

describe('ORC-8 Matrix: Billing Stage Advance & Settlement Alignment', () => {
  test('cash receipt service atomically advances encounter stage on full settlement', async () => {
    const service = await source('lib/backend/services/cash-receipt-domain-service.ts');

    // Full consultation settlement branch
    expect(service).toContain('isConsultationInvoice && newBalanceMinorUnits === 0');
    expect(service).toContain("financialClearanceState: 'CONSULTATION_CLEARED'");
    expect(service).toContain("currentStage: 'BILLING_SETTLEMENT'");
    expect(service).toContain('billingSettlementEnteredAt: payload.collectedAt');
    expect(service).toContain('billingSettlementEnteredByReceiptId: payload.receiptId');
  });

  test('reconciliation domain service requires BILLING_SETTLEMENT stage', async () => {
    const service = await source('lib/backend/services/opd-billing-reconciliation-domain-service.ts');

    expect(service).toContain("if (stage !== 'BILLING_SETTLEMENT')");
    expect(service).toContain('OPD_BILLING_STAGE_REQUIRED');
  });

  test('reconciliation completion advances financial clearance to FINAL_BILLING_CLEARED', async () => {
    const service = await source('lib/backend/services/opd-billing-reconciliation-domain-service.ts');

    expect(service).toContain("financialClearanceState: 'FINAL_BILLING_CLEARED'");
  });
});
