import { beforeEach, describe, expect, test } from 'bun:test';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import { OpdBillingReconciliationDomainService } from '@/lib/backend/services/opd-billing-reconciliation-domain-service';
import { OpdWorkflowRuntimeService } from '@/lib/backend/services/opd-workflow-runtime-service';
import type { CommandContext } from '@/lib/backend/types';

function context(tenantId: string): CommandContext {
  return {
    actorId: 'billing-rp12',
    tenantId,
    roles: ['BILLING_CLERK'],
    permissions: [],
    clinicalPrivileges: [],
    correlationId: 'corr-rp12',
    requestId: 'req-rp12',
  };
}

function seedEncounter(
  tenantId: string,
  encounterId: string,
  options: { settled: boolean }
) {
  const patientId = `patient-${encounterId}`;
  const invoiceId = `invoice-${encounterId}`;
  const chargeId = `charge-${encounterId}`;
  const arId = `ar_patient_${invoiceId}`;

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'ENCOUNTER',
    encounterId,
    {
      encounterId,
      tenantId,
      patientId,
      encounterType: 'OPD',
      clinicalState: 'DISPOSITION',
      currentStage: 'BILLING_SETTLEMENT',
      operationalState: 'ACTIVE',
      status: 'ACTIVE',
      billingMutationSequence: 1,
      updatedAt: 1,
    }
  );

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'INVOICE',
    invoiceId,
    {
      id: invoiceId,
      tenantId,
      patientId,
      encounterId,
      billingPurpose: 'OPD_CONSULTATION',
      currency: 'PKR',
      totalPatientDue: 100,
      totalPaid: options.settled ? 100 : 90,
      balanceDue: options.settled ? 0 : 10,
      paymentStatus: options.settled ? 'paid' : 'partially_paid',
      items: [
        {
          id: chargeId,
          entitySource: 'consultation',
          code: 'OPD-CONS',
          description: 'OPD consultation',
          quantity: 1,
          unitPrice: 100,
          grossAmount: 100,
          discountAmount: 0,
          tax: 0,
          netAmount: 100,
          patientPortion: 100,
          insurancePortion: 0,
        },
      ],
    }
  );

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'ENCOUNTER_CHARGE',
    chargeId,
    {
      chargeId,
      tenantId,
      patientId,
      encounterId,
      invoiceId,
      status: 'BILLED',
      patientResponsibilityMinorUnits: 10_000,
    }
  );

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'JOURNAL_ENTRY',
    `journal-${encounterId}`,
    {
      journalId: `journal-${encounterId}`,
      tenantId,
      referenceDocumentId: invoiceId,
      currency: 'PKR',
      totalAmountMinorUnits: 10_000,
      status: 'POSTED',
      lines: [
        {
          glAccountId: '1110',
          debitMinorUnits: 10_000,
          creditMinorUnits: 0,
        },
        {
          glAccountId: '4000',
          debitMinorUnits: 0,
          creditMinorUnits: 10_000,
        },
      ],
    }
  );

  TransactionManager.seedEphemeralStateForTesting(
    tenantId,
    'AR_OPEN_ITEM',
    arId,
    {
      openItemId: arId,
      tenantId,
      invoiceId,
      debtorType: 'PATIENT',
      debtorId: patientId,
      patientId,
      encounterId,
      issueAt: 1,
      dueAt: 1,
      currency: 'PKR',
      originalMinorUnits: 10_000,
      allocatedMinorUnits: options.settled ? 10_000 : 9_000,
      writtenOffMinorUnits: 0,
      refundedMinorUnits: 0,
      outstandingMinorUnits: options.settled ? 0 : 1_000,
      status: options.settled ? 'SETTLED' : 'PARTIALLY_SETTLED',
      createdAt: new Date(1).toISOString(),
      updatedAt: new Date(1).toISOString(),
    }
  );

  return { patientId, invoiceId, chargeId, arId };
}

describe('OPD-RP12 executable final billing reconciliation', () => {
  beforeEach(() => {
    TransactionManager.resetEphemeralStateForTesting();
  });

  test('settled encounter reconciles immutably and unlocks billing-to-disposition edge', async () => {
    const tenantId = 'tenant-rp12-settled';
    const encounterId = 'enc-rp12-settled';
    seedEncounter(tenantId, encounterId, { settled: true });

    const result = await OpdBillingReconciliationDomainService.reconcile(
      context(tenantId),
      'cmd-rp12-reconcile',
      'idem-rp12-reconcile',
      { encounterId }
    );

    expect(result.success).toBe(true);
    expect((result.data as any)?.reconciliation?.status).toBe('CLEARED');
    const reconciliationId = String(result.entityId || '');
    expect(reconciliationId).toBe(`opd_billrec_${encounterId}`);

    const persisted =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'OPD_BILLING_RECONCILIATION',
        reconciliationId
      );
    expect(persisted?.status).toBe('CLEARED');
    expect(persisted?.totalOutstandingMinorUnits).toBe(0);
    expect((persisted?.journalIds as string[])?.length).toBe(1);

    const encounter = TransactionManager.getEphemeralStateForTesting(
      tenantId,
      'ENCOUNTER',
      encounterId
    );
    expect(encounter?.billingReconciliationId).toBe(reconciliationId);
    expect(encounter?.financialClearanceState).toBe('FINAL_BILLING_CLEARED');

    const advance =
      await OpdWorkflowRuntimeService.validateAuthoritativeEvidence({
        tenantId,
        encounterId,
        patientId: `patient-${encounterId}`,
        currentStage: 'BILLING_SETTLEMENT',
        targetStage: 'DISCHARGE_OR_REFERRAL',
        evidenceId: reconciliationId,
      });
    expect(advance.allowed).toBe(true);

    const duplicate = await OpdBillingReconciliationDomainService.reconcile(
      context(tenantId),
      'cmd-rp12-duplicate',
      'idem-rp12-duplicate',
      { encounterId }
    );
    expect(duplicate.success).toBe(false);
    expect(duplicate.error?.code).toBe('OPD_BILLING_ALREADY_RECONCILED');
  });

  test('open patient balance fails closed before reconciliation state is written', async () => {
    const tenantId = 'tenant-rp12-open';
    const encounterId = 'enc-rp12-open';
    seedEncounter(tenantId, encounterId, { settled: false });

    const result = await OpdBillingReconciliationDomainService.reconcile(
      context(tenantId),
      'cmd-rp12-open',
      'idem-rp12-open',
      { encounterId }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('OPD_OUTSTANDING_INVOICE');
    expect(
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'OPD_BILLING_RECONCILIATION',
        `opd_billrec_${encounterId}`
      )
    ).toBeNull();
  });

  test('billing-to-disposition evidence becomes stale after a later billing mutation', async () => {
    const tenantId = 'tenant-rp12-stale';
    const encounterId = 'enc-rp12-stale';
    seedEncounter(tenantId, encounterId, { settled: true });

    const result = await OpdBillingReconciliationDomainService.reconcile(
      context(tenantId),
      'cmd-rp12-stale-reconcile',
      'idem-rp12-stale-reconcile',
      { encounterId }
    );
    expect(result.success).toBe(true);
    const reconciliationId = String(result.entityId || '');

    const encounter =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'ENCOUNTER',
        encounterId
      ) || {};
    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'ENCOUNTER',
      encounterId,
      {
        ...encounter,
        billingMutationSequence:
          Number(encounter.billingMutationSequence || 0) + 1,
      }
    );

    const advance =
      await OpdWorkflowRuntimeService.validateAuthoritativeEvidence({
        tenantId,
        encounterId,
        patientId: `patient-${encounterId}`,
        currentStage: 'BILLING_SETTLEMENT',
        targetStage: 'DISCHARGE_OR_REFERRAL',
        evidenceId: reconciliationId,
      });

    expect(advance.allowed).toBe(false);
    expect(advance.code).toBe('OPD_BILLING_RECONCILIATION_STALE');
  });

  test('finalized diagnostic service reconciles both deferred billing and revenue-recognition journals', async () => {
    const tenantId = 'tenant-rp12-diagnostic';
    const encounterId = 'enc-rp12-diagnostic';
    const { patientId } = seedEncounter(tenantId, encounterId, {
      settled: true,
    });

    const invoiceId = `diag-invoice-${encounterId}`;
    const chargeId = `diag-charge-${encounterId}`;
    const arId = `ar_patient_${invoiceId}`;
    const orderId = `diag-order-${encounterId}`;
    const deferredJournalId = `diag-deferred-${encounterId}`;
    const recognitionJournalId = `diag-recognition-${encounterId}`;

    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'INVOICE',
      invoiceId,
      {
        id: invoiceId,
        tenantId,
        patientId,
        encounterId,
        billingPurpose: 'OPD_DIAGNOSTIC',
        sourceOrderId: orderId,
        currency: 'PKR',
        totalPatientDue: 50,
        totalPaid: 50,
        balanceDue: 0,
        paymentStatus: 'paid',
        items: [
          {
            id: chargeId,
            entitySource: 'lab',
            code: 'LAB-RP12',
            description: 'RP12 diagnostic',
            quantity: 1,
            unitPrice: 50,
            grossAmount: 50,
            discountAmount: 0,
            tax: 5,
            netAmount: 50,
            patientPortion: 50,
            insurancePortion: 0,
          },
        ],
      }
    );
    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'ENCOUNTER_CHARGE',
      chargeId,
      {
        chargeId,
        tenantId,
        patientId,
        encounterId,
        invoiceId,
        status: 'BILLED_DEFERRED',
        patientResponsibilityMinorUnits: 5_000,
      }
    );
    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'AR_OPEN_ITEM',
      arId,
      {
        openItemId: arId,
        tenantId,
        invoiceId,
        debtorType: 'PATIENT',
        debtorId: patientId,
        patientId,
        encounterId,
        issueAt: 1,
        dueAt: 1,
        currency: 'PKR',
        originalMinorUnits: 5_000,
        allocatedMinorUnits: 5_000,
        writtenOffMinorUnits: 0,
        refundedMinorUnits: 0,
        outstandingMinorUnits: 0,
        status: 'SETTLED',
        createdAt: new Date(1).toISOString(),
        updatedAt: new Date(1).toISOString(),
      }
    );
    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'DIAGNOSTIC_ORDER',
      orderId,
      {
        orderId,
        tenantId,
        patientId,
        encounterId,
        worklistStatus: 'FINALIZED',
        revenueRecognizedAt: 2,
        deferredRevenueJournalId: deferredJournalId,
        recognitionJournalId,
      }
    );
    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'JOURNAL_ENTRY',
      deferredJournalId,
      {
        journalId: deferredJournalId,
        tenantId,
        referenceDocumentId: invoiceId,
        currency: 'PKR',
        totalAmountMinorUnits: 5_000,
        status: 'POSTED',
        lines: [
          {
            glAccountId: '1110',
            debitMinorUnits: 5_000,
            creditMinorUnits: 0,
          },
          {
            glAccountId: '2050',
            debitMinorUnits: 0,
            creditMinorUnits: 4_500,
          },
          {
            glAccountId: '2040',
            debitMinorUnits: 0,
            creditMinorUnits: 500,
          },
        ],
      }
    );
    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'JOURNAL_ENTRY',
      recognitionJournalId,
      {
        journalId: recognitionJournalId,
        tenantId,
        referenceDocumentId: invoiceId,
        currency: 'PKR',
        totalAmountMinorUnits: 4_500,
        status: 'POSTED',
        lines: [
          {
            glAccountId: '2050',
            debitMinorUnits: 4_500,
            creditMinorUnits: 0,
          },
          {
            glAccountId: '4020',
            debitMinorUnits: 0,
            creditMinorUnits: 4_500,
          },
        ],
      }
    );

    const encounter =
      TransactionManager.getEphemeralStateForTesting(
        tenantId,
        'ENCOUNTER',
        encounterId
      ) || {};
    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'ENCOUNTER',
      encounterId,
      { ...encounter, billingMutationSequence: 2 }
    );

    const result = await OpdBillingReconciliationDomainService.reconcile(
      context(tenantId),
      'cmd-rp12-diagnostic',
      'idem-rp12-diagnostic',
      { encounterId }
    );

    expect(result.success).toBe(true);
    expect((result.data as any)?.reconciliation?.invoiceCount).toBe(2);
    expect((result.data as any)?.reconciliation?.journalIds).toContain(
      deferredJournalId
    );
    expect((result.data as any)?.reconciliation?.journalIds).toContain(
      recognitionJournalId
    );
  });

  test('pending Revenue Integrity candidate blocks final financial closure', async () => {
    const tenantId = 'tenant-rp12-ri-pending';
    const encounterId = 'enc-rp12-ri-pending';
    const { patientId } = seedEncounter(tenantId, encounterId, {
      settled: true,
    });

    TransactionManager.seedEphemeralStateForTesting(
      tenantId,
      'REVENUE_INTEGRITY_FINDING',
      'ri-rp12-pending',
      {
        id: 'ri-rp12-pending',
        tenantId,
        patientId,
        encounterId,
        sourceEvidenceId: 'ev-rp12',
        documentedItem: 'Potential missed procedure',
        category: 'Procedure',
        suggestedCode: 'PROC-RP12',
        estimatedRecoverableAmountMinorUnits: 2_500,
        currency: 'PKR',
        status: 'PENDING_REVIEW',
        evidenceSnippet: 'Signed evidence',
        createdAt: 1,
        createdBy: 'doctor-rp12',
      }
    );

    const result = await OpdBillingReconciliationDomainService.reconcile(
      context(tenantId),
      'cmd-rp12-ri-pending',
      'idem-rp12-ri-pending',
      { encounterId }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(
      'OPD_REVENUE_INTEGRITY_PENDING_REVIEW'
    );
  });

});
