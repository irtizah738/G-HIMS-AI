import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { FinanceAccountRecord, FinancePeriodRecord } from '@/types/finance-domain';
import { financePeriodId } from '@/lib/finance/finance-engine';

const SERVICE_ID = 'opd-consultation-standard';
const CASH_TARIFF_ID = 'tariff-standard-cash';

function reject(
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

export class OpdBillingConfigurationDomainService {
  public static async configureConsultationService(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      serviceCode: string;
      description: string;
      currency: string;
      unitPriceMinorUnits: number;
      taxRateBasisPoints: number;
      revenueAccountCode: string;
      effectiveFrom?: string;
    }
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'BILLING_ADMIN',
        'FINANCE_MANAGER',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });

    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Billing configuration authority required.'
      );
    }

    try {
      const currency = payload.currency.trim().toUpperCase();
      const serviceCode = payload.serviceCode.trim().toUpperCase();
      const description = payload.description.trim();
      const revenueAccountCode = payload.revenueAccountCode.trim();

      if (currency.length !== 3) {
        throw new AtomicMutationRejectedError(
          'INVALID_SERVICE_CURRENCY',
          'Consultation service currency must be a 3-letter ISO code.'
        );
      }
      if (!serviceCode || !description || !revenueAccountCode) {
        throw new AtomicMutationRejectedError(
          'INVALID_OPD_SERVICE_CONFIGURATION',
          'Service code, description and revenue account are required.'
        );
      }
      if (
        !Number.isSafeInteger(payload.unitPriceMinorUnits) ||
        payload.unitPriceMinorUnits <= 0
      ) {
        throw new AtomicMutationRejectedError(
          'INVALID_SERVICE_PRICE',
          'Consultation price must be a positive integer minor-unit amount.'
        );
      }
      if (
        !Number.isInteger(payload.taxRateBasisPoints) ||
        payload.taxRateBasisPoints < 0 ||
        payload.taxRateBasisPoints > 10_000
      ) {
        throw new AtomicMutationRejectedError(
          'INVALID_SERVICE_TAX_RATE',
          'Consultation tax rate must be between 0 and 10,000 basis points.'
        );
      }

      const revenueAccounts =
        await DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
          context.tenantId,
          'accounts',
          'accountCode',
          revenueAccountCode,
          { pageSize: 10, maxRows: 10 }
        );
      const arAccounts =
        await DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
          context.tenantId,
          'accounts',
          'accountCode',
          '1110',
          { pageSize: 10, maxRows: 10 }
        );
      const taxAccounts =
        payload.taxRateBasisPoints > 0
          ? await DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
              context.tenantId,
              'accounts',
              'accountCode',
              '2040',
              { pageSize: 10, maxRows: 10 }
            )
          : [];

      const revenue = revenueAccounts[0];
      const ar = arAccounts[0];
      const tax = taxAccounts[0];

      if (
        revenueAccounts.length !== 1 ||
        !revenue ||
        revenue.isActive !== true ||
        revenue.category !== 'revenue' ||
        revenue.currency.trim().toUpperCase() !== currency
      ) {
        throw new AtomicMutationRejectedError(
          'OPD_REVENUE_ACCOUNT_INVALID',
          `Revenue account ${revenueAccountCode} must be uniquely active, category revenue, and currency-compatible.`
        );
      }
      if (
        arAccounts.length !== 1 ||
        !ar ||
        ar.isActive !== true ||
        ar.category !== 'asset' ||
        ar.currency.trim().toUpperCase() !== currency
      ) {
        throw new AtomicMutationRejectedError(
          'AR_CONTROL_ACCOUNT_INVALID',
          'Accounts Receivable control account 1110 must be uniquely active and currency-compatible.'
        );
      }
      if (
        payload.taxRateBasisPoints > 0 &&
        (taxAccounts.length !== 1 ||
          !tax ||
          tax.isActive !== true ||
          tax.category !== 'liability' ||
          tax.currency.trim().toUpperCase() !== currency)
      ) {
        throw new AtomicMutationRejectedError(
          'OUTPUT_TAX_ACCOUNT_INVALID',
          'Output tax account 2040 must be uniquely active and currency-compatible when consultation tax is non-zero.'
        );
      }

      const now = new Date();
      const fiscalYear = now.getUTCFullYear();
      const postingPeriod = now.getUTCMonth() + 1;
      const periodId = financePeriodId(fiscalYear, postingPeriod);
      const period = await DomainStateRepository.getById<FinancePeriodRecord>(
        context.tenantId,
        'accountingPeriods',
        periodId
      );

      if (!period || !['OPEN', 'SOFT_CLOSE'].includes(period.status)) {
        throw new AtomicMutationRejectedError(
          'FINANCE_PERIOD_NOT_POSTABLE',
          `Current finance period ${periodId} must exist and be OPEN or SOFT_CLOSE before OPD billing can be configured.`
        );
      }

      const nowIso = now.toISOString();
      const effectiveFrom = payload.effectiveFrom?.trim() || nowIso;

      const serviceState = {
        id: SERVICE_ID,
        tenantId: context.tenantId,
        serviceCode,
        description,
        category: 'consultation' as const,
        status: 'ACTIVE' as const,
        currency,
        unitPriceMinorUnits: payload.unitPriceMinorUnits,
        taxRateBasisPoints: payload.taxRateBasisPoints,
        revenueAccountCode,
        effectiveFrom,
        updatedAt: nowIso,
        updatedBy: context.actorId,
      };

      const tariffState = {
        id: CASH_TARIFF_ID,
        tenantId: context.tenantId,
        name: 'Standard Cash / Out-of-Pocket',
        planName: 'cash' as const,
        description: '100% patient responsibility for controlled OPD cash billing.',
        defaultDiscountPercent: 0,
        copayPercent: 100,
        priceOverrides: {},
        isDefault: true,
        status: 'active' as const,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'AUTHENTICATED_USER',
        actorRoles: context.roles,
        deviceId: context.deviceId,
        sessionId: context.sessionId,
        aggregateType: 'BILLING_SERVICE_CATALOG',
        aggregateId: SERVICE_ID,
        eventType: 'OPD_CONSULTATION_BILLING_CONFIGURED',
        auditAction: 'OPD_CONSULTATION_BILLING_CONFIGURED',
        auditResourceType: 'BILLING_SERVICE_CATALOG',
        auditResourceId: SERVICE_ID,
        outboxTopic: 'g-hims-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'service',
            entityType: 'BILLING_SERVICE_CATALOG',
            entityId: SERVICE_ID,
            required: false,
          },
          {
            key: 'tariff',
            entityType: 'TARIFF',
            entityId: CASH_TARIFF_ID,
            required: false,
          },
          {
            key: 'period',
            entityType: 'FINANCE_PERIOD',
            entityId: periodId,
            required: true,
          },
        ],
        prepare: (current) => {
          const currentPeriod = current.period as unknown as FinancePeriodRecord;
          if (!['OPEN', 'SOFT_CLOSE'].includes(currentPeriod.status)) {
            throw new AtomicMutationRejectedError(
              'FINANCE_PERIOD_NOT_POSTABLE',
              `Finance period ${periodId} is no longer postable.`
            );
          }

          return {
            domainState: serviceState,
            additionalStateWrites: [
              {
                entityType: 'TARIFF',
                entityId: CASH_TARIFF_ID,
                domainState: {
                  ...(current.tariff || {}),
                  ...tariffState,
                  createdAt:
                    String((current.tariff as any)?.createdAt || '').trim() ||
                    nowIso,
                },
              },
            ],
            eventPayload: {
              serviceCatalogId: SERVICE_ID,
              tariffId: CASH_TARIFF_ID,
              serviceCode,
              currency,
              unitPriceMinorUnits: payload.unitPriceMinorUnits,
              taxRateBasisPoints: payload.taxRateBasisPoints,
              revenueAccountCode,
              effectiveFrom,
            },
            auditReason:
              `Configured OPD consultation billing service ${serviceCode} at ${payload.unitPriceMinorUnits} minor units in ${currency}.`,
            auditMetadata: {
              previousServiceConfigured: Boolean(current.service),
              previousTariffConfigured: Boolean(current.tariff),
            },
            resultData: {
              service: serviceState,
              tariff: tariffState,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: SERVICE_ID,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(
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
