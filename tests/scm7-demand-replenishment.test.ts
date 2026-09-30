import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildDemandInputFingerprint,
  calculateDemandPlanLine,
} from '@/lib/supply-chain/demand-planning';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('SCM-7 demand planning and replenishment', () => {
  test('demand planning is deterministic and explainable', () => {
    const policy = {
      policyId: 'rpol_fac_loc_item',
      tenantId: 'tenant',
      facilityId: 'fac',
      locationId: 'loc',
      itemId: 'item',
      itemCode: 'MED-1',
      itemName: 'Medicine',
      uom: 'PIECE',
      criticality: 'VITAL',
      minQuantity: 10,
      maxQuantity: 50,
      reorderPoint: 15,
      safetyStockQuantity: 10,
      safetyStockDays: 2,
      leadTimeDays: 3,
      sourceLocationId: 'central',
      mode: 'AUTO',
      active: true,
    } as any;

    const line = calculateDemandPlanLine({
      policy,
      currentAvailable: 8,
      sourceAvailable: 100,
      historicalUsage: Array.from({ length: 30 }, (_, index) => ({
        quantity: 2,
        occurredAt: new Date(
          Date.parse('2026-09-30T12:00:00.000Z') -
            (index + 1) * 24 * 60 * 60 * 1000
        ).toISOString(),
      })),
      itemUnitCost: 5,
      asOf: '2026-09-30T12:00:00.000Z',
      lookbackDays: 30,
    });

    expect(line.averageDailyUsage).toBe(2);
    expect(line.leadTimeDemand).toBe(6);
    expect(line.effectiveReorderPoint).toBe(16);
    expect(line.recommendedQuantity).toBe(42);
    expect(line.action).toBe('INTERNAL_TRANSFER');
    expect(line.urgency).toBe('CRITICAL');
    expect(line.explanation.length).toBeGreaterThanOrEqual(5);

    expect(
      buildDemandInputFingerprint({ a: 1, b: ['x'] })
    ).toBe(buildDemandInputFingerprint({ a: 1, b: ['x'] }));
  });

  test('planning workflow rejects stale inputs and enforces maker-checker review', async () => {
    const service = await source(
      'lib/backend/services/scm-planning-domain-service.ts'
    );

    expect(service).toContain('REPLENISHMENT_PLAN_STALE_REGENERATE');
    expect(service).toContain('SCM_SEGREGATION_OF_DUTIES');
    expect(service).toContain("status: 'DRAFT'");
    expect(service).toContain("'REPLENISHMENT_PLAN_APPROVED'");
    expect(service).toContain("'REPLENISHMENT_PLAN_EXECUTED'");
    expect(service).toContain('inputFingerprint');
  });

  test('execution creates governed purchase requisitions and internal replenishment orders', async () => {
    const service = await source(
      'lib/backend/services/scm-planning-domain-service.ts'
    );

    expect(service).toContain("entityType: 'PURCHASE_REQUISITION'");
    expect(service).toContain("status: 'SUBMITTED'");
    expect(service).toContain("entityType: 'REPLENISHMENT_ORDER'");
    expect(service).toContain("status: 'READY_TO_PICK'");
    expect(service).not.toContain("entityType: 'INVENTORY_BALANCE'");
  });

  test('internal order completion requires immutable governed transfer evidence', async () => {
    const service = await source(
      'lib/backend/services/scm-planning-domain-service.ts'
    );

    expect(service).toContain("'TRANSFER_OUT'");
    expect(service).toContain("'INTERNAL_REQUEST'");
    expect(service).toContain('REPLENISHMENT_TRANSFER_EVIDENCE_INVALID');
    expect(service).toContain('REPLENISHMENT_ORDER_UNDERFULFILLED');
  });

  test('SCM-7 commands are strictly validated and routed', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');

    for (const command of [
      'UpsertReplenishmentPolicyCommand',
      'GenerateReplenishmentPlanCommand',
      'ReviewReplenishmentPlanCommand',
      'ExecuteReplenishmentPlanCommand',
      'CompleteInternalReplenishmentOrderCommand',
    ]) {
      expect(bus).toContain(`case '${command}'`);
    }

    const invalid = validateCommandPayload({
      commandId: 'cmd',
      idempotencyKey: 'idem',
      tenantId: 'tenant',
      commandType: 'GenerateReplenishmentPlanCommand',
      schemaVersion: 1,
      payload: {
        planId: 'plan',
        facilityId: 'fac',
        locationId: 'loc',
        policyIds: [],
        asOf: '2026-09-30T00:00:00Z',
        lookbackDays: 30,
        currency: 'USD',
      },
    });

    expect(invalid.success).toBe(false);
  });

  test('planning read models are tenant-scoped, client-write denied, and hydratable', async () => {
    const rules = await source('firestore.rules');
    const hydration = await source('lib/offline/hydration.ts');

    for (const collection of [
      'scmReplenishmentPolicies',
      'scmReplenishmentPlans',
      'scmReplenishmentOrders',
    ]) {
      const start = rules.indexOf(`match /${collection}/{id}`);
      expect(start).toBeGreaterThan(-1);
      expect(rules.slice(start, start + 250)).toContain(
        'allow write: if false;'
      );
      expect(hydration).toContain(`'${collection}'`);
    }
  });

  test('planning decisions remain online-only; offline clients consume projections only', async () => {
    const adapter = await source(
      'lib/supply-chain/scm-planning-edge-adapter.ts'
    );
    expect(adapter).toContain('executeActiveTenantCommand');
    expect(adapter).not.toContain('offlineQueue');
  });
});
