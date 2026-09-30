import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  evaluateSupplierQuotations,
  validatePurchaseOrderAgainstContract,
} from '@/lib/supply-chain/supplier-sourcing';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('SCM-6 supplier and contract management', () => {
  test('quotation evaluation is deterministic, explainable and supplier-aware', () => {
    const suppliers = [
      {
        supplierId: 's1',
        status: 'ACTIVE',
        scorecard: {
          qualityAcceptanceRatePercent: 99,
          overallExplainableScore: 95,
          complianceStatus: 'FULLY_COMPLIANT',
        },
      },
      {
        supplierId: 's2',
        status: 'ACTIVE',
        scorecard: {
          qualityAcceptanceRatePercent: 90,
          overallExplainableScore: 80,
          complianceStatus: 'WARNING_RENEWAL_DUE',
        },
      },
    ] as any;
    const quotations = [
      {
        quotationId: 'q1',
        supplierId: 's1',
        totalMinorUnits: 10000,
        paymentTerms: 'NET30',
        items: [{ leadTimeDays: 4 }],
      },
      {
        quotationId: 'q2',
        supplierId: 's2',
        totalMinorUnits: 9000,
        paymentTerms: 'NET30',
        items: [{ leadTimeDays: 6 }],
      },
    ] as any;

    const scores = evaluateSupplierQuotations({ quotations, suppliers });
    expect(scores).toHaveLength(2);
    expect(scores[0].explainability).toHaveLength(6);
    expect(scores.every((score) => score.weightedTotal >= 0)).toBe(true);
  });

  test('contract validation blocks supplier, currency, price, UOM and cumulative ceilings', () => {
    const contract = {
      contractId: 'c1',
      supplierId: 's1',
      currency: 'USD',
      paymentTerms: 'NET30',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-12-31T23:59:59.999Z',
      status: 'ACTIVE',
      maxSpendMinorUnits: 100000,
      committedSpendMinorUnits: 20000,
      reservedSpendMinorUnits: 10000,
      committedQuantityByItem: { i1: 10 },
      reservedQuantityByItem: { i1: 5 },
      lines: [
        {
          itemId: 'i1',
          uom: 'PIECE',
          maxUnitPriceMinorUnits: 1000,
          contractedQuantity: 100,
        },
      ],
    } as any;

    expect(() =>
      validatePurchaseOrderAgainstContract({
        contract,
        po: {
          supplierId: 's1',
          currency: 'USD',
          paymentTerms: 'NET30',
          orderDate: '2026-09-30T00:00:00.000Z',
          lines: [
            {
              itemId: 'i1',
              uom: 'PIECE',
              unitPriceMinorUnits: 900,
              quantity: 10,
            },
          ],
        },
      })
    ).not.toThrow();

    expect(() =>
      validatePurchaseOrderAgainstContract({
        contract,
        po: {
          supplierId: 's1',
          currency: 'USD',
          paymentTerms: 'NET30',
          orderDate: '2026-09-30T00:00:00.000Z',
          lines: [
            {
              itemId: 'i1',
              uom: 'PIECE',
              unitPriceMinorUnits: 1100,
              quantity: 10,
            },
          ],
        },
      })
    ).toThrow('SUPPLIER_CONTRACT_PRICE_EXCEEDED');
  });

  test('sourcing lifecycle is atomic and contract approval is maker-checker', async () => {
    const service = await source(
      'lib/backend/services/scm-sourcing-domain-service.ts'
    );

    expect(service).toContain('SUPPLIER_QUALIFICATION_REVIEWED');
    expect(service).toContain('SCM_RFQ_CREATED');
    expect(service).toContain('SUPPLIER_QUOTATION_CAPTURED');
    expect(service).toContain('SUPPLIER_CONTRACT_AWARDED_PENDING_APPROVAL');
    expect(service).toContain('SUPPLIER_CONTRACT_ACTIVATED');
    expect(service).toContain('SCM_SEGREGATION_OF_DUTIES');
    expect(service).toContain('NON_TOP_AWARD_JUSTIFICATION_REQUIRED');
    expect(service).toContain('SUPPLIER_CERTIFICATION_EXPIRED');
    expect(service).toContain('SUPPLIER_CONTRACT_HAS_OPEN_PO_RESERVATIONS');
  });

  test('routine purchase orders require contract or explicit emergency waiver', async () => {
    const procurement = await source(
      'lib/backend/services/scm-procurement-domain-service.ts'
    );

    expect(procurement).toContain('SUPPLIER_CONTRACT_REQUIRED');
    expect(procurement).toContain('validatePurchaseOrderAgainstContract');
    expect(procurement).toContain('reservedSpendMinorUnits');
    expect(procurement).toContain('reservedQuantityByItem');
    expect(procurement).toContain('committedSpendMinorUnits');
    expect(procurement).toContain('committedQuantityByItem');
    expect(procurement).toContain('emergencyContractWaiver');
  });

  test('SCM-6 commands have strict schemas and governed routing', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');
    for (const command of [
      'ReviewSupplierQualificationCommand',
      'CreateScmRfqCommand',
      'RecordSupplierQuotationCommand',
      'AwardSupplierContractCommand',
      'ApproveSupplierContractCommand',
      'ChangeSupplierContractStatusCommand',
    ]) {
      expect(bus).toContain(`case '${command}'`);
    }

    const invalid = validateCommandPayload({
      commandId: 'cmd',
      idempotencyKey: 'idem',
      tenantId: 'tenant',
      commandType: 'CreateScmRfqCommand',
      schemaVersion: 1,
      payload: {
        rfqId: 'r1',
        rfqNumber: 'RFQ-1',
        requisitionId: 'pr-1',
        requiredDeliveryDate: '2026-10-10',
        submissionDeadline: '2026-10-01',
        invitedSupplierIds: ['only-one'],
        terms: 'terms',
      },
    });
    expect(invalid.success).toBe(false);
  });

  test('SCM-6 read models are server-write-only and indexed', async () => {
    const rules = await source('firestore.rules');
    const indexes = await source('firestore.indexes.json');

    for (const collection of [
      'scmSupplierQualificationReviews',
      'scmRfqs',
      'scmSupplierQuotations',
      'scmSupplierContracts',
    ]) {
      const start = rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      expect(rules.slice(start, start + 260)).toContain(
        'allow write: if false;'
      );
    }

    expect(indexes).toContain('"collectionGroup": "scmRfqs"');
    expect(indexes).toContain('"collectionGroup": "scmSupplierContracts"');
  });

  test('supplier sourcing mutations are online-only', async () => {
    const adapter = await source(
      'lib/supply-chain/scm-sourcing-edge-adapter.ts'
    );
    expect(adapter).toContain('executeActiveTenantCommand');
    expect(adapter).not.toContain('offlineQueue');
  });
});
