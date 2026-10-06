/**
 * G-HIMS Revenue Integrity Domain Service
 *
 * Revenue Integrity findings are candidate financial discrepancies backed by signed
 * clinical evidence. They never become billable charges until an authorized revenue
 * cycle user explicitly reconciles them.
 */
import { AuthorizationPipeline } from '../auth/authorization-pipeline';
import { TransactionManager } from '../transactions/transaction-manager';
import { CommandContext, CommandResult } from '../types';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { DiagnosticBillingCatalogRecord } from '@/types/diagnostic-billing';
import type { Invoice, Tariff, ChargeItem } from '@/types/billing';
import type {
  FinanceAccountRecord,
  FinanceArOpenItem,
  FinancePeriodRecord,
} from '@/types/finance-domain';
import { financePeriodId } from '@/lib/finance/finance-engine';

export type RevenueIntegrityFindingStatus = 'PENDING_REVIEW' | 'RECONCILED' | 'DISMISSED';

export interface RevenueIntegrityFinding {
  id: string;
  tenantId: string;
  patientId: string;
  patientName?: string;
  encounterId: string;
  sourceEvidenceId: string;
  sourceNoteId?: string;
  documentedItem: string;
  category: 'Procedure' | 'Medication' | 'Lab' | 'Supply / Consumable' | 'Bed Tier';
  suggestedCode: string;
  estimatedRecoverableAmountMinorUnits?: number;
  currency?: string;
  status: RevenueIntegrityFindingStatus;
  evidenceSnippet: string;
  confidenceScore?: number;
  createdAt: number;
  createdBy: string;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewReason?: string;
  chargeId?: string;
  invoiceId?: string;
}

export interface EncounterCharge {
  id: string;
  chargeId: string;
  tenantId: string;
  patientId: string;
  encounterId: string;
  sourceFindingId: string;
  sourceEvidenceId: string;
  code: string;
  description: string;
  category: RevenueIntegrityFinding['category'];
  quantity: number;
  unitAmountMinorUnits: number;
  netAmountMinorUnits: number;
  patientResponsibilityMinorUnits: number;
  currency: string;
  invoiceId: string;
  status: 'BILLED';
  createdAt: number;
  createdBy: string;
}

export interface ReconcileRevenueIntegrityFindingPayload {
  findingId: string;
}

export interface DismissRevenueIntegrityFindingPayload {
  findingId: string;
  reason: string;
}

function revenueAuthorization(context: CommandContext) {
  return AuthorizationPipeline.evaluate(context, {
    requiredRoles: [
      'BILLING_CLERK',
      'BILLING_STAFF',
      'FINANCE_MANAGER',
      'ACCOUNTANT',
      'ADMINISTRATOR',
      'SYSTEM_ADMIN',
    ],
  });
}

export class RevenueIntegrityDomainService {
  public static async reconcile(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: ReconcileRevenueIntegrityFindingPayload
  ): Promise<CommandResult<{ finding: RevenueIntegrityFinding; charge: EncounterCharge }>> {
    const auth = revenueAuthorization(context);
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Revenue-cycle authorization required.',
        },
      };
    }

    const finding = await DomainStateRepository.getById<RevenueIntegrityFinding>(
      context.tenantId,
      'billingMismatches',
      payload.findingId
    );

    if (!finding) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'REVENUE_FINDING_NOT_FOUND', message: 'Revenue Integrity finding was not found.' },
      };
    }

    if (finding.status === 'RECONCILED' && finding.chargeId) {
      const existingCharge = await DomainStateRepository.getById<EncounterCharge>(
        context.tenantId,
        'encounterCharges',
        finding.chargeId
      );

      if (existingCharge) {
        return {
          success: true,
          commandId,
          idempotencyKey,
          entityId: finding.id,
          data: { finding, charge: existingCharge },
        };
      }
    }

    if (finding.status !== 'PENDING_REVIEW') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'REVENUE_FINDING_ALREADY_REVIEWED',
          message: `Finding ${finding.id} is already ${finding.status}.`,
        },
      };
    }

    const encounter =
      await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        finding.encounterId
      );
    if (
      !encounter ||
      String(encounter.patientId || '') !== finding.patientId
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'REVENUE_FINDING_ENCOUNTER_MISMATCH',
          message:
            'Revenue Integrity acceptance requires the authoritative patient encounter referenced by the finding.',
        },
      };
    }
    if (
      String(encounter.encounterType || '').toUpperCase() === 'OPD' &&
      (
        String(encounter.billingReconciliationState || '').toUpperCase() ===
          'CLEARED' ||
        String(encounter.billingReconciliationId || '').trim()
      )
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'OPD_BILLING_ALREADY_RECONCILED',
          message:
            'A new Revenue Integrity charge cannot be accepted after final OPD billing reconciliation.',
        },
      };
    }

    if (
      String(encounter.encounterType || '').toUpperCase() !== 'OPD' ||
      finding.category !== 'Procedure'
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'REVENUE_INTEGRITY_AUTOBILL_SCOPE_UNSUPPORTED',
          message:
            'Governed Revenue Integrity auto-billing currently supports documented OPD procedures only.',
        },
      };
    }

    const [patient, catalog, tariff] = await Promise.all([
      DomainStateRepository.getById<Record<string, any>>(
        context.tenantId,
        'patients',
        finding.patientId
      ),
      DomainStateRepository.getById<DiagnosticBillingCatalogRecord>(
        context.tenantId,
        'billingServiceCatalog',
        finding.suggestedCode
      ),
      DomainStateRepository.getById<Tariff>(
        context.tenantId,
        'tariffs',
        'tariff-standard-cash'
      ),
    ]);

    if (
      !patient ||
      String(patient.tariffPlan || '').toUpperCase() !== 'OUT_OF_POCKET'
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'OPD_PILOT_PAYER_NOT_SUPPORTED',
          message:
            'Revenue Integrity auto-billing requires an authoritative OUT_OF_POCKET patient.',
        },
      };
    }

    if (
      !catalog ||
      catalog.status !== 'ACTIVE' ||
      catalog.orderType !== 'PROCEDURE' ||
      catalog.category !== 'procedure' ||
      catalog.serviceCode !== finding.suggestedCode ||
      !Number.isSafeInteger(catalog.unitPriceMinorUnits) ||
      catalog.unitPriceMinorUnits <= 0 ||
      !Number.isInteger(catalog.taxRateBasisPoints) ||
      catalog.taxRateBasisPoints < 0 ||
      catalog.taxRateBasisPoints > 10_000 ||
      !catalog.revenueAccountCode?.trim()
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'REVENUE_INTEGRITY_CATALOG_NOT_CONFIGURED',
          message:
            'Accepted Revenue Integrity procedure must resolve to an active server-owned procedure billing catalog entry.',
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
            'Revenue Integrity auto-billing requires the active 100% patient-responsibility cash tariff.',
        },
      };
    }

    const currency = String(catalog.currency || '').trim().toUpperCase();
    const discountBasisPoints = Math.round(
      Number(tariff.defaultDiscountPercent || 0) * 100
    );
    const grossMinorUnits = catalog.unitPriceMinorUnits;
    const discountMinorUnits = Math.round(
      (grossMinorUnits * discountBasisPoints) / 10_000
    );
    const netRevenueMinorUnits = grossMinorUnits - discountMinorUnits;
    const taxMinorUnits = Math.round(
      (netRevenueMinorUnits * catalog.taxRateBasisPoints) / 10_000
    );
    const patientDueMinorUnits = netRevenueMinorUnits + taxMinorUnits;

    if (
      currency.length !== 3 ||
      ![
        discountBasisPoints,
        grossMinorUnits,
        discountMinorUnits,
        netRevenueMinorUnits,
        taxMinorUnits,
        patientDueMinorUnits,
      ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      discountBasisPoints > 10_000 ||
      patientDueMinorUnits <= 0
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'INVALID_REVENUE_INTEGRITY_MONETARY_STATE',
          message:
            'Revenue Integrity catalog pricing or tariff calculation is invalid.',
        },
      };
    }

    const postingAt = Date.now();
    const postingDate = new Date(postingAt);
    const periodId = financePeriodId(
      postingDate.getUTCFullYear(),
      postingDate.getUTCMonth() + 1
    );
    const [arAccounts, revenueAccounts, taxAccounts, period] =
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
          catalog.revenueAccountCode,
          { pageSize: 10, maxRows: 10 }
        ),
        taxMinorUnits > 0
          ? DomainStateRepository.queryAllEqual<FinanceAccountRecord>(
              context.tenantId,
              'accounts',
              'accountCode',
              '2040',
              { pageSize: 10, maxRows: 10 }
            )
          : Promise.resolve([]),
        DomainStateRepository.getById<FinancePeriodRecord>(
          context.tenantId,
          'accountingPeriods',
          periodId
        ),
      ]);

    const arAccount = arAccounts[0];
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
            'Accounts Receivable control account 1110 is not valid for Revenue Integrity billing.',
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
          code: 'REVENUE_ACCOUNT_INVALID',
          message:
            'Revenue Integrity procedure revenue account is not active and currency-compatible.',
        },
      };
    }
    if (
      taxMinorUnits > 0 &&
      (
        taxAccounts.length !== 1 ||
        !taxAccount?.isActive ||
        taxAccount.category !== 'liability' ||
        taxAccount.currency.trim().toUpperCase() !== currency
      )
    ) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'OUTPUT_TAX_CONTROL_ACCOUNT_INVALID',
          message:
            'Output tax account 2040 is not valid for Revenue Integrity billing.',
        },
      };
    }
    if (!period || !['OPEN', 'SOFT_CLOSE'].includes(period.status)) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'FINANCE_PERIOD_NOT_POSTABLE',
          message:
            'Revenue Integrity billing requires an open finance period.',
        },
      };
    }

    const now = postingAt;
    const chargeId = `chg_ri_${finding.id}`;
    const invoiceId = `inv_ri_${finding.id}`;
    const arOpenItemId = `ar_patient_${invoiceId}`;
    const journalId = `je_ri_${finding.id}`;

    const charge: EncounterCharge = {
      id: chargeId,
      chargeId,
      tenantId: context.tenantId,
      patientId: finding.patientId,
      encounterId: finding.encounterId,
      sourceFindingId: finding.id,
      sourceEvidenceId: finding.sourceEvidenceId,
      code: catalog.serviceCode,
      description: catalog.description,
      category: finding.category,
      quantity: 1,
      unitAmountMinorUnits: grossMinorUnits,
      netAmountMinorUnits: patientDueMinorUnits,
      patientResponsibilityMinorUnits: patientDueMinorUnits,
      currency,
      invoiceId,
      status: 'BILLED',
      createdAt: now,
      createdBy: context.actorId,
    };

    const item: ChargeItem = {
      id: chargeId,
      entitySource: 'procedure',
      code: catalog.serviceCode,
      description: catalog.description,
      quantity: 1,
      unitPrice: grossMinorUnits / 100,
      grossAmount: grossMinorUnits / 100,
      discountAmount: discountMinorUnits / 100,
      tax: taxMinorUnits / 100,
      netAmount: patientDueMinorUnits / 100,
      insurancePortion: 0,
      patientPortion: patientDueMinorUnits / 100,
      timestamp: new Date(now).toISOString(),
      status: 'billed',
      sourceReferenceId: finding.id,
    };

    const invoice: Invoice & {
      currency: string;
      billingPurpose: 'OPD_REVENUE_INTEGRITY';
      sourceFindingId: string;
      chargeId: string;
    } = {
      id: invoiceId,
      tenantId: context.tenantId,
      invoiceNumber: `RI-${finding.id.replace(/[^a-zA-Z0-9]/g, '').slice(-12).toUpperCase()}`,
      patientId: finding.patientId,
      patientName: String(patient.fullName || finding.patientName || ''),
      mrn: String(patient.mrn || ''),
      encounterId: finding.encounterId,
      tariffId: tariff.id,
      tariffName: tariff.name,
      planName: tariff.planName,
      totalGross: grossMinorUnits / 100,
      totalDiscount: discountMinorUnits / 100,
      totalTax: taxMinorUnits / 100,
      totalCoverage: 0,
      totalPatientDue: patientDueMinorUnits / 100,
      totalPaid: 0,
      balanceDue: patientDueMinorUnits / 100,
      paymentStatus: 'pending',
      paymentMethod: 'cash',
      items: [item],
      paymentHistory: [],
      currency,
      billingPurpose: 'OPD_REVENUE_INTEGRITY',
      sourceFindingId: finding.id,
      chargeId,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };

    const arOpenItem: FinanceArOpenItem = {
      openItemId: arOpenItemId,
      tenantId: context.tenantId,
      invoiceId,
      debtorType: 'PATIENT',
      debtorId: finding.patientId,
      patientId: finding.patientId,
      encounterId: finding.encounterId,
      issueAt: now,
      dueAt: now,
      currency,
      originalMinorUnits: patientDueMinorUnits,
      allocatedMinorUnits: 0,
      writtenOffMinorUnits: 0,
      refundedMinorUnits: 0,
      outstandingMinorUnits: patientDueMinorUnits,
      status: 'OPEN',
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };

    const journalState = {
      journalId,
      tenantId: context.tenantId,
      fiscalYear: postingDate.getUTCFullYear(),
      postingPeriod: postingDate.getUTCMonth() + 1,
      documentDate: now,
      postingDate: now,
      referenceDocumentId: invoiceId,
      documentHeader: `Revenue Integrity procedure ${invoice.invoiceNumber}`,
      currency,
      totalAmountMinorUnits: patientDueMinorUnits,
      lines: [
        {
          glAccountId: '1110',
          glAccountName: arAccount.accountName,
          debitMinorUnits: patientDueMinorUnits,
          creditMinorUnits: 0,
          lineDescription: `Patient receivable for ${catalog.description}`,
        },
        {
          glAccountId: catalog.revenueAccountCode,
          glAccountName: revenueAccount.accountName,
          debitMinorUnits: 0,
          creditMinorUnits: netRevenueMinorUnits,
          lineDescription: `Procedure revenue for ${catalog.description}`,
        },
        ...(taxMinorUnits > 0
          ? [
              {
                glAccountId: '2040',
                glAccountName: taxAccount!.accountName,
                debitMinorUnits: 0,
                creditMinorUnits: taxMinorUnits,
                lineDescription: `Output tax for ${catalog.description}`,
              },
            ]
          : []),
      ],
      sourceModule: 'BILLING',
      status: 'POSTED',
      postedBy: context.actorId,
      postedAt: now,
    };

    const reconciledFinding: RevenueIntegrityFinding = {
      ...finding,
      status: 'RECONCILED',
      reviewedAt: now,
      reviewedBy: context.actorId,
      reviewReason: 'Accepted by authorized revenue-cycle reviewer.',
      chargeId,
      invoiceId,
      estimatedRecoverableAmountMinorUnits: patientDueMinorUnits,
      currency,
    };

    const tx = await TransactionManager.executeAtomicMutation({
      tenantId: context.tenantId,
      actorId: context.actorId,
      actorRole: context.roles[0] || 'BILLING_STAFF',
      aggregateType: 'REVENUE_INTEGRITY_FINDING',
      aggregateId: finding.id,
      eventType: 'REVENUE_INTEGRITY_FINDING_RECONCILED',
      eventPayload: {
        findingId: finding.id,
        patientId: finding.patientId,
        encounterId: finding.encounterId,
        chargeId,
        invoiceId,
        arOpenItemId,
        journalId,
        amountMinorUnits: charge.netAmountMinorUnits,
        currency: charge.currency,
        sourceEvidenceId: finding.sourceEvidenceId,
      },
      auditAction: 'RECONCILE_REVENUE_INTEGRITY_FINDING',
      auditResourceType: 'REVENUE_INTEGRITY_FINDING',
      auditResourceId: finding.id,
      auditReason: `Accepted candidate charge ${finding.suggestedCode} for encounter ${finding.encounterId}.`,
      outboxTopic: 'g-hims-revenue-integrity-events',
      idempotencyKey,
      commandId,
      correlationId: context.correlationId,
      domainState: reconciledFinding,
      expectedPrimaryServerVersion: Number(
        (finding as RevenueIntegrityFinding & { _serverVersion?: number })
          ._serverVersion || 0
      ),
      additionalStateWrites: [
        {
          entityType: 'ENCOUNTER_CHARGE',
          entityId: chargeId,
          domainState: charge,
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
          entityId: journalId,
          domainState: journalState,
        },
        {
          entityType: 'ENCOUNTER',
          entityId: finding.encounterId,
          domainState: {
            ...encounter,
            billingMutationSequence:
              Number(encounter.billingMutationSequence || 0) + 1,
            updatedAt: now,
          },
          expectedServerVersion: Number(encounter._serverVersion || 0),
        },
      ],
    });

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: finding.id,
      eventId: tx.eventId,
      auditId: tx.auditId,
      outboxId: tx.outboxId,
      data: {
        finding: reconciledFinding,
        charge,
        invoice,
        arOpenItem,
        journal: journalState,
      },
    };
  }

  public static async dismiss(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: DismissRevenueIntegrityFindingPayload
  ): Promise<CommandResult<{ finding: RevenueIntegrityFinding }>> {
    const auth = revenueAuthorization(context);
    if (!auth.authorized) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: auth.code || 'UNAUTHORIZED',
          message: auth.reason || 'Revenue-cycle authorization required.',
        },
      };
    }

    const reason = String(payload.reason || '').trim();
    if (reason.length < 3) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'DISMISSAL_REASON_REQUIRED', message: 'A dismissal reason is required.' },
      };
    }

    const finding = await DomainStateRepository.getById<RevenueIntegrityFinding>(
      context.tenantId,
      'billingMismatches',
      payload.findingId
    );

    if (!finding) {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: { code: 'REVENUE_FINDING_NOT_FOUND', message: 'Revenue Integrity finding was not found.' },
      };
    }

    if (finding.status !== 'PENDING_REVIEW') {
      return {
        success: false,
        commandId,
        idempotencyKey,
        error: {
          code: 'REVENUE_FINDING_ALREADY_REVIEWED',
          message: `Finding ${finding.id} is already ${finding.status}.`,
        },
      };
    }

    const dismissedFinding: RevenueIntegrityFinding = {
      ...finding,
      status: 'DISMISSED',
      reviewedAt: Date.now(),
      reviewedBy: context.actorId,
      reviewReason: reason,
    };

    const tx = await TransactionManager.executeAtomicWrite(
      context,
      commandId,
      idempotencyKey,
      {
        entityType: 'REVENUE_INTEGRITY_FINDING',
        entityId: finding.id,
        eventType: 'REVENUE_INTEGRITY_FINDING_DISMISSED',
        domainState: dismissedFinding,
        eventPayload: {
          findingId: finding.id,
          patientId: finding.patientId,
          encounterId: finding.encounterId,
          reason,
          sourceEvidenceId: finding.sourceEvidenceId,
        },
        auditReason: reason,
        outboxTopic: 'g-hims-revenue-integrity-events',
      }
    );

    return {
      success: true,
      commandId,
      idempotencyKey,
      entityId: finding.id,
      eventId: tx.event.eventId,
      auditId: tx.audit.auditId,
      outboxId: tx.outbox.outboxId,
      data: { finding: dismissedFinding },
    };
  }
}
