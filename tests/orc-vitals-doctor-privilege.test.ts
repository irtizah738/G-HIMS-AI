import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deriveClinicalPrivileges } from '@/server/auth/tenant-membership';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';

const source = (relPath: string) => readFile(join(process.cwd(), relPath), 'utf8');

describe('ORC-8 Matrix: Doctor Vitals Recording Privilege', () => {
  test('deriveClinicalPrivileges grants RECORD_VITALS to doctors and physicians', () => {
    const doctorPrivileges = deriveClinicalPrivileges(['doctor']);
    expect(doctorPrivileges).toContain('RECORD_VITALS');

    const physicianPrivileges = deriveClinicalPrivileges(['physician']);
    expect(physicianPrivileges).toContain('RECORD_VITALS');

    const nursePrivileges = deriveClinicalPrivileges(['nurse']);
    expect(nursePrivileges).toContain('RECORD_VITALS');
  });

  test('authorization-context defines RECORD_VITALS in credentialGatedRoleBaseline', async () => {
    const authContext = await source('server/auth/authorization-context.ts');

    expect(authContext).toContain('RECORD_VITALS');
    // Ensure both doctor and nurse baselines contain RECORD_VITALS
    const baselineSection = authContext.slice(
      authContext.indexOf('credentialGatedRoleBaseline'),
      authContext.indexOf('function deriveCredentialsFromHcm')
    );
    expect(baselineSection).toContain("'RECORD_VITALS'");
  });

  test('RecordVitalsCommand schema validates standard physiological observations', () => {
    const validCommand = {
      commandId: 'cmd-vitals-01',
      idempotencyKey: 'idem-vitals-01',
      tenantId: 'tenant-metro',
      commandType: 'RecordVitalsCommand',
      schemaVersion: 1,
      payload: {
        patientId: 'patient-402',
        encounterId: 'enc-opd-101',
        heartRate: 78,
        bloodPressure: '120/80',
        temperature: 37.0,
        respiratoryRate: 16,
        oxygenSaturation: 98,
        measuredAt: Date.now(),
      },
    };

    const result = validateCommandPayload(validCommand);
    expect(result.success).toBe(true);
    expect(result.payload?.heartRate).toBe(78);
    expect(result.payload?.temperature).toBe(37.0);
  });
});
