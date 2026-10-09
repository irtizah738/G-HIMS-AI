import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mockRetirementNonOpdPointerBlockers } from '@/lib/backend/services/mock-patient-pointer-inspection';
import type { PatientMPI } from '@/types/mpi';

const inspect = (state: Record<string, unknown>) =>
  mockRetirementNonOpdPointerBlockers(state as unknown as PatientMPI);

describe('mock MPI retirement read-only reconciliation', () => {
  test('absence of non-OPD pointers does not fabricate a clinical blocker', () => {
    expect(inspect({
      activeCareContexts: {
        activeOpdEncounterIds: ['opd-synthetic'],
        activeTelehealthEncounterIds: [],
      },
    })).toEqual([]);
    expect(inspect({})).toEqual([]);
  });

  test('each actual non-OPD pointer is named for the operator', () => {
    expect(inspect({
      activeBedId: 'bed-1',
      activeCareContexts: {
        activeIpdEncounterId: 'ipd-1',
        activeEmergencyEncounterId: 'er-1',
        activeTelehealthEncounterIds: ['tel-1'],
      },
    })).toEqual([
      'activeBedId',
      'activeCareContexts.activeIpdEncounterId',
      'activeCareContexts.activeEmergencyEncounterId',
      'activeCareContexts.activeTelehealthEncounterIds',
    ]);
  });

  test('malformed pointer types fail closed; strings are never mistaken for an empty array', () => {
    expect(inspect({
      activeCareContexts: { activeTelehealthEncounterIds: '[]' },
    })).toContain('activeCareContexts.activeTelehealthEncounterIds (malformed)');
    expect(inspect({
      activeCareContexts: 'corrupt',
    })).toContain('activeCareContexts (malformed)');
  });

  test('retirement service rechecks authoritative pointers at commit', async () => {
    const service = await readFile(join(
      process.cwd(),
      'lib/backend/services/confirmed-mock-patient-retirement-domain-service.ts'
    ), 'utf8');
    expect(service).toContain('mockRetirementNonOpdPointerBlockers(patient)');
    expect(service).toContain('mockRetirementNonOpdPointerBlockers(latest)');
    expect(service).toContain('MOCK_CLEANUP_NON_OPD_ACTIVE_CARE');
    expect(service).toContain('MOCK_CLEANUP_FINANCIAL_RECONCILIATION_REQUIRED');
    expect(service).toContain("['TEST', 'DEMO'].includes(mode)");
  });

  test('inspection script is read-only and limited to exact non-production test identities', async () => {
    const file = await readFile(
      join(process.cwd(), 'scripts/ops/inspect-mock-retirement.ts'), 'utf8'
    );
    expect(file).toContain('GHIMS_MOCK_INSPECTION_CONFIRM_PROJECT');
    expect(file).toContain('GHIMS_FIREBASE_PROJECT_ID_PRODUCTION');
    expect(file).toContain('GHIMS_MOCK_INSPECTION_TENANT_ID');
    expect(file).toContain('GHIMS_MOCK_INSPECTION_MRN');
    expect(file).toContain('PER_COLLECTION_LIMIT = 26');
    expect(file).toContain('query(');
    expect(file).toContain('mockRetirementNonOpdPointerBlockers');
    expect(file).toContain('No patient identity or care lifecycle is modified.');
    expect(file).not.toMatch(/\.set\(|\.update\(|\.delete\(|\.create\(|\.add\(|runTransaction\(/);
  });
});
