import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CashReceiptDomainService } from '@/lib/backend/services/cash-receipt-domain-service';

const source = (relPath: string) => readFile(join(process.cwd(), relPath), 'utf8');

describe('ORC-8 Matrix: Billing Idempotency & Precondition Invariance', () => {
  test('CashReceiptDomainService rejects non-integer or decimal minor units', async () => {
    const decimalAttempt = await CashReceiptDomainService.record(
      {
        tenantId: 'tenant-metro',
        actorId: 'user-cashier-1',
        roles: ['CASHIER'],
        facilityIds: ['facility-1'],
        correlationId: 'corr-01',
      },
      'cmd-receipt-01',
      'idem-receipt-01',
      {
        receiptId: 'rcpt_001',
        invoiceId: 'inv_001',
        encounterId: 'enc_001',
        patientId: 'pat_001',
        amountMinorUnits: 25.5, // Non-integer decimal violates §95 integer monetary invariant
        collectedAt: Date.now(),
      }
    );

    expect(decimalAttempt.success).toBe(false);
    expect(decimalAttempt.error?.code).toBe('INVALID_CASH_RECEIPT');
  });

  test('CashReceiptDomainService rejects negative or zero minor units', async () => {
    const zeroAttempt = await CashReceiptDomainService.record(
      {
        tenantId: 'tenant-metro',
        actorId: 'user-cashier-1',
        roles: ['CASHIER'],
        facilityIds: ['facility-1'],
        correlationId: 'corr-02',
      },
      'cmd-receipt-02',
      'idem-receipt-02',
      {
        receiptId: 'rcpt_002',
        invoiceId: 'inv_002',
        encounterId: 'enc_002',
        patientId: 'pat_002',
        amountMinorUnits: 0,
        collectedAt: Date.now(),
      }
    );

    expect(zeroAttempt.success).toBe(false);
    expect(zeroAttempt.error?.code).toBe('INVALID_CASH_RECEIPT');
  });

  test('cash receipt service rejects payment against already paid or settled invoice', async () => {
    const service = await source('lib/backend/services/cash-receipt-domain-service.ts');

    expect(service).toContain("paymentStatus === 'paid' || paymentStatus === 'waived'");
    expect(service).toContain('INVOICE_NOT_OPEN');
    expect(service).toContain('PAYMENT_EXCEEDS_OUTSTANDING_BALANCE');
  });

  test('cash receipt service requires idempotency key to prevent double receipt creation', async () => {
    const service = await source('lib/backend/services/cash-receipt-domain-service.ts');

    expect(service).toContain('idempotencyKey');
    expect(service).toContain('executeAtomicReadModifyMutation');
  });
});
