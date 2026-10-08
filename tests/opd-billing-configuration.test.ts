import { beforeEach, describe, expect, test } from 'bun:test';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import { OpdBillingConfigurationDomainService } from '@/lib/backend/services/opd-billing-configuration-domain-service';
import { financePeriodId } from '@/lib/finance/finance-engine';
import type { CommandContext } from '@/lib/backend/types';

function context(tenantId: string, roles = ['SYSTEM_ADMIN']): CommandContext {
  return {
    actorId: 'billing-config-admin',
    tenantId,
    roles,
    permissions: [],
    clinicalPrivileges: [],
    correlationId: 'corr-opd-config',
    requestId: 'req-opd-config',
  };
}

function seedFinanceControls(tenantId: string) {
  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'GL_ACCOUNT',
    'ar-1110',
    {
      id: 'ar-1110',
      accountId: 'ar-1110',
      tenantId,
      accountCode: '1110',
      accountName: 'Patient Accounts Receivable',
      category: 'asset',
      normalBalance: 'debit',
      currency: 'PKR',
      isActive: true,
    }
  );

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'GL_ACCOUNT',
    'rev-4010',
    {
      id: 'rev-4010',
      accountId: 'rev-4010',
      tenantId,
      accountCode: '4010',
      accountName: 'OPD Consultation Revenue',
      category: 'revenue',
      normalBalance: 'credit',
      currency: 'PKR',
      isActive: true,
    }
  );

  const now = new Date();
  const periodId = financePeriodId(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1
  );

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'FINANCE_PERIOD',
    periodId,
    {
      periodId,
      tenantId,
      fiscalYear: now.getUTCFullYear(),
      postingPeriod: now.getUTCMonth() + 1,
      periodKey: periodId,
      periodName: periodId,
      startAt: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      endAt: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1,
      status: 'OPEN',
    }
  );
}

describe('governed OPD consultation billing configuration', () => {
  beforeEach(() => {
    TransactionManager.resetEphemeralStateForTesting();
  });

  test('authorized admin atomically configures consultation service and cash tariff', async () => {
    const tenantId = 'tenant-opd-config-success';
    seedFinanceControls(tenantId);

    const result =
      await OpdBillingConfigurationDomainService.configureConsultationService(
        context(tenantId),
        'cmd-opd-config',
        'idem-opd-config',
        {
          serviceCode: 'OPD-CONSULT',
          description: 'Standard OPD Consultation',
          currency: 'PKR',
          unitPriceMinorUnits: 150_000,
          taxRateBasisPoints: 0,
          revenueAccountCode: '4010',
        }
      );

    expect(result.success).toBe(true);

    const service = TransactionManager.getEphemeralStateForTesting(
      tenantId,
      'BILLING_SERVICE_CATALOG',
      'opd-consultation-standard'
    );
    expect(service?.status).toBe('ACTIVE');
    expect(service?.currency).toBe('PKR');
    expect(service?.unitPriceMinorUnits).toBe(150_000);
    expect(service?.revenueAccountCode).toBe('4010');

    const tariff = TransactionManager.getEphemeralStateForTesting(
      tenantId,
      'TARIFF',
      'tariff-standard-cash'
    );
    expect(tariff?.status).toBe('active');
    expect(tariff?.planName).toBe('cash');
    expect(tariff?.copayPercent).toBe(100);
  });

  test('configuration fails closed when revenue account is missing', async () => {
    const tenantId = 'tenant-opd-config-no-revenue';

    const now = new Date();
    const periodId = financePeriodId(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1
    );

    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'GL_ACCOUNT',
      'ar-1110',
      {
        id: 'ar-1110',
        accountId: 'ar-1110',
        tenantId,
        accountCode: '1110',
        accountName: 'Patient Accounts Receivable',
        category: 'asset',
        normalBalance: 'debit',
        currency: 'PKR',
        isActive: true,
      }
    );

    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'FINANCE_PERIOD',
      periodId,
      {
        periodId,
        tenantId,
        fiscalYear: now.getUTCFullYear(),
        postingPeriod: now.getUTCMonth() + 1,
        periodKey: periodId,
        periodName: periodId,
        startAt: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        endAt: Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1,
        status: 'OPEN',
      }
    );

    const result =
      await OpdBillingConfigurationDomainService.configureConsultationService(
        context(tenantId),
        'cmd-opd-config-fail',
        'idem-opd-config-fail',
        {
          serviceCode: 'OPD-CONSULT',
          description: 'Standard OPD Consultation',
          currency: 'PKR',
          unitPriceMinorUnits: 150_000,
          taxRateBasisPoints: 0,
          revenueAccountCode: '4010',
        }
      );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('OPD_REVENUE_ACCOUNT_INVALID');
  });

  test('receptionist cannot configure tenant billing authority', async () => {
    const tenantId = 'tenant-opd-config-role-denied';
    seedFinanceControls(tenantId);

    const result =
      await OpdBillingConfigurationDomainService.configureConsultationService(
        context(tenantId, ['RECEPTIONIST']),
        'cmd-opd-config-denied',
        'idem-opd-config-denied',
        {
          serviceCode: 'OPD-CONSULT',
          description: 'Standard OPD Consultation',
          currency: 'PKR',
          unitPriceMinorUnits: 150_000,
          taxRateBasisPoints: 0,
          revenueAccountCode: '4010',
        }
      );

    expect(result.success).toBe(false);
  });
});
