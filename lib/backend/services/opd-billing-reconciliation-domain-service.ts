import { createHash } from 'node:crypto';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import {
  AtomicMutationRejectedError,
  TransactionManager,
} from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext, CommandResult } from '@/lib/backend/types';
import { OpdWorkflowRuntimeService } from '@/lib/backend/services/opd-workflow-runtime-service';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import type { FinanceArOpenItem } from '@/types/finance-domain';
import type { OpdBillingReconciliation } from '@/types/opd-billing-reconciliation';

type DomainRecord = Record<string, any>;

const SUPPORTED_PURPOSES = new Set([
  'OPD_CONSULTATION',
  'OPD_DIAGNOSTIC',
  'OPD_PHARMACY',
]);

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

function majorToMinor(value: unknown): number {
  const numeric = Number(value);
  const minor = Math.round(numeric * 100);
  if (!Number.isFinite(numeric) || !Number.isSafeInteger(minor) || minor < 0) {
    return -1;
  }
  return minor;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== '_serverVersion')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)])
    );
  }
  return value;
}

function snapshotFingerprint(input: {
  billingMutationSequence: number;
  invoices: DomainRecord[];
  charges: DomainRecord[];
  arItems: DomainRecord[];
  journals: DomainRecord[];
  diagnosticOrders: DomainRecord[];
  prescriptions: DomainRecord[];
}): string {
  const normalize = (rows: DomainRecord[], idField: string) =>
    [...rows]
      .sort((left, right) =>
        String(left[idField] || '').localeCompare(String(right[idField] || ''))
      )
      .map((row) => stableValue(row));

  return createHash('sha256')
    .update(
      JSON.stringify({
        billingMutationSequence: input.billingMutationSequence,
        invoices: normalize(input.invoices, 'id'),
        charges: normalize(input.charges, 'chargeId'),
        arItems: normalize(input.arItems, 'openItemId'),
        journals: normalize(input.journals, 'journalId'),
        diagnosticOrders: normalize(input.diagnosticOrders, 'orderId'),
        prescriptions: normalize(input.prescriptions, 'prescriptionId'),
      })
    )
    .digest('hex');
}

export class OpdBillingReconciliationDomainService {
  public static async reconcile(
    context: CommandContext,
    commandId: string,
    idempotencyKey: string,
    payload: { encounterId: string }
  ): Promise<CommandResult> {
    const auth = AuthorizationPipeline.evaluate(context, {
      requiredRoles: [
        'BILLING_CLERK',
        'BILLING_ADMIN',
        'CASHIER',
        'FINANCE_MANAGER',
        'ACCOUNTANT',
        'REVENUE_CYCLE',
        'SYSTEM_ADMIN',
        'ADMINISTRATOR',
      ],
    });
    if (!auth.authorized) {
      return reject(
        commandId,
        idempotencyKey,
        auth.code || 'UNAUTHORIZED',
        auth.reason || 'Billing authority required for OPD reconciliation.'
      );
    }

    const encounter = await DomainStateRepository.getById<DomainRecord>(
      context.tenantId,
      'encounters',
      payload.encounterId
    );
    if (!encounter) {
      return reject(
        commandId,
        idempotencyKey,
        'ENCOUNTER_NOT_FOUND',
        'OPD encounter was not found.'
      );
    }
    if (String(encounter.encounterType || '').toUpperCase() !== 'OPD') {
      return reject(
        commandId,
        idempotencyKey,
        'NOT_OPD_ENCOUNTER',
        'Final OPD billing reconciliation only applies to OPD encounters.'
      );
    }
    if (
      ['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED'].includes(
        String(encounter.status || '').toUpperCase()
      )
    ) {
      return reject(
        commandId,
        idempotencyKey,
        'ENCOUNTER_ALREADY_CLOSED',
        'Closed encounters cannot be financially reconciled again.'
      );
    }

    if (
      String(encounter.billingReconciliationState || '').toUpperCase() ===
        'CLEARED' ||
      String(encounter.billingReconciliationId || '').trim()
    ) {
      return reject(
        commandId,
        idempotencyKey,
        'OPD_BILLING_ALREADY_RECONCILED',
        'This encounter already has a finalized billing reconciliation.'
      );
    }

    const stage = OpdWorkflowRuntimeService.resolveStage(
      encounter.clinicalState || encounter.currentStage
    );
    if (stage !== 'BILLING_SETTLEMENT') {
      return reject(
        commandId,
        idempotencyKey,
        'OPD_BILLING_STAGE_REQUIRED',
        'Final billing reconciliation requires the authoritative OPD workflow to be at BILLING_SETTLEMENT.'
      );
    }
    const patientId = String(encounter.patientId || '').trim();
    if (!patientId) {
      return reject(
        commandId,
        idempotencyKey,
        'ENCOUNTER_PATIENT_MISSING',
        'Encounter patient identity is missing.'
      );
    }

    const billingMutationSequence = Number(
      encounter.billingMutationSequence || 0
    );
    if (
      !Number.isSafeInteger(billingMutationSequence) ||
      billingMutationSequence < 0
    ) {
      return reject(
        commandId,
        idempotencyKey,
        'INVALID_BILLING_MUTATION_SEQUENCE',
        'Encounter billing mutation sequence is invalid.'
      );
    }

    const [invoices, charges, arItems, diagnosticOrders, prescriptions] =
      await Promise.all([
        DomainStateRepository.queryAllEqual<DomainRecord>(
          context.tenantId,
          'invoices',
          'encounterId',
          payload.encounterId,
          { pageSize: 200, maxRows: 500 }
        ),
        DomainStateRepository.queryAllEqual<DomainRecord>(
          context.tenantId,
          'encounterCharges',
          'encounterId',
          payload.encounterId,
          { pageSize: 200, maxRows: 500 }
        ),
        DomainStateRepository.queryAllEqual<DomainRecord>(
          context.tenantId,
          'arOpenItems',
          'encounterId',
          payload.encounterId,
          { pageSize: 200, maxRows: 500 }
        ),
        DomainStateRepository.queryAllEqual<DomainRecord>(
          context.tenantId,
          'orders',
          'encounterId',
          payload.encounterId,
          { pageSize: 200, maxRows: 500 }
        ),
        DomainStateRepository.queryAllEqual<DomainRecord>(
          context.tenantId,
          'prescriptions',
          'encounterId',
          payload.encounterId,
          { pageSize: 200, maxRows: 500 }
        ),
      ]);

    if (invoices.length === 0) {
      return reject(
        commandId,
        idempotencyKey,
        'OPD_INVOICE_SET_EMPTY',
        'An OPD encounter cannot close without authoritative billing invoices.'
      );
    }

    const invoiceById = new Map<string, DomainRecord>();
    const chargeToInvoiceIds = new Map<string, Set<string>>();
    const currencies = new Set<string>();
    let consultationInvoiceCount = 0;
    let totalPatientDueMinorUnits = 0;
    let totalPaidMinorUnits = 0;

    for (const invoice of invoices) {
      const invoiceId = String(invoice.id || '').trim();
      const purpose = String(invoice.billingPurpose || '').toUpperCase();
      if (!invoiceId || invoiceById.has(invoiceId)) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_INVOICE_IDENTITY_CONFLICT',
          'Encounter invoice identities are missing or duplicated.'
        );
      }
      if (purpose === 'FINAL_ENCOUNTER') {
        return reject(
          commandId,
          idempotencyKey,
          'LEGACY_FINAL_INVOICE_AUTHORITY_PRESENT',
          'A legacy aggregate final invoice is present. Reconciliation must not double-bill point-of-service invoices.'
        );
      }
      if (!SUPPORTED_PURPOSES.has(purpose)) {
        return reject(
          commandId,
          idempotencyKey,
          'UNSUPPORTED_OPD_INVOICE_PURPOSE',
          `Invoice ${invoiceId} has unsupported purpose ${purpose || 'UNKNOWN'}.`
        );
      }
      if (
        String(invoice.encounterId || '') !== payload.encounterId ||
        String(invoice.patientId || '') !== patientId
      ) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_INVOICE_LINEAGE_MISMATCH',
          `Invoice ${invoiceId} does not belong to this patient encounter.`
        );
      }

      const currency = String(invoice.currency || '').trim().toUpperCase();
      if (currency.length !== 3) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_INVOICE_CURRENCY_INVALID',
          `Invoice ${invoiceId} has invalid currency.`
        );
      }
      currencies.add(currency);

      const patientDue = majorToMinor(invoice.totalPatientDue);
      const totalPaid = majorToMinor(invoice.totalPaid || 0);
      const balanceDue = majorToMinor(invoice.balanceDue || 0);
      if (
        patientDue < 0 ||
        totalPaid < 0 ||
        balanceDue < 0 ||
        totalPaid + balanceDue !== patientDue
      ) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_INVOICE_MONETARY_MISMATCH',
          `Invoice ${invoiceId} paid plus balance does not equal patient responsibility.`
        );
      }
      if (
        String(invoice.paymentStatus || '').toLowerCase() !== 'paid' ||
        balanceDue !== 0 ||
        totalPaid !== patientDue
      ) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_OUTSTANDING_INVOICE',
          `Invoice ${invoiceId} is not fully cash-settled.`,
          { invoiceId, patientDue, totalPaid, balanceDue }
        );
      }

      const items = Array.isArray(invoice.items) ? invoice.items : [];
      if (items.length === 0) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_INVOICE_ITEMS_MISSING',
          `Invoice ${invoiceId} contains no authoritative charge items.`
        );
      }
      for (const item of items) {
        const chargeId = String(item?.id || '').trim();
        if (!chargeId) {
          return reject(
            commandId,
            idempotencyKey,
            'OPD_INVOICE_CHARGE_ID_MISSING',
            `Invoice ${invoiceId} contains a line without charge identity.`
          );
        }
        const links = chargeToInvoiceIds.get(chargeId) || new Set<string>();
        links.add(invoiceId);
        chargeToInvoiceIds.set(chargeId, links);
      }

      if (purpose === 'OPD_CONSULTATION') consultationInvoiceCount += 1;
      totalPatientDueMinorUnits += patientDue;
      totalPaidMinorUnits += totalPaid;
      invoiceById.set(invoiceId, invoice);
    }

    if (consultationInvoiceCount !== 1) {
      return reject(
        commandId,
        idempotencyKey,
        'OPD_CONSULTATION_INVOICE_CARDINALITY_INVALID',
        'Exactly one authoritative OPD consultation invoice is required.'
      );
    }
    if (currencies.size !== 1) {
      return reject(
        commandId,
        idempotencyKey,
        'OPD_MULTI_CURRENCY_RECONCILIATION_BLOCKED',
        'Controlled OPD final reconciliation requires a single encounter billing currency.'
      );
    }

    const chargeIds: string[] = [];
    for (const charge of charges) {
      const chargeId = String(charge.chargeId || '').trim();
      if (!chargeId) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_CHARGE_IDENTITY_MISSING',
          'An encounter charge is missing charge identity.'
        );
      }
      const status = String(charge.status || '').toUpperCase();
      if (!['BILLED', 'BILLED_DEFERRED'].includes(status)) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_UNBILLED_CHARGE',
          `Charge ${chargeId} is ${status || 'UNKNOWN'} and prevents encounter closure.`
        );
      }

      const links = new Set<string>(chargeToInvoiceIds.get(chargeId) || []);
      const explicitInvoiceId = String(charge.invoiceId || '').trim();
      if (explicitInvoiceId) links.add(explicitInvoiceId);
      if (links.size !== 1) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_CHARGE_INVOICE_CARDINALITY_INVALID',
          `Charge ${chargeId} must belong to exactly one authoritative invoice.`,
          { chargeId, invoiceIds: [...links] }
        );
      }
      const invoiceId = [...links][0];
      if (!invoiceById.has(invoiceId)) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_CHARGE_ORPHANED',
          `Charge ${chargeId} references an invoice outside this encounter.`
        );
      }
      chargeIds.push(chargeId);
    }

    for (const [chargeId, linkedInvoiceIds] of chargeToInvoiceIds.entries()) {
      if (
        linkedInvoiceIds.size !== 1 ||
        !charges.some((charge) => String(charge.chargeId || '') === chargeId)
      ) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_INVOICE_CHARGE_ORPHANED',
          `Invoice charge ${chargeId} does not resolve to exactly one encounter charge.`
        );
      }
    }

    const arByInvoiceId = new Map<string, FinanceArOpenItem>();
    for (const row of arItems as FinanceArOpenItem[]) {
      if (
        row.debtorType !== 'PATIENT' ||
        row.patientId !== patientId ||
        row.encounterId !== payload.encounterId
      ) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_AR_LINEAGE_MISMATCH',
          'Patient AR lineage does not match the encounter being reconciled.'
        );
      }
      if (!invoiceById.has(row.invoiceId) || arByInvoiceId.has(row.invoiceId)) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_AR_INVOICE_CARDINALITY_INVALID',
          'Every encounter invoice must resolve to exactly one patient AR open item.'
        );
      }
      if (
        row.status !== 'SETTLED' ||
        row.outstandingMinorUnits !== 0 ||
        row.originalMinorUnits !== row.allocatedMinorUnits
      ) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_AR_NOT_SETTLED',
          `AR item ${row.openItemId} is not fully settled.`
        );
      }
      arByInvoiceId.set(row.invoiceId, row);
    }
    if (arByInvoiceId.size !== invoiceById.size) {
      return reject(
        commandId,
        idempotencyKey,
        'OPD_AR_COVERAGE_INCOMPLETE',
        'Every authoritative encounter invoice must have one settled patient AR item.'
      );
    }

    const journalGroups = await Promise.all(
      [...invoiceById.keys()].map((invoiceId) =>
        DomainStateRepository.queryAllEqual<DomainRecord>(
          context.tenantId,
          'journalEntries',
          'referenceDocumentId',
          invoiceId,
          { pageSize: 10, maxRows: 10 }
        )
      )
    );
    const journals: DomainRecord[] = [];
    const journalIds: string[] = [];
    let journalGroupIndex = 0;
    for (const invoiceId of invoiceById.keys()) {
      const group = journalGroups[journalGroupIndex++] || [];
      if (group.length !== 1) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_BILLING_JOURNAL_CARDINALITY_INVALID',
          `Invoice ${invoiceId} must resolve to exactly one initial billing journal.`
        );
      }
      const journal = group[0];
      const journalId = String(journal.journalId || '').trim();
      const invoice = invoiceById.get(invoiceId)!;
      const expectedMinor = majorToMinor(invoice.totalPatientDue);
      const lines = Array.isArray(journal.lines) ? journal.lines : [];
      const debit = lines.reduce(
        (sum: number, line: DomainRecord) =>
          sum + Number(line.debitMinorUnits || 0),
        0
      );
      const credit = lines.reduce(
        (sum: number, line: DomainRecord) =>
          sum + Number(line.creditMinorUnits || 0),
        0
      );
      if (
        !journalId ||
        String(journal.status || '').toUpperCase() !== 'POSTED' ||
        String(journal.currency || '').toUpperCase() !==
          String(invoice.currency || '').toUpperCase() ||
        Number(journal.totalAmountMinorUnits || 0) !== expectedMinor ||
        !Number.isSafeInteger(debit) ||
        !Number.isSafeInteger(credit) ||
        debit !== expectedMinor ||
        credit !== expectedMinor
      ) {
        return reject(
          commandId,
          idempotencyKey,
          'OPD_BILLING_JOURNAL_INVALID',
          `Invoice ${invoiceId} billing journal is missing, unbalanced, or monetarily inconsistent.`
        );
      }
      journals.push(journal);
      journalIds.push(journalId);
    }

    const diagnosticById = new Map(
      diagnosticOrders.map((order) => [String(order.orderId || ''), order])
    );
    const prescriptionById = new Map(
      prescriptions.map((rx) => [String(rx.prescriptionId || ''), rx])
    );
    const diagnosticOrderIds: string[] = [];
    const prescriptionIds: string[] = [];

    for (const invoice of invoices) {
      const purpose = String(invoice.billingPurpose || '').toUpperCase();
      if (purpose === 'OPD_DIAGNOSTIC') {
        const orderId = String(invoice.sourceOrderId || '').trim();
        const order = diagnosticById.get(orderId);
        if (
          !orderId ||
          !order ||
          String(order.worklistStatus || '') !== 'FINALIZED' ||
          !Number(order.revenueRecognizedAt || 0)
        ) {
          return reject(
            commandId,
            idempotencyKey,
            'OPD_DIAGNOSTIC_NOT_FINALIZED',
            `Diagnostic invoice ${invoice.id} is not backed by a finalized, revenue-recognized diagnostic service.`
          );
        }
        diagnosticOrderIds.push(orderId);
      }
      if (purpose === 'OPD_PHARMACY') {
        const prescriptionId = String(
          invoice.sourcePrescriptionId || ''
        ).trim();
        const prescription = prescriptionById.get(prescriptionId);
        if (
          !prescriptionId ||
          !prescription ||
          String(prescription.status || '') !== 'DISPENSED'
        ) {
          return reject(
            commandId,
            idempotencyKey,
            'OPD_PHARMACY_NOT_DISPENSED',
            `Pharmacy invoice ${invoice.id} is not backed by a completed dispense.`
          );
        }
        prescriptionIds.push(prescriptionId);
      }
    }

    const preflightFingerprint = snapshotFingerprint({
      billingMutationSequence,
      invoices,
      charges,
      arItems,
      journals,
      diagnosticOrders: diagnosticOrderIds.map(
        (id) => diagnosticById.get(id)!
      ),
      prescriptions: prescriptionIds.map((id) => prescriptionById.get(id)!),
    });
    const reconciliationId = `opd_billrec_${payload.encounterId}`;
    const reconciledAt = Date.now();
    const reconciliation: OpdBillingReconciliation = {
      reconciliationId,
      tenantId: context.tenantId,
      encounterId: payload.encounterId,
      patientId,
      status: 'CLEARED',
      currency: [...currencies][0],
      invoiceIds: [...invoiceById.keys()].sort(),
      chargeIds: [...new Set(chargeIds)].sort(),
      arOpenItemIds: [...arByInvoiceId.values()]
        .map((row) => row.openItemId)
        .sort(),
      journalIds: [...new Set(journalIds)].sort(),
      diagnosticOrderIds: [...new Set(diagnosticOrderIds)].sort(),
      prescriptionIds: [...new Set(prescriptionIds)].sort(),
      invoiceCount: invoiceById.size,
      chargeCount: new Set(chargeIds).size,
      totalPatientDueMinorUnits,
      totalPaidMinorUnits,
      totalOutstandingMinorUnits: 0,
      snapshotFingerprint: preflightFingerprint,
      reconciledBy: context.actorId,
      reconciledAt,
      schemaVersion: 1,
    };

    const readTargets = [
      {
        key: 'encounter',
        entityType: 'ENCOUNTER',
        entityId: payload.encounterId,
        required: true,
      },
      {
        key: 'reconciliation',
        entityType: 'OPD_BILLING_RECONCILIATION',
        entityId: reconciliationId,
        required: false,
      },
      ...reconciliation.invoiceIds.map((id) => ({
        key: `invoice:${id}`,
        entityType: 'INVOICE',
        entityId: id,
        required: true,
      })),
      ...reconciliation.chargeIds.map((id) => ({
        key: `charge:${id}`,
        entityType: 'ENCOUNTER_CHARGE',
        entityId: id,
        required: true,
      })),
      ...reconciliation.arOpenItemIds.map((id) => ({
        key: `ar:${id}`,
        entityType: 'AR_OPEN_ITEM',
        entityId: id,
        required: true,
      })),
      ...reconciliation.journalIds.map((id) => ({
        key: `journal:${id}`,
        entityType: 'JOURNAL_ENTRY',
        entityId: id,
        required: true,
      })),
      ...reconciliation.diagnosticOrderIds.map((id) => ({
        key: `diagnostic:${id}`,
        entityType: 'DIAGNOSTIC_ORDER',
        entityId: id,
        required: true,
      })),
      ...reconciliation.prescriptionIds.map((id) => ({
        key: `prescription:${id}`,
        entityType: 'PRESCRIPTION',
        entityId: id,
        required: true,
      })),
    ];

    if (readTargets.length > 400) {
      return reject(
        commandId,
        idempotencyKey,
        'OPD_RECONCILIATION_TOO_LARGE',
        'Encounter billing state exceeds the bounded transactional reconciliation limit.',
        { readTargetCount: readTargets.length }
      );
    }

    try {
      const tx = await TransactionManager.executeAtomicReadModifyMutation({
        tenantId: context.tenantId,
        actorId: context.actorId,
        actorRole: context.roles[0] || 'BILLING',
        aggregateType: 'OPD_BILLING_RECONCILIATION',
        aggregateId: reconciliationId,
        eventType: 'OPD_FINAL_BILLING_RECONCILED',
        auditAction: 'RECONCILE_OPD_BILLING',
        auditResourceType: 'OPD_BILLING_RECONCILIATION',
        auditResourceId: reconciliationId,
        outboxTopic: 'g-hims-finance-events',
        idempotencyKey,
        commandId,
        correlationId: context.correlationId,
        readTargets,
        prepare: (current) => {
          if (current.reconciliation) {
            throw new AtomicMutationRejectedError(
              'OPD_BILLING_ALREADY_RECONCILED',
              'An immutable billing reconciliation already exists for this encounter.'
            );
          }

          const currentEncounter = current.encounter || {};
          if (
            Number(currentEncounter.billingMutationSequence || 0) !==
            billingMutationSequence
          ) {
            throw new AtomicMutationRejectedError(
              'OPD_BILLING_CHANGED_DURING_RECONCILIATION',
              'Billable encounter state changed during reconciliation. Refresh and reconcile again.'
            );
          }
          if (
            String(
              currentEncounter.billingReconciliationState || ''
            ).toUpperCase() === 'CLEARED'
          ) {
            throw new AtomicMutationRejectedError(
              'OPD_BILLING_ALREADY_RECONCILED',
              'Encounter billing has already been finalized.'
            );
          }

          const currentInvoices = reconciliation.invoiceIds.map(
            (id) => current[`invoice:${id}`] || {}
          );
          const currentCharges = reconciliation.chargeIds.map(
            (id) => current[`charge:${id}`] || {}
          );
          const currentArItems = reconciliation.arOpenItemIds.map(
            (id) => current[`ar:${id}`] || {}
          );
          const currentJournals = reconciliation.journalIds.map(
            (id) => current[`journal:${id}`] || {}
          );
          const currentDiagnostics = reconciliation.diagnosticOrderIds.map(
            (id) => current[`diagnostic:${id}`] || {}
          );
          const currentPrescriptions = reconciliation.prescriptionIds.map(
            (id) => current[`prescription:${id}`] || {}
          );
          const currentFingerprint = snapshotFingerprint({
            billingMutationSequence,
            invoices: currentInvoices,
            charges: currentCharges,
            arItems: currentArItems,
            journals: currentJournals,
            diagnosticOrders: currentDiagnostics,
            prescriptions: currentPrescriptions,
          });
          if (currentFingerprint !== preflightFingerprint) {
            throw new AtomicMutationRejectedError(
              'OPD_BILLING_SNAPSHOT_CHANGED',
              'Invoice, charge, AR, diagnostic, or pharmacy state changed during reconciliation.'
            );
          }

          const updatedEncounter = {
            ...currentEncounter,
            billingReconciliationId: reconciliationId,
            billingReconciliationState: 'CLEARED',
            financialClearanceState: 'FINAL_BILLING_CLEARED',
            billingClosedAt: reconciledAt,
            billingClosedBy: context.actorId,
            updatedAt: reconciledAt,
          };

          return {
            domainState: reconciliation,
            additionalStateWrites: [
              {
                entityType: 'ENCOUNTER',
                entityId: payload.encounterId,
                domainState: updatedEncounter,
              },
            ],
            eventPayload: {
              reconciliationId,
              encounterId: payload.encounterId,
              patientId,
              invoiceIds: reconciliation.invoiceIds,
              chargeIds: reconciliation.chargeIds,
              totalPatientDueMinorUnits,
              totalPaidMinorUnits,
              currency: reconciliation.currency,
              snapshotFingerprint: preflightFingerprint,
            },
            auditReason:
              `Final OPD billing reconciliation cleared ${reconciliation.invoiceCount} invoices and ${reconciliation.chargeCount} charges with zero outstanding patient AR.`,
            resultData: {
              reconciliation,
              encounter: updatedEncounter,
            },
          };
        },
      });

      return {
        success: true,
        commandId,
        idempotencyKey,
        entityId: reconciliationId,
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
