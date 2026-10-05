import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { PatientMPI } from '@/types/mpi';
import type {
  FinanceAccountRecord,
  FinanceArOpenItem,
  FinancePeriodRecord,
} from '@/types/finance-domain';
import { financePeriodId } from '@/lib/finance/finance-engine';
import type { Invoice, Tariff, ChargeItem } from '@/types/billing';

const OPD_CONSULTATION_SERVICE_ID = 'opd-consultation-standard';
const CASH_TARIFF_ID = 'tariff-standard-cash';

interface BillingServiceCatalogRecord {
  id: string;
  serviceCode: string;
  description: string;
  category: 'consultation';
  status: 'ACTIVE' | 'INACTIVE';
  currency: string;
  unitPriceMinorUnits: number;
  taxRateBasisPoints: number;
  revenueAccountCode: string;
}

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

function safeMinor(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AtomicMutationRejectedError(code, 'Invalid minor-unit monetary value.');
  }
  return value;
}

export class OpdBillingDomainService {
  public static async createConsultationInvoice(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: { encounterId: string }
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'RECEPTIONIST',
        'REGISTRAR',
        'BILLING_CLERK',
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
        auth.reason || 'Not authorized to create an OPD consultation invoice.'
      );
    }

    const encounter = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'encounters',
      payload.encounterId
    );
    if (!encounter) {
      return reject(commandId, idempotencyKey, 'ENCOUNTER_NOT_FOUND', 'OPD encounter was not found.');
    }
    if (String(encounter.encounterType || encounter.type || '').toUpperCase() !== 'OPD') {
      return reject(
        commandId,
        idempotencyKey,
        'NOT_OPD_ENCOUNTER',
        'Consultation invoice command only applies to OPD encounters.'
      );
    }

    const patientId = String(encounter.patientId || '');
    const patient = await DomainStateRepository.getById<PatientMPI>(
      context.tenantId,
      'patients',
      patientId
    );
    if (!patient) {
      return reject(commandId, idempotencyKey, 'PATIENT_NOT_FOUND', 'Encounter patient was not found.');
    }

    // Pilot RP6 is deliberately cash-only. Other payer models require their own
    // eligibility/preauthorization authority and may not silently fall back to cash.
    if (patient.tariffPlan !== 'OUT_OF_POCKET') {
      return reject(
        commandId,
        idempotencyKey,
        'OPD_PILOT_PAYER_NOT_SUPPORTED',
        'The current OPD pilot invoice authority supports OUT_OF_POCKET cash billing only.'
      );
    }

    const [service, tariff] = await Promise.all([
      DomainStateRepository.getById<BillingServiceCatalogRecord>(
        context.tenantId,
        'billingServiceCatalog',
        OPD_CONSULTATION_SERVICE_ID
      ),
      DomainStateRepository.getById<Tariff>(
        context.tenantId,
        'tariffs',
        CASH_TARIFF_ID
      ),
    ]);

    if (
      !service ||
      service.status !== 'ACTIVE' ||
      service.category !== 'consultation' ||
      !service.serviceCode ||
      !service.description ||
      !Number.isSafeInteger(service.unitPriceMinorUnits) ||
      service.unitPriceMinorUnits <= 0 ||
      !Number.isInteger(service.taxRateBasisPoints) ||
      service.taxRateBasisPoints < 0 ||
      service.taxRateBasisPoints > 10_000 ||
      !service.revenueAccountCode
    ) {
      return reject(
        commandId,
        idempotencyKey,
        'OPD_CONSULTATION_CATALOG_NOT_CONFIGURED',
        'Tenant billingServiceCatalog/opd-consultation-standard must define an active consultation service, currency, integer minor-unit price, tax rate and revenue account.'
      );
    }
    if (
      !tariff ||
      tariff.status !== 'active' ||
      tariff.planName !== 'cash' ||
      tariff.copayPercent !== 100
    ) {
      return reject(
        commandId,
        idempotencyKey,
        'CASH_TARIFF_NOT_CONFIGURED',
        'The active tariff-standard-cash configuration is required and must assign 100% patient responsibility.'
      );
    }

    const currency = String(service.currency || '').trim().toUpperCase();
    if (!currency) {
      return reject(commandId, idempotencyKey, 'SERVICE_CURRENCY_REQUIRED', 'Billing service currency is required.');
    }

    const discountBasisPoints = Math.round(Number(tariff.defaultDiscountPercent || 0) * 100);
    if (
      !Number.isSafeInteger(discountBasisPoints) ||
      discountBasisPoints < 0 ||
      discountBasisPoints > 10_000
    ) {
      return reject(commandId, idempotencyKey, 'INVALID_TARIFF_DISCOUNT', 'Cash tariff discount is invalid.');
    }

    const grossMinor = safeMinor(service.unitPriceMinorUnits, 'INVALID_SERVICE_PRICE');
    const discountMinor = safeMinor(
      Math.round((grossMinor * discountBasisPoints) / 10_000),
      'INVALID_DISCOUNT'
    );
    const netBeforeTaxMinor = safeMinor(grossMinor - discountMinor, 'INVALID_NET_AMOUNT');
    const taxMinor = safeMinor(
      Math.round((netBeforeTaxMinor * service.taxRateBasisPoints) / 10_000),
      'INVALID_TAX_AMOUNT'
    );
    const patientDueMinor = safeMinor(netBeforeTaxMinor + taxMinor, 'INVALID_PATIENT_DUE');

    const postingAt = Date.now();
    const postingDate = new Date(postingAt);
    const fiscalYear = postingDate.getUTCFullYear();
    const postingPeriod = postingDate.getUTCMonth() + 1;
    const periodId = financePeriodId(fiscalYear, postingPeriod);

    const revenueAccounts =
      await DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
        context.tenantId,
        'accounts',
        'accountCode',
        service.revenueAccountCode,
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
      taxMinor > 0
        ? await DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
            context.tenantId,
            'accounts',
            'accountCode',
            '2040',
            { pageSize: 10, maxRows: 10 }
          )
        : [];

    if (
      revenueAccounts.length !== 1 ||
      revenueAccounts[0].isActive !== true ||
      revenueAccounts[0].category !== 'revenue' ||
      revenueAccounts[0].currency.trim().toUpperCase() !== currency
    ) {
      return reject(
        commandId,
        idempotencyKey,
        'OPD_REVENUE_ACCOUNT_INVALID',
        `Revenue account ${service.revenueAccountCode} must be uniquely active and currency-compatible.`
      );
    }
    if (
      arAccounts.length !== 1 ||
      arAccounts[0].isActive !== true ||
      arAccounts[0].category !== 'asset' ||
      arAccounts[0].currency.trim().toUpperCase() !== currency
    ) {
      return reject(
        commandId,
        idempotencyKey,
        'AR_CONTROL_ACCOUNT_INVALID',
        'Accounts Receivable control account 1110 must be uniquely active and currency-compatible.'
      );
    }
    if (
      taxMinor > 0 &&
      (taxAccounts.length !== 1 ||
        taxAccounts[0].isActive !== true ||
        taxAccounts[0].category !== 'liability' ||
        taxAccounts[0].currency.trim().toUpperCase() !== currency)
    ) {
      return reject(
        commandId,
        idempotencyKey,
        'OUTPUT_TAX_ACCOUNT_INVALID',
        'Output tax account 2040 must be uniquely active and currency-compatible when the service is taxable.'
      );
    }

    const invoiceId = `inv_opd_consult_${payload.encounterId}`;
    const chargeId = `chg_opd_consult_${payload.encounterId}`;
    const arOpenItemId = `ar_patient_${invoiceId}`;
    const journalId = `je_opd_consult_${payload.encounterId}`;
    const createdIso = new Date(postingAt).toISOString();

    const item: ChargeItem = {
      id: chargeId,
      entitySource: 'consultation',
      code: service.serviceCode,
      description: service.description,
      quantity: 1,
      unitPrice: grossMinor / 100,
      grossAmount: grossMinor / 100,
      discountAmount: discountMinor / 100,
      tax: taxMinor / 100,
      netAmount: patientDueMinor / 100,
      insurancePortion: 0,
      patientPortion: patientDueMinor / 100,
      timestamp: createdIso,
      status: 'billed',
      sourceReferenceId: payload.encounterId,
    };

    const invoice: Invoice & {
      currency: string;
      billingPurpose: 'OPD_CONSULTATION';
      serviceCatalogId: string;
    } = {
      id: invoiceId,
      tenantId: context.tenantId,
      invoiceNumber: `OPD-${payload.encounterId.replace(/[^a-zA-Z0-9]/g, '').slice(-12).toUpperCase()}`,
      patientId,
      patientName: patient.fullName,
      mrn: patient.mrn,
      encounterId: payload.encounterId,
      tariffId: tariff.id,
      tariffName: tariff.name,
      planName: tariff.planName,
      totalGross: grossMinor / 100,
      totalDiscount: discountMinor / 100,
      totalTax: taxMinor / 100,
      totalCoverage: 0,
      totalPatientDue: patientDueMinor / 100,
      totalPaid: 0,
      balanceDue: patientDueMinor / 100,
      paymentStatus: 'pending',
      paymentMethod: 'cash',
      items: [item],
      paymentHistory: [],
      currency,
      billingPurpose: 'OPD_CONSULTATION',
      serviceCatalogId: service.id,
      createdAt: createdIso,
      updatedAt: createdIso,
    };

    const arOpenItem: FinanceArOpenItem = {
      openItemId: arOpenItemId,
      tenantId: context.tenantId,
      invoiceId,
      debtorType: 'PATIENT',
      debtorId: patientId,
      patientId,
      encounterId: payload.encounterId,
      issueAt: postingAt,
      dueAt: postingAt,
      currency,
      originalMinorUnits: patientDueMinor,
      allocatedMinorUnits: 0,
      writtenOffMinorUnits: 0,
      refundedMinorUnits: 0,
      outstandingMinorUnits: patientDueMinor,
      status: 'OPEN',
      createdAt: createdIso,
      updatedAt: createdIso,
    };

    const journalState = {
      journalId,
      tenantId: context.tenantId,
      fiscalYear,
      postingPeriod,
      documentDate: postingAt,
      postingDate: postingAt,
      referenceDocumentId: invoiceId,
      documentHeader: `OPD consultation revenue ${invoice.invoiceNumber}`,
      currency,
      totalAmountMinorUnits: patientDueMinor,
      lines: [
        {
          glAccountId: '1110',
          glAccountName: arAccounts[0].accountName,
          debitMinorUnits: patientDueMinor,
          creditMinorUnits: 0,
          lineDescription: `Patient receivable for ${service.description}`,
        },
        {
          glAccountId: service.revenueAccountCode,
          glAccountName: revenueAccounts[0].accountName,
          debitMinorUnits: 0,
          creditMinorUnits: netBeforeTaxMinor,
          lineDescription: service.description,
        },
        ...(taxMinor > 0
          ? [
              {
                glAccountId: '2040',
                glAccountName: taxAccounts[0].accountName,
                debitMinorUnits: 0,
                creditMinorUnits: taxMinor,
                lineDescription: `Output tax for ${service.description}`,
              },
            ]
          : []),
      ],
      sourceModule: 'BILLING',
      status: 'POSTED',
      postedBy: context.actorId,
      postedAt: postingAt,
    };

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'RECEPTIONIST',
        aggregateType: 'INVOICE',
        aggregateId: invoiceId,
        eventType: 'OPD_CONSULTATION_INVOICE_CREATED',
        auditAction: 'CREATE_OPD_CONSULTATION_INVOICE',
        auditResourceType: 'INVOICE',
        auditResourceId: invoiceId,
        outboxTopic: 'g-hims-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'encounter',
            entityType: 'ENCOUNTER',
            entityId: payload.encounterId,
            required: true,
          },
          {
            key: 'patient',
            entityType: 'PATIENT_MPI',
            entityId: patientId,
            required: true,
          },
          {
            key: 'period',
            entityType: 'FINANCE_PERIOD',
            entityId: periodId,
            required: true,
          },
          {
            key: 'invoice',
            entityType: 'INVOICE',
            entityId: invoiceId,
            required: false,
          },
          {
            key: 'arOpenItem',
            entityType: 'AR_OPEN_ITEM',
            entityId: arOpenItemId,
            required: false,
          },
        ],
        prepare: (current) => {
          if (current.invoice || current.arOpenItem) {
            throw new AtomicMutationRejectedError(
              'OPD_CONSULTATION_INVOICE_ALREADY_EXISTS',
              'An authoritative consultation invoice already exists for this encounter.'
            );
          }

          const currentEncounter = current.encounter || {};
          if (String(currentEncounter.patientId || '') !== patientId) {
            throw new AtomicMutationRejectedError(
              'ENCOUNTER_PATIENT_MISMATCH',
              'Encounter patient linkage changed before invoice creation.'
            );
          }
          if (
            String(currentEncounter.financialClearanceState || '').toUpperCase() !==
            'CONSULTATION_PAYMENT_PENDING'
          ) {
            throw new AtomicMutationRejectedError(
              'CONSULTATION_INVOICE_STATE_INVALID',
              'Consultation invoice can only be created while payment is pending.'
            );
          }

          const period = current.period as unknown as FinancePeriodRecord;
          if (!['OPEN', 'SOFT_CLOSE'].includes(period.status)) {
            throw new AtomicMutationRejectedError(
              'FINANCE_PERIOD_NOT_POSTABLE',
              `Finance period ${period.periodKey} is ${period.status}.`
            );
          }

          const updatedEncounter = {
            ...currentEncounter,
            consultationInvoiceId: invoiceId,
            updatedAt: postingAt,
          };

          return {
            domainState: invoice,
            additionalStateWrites: [
              {
                entityType: 'ENCOUNTER_CHARGE',
                entityId: chargeId,
                domainState: {
                  chargeId,
                  tenantId: context.tenantId,
                  encounterId: payload.encounterId,
                  patientId,
                  invoiceId,
                  serviceCatalogId: service.id,
                  serviceCode: service.serviceCode,
                  description: service.description,
                  currency,
                  grossMinorUnits: grossMinor,
                  discountMinorUnits: discountMinor,
                  taxMinorUnits: taxMinor,
                  patientResponsibilityMinorUnits: patientDueMinor,
                  status: 'BILLED',
                  createdAt: postingAt,
                  createdBy: context.actorId,
                },
              },
              {
                entityType: 'AR_OPEN_ITEM',
                entityId: arOpenItemId,
                domainState: arOpenItem,
              },
              {
                entityType: 'JOURNAL_ENTRY',
                entityId: journalId,
                domainState: journalState,
              },
              {
                entityType: 'ENCOUNTER',
                entityId: payload.encounterId,
                domainState: updatedEncounter,
              },
            ],
            eventPayload: {
              invoiceId,
              chargeId,
              encounterId: payload.encounterId,
              patientId,
              serviceCatalogId: service.id,
              serviceCode: service.serviceCode,
              patientDueMinorUnits: patientDueMinor,
              currency,
              arOpenItemId,
              journalId,
            },
            auditReason:
              `Created authoritative OPD consultation invoice ${invoice.invoiceNumber} from tenant billing catalog.`,
            resultData: {
              invoice,
              charge: item,
              arOpenItem,
              journal: journalState,
              encounter: updatedEncounter,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: invoiceId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return reject(commandId, idempotencyKey, error.code, error.message, error.details);
      }
      throw error;
    }
  }
}
