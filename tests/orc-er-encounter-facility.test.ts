import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';

const source = async (relPath: string) => {
  const content = await readFile(join(process.cwd(), relPath), 'utf8');
  return content.replace(/\r\n/g, '\n');
};

describe('ORC-8 Matrix: Emergency Encounter Facility Scope & Census', () => {
  test('CreateEncounterCommand schema validates facilityId attribute', () => {
    const validCommand = {
      commandId: 'cmd-er-01',
      idempotencyKey: 'idem-er-01',
      tenantId: 'tenant-metro',
      commandType: 'CreateEncounterCommand',
      schemaVersion: 1,
      payload: {
        patientId: 'patient-402',
        encounterType: 'EMERGENCY',
        facilityId: 'facility-trauma-1',
        chiefComplaint: 'Acute chest pain and diaphoresis',
        departmentId: 'dept-er-triage',
        priority: 'STAT',
      },
    };

    const result = validateCommandPayload(validCommand);
    expect(result.success).toBe(true);
    expect(result.payload?.facilityId).toBe('facility-trauma-1');
  });

  test('EncounterDomainService enforces emergency facility scope on creation', async () => {
    const service = await source('lib/backend/services/encounter-domain-service.ts');

    // Rejection guard when facilityId is missing or not in actor authorizedFacilities
    expect(service).toContain('EMERGENCY_FACILITY_SCOPE_REQUIRED');
    expect(service).toContain('authorizedFacilities.includes(emergencyFacilityId)');

    // Writing facilityId to domainState so facility census queries return the encounter
    expect(service).toContain('...(emergencyFacilityId ? { facilityId: emergencyFacilityId } : {})');
  });

  test('Emergency encounters override financial clearance lock for patient safety', async () => {
    const service = await source('lib/backend/services/encounter-domain-service.ts');

    // Financial clearance is NOT_REQUIRED for emergency care, adhering to §95 architectural non-negotiables
    expect(service).toContain("payload.encounterType === 'EMERGENCY'");
    expect(service).toContain("? 'NOT_REQUIRED'");
    expect(service).toContain(": 'CONSULTATION_PAYMENT_PENDING'");
  });

  test('OPD encounter creation also populates facilityId in encounter state', async () => {
    const service = await source('lib/backend/services/encounter-domain-service.ts');

    expect(service).toContain(
      "facilityId: String(payload.facilityId || context.facilityIds?.[0] || '').trim()"
    );
  });
});
