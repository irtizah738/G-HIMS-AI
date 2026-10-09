import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';
const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

function vitals(override: Record<string, unknown> = {}) {
  return {
    commandId:'orc4-vitals', idempotencyKey:['orc4','synthetic','fixture'].join('-'),
    tenantId:'tenant-a', commandType:'RecordVitalsCommand', schemaVersion:1,
    payload:{
      patientId:'patient-a', encounterId:'encounter-a', heartRate:88,
      bloodPressure:'122/78', temperature:37, respiratoryRate:16,
      oxygenSaturation:98, ...override,
    },
  };
}
describe('ORC-4 vitals/NEWS2 input authority', () => {
  test('server enforces HR, temperature and NEWS2 enumerations', () => {
    expect(validateCommandPayload(vitals()).success).toBe(true);
    expect(validateCommandPayload(vitals({heartRate:275})).success).toBe(false);
    expect(validateCommandPayload(vitals({temperature:26})).success).toBe(false);
    expect(validateCommandPayload(vitals({spO2Scale:3})).success).toBe(false);
    expect(validateCommandPayload(vitals({spO2Scale:2, onSupplementalOxygen:false, consciousness:'Alert'})).success).toBe(true);
  });
  test('MPI form sends explicit NEWS2 evidence and labels omissions incomplete', async () => {
    const mpi = await source('components/views/patient-mpi-view.tsx');
    const service = await source('lib/backend/services/clinical-documentation-domain-service.ts');
    expect(mpi).toContain("newHeartRate > 250");
    expect(mpi).toContain("newTemp < 30");
    expect(mpi).toContain('spO2Scale: news2Scale');
    expect(mpi).toContain('onSupplementalOxygen:');
    expect(mpi).toContain('consciousness: news2Consciousness');
    expect(mpi).toContain('NEWS2 is INCOMPLETE_INPUT');
    expect(service).toContain("news2Status: news2 ? 'VERIFIED' : 'INCOMPLETE_INPUT'");
    expect(service).toContain("eventType: 'VITALS_RECORDED'");
    expect(service).toContain("entityType: 'CLINICAL_OBSERVATION'");
  });
});
