import { describe, expect, test } from 'bun:test';
import {
  parseOrcRepairOptions,
  findEncounterFacilityRepairCandidates,
  findDoctorPrivilegeRepairCandidates,
  findBillingStageAdvanceCandidates,
  buildOrcRepairPlan,
} from '../scripts/ops/orc7-data-repair';

describe('ORC-7: Compensating Data Repair Suite', () => {
  describe('Options & Environment Validation', () => {
    test('strictly rejects production runtime mode', () => {
      expect(() =>
        parseOrcRepairOptions([], {
          GHIMS_RUNTIME_MODE: 'PRODUCTION',
          GHIMS_ORC_REPAIR_TENANT_ID: 'tenant-metro',
        })
      ).toThrow('ORC_REPAIR_STAGING_ONLY');
    });

    test('strictly rejects missing tenant identifier', () => {
      expect(() =>
        parseOrcRepairOptions([], {
          GHIMS_RUNTIME_MODE: 'STAGING',
        })
      ).toThrow('ORC_REPAIR_EXPLICIT_TENANT_REQUIRED');
    });

    test('defaults to safe dry-run mode when no flags are supplied', () => {
      const opts = parseOrcRepairOptions([], {
        GHIMS_RUNTIME_MODE: 'STAGING',
        GHIMS_ORC_REPAIR_TENANT_ID: 'tenant-metro',
      });
      expect(opts.isDryRun).toBe(true);
      expect(opts.tenantId).toBe('tenant-metro');
      expect(opts.defaultFacilityId).toBe('facility-primary');
    });

    test('rejects live execution when approve actor UID is omitted', () => {
      expect(() =>
        parseOrcRepairOptions(['--execute'], {
          GHIMS_RUNTIME_MODE: 'STAGING',
          GHIMS_ORC_REPAIR_TENANT_ID: 'tenant-metro',
        })
      ).toThrow('ORC_REPAIR_APPROVE_ACTOR_REQUIRED');
    });

    test('successfully parses live options with explicit approver and default facility', () => {
      const opts = parseOrcRepairOptions(
        ['--execute', '--approve-actor=user-admin-42', '--default-facility=facility-trauma-1'],
        {
          GHIMS_RUNTIME_MODE: 'STAGING',
          GHIMS_ORC_REPAIR_TENANT_ID: 'tenant-metro',
        }
      );
      expect(opts.isDryRun).toBe(false);
      expect(opts.approveActorId).toBe('user-admin-42');
      expect(opts.defaultFacilityId).toBe('facility-trauma-1');
    });
  });

  describe('Target 1: Encounter Facility Scope Repair', () => {
    test('identifies encounters missing facilityId and plans compensating backfill', () => {
      const encounters = [
        { documentId: 'enc-1', encounterId: 'enc-1', encounterType: 'EMERGENCY', facilityId: '' },
        { documentId: 'enc-2', encounterId: 'enc-2', encounterType: 'OPD' }, // missing key
        { documentId: 'enc-3', encounterId: 'enc-3', encounterType: 'OPD', facilityId: 'facility-existing' },
      ];

      const candidates = findEncounterFacilityRepairCandidates(encounters, 'facility-metro-main');
      expect(candidates).toHaveLength(2);
      expect(candidates[0].encounterId).toBe('enc-1');
      expect(candidates[0].targetFacilityId).toBe('facility-metro-main');
      expect(candidates[1].encounterId).toBe('enc-2');
      expect(candidates[1].targetFacilityId).toBe('facility-metro-main');
    });
  });

  describe('Target 2: Doctor Membership Privilege Re-derivation', () => {
    test('identifies doctors missing RECORD_VITALS and plans privilege addition', () => {
      const users = [
        {
          documentId: 'user-doc-1',
          userId: 'user-doc-1',
          roles: ['doctor'],
          clinicalPrivileges: ['ORDER_MEDICATIONS', 'SIGN_CLINICAL_NOTES'],
        },
        {
          documentId: 'user-doc-2',
          userId: 'user-doc-2',
          roles: ['physician'],
          clinicalPrivileges: ['RECORD_VITALS', 'ORDER_MEDICATIONS'],
        },
        {
          documentId: 'user-clerk',
          userId: 'user-clerk',
          roles: ['receptionist'],
          clinicalPrivileges: [],
        },
      ];

      const candidates = findDoctorPrivilegeRepairCandidates(users);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].userId).toBe('user-doc-1');
      expect(candidates[0].missingPrivilege).toBe('RECORD_VITALS');
      expect(candidates[0].repairedPrivileges).toContain('RECORD_VITALS');
      expect(candidates[0].repairedPrivileges).toContain('ORDER_MEDICATIONS');
    });
  });

  describe('Target 3: Settled OPD Encounter Stage Advance', () => {
    test('identifies consultation-cleared encounters with zero open AR items', () => {
      const encounters = [
        {
          documentId: 'enc-settled-1',
          encounterId: 'enc-settled-1',
          encounterType: 'OPD',
          currentStage: 'CONSULTATION_COMPLETED',
          financialClearanceState: 'CONSULTATION_CLEARED',
        },
        {
          documentId: 'enc-settled-2',
          encounterId: 'enc-settled-2',
          encounterType: 'OPD',
          currentStage: 'CONSULTATION_COMPLETED',
          financialClearanceState: 'CONSULTATION_CLEARED',
        },
        {
          documentId: 'enc-unsettled',
          encounterId: 'enc-unsettled',
          encounterType: 'OPD',
          currentStage: 'CONSULTATION_COMPLETED',
          financialClearanceState: 'CONSULTATION_PAYMENT_PENDING',
        },
        {
          documentId: 'enc-already-advanced',
          encounterId: 'enc-already-advanced',
          encounterType: 'OPD',
          currentStage: 'BILLING_SETTLEMENT',
          financialClearanceState: 'CONSULTATION_CLEARED',
        },
      ];

      const arOpenItems = [
        // enc-settled-2 has an open unpaid AR item:
        {
          documentId: 'ar-1',
          encounterId: 'enc-settled-2',
          balanceDue: 2500,
          status: 'OPEN',
        },
        // enc-settled-1 has a cleared item (balance 0):
        {
          documentId: 'ar-2',
          encounterId: 'enc-settled-1',
          balanceDue: 0,
          status: 'CLEARED',
        },
      ];

      const candidates = findBillingStageAdvanceCandidates(encounters, arOpenItems);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].encounterId).toBe('enc-settled-1');
      expect(candidates[0].currentStage).toBe('CONSULTATION_COMPLETED');
      expect(candidates[0].targetStage).toBe('BILLING_SETTLEMENT');
    });
  });

  describe('Integrated Repair Plan Assembly', () => {
    test('builds comprehensive repair plan without mutating state', () => {
      const plan = buildOrcRepairPlan(
        [{ documentId: 'enc-1', encounterType: 'EMERGENCY' }],
        [{ documentId: 'user-doc-1', roles: ['doctor'], clinicalPrivileges: [] }],
        [],
        'facility-trauma-center'
      );

      expect(plan.facilityRepairs).toHaveLength(1);
      expect(plan.facilityRepairs[0].targetFacilityId).toBe('facility-trauma-center');
      expect(plan.privilegeRepairs).toHaveLength(1);
      expect(plan.billingStageRepairs).toHaveLength(0);
    });
  });
});
