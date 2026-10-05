/**
 * Clinical Order Domain Service
 * Manages diagnostic orders, credential-gated prescriptions, and atomic
 * prescription-to-inventory dispensing.
 */

import { CommandContext, CommandResult } from '../types';
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '../transactions/transaction-manager';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { EncounterDomainService } from './encounter-domain-service';
import { PatientClinicalKnowledgeDomainService } from './patient-clinical-knowledge-domain-service';
import { MedicationSafetyService } from '@/lib/clinical/intelligence/medication-safety-service';
import type { InventoryBalance } from '@/types/scm-domain';
import type {
  DiagnosticBillingCatalogRecord,
  OperationalDiagnosticOrder,
} from '@/types/diagnostic-billing';
import type { PatientMPI } from '@/types/mpi';
import type { Invoice, Tariff, ChargeItem } from '@/types/billing';
import type {
  FinanceAccountRecord,
  FinanceArOpenItem,
  FinancePeriodRecord,
} from '@/types/finance-domain';
import { financePeriodId } from '@/lib/finance/finance-engine';
import {
  buildCanonicalDiagnosticOrder,
  buildCanonicalMedicationDispense,
  buildCanonicalMedicationOrder,
} from '@/lib/clinical/canonical-fact-builders';

export interface PlaceOrderPayload {
  encounterId: string;
  patientId: string;
  orderType: 'LAB' | 'RADIOLOGY' | 'PROCEDURE';
  catalogCode: string;
  priority: 'STAT' | 'URGENT' | 'ROUTINE';
  clinicalIndication: string;
  statOverrideReason?: string;
}

export interface PrescribeMedicationPayload {
  encounterId: string;
  patientId: string;
  drugCode: string;
  drugName: string;
  dosage: string;
  route: string;
  frequency: string;
  durationDays: number;
  quantityPrescribed?: number;
  unitOfMeasure?: string;
  unitPriceMinorUnits?: number;
  inventoryItemId?: string;
  instructions?: string;
  safetyAcknowledgementFindingIds?: string[];
  safetyOverrideReason?: string;
}

interface VersionedInventoryBalance extends InventoryBalance {
  _serverVersion?: number;
}

function isClosedEncounter(status: unknown): boolean {
  return ['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED'].includes(
    String(status || '').toUpperCase()
  );
}

export class ClinicalOrderDomainService {
  /**
   * Places a diagnostic order with clinical revenue lock evaluation.
   */
  public static async placeDiagnosticOrder(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: PlaceOrderPayload
  ): Promise<CommandResult> {
    const requiredPrivilege =
      payload.orderType === 'LAB'
        ? 'ORDER_LAB'
        : payload.orderType === 'RADIOLOGY'
          ? 'ORDER_RADIOLOGY'
          : 'ORDER_PROCEDURE';

    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
      requiredPrivilege,
      allowBreakGlass: payload.priority === 'STAT',
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Not privileged to order diagnostics.',
        },
      };
    }

    if (
      payload.priority === 'STAT' &&
      (!payload.statOverrideReason || payload.statOverrideReason.trim().length < 10)
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'STAT_OVERRIDE_REASON_REQUIRED',
          message:
            'STAT diagnostic execution bypasses the payment lock and requires an explicit emergency justification.',
        },
      };
    }

    const encounter = await EncounterDomainService.getAuthoritativeEncounter(
      context.tenantId,
      payload.encounterId
    );
    if (!encounter || String(encounter.patientId || '') !== payload.patientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_PATIENT_MISMATCH',
          message:
            'Diagnostic orders require an existing encounter for the same patient.',
        },
      };
    }
    if (isClosedEncounter(encounter.status)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_ALREADY_CLOSED',
          message: 'Diagnostic orders cannot be added to a closed encounter.',
        },
      };
    }

    const [patient, catalog, tariff] = await Promise.all([
      DomainStateRepository.getById<PatientMPI>(
        context.tenantId,
        'patients',
        payload.patientId
      ),
      DomainStateRepository.getById<DiagnosticBillingCatalogRecord>(
        context.tenantId,
        'billingServiceCatalog',
        payload.catalogCode
      ),
      DomainStateRepository.getById<Tariff>(
        context.tenantId,
        'tariffs',
        'tariff-standard-cash'
      ),
    ]);

    if (!patient) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'PATIENT_NOT_FOUND', message: 'Patient record was not found.' },
      };
    }
    if (patient.tariffPlan !== 'OUT_OF_POCKET') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'OPD_PILOT_PAYER_NOT_SUPPORTED',
          message:
            'The controlled OPD diagnostic payment gate currently supports OUT_OF_POCKET cash billing only.',
        },
      };
    }

    const expectedCategory =
      payload.orderType === 'LAB'
        ? 'laboratory'
        : payload.orderType === 'RADIOLOGY'
          ? 'radiology'
          : 'procedure';

    if (
      !catalog ||
      catalog.id !== payload.catalogCode ||
      catalog.status !== 'ACTIVE' ||
      catalog.orderType !== payload.orderType ||
      catalog.category !== expectedCategory ||
      !catalog.serviceCode?.trim() ||
      !catalog.description?.trim() ||
      !Number.isSafeInteger(catalog.unitPriceMinorUnits) ||
      catalog.unitPriceMinorUnits <= 0 ||
      !Number.isInteger(catalog.taxRateBasisPoints) ||
      catalog.taxRateBasisPoints < 0 ||
      catalog.taxRateBasisPoints > 10_000 ||
      !catalog.revenueAccountCode?.trim() ||
      !catalog.deferredRevenueAccountCode?.trim()
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_CATALOG_NOT_CONFIGURED',
          message:
            'The selected diagnostic service is not an active, fully configured server-owned billing catalog item.',
        },
      };
    }

    if (catalog.requiresProcedureConsent) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PROCEDURE_SPECIFIC_CONSENT_REQUIRED',
          message:
            'This procedure requires a procedure-specific consent authority and cannot be dispatched from the generic OPD diagnostic order flow.',
        },
      };
    }

    if (
      !tariff ||
      tariff.status !== 'active' ||
      tariff.planName !== 'cash' ||
      tariff.copayPercent !== 100
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'CASH_TARIFF_NOT_CONFIGURED',
          message:
            'The active tariff-standard-cash configuration is required and must assign 100% patient responsibility.',
        },
      };
    }

    const currency = String(catalog.currency || '').trim().toUpperCase();
    if (!currency) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_CURRENCY_REQUIRED',
          message: 'Diagnostic catalog currency is required.',
        },
      };
    }

    const discountBasisPoints = Math.round(
      Number(tariff.defaultDiscountPercent || 0) * 100
    );
    if (
      !Number.isSafeInteger(discountBasisPoints) ||
      discountBasisPoints < 0 ||
      discountBasisPoints > 10_000
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_TARIFF_DISCOUNT',
          message: 'Cash tariff discount is invalid.',
        },
      };
    }

    const grossMinor = catalog.unitPriceMinorUnits;
    const discountMinor = Math.round(
      (grossMinor * discountBasisPoints) / 10_000
    );
    const netBeforeTaxMinor = grossMinor - discountMinor;
    const taxMinor = Math.round(
      (netBeforeTaxMinor * catalog.taxRateBasisPoints) / 10_000
    );
    const patientDueMinor = netBeforeTaxMinor + taxMinor;
    if (
      ![grossMinor, discountMinor, netBeforeTaxMinor, taxMinor, patientDueMinor].every(
        (value) => Number.isSafeInteger(value) && value >= 0
      ) ||
      patientDueMinor <= 0
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_DIAGNOSTIC_MONETARY_STATE',
          message: 'Diagnostic monetary calculation is invalid.',
        },
      };
    }

    const [arAccounts, deferredAccounts, revenueAccounts, taxAccounts] =
      await Promise.all([
        DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
          context.tenantId,
          'accounts',
          'accountCode',
          '1110',
          { pageSize: 10, maxRows: 10 }
        ),
        DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
          context.tenantId,
          'accounts',
          'accountCode',
          catalog.deferredRevenueAccountCode,
          { pageSize: 10, maxRows: 10 }
        ),
        DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
          context.tenantId,
          'accounts',
          'accountCode',
          catalog.revenueAccountCode,
          { pageSize: 10, maxRows: 10 }
        ),
        taxMinor > 0
          ? DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
              context.tenantId,
              'accounts',
              'accountCode',
              '2040',
              { pageSize: 10, maxRows: 10 }
            )
          : Promise.resolve([] as FinanceAccountRecord[]),
      ]);

    const arAccount = arAccounts[0];
    const deferredAccount = deferredAccounts[0];
    const revenueAccount = revenueAccounts[0];
    const taxAccount = taxAccounts[0];

    if (
      arAccounts.length !== 1 ||
      !arAccount?.isActive ||
      arAccount.category !== 'asset' ||
      arAccount.currency.trim().toUpperCase() !== currency
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'AR_CONTROL_ACCOUNT_INVALID',
          message:
            'Accounts Receivable control account 1110 must be uniquely active and currency-compatible.',
        },
      };
    }
    if (
      deferredAccounts.length !== 1 ||
      !deferredAccount?.isActive ||
      deferredAccount.category !== 'liability' ||
      deferredAccount.currency.trim().toUpperCase() !== currency
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_DEFERRED_REVENUE_ACCOUNT_INVALID',
          message:
            'Diagnostic deferred revenue must resolve to one active liability account in the invoice currency.',
        },
      };
    }
    if (
      revenueAccounts.length !== 1 ||
      !revenueAccount?.isActive ||
      revenueAccount.category !== 'revenue' ||
      revenueAccount.currency.trim().toUpperCase() !== currency
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'DIAGNOSTIC_REVENUE_ACCOUNT_INVALID',
          message:
            'Diagnostic revenue must resolve to one active revenue account in the invoice currency.',
        },
      };
    }
    if (
      taxMinor > 0 &&
      (taxAccounts.length !== 1 ||
        !taxAccount?.isActive ||
        taxAccount.category !== 'liability' ||
        taxAccount.currency.trim().toUpperCase() !== currency)
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'OUTPUT_TAX_ACCOUNT_INVALID',
          message:
            'Output tax account 2040 must be uniquely active and currency-compatible.',
        },
      };
    }

    const orderedAt = Date.now();
    const postingDate = new Date(orderedAt);
    const periodId = financePeriodId(
      postingDate.getUTCFullYear(),
      postingDate.getUTCMonth() + 1
    );
    const orderId = `ord_${crypto.randomUUID()}`;
    const invoiceId = `inv_diag_${orderId}`;
    const chargeId = `chg_diag_${orderId}`;
    const arOpenItemId = `ar_patient_${invoiceId}`;
    const deferredRevenueJournalId = `je_diag_deferred_${orderId}`;
    const isStat = payload.priority === 'STAT';
    const specimenBarcode =
      payload.orderType === 'LAB'
        ? `SPEC-${crypto.randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`
        : undefined;

    const orderState: OperationalDiagnosticOrder = {
      orderId,
      tenantId: context.tenantId,
      encounterId: payload.encounterId,
      patientId: payload.patientId,
      orderType: payload.orderType,
      catalogCode: payload.catalogCode,
      serviceCatalogId: catalog.id,
      orderName: catalog.description,
      priority: payload.priority,
      clinicalIndication: payload.clinicalIndication.trim(),
      status: 'PLACED',
      revenueLockStatus: isStat
        ? 'UNLOCKED_STAT_OVERRIDE'
        : 'PENDING_PAYMENT_CLEARANCE',
      worklistStatus: isStat
        ? 'READY_FOR_EXECUTION'
        : 'BLOCKED_BY_REVENUE_GATE',
      costMinorUnits: patientDueMinor,
      currency,
      billingInvoiceId: invoiceId,
      chargeId,
      deferredRevenueJournalId,
      deferredRevenueAccountCode: catalog.deferredRevenueAccountCode,
      revenueAccountCode: catalog.revenueAccountCode,
      netRevenueMinorUnits: netBeforeTaxMinor,
      taxMinorUnits: taxMinor,
      ...(isStat
        ? {
            statOverrideReason: payload.statOverrideReason!.trim(),
            statOverrideBy: context.actorId,
            statOverrideAt: orderedAt,
          }
        : {}),
      ...(catalog.specimenType ? { specimenType: catalog.specimenType } : {}),
      ...(specimenBarcode ? { specimenBarcode } : {}),
      orderedBy: context.actorId,
      createdAt: orderedAt,
      updatedAt: orderedAt,
    };

    const canonicalOrder = buildCanonicalDiagnosticOrder({
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      orderId,
      actorId: context.actorId,
      orderType: payload.orderType,
      catalogCode: catalog.serviceCode,
      orderName: catalog.description,
      priority: payload.priority,
      clinicalIndication: payload.clinicalIndication.trim(),
      orderedAt,
    });

    const item: ChargeItem = {
      id: chargeId,
      entitySource:
        payload.orderType === 'LAB'
          ? 'lab'
          : payload.orderType === 'RADIOLOGY'
            ? 'radiology'
            : 'procedure',
      code: catalog.serviceCode,
      description: catalog.description,
      quantity: 1,
      unitPrice: grossMinor / 100,
      grossAmount: grossMinor / 100,
      discountAmount: discountMinor / 100,
      tax: taxMinor / 100,
      netAmount: patientDueMinor / 100,
      insurancePortion: 0,
      patientPortion: patientDueMinor / 100,
      timestamp: new Date(orderedAt).toISOString(),
      status: 'billed',
      sourceReferenceId: orderId,
    };

    const invoice: Invoice & {
      currency: string;
      billingPurpose: 'OPD_DIAGNOSTIC';
      sourceOrderId: string;
      serviceCatalogId: string;
      deferredRevenueAccountCode: string;
      revenueAccountCode: string;
    } = {
      id: invoiceId,
      tenantId: context.tenantId,
      invoiceNumber: `DX-${orderId.replace(/[^a-zA-Z0-9]/g, '').slice(-12).toUpperCase()}`,
      patientId: payload.patientId,
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
      billingPurpose: 'OPD_DIAGNOSTIC',
      sourceOrderId: orderId,
      serviceCatalogId: catalog.id,
      deferredRevenueAccountCode: catalog.deferredRevenueAccountCode,
      revenueAccountCode: catalog.revenueAccountCode,
      createdAt: new Date(orderedAt).toISOString(),
      updatedAt: new Date(orderedAt).toISOString(),
    };

    const arOpenItem: FinanceArOpenItem = {
      openItemId: arOpenItemId,
      tenantId: context.tenantId,
      invoiceId,
      debtorType: 'PATIENT',
      debtorId: payload.patientId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      issueAt: orderedAt,
      dueAt: orderedAt,
      currency,
      originalMinorUnits: patientDueMinor,
      allocatedMinorUnits: 0,
      writtenOffMinorUnits: 0,
      refundedMinorUnits: 0,
      outstandingMinorUnits: patientDueMinor,
      status: 'OPEN',
      createdAt: new Date(orderedAt).toISOString(),
      updatedAt: new Date(orderedAt).toISOString(),
    };

    const deferredJournal = {
      journalId: deferredRevenueJournalId,
      tenantId: context.tenantId,
      fiscalYear: postingDate.getUTCFullYear(),
      postingPeriod: postingDate.getUTCMonth() + 1,
      documentDate: orderedAt,
      postingDate: orderedAt,
      referenceDocumentId: invoiceId,
      documentHeader: `Diagnostic pre-service billing ${invoice.invoiceNumber}`,
      currency,
      totalAmountMinorUnits: patientDueMinor,
      lines: [
        {
          glAccountId: '1110',
          glAccountName: arAccount.accountName,
          debitMinorUnits: patientDueMinor,
          creditMinorUnits: 0,
          lineDescription: `Patient receivable for ${catalog.description}`,
        },
        {
          glAccountId: catalog.deferredRevenueAccountCode,
          glAccountName: deferredAccount.accountName,
          debitMinorUnits: 0,
          creditMinorUnits: netBeforeTaxMinor,
          lineDescription: `Deferred diagnostic revenue for ${catalog.description}`,
        },
        ...(taxMinor > 0
          ? [
              {
                glAccountId: '2040',
                glAccountName: taxAccount.accountName,
                debitMinorUnits: 0,
                creditMinorUnits: taxMinor,
                lineDescription: `Output tax for ${catalog.description}`,
              },
            ]
          : []),
      ],
      sourceModule: 'BILLING',
      status: 'POSTED',
      postedBy: context.actorId,
      postedAt: orderedAt,
    };

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        aggregateType: 'DIAGNOSTIC_ORDER',
        aggregateId: orderId,
        eventType: isStat
          ? 'INVESTIGATION_ORDERED_STAT_OVERRIDE'
          : 'INVESTIGATION_ORDERED_PAYMENT_LOCKED',
        auditAction: 'PLACE_DIAGNOSTIC_ORDER',
        auditResourceType: 'DIAGNOSTIC_ORDER',
        auditResourceId: orderId,
        auditReason: isStat
          ? `STAT diagnostic order ${catalog.description}; payment lock bypassed for emergency reason: ${payload.statOverrideReason}`
          : `Ordered ${payload.orderType} ${catalog.description}; worklist locked pending payment.`,
        auditMetadata: isStat
          ? {
              statOverride: true,
              statOverrideReason: payload.statOverrideReason,
            }
          : { statOverride: false },
        outboxTopic: 'g-hims-clinical-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets: [
          {
            key: 'period',
            entityType: 'FINANCE_PERIOD',
            entityId: periodId,
            required: true,
          },
        ],
        prepare: (current) => {
          const period = current.period as unknown as FinancePeriodRecord;
          if (!['OPEN', 'SOFT_CLOSE'].includes(period.status)) {
            throw new AtomicMutationRejectedError(
              'FINANCE_PERIOD_NOT_POSTABLE',
              'Diagnostic pre-service billing requires an open finance period.'
            );
          }

          return {
            domainState: orderState,
            additionalStateWrites: [
              {
                entityType: 'CANONICAL_DIAGNOSTIC_ORDER',
                entityId: canonicalOrder.diagnosticOrderId,
                domainState: canonicalOrder,
              },
              {
                entityType: 'ENCOUNTER_CHARGE',
                entityId: chargeId,
                domainState: {
                  chargeId,
                  tenantId: context.tenantId,
                  encounterId: payload.encounterId,
                  patientId: payload.patientId,
                  sourceType: 'DIAGNOSTIC_ORDER',
                  sourceId: orderId,
                  serviceCatalogId: catalog.id,
                  serviceCode: catalog.serviceCode,
                  description: catalog.description,
                  currency,
                  grossMinorUnits: grossMinor,
                  discountMinorUnits: discountMinor,
                  taxMinorUnits: taxMinor,
                  patientResponsibilityMinorUnits: patientDueMinor,
                  status: 'BILLED_DEFERRED',
                  createdAt: orderedAt,
                  createdBy: context.actorId,
                },
              },
              {
                entityType: 'INVOICE',
                entityId: invoiceId,
                domainState: invoice,
              },
              {
                entityType: 'AR_OPEN_ITEM',
                entityId: arOpenItemId,
                domainState: arOpenItem,
              },
              {
                entityType: 'JOURNAL_ENTRY',
                entityId: deferredRevenueJournalId,
                domainState: deferredJournal,
              },
            ],
            eventPayload: {
              orderId,
              encounterId: payload.encounterId,
              patientId: payload.patientId,
              catalogCode: catalog.serviceCode,
              priority: payload.priority,
              revenueLockStatus: orderState.revenueLockStatus,
              worklistStatus: orderState.worklistStatus,
              billingInvoiceId: invoiceId,
              chargeId,
              arOpenItemId,
              deferredRevenueJournalId,
              statOverride: isStat,
              canonicalDiagnosticOrderId: canonicalOrder.diagnosticOrderId,
            },
            resultData: {
              order: orderState,
              invoice,
              charge: item,
              arOpenItem,
              deferredJournal,
              canonicalDiagnosticOrder: canonicalOrder,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: orderId,
        eventId: tx.eventId,
        auditId: tx.auditId,
        outboxId: tx.outboxId,
        data: tx.resultData,
      };
    } catch (error) {
      if (error instanceof AtomicMutationRejectedError) {
        return {
          success: false,
          commandId,
          idempotencyKey,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        };
      }
      throw error;
    }
  }

  public static async dispenseMedication(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: {
      prescriptionId: string;
      quantityDispensed: number;
      batchNumber?: string;
      expiryDate?: string;
      dispensedByName?: string;
    }
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['PHARMACIST', 'SYSTEM_ADMIN'],
      requiredPrivilege: 'DISPENSE_MEDICATION',
    });
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Licensed pharmacy authority required to dispense medication.',
        },
      };
    }

    if (
      !payload.prescriptionId ||
      !Number.isFinite(payload.quantityDispensed) ||
      payload.quantityDispensed <= 0
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_DISPENSE',
          message: 'Prescription identity and a positive dispense quantity are required.',
        },
      };
    }

    const prescription = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'prescriptions',
      payload.prescriptionId
    );

    if (!prescription) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'PRESCRIPTION_NOT_FOUND', message: 'Prescription was not found.' },
      };
    }
    if (String(prescription.status || '') !== 'PRESCRIBED') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PRESCRIPTION_STATE_CONFLICT',
          message: `Prescription is already ${String(prescription.status || 'UNKNOWN')}.`,
        },
      };
    }

    const patientId = String(prescription.patientId || '');
    const encounterId = String(prescription.encounterId || '');
    const itemId = String(prescription.inventoryItemId || prescription.drugCode || '');
    if (!patientId || !encounterId || !itemId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PRESCRIPTION_TRACEABILITY_INCOMPLETE',
          message: 'Prescription is missing patient, encounter, or inventory item identity.',
        },
      };
    }

    const [patient, encounter, balances] = await Promise.all([
      DomainStateRepository.getById<Record<string, unknown>>(context.tenantId, 'patients', patientId),
      EncounterDomainService.getAuthoritativeEncounter(context.tenantId, encounterId),
      DomainStateRepository.queryEqual<VersionedInventoryBalance>(
        context.tenantId,
        'inventoryBalances',
        'itemId',
        itemId,
        200
      ),
    ]);

    if (!patient || !encounter || String(encounter.patientId || '') !== patientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PRESCRIPTION_ENCOUNTER_TRACEABILITY_CONFLICT',
          message: 'Prescription patient/encounter lineage could not be verified.',
        },
      };
    }
    if (isClosedEncounter(encounter.status)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_ALREADY_CLOSED',
          message: 'Medication cannot be dispensed against a closed encounter.',
        },
      };
    }

    const now = Date.now();
    const eligibleBalances = balances
      .filter((balance) => {
        const expiryMs = Date.parse(balance.expiryDate);
        return (
          balance.available >= payload.quantityDispensed &&
          Number.isFinite(expiryMs) &&
          expiryMs > now
        );
      })
      .sort((left, right) => {
        const expiryDelta = Date.parse(left.expiryDate) - Date.parse(right.expiryDate);
        if (expiryDelta !== 0) return expiryDelta;
        return String(left.batchNumber || '').localeCompare(String(right.batchNumber || ''));
      });

    const selectedBalance = eligibleBalances[0];
    if (!selectedBalance) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'PHARMACY_STOCK_NOT_AVAILABLE',
          message: `No non-expired FEFO inventory batch has ${payload.quantityDispensed} units available for ${itemId}.`,
        },
      };
    }

    if (
      payload.batchNumber &&
      String(payload.batchNumber).trim() !== String(selectedBalance.batchNumber || '').trim()
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'FEFO_BATCH_MISMATCH',
          message: `Client-selected batch ${payload.batchNumber} is not the authoritative FEFO batch ${selectedBalance.batchNumber}.`,
        },
      };
    }
    if (
      payload.expiryDate &&
      String(payload.expiryDate).slice(0, 10) !== String(selectedBalance.expiryDate).slice(0, 10)
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'FEFO_EXPIRY_MISMATCH',
          message: 'Client-supplied expiry does not match the authoritative inventory batch.',
        },
      };
    }

    const quantity = payload.quantityDispensed;
    const dispensedAt = Date.now();
    const stockTransactionId = `stk_dispense_${crypto.randomUUID()}`;
    const consumptionId = `consume_${crypto.randomUUID()}`;
    const chargeId = `chg_rx_${crypto.randomUUID()}`;
    const unitPriceMinorUnits = Math.max(0, Number(prescription.unitPriceMinorUnits || 0));
    const amountMinorUnits = Math.round(unitPriceMinorUnits * quantity);

    const prescriptionState = {
      ...prescription,
      status: 'DISPENSED',
      quantityDispensed: quantity,
      batchId: selectedBalance.batchId,
      batchNumber: selectedBalance.batchNumber,
      expiryDate: selectedBalance.expiryDate,
      inventoryBalanceId: selectedBalance.balanceId,
      dispensedBy: context.actorId,
      dispensedByName: payload.dispensedByName,
      dispensedAt,
    };

    const inventoryState: VersionedInventoryBalance = {
      ...selectedBalance,
      onHand: Math.max(0, selectedBalance.onHand - quantity),
      available: Math.max(0, selectedBalance.available - quantity),
      totalValuation: Math.max(
        0,
        (selectedBalance.onHand - quantity) * selectedBalance.unitCost
      ),
      lastMovementAt: new Date(dispensedAt).toISOString(),
      version: Number(selectedBalance.version || 0) + 1,
    };

    const stockTransactionState = {
      transactionId: stockTransactionId,
      tenantId: context.tenantId,
      facilityId: selectedBalance.facilityId,
      itemId: selectedBalance.itemId,
      itemCode: selectedBalance.itemCode,
      itemName: selectedBalance.itemName,
      batchId: selectedBalance.batchId,
      batchNumber: selectedBalance.batchNumber,
      expirationDate: selectedBalance.expiryDate,
      fromLocationId: selectedBalance.locationId,
      fromLocationName: selectedBalance.locationName,
      quantity,
      uom: selectedBalance.uom,
      normalizedQuantity: quantity,
      unitCost: selectedBalance.unitCost,
      totalCost: quantity * selectedBalance.unitCost,
      currency: 'PKR',
      transactionType: 'DISPENSE',
      referenceType: 'PRESCRIPTION',
      referenceId: payload.prescriptionId,
      patientId,
      encounterId,
      performedBy: {
        userId: context.actorId,
        userName: payload.dispensedByName || context.actorId,
        role: context.roles[0] || 'PHARMACIST',
      },
      occurredAt: new Date(dispensedAt).toISOString(),
      recordedAt: new Date(dispensedAt).toISOString(),
      idempotencyKey,
      source: 'ONLINE',
    };

    const consumptionState = {
      consumptionId,
      tenantId: context.tenantId,
      patientId,
      patientMRN: String(patient.mrn || ''),
      patientName: String(patient.fullName || ''),
      encounterId,
      departmentId: String(encounter.departmentId || encounter.department || ''),
      departmentName: String(encounter.departmentId || encounter.department || ''),
      itemId: selectedBalance.itemId,
      itemCode: selectedBalance.itemCode,
      itemName: selectedBalance.itemName,
      itemType: selectedBalance.itemType,
      batchId: selectedBalance.batchId,
      batchNumber: selectedBalance.batchNumber,
      quantity,
      uom: selectedBalance.uom,
      consumedAt: new Date(dispensedAt).toISOString(),
      documentedBy: context.actorId,
      isImplant: false,
      sourcePrescriptionId: payload.prescriptionId,
    };

    const canonicalDispense = buildCanonicalMedicationDispense({
      tenantId: context.tenantId,
      patientId,
      encounterId,
      prescriptionId: payload.prescriptionId,
      actorId: context.actorId,
      drugCode: String(prescription.drugCode || itemId),
      drugName: String(prescription.drugName || selectedBalance.itemName),
      quantityDispensed: quantity,
      unitOfMeasure: String(prescription.unitOfMeasure || selectedBalance.uom || 'unit'),
      batchNumber: String(selectedBalance.batchNumber || ''),
      expiryDate: String(selectedBalance.expiryDate || ''),
      dispensedAt,
    });

    const chargeState = {
      chargeId,
      tenantId: context.tenantId,
      encounterId,
      patientId,
      category: 'PHARMACY',
      sourceType: 'PRESCRIPTION_DISPENSE',
      sourceId: payload.prescriptionId,
      serviceCode: String(prescription.drugCode || itemId),
      description: `${String(prescription.drugName || selectedBalance.itemName)} dispense`,
      quantity,
      unitPriceMinorUnits,
      amountMinorUnits,
      status: amountMinorUnits > 0 ? 'UNBILLED' : 'PRICE_PENDING',
      createdAt: dispensedAt,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'PHARMACIST',
      aggregateType: 'PRESCRIPTION',
      aggregateId: payload.prescriptionId,
      eventType: 'MEDICATION_DISPENSED',
      eventPayload: {
        prescriptionId: payload.prescriptionId,
        patientId,
        encounterId,
        quantityDispensed: quantity,
        inventoryBalanceId: selectedBalance.balanceId,
        batchId: selectedBalance.batchId,
        batchNumber: selectedBalance.batchNumber,
        expiryDate: selectedBalance.expiryDate,
        stockTransactionId,
        consumptionId,
        chargeId,
        amountMinorUnits,
        dispensedAt,
      },
      auditAction: 'DISPENSE_MEDICATION',
      auditResourceType: 'PRESCRIPTION',
      auditResourceId: payload.prescriptionId,
      auditReason: `Dispensed prescription ${payload.prescriptionId} from FEFO batch ${selectedBalance.batchNumber}`,
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: prescriptionState,
      expectedPrimaryServerVersion: Number(prescription._serverVersion || 0),
      additionalStateWrites: [
        {
          entityType: 'INVENTORY_BALANCE',
          entityId: selectedBalance.balanceId,
          domainState: inventoryState,
          expectedServerVersion: Number(selectedBalance._serverVersion || 0),
        },
        {
          entityType: 'STOCK_TRANSACTION',
          entityId: stockTransactionId,
          domainState: stockTransactionState,
        },
        {
          entityType: 'PATIENT_CONSUMPTION',
          entityId: consumptionId,
          domainState: consumptionState,
        },
        {
          entityType: 'ENCOUNTER_CHARGE',
          entityId: chargeId,
          domainState: chargeState,
        },
        {
          entityType: 'MEDICATION_DISPENSE',
          entityId: canonicalDispense.medicationDispenseId,
          domainState: canonicalDispense,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: payload.prescriptionId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        prescription: prescriptionState,
        inventoryBalance: inventoryState,
        stockTransaction: stockTransactionState,
        patientConsumption: consumptionState,
        charge: chargeState,
        canonicalMedicationDispense: canonicalDispense,
      },
    };
  }

  /**
   * Prescribes medication requiring explicit PRESCRIBE clinical privilege.
   */
  public static async prescribeMedication(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: PrescribeMedicationPayload
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: ['DOCTOR', 'CONSULTANT', 'SYSTEM_ADMIN'],
      requiredPrivilege: 'PRESCRIBE',
    });

    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: auth.code || 'UNAUTHORIZED', message: auth.reason || 'Active PRESCRIBE privilege required.' },
      };
    }

    const encounter = await DomainStateRepository.getById<Record<string, unknown>>(
      context.tenantId,
      'encounters',
      payload.encounterId
    );
    if (!encounter || String(encounter.patientId || '') !== payload.patientId) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_PATIENT_MISMATCH',
          message: 'Prescription requires an existing encounter for the same patient.',
        },
      };
    }
    if (isClosedEncounter(encounter.status)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'ENCOUNTER_ALREADY_CLOSED',
          message: 'Medication cannot be prescribed against a closed encounter.',
        },
      };
    }

    let safetyEvaluation;
    try {
      safetyEvaluation =
        await MedicationSafetyService.evaluateCandidateAuthoritatively(
          context.tenantId,
          payload.patientId,
          payload.encounterId,
          {
            drugCode: payload.drugCode,
            drugName: payload.drugName,
          }
        );
    } catch (error) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'MEDICATION_SAFETY_PRECHECK_UNAVAILABLE',
          message:
            error instanceof Error
              ? error.message
              : 'Authoritative medication-safety precheck is unavailable.',
        },
      };
    }

    const acknowledgedFindingIds = new Set(
      (payload.safetyAcknowledgementFindingIds || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );
    const missingAcknowledgements =
      safetyEvaluation.acknowledgementFindingIds.filter(
        (findingId) => !acknowledgedFindingIds.has(findingId)
      );
    if (missingAcknowledgements.length > 0) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'MEDICATION_SAFETY_ACKNOWLEDGEMENT_REQUIRED',
          message:
            'Medication-safety findings require explicit clinician acknowledgement before prescribing.',
          details: {
            findings: safetyEvaluation.findings,
            missingFindingIds: missingAcknowledgements,
          },
        },
      };
    }

    if (
      safetyEvaluation.blockingFindingIds.length > 0 &&
      !String(payload.safetyOverrideReason || '').trim()
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'MEDICATION_SAFETY_OVERRIDE_REQUIRED',
          message:
            'A documented clinical override reason is required for the identified critical medication-safety finding.',
          details: {
            findings: safetyEvaluation.findings,
            blockingFindingIds: safetyEvaluation.blockingFindingIds,
          },
        },
      };
    }

    const prescriptionId = `rx_${crypto.randomUUID()}`;
    const domainState = {
      prescriptionId,
      tenantId: context.tenantId,
      encounterId: payload.encounterId,
      patientId: payload.patientId,
      drugCode: payload.drugCode,
      drugName: payload.drugName,
      dosage: payload.dosage,
      route: payload.route,
      frequency: payload.frequency,
      durationDays: payload.durationDays,
      quantityPrescribed: payload.quantityPrescribed,
      unitOfMeasure: payload.unitOfMeasure,
      unitPriceMinorUnits: payload.unitPriceMinorUnits,
      inventoryItemId: payload.inventoryItemId || payload.drugCode,
      instructions: payload.instructions,
      prescribedBy: context.actorId,
      status: 'PRESCRIBED',
      createdAt: Date.now(),
    };

    const canonicalMedicationOrder = buildCanonicalMedicationOrder({
      tenantId: context.tenantId,
      patientId: payload.patientId,
      encounterId: payload.encounterId,
      prescriptionId,
      actorId: context.actorId,
      drugCode: payload.drugCode,
      drugName: payload.drugName,
      dosage: payload.dosage,
      route: payload.route,
      frequency: payload.frequency,
      durationDays: payload.durationDays,
      quantityPrescribed: payload.quantityPrescribed,
      unitOfMeasure: payload.unitOfMeasure,
      instructions: payload.instructions,
      authoredAt: domainState.createdAt,
    });

    const knowledgeRecord =
      PatientClinicalKnowledgeDomainService.buildRecord({
        tenantId: context.tenantId,
        patientId: payload.patientId,
        domain: 'MEDICATIONS',
        status: 'KNOWN',
        actorId: context.actorId,
        reviewedAt: domainState.createdAt,
        encounterId: payload.encounterId,
        reason: 'Medication prescribed',
      });

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'CLINICIAN',
      aggregateType: 'PRESCRIPTION',
      aggregateId: prescriptionId,
      eventType: 'MEDICATION_PRESCRIBED',
      eventPayload: {
        prescriptionId,
        encounterId: payload.encounterId,
        patientId: payload.patientId,
        drugCode: payload.drugCode,
        drugName: payload.drugName,
        quantityPrescribed: payload.quantityPrescribed,
        canonicalMedicationOrderId: canonicalMedicationOrder.medicationOrderId,
        medicationKnowledgeStatus: 'KNOWN',
        medicationSafetyFindingIds: safetyEvaluation.findings.map(
          (finding) => finding.findingId
        ),
        medicationSafetyOverrideApplied:
          safetyEvaluation.blockingFindingIds.length > 0,
      },
      auditAction: 'PRESCRIBE_MEDICATION',
      auditResourceType: 'PRESCRIPTION',
      auditResourceId: prescriptionId,
      auditReason: `Prescribed ${payload.drugName} ${payload.dosage} (${payload.route})`,
      auditMetadata: {
        medicationSafetyFindingIds: safetyEvaluation.findings.map(
          (finding) => finding.findingId
        ),
        medicationSafetyOverrideReason:
          String(payload.safetyOverrideReason || '').trim() || undefined,
        medicationSafetyRuleIds: safetyEvaluation.findings.map(
          (finding) => finding.ruleId
        ),
      },
      outboxTopic: 'g-hims-clinical-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState,
      additionalStateWrites: [
        {
          entityType: 'MEDICATION_ORDER',
          entityId: canonicalMedicationOrder.medicationOrderId,
          domainState: canonicalMedicationOrder,
        },
        {
          entityType: 'PATIENT_CLINICAL_KNOWLEDGE_STATUS',
          entityId: PatientClinicalKnowledgeDomainService.documentId(
            payload.patientId,
            'MEDICATIONS'
          ),
          domainState: knowledgeRecord,
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: prescriptionId,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        ...domainState,
        canonicalMedicationOrderId: canonicalMedicationOrder.medicationOrderId,
        medicationSafety: safetyEvaluation,
      },
    };
  }
}
