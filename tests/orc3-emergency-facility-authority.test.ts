import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';
const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

const command = (facilityId: unknown) => ({
  commandId: 'cmd-er-facility',
  idempotencyKey: 'idem-er-facility',
  tenantId: 'tenant-a',
  commandType: 'CreateEncounterCommand',
  schemaVersion: 1,
  payload: { patientId: 'patient-a', encounterType: 'EMERGENCY', facilityId, chiefComplaint: 'Emergency triage', departmentId: 'emergency' },
});

describe('ORC-3 emergency facility authority', () => {
  test('rejects malformed facility ID in the command schema', () => {
    expect(validateCommandPayload(command('')).success).toBe(false);
    expect(validateCommandPayload(command('facility-a')).success).toBe(true);
  });
  test('encounter service enforces actor facility scope server-side', async () => {
    const service = await source('lib/backend/services/encounter-domain-service.ts');
    expect(service).toContain('EMERGENCY_FACILITY_SCOPE_REQUIRED');
    expect(service).toContain('authorizedFacilities.includes(emergencyFacilityId)');
    expect(service).toContain('facilityId: emergencyFacilityId || undefined');
    expect(service).toContain("['DOCTOR', 'CONSULTANT'].includes");
    expect(service).toContain("assignedProviderId:");
  });
  test('ER intake supplies only selected authenticated actor facility', async () => {
    const ui = await source('components/emergency/governed-emergency-console.tsx');
    expect(ui).toContain('authorizedFacilityIds = auth.user?.facilityIds || []');
    expect(ui).toContain('facilityId: emergencyFacilityId');
    expect(ui).toContain('Select authorized facility');
    expect(ui).toContain('authorizedFacilityIds.includes(selectedFacilityId)');
    expect(ui).toContain('authorizedFacilityIds.includes(emergencyFacilityId)');
    expect(ui).toContain('!patientsById[patientId]');
    expect(ui).toContain("authorizedFacilityIds.includes(selectedEncounter.facilityId || '')");
  });
});
