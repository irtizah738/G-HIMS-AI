import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { z } from 'zod/v3';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';
import { validateHospital0Evidence } from '@/lib/qualification/hospital0-evidence';
import { ClinicalNoteParsedOutputSchema } from '@/schemas/clinical-billing';

const qualificationContext = {
  qualificationRunId: 'h0-run-20261007',
  gitCommitSha: '0123456789abcdef0123456789abcdef01234567',
};

describe('Patched Zod with preserved v3 clinical parsing contracts', () => {
  test('the installed runtime is patched and compatibility APIs are available', () => {
    const version = JSON.parse(readFileSync('node_modules/zod/package.json', 'utf8')).version;
    expect(version).toBe('4.6.6');
    expect(z.object({ recorded: z.string().min(1) }).safeParse({ recorded: 'yes' }).success).toBe(true);
  });

  test('source-limited clinical lists remain typed and bounded', () => {
    const valid = {
      chiefComplaint: 'Shortness of breath',
      diagnoses: ['Suspected respiratory infection'],
      medicationsPrescribed: [],
      recommendedProcedures: [],
      billingCodes: [],
      summary: 'Clinician review required',
    };
    const parsed = ClinicalNoteParsedOutputSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.followUpDays).toBe(7);
    expect(ClinicalNoteParsedOutputSchema.safeParse({
      ...valid,
      diagnoses: Array.from({ length: 1001 }, () => 'Unverified finding'),
    }).success).toBe(false);
    expect(ClinicalNoteParsedOutputSchema.safeParse({
      ...valid,
      medicationsPrescribed: [{ name: 'Drug', dosage: 1, frequency: 'daily', route: 'oral' }],
    }).success).toBe(false);
  });

  test('command schemas continue to fail closed on unapproved payload fields', () => {
    const command = {
      commandId: 'zod-upgrade-command-1',
      idempotencyKey: 'zod-upgrade-idempotency-1',
      tenantId: 'hospital-test',
      commandType: 'ReconcileOpdBillingCommand',
      schemaVersion: 1,
      payload: { encounterId: 'encounter-1' },
    } as Parameters<typeof validateCommandPayload>[0];
    expect(validateCommandPayload(command).success).toBe(true);
    expect(validateCommandPayload({ ...command, payload: { encounterId: 'encounter-1', settlementOverride: true } }).success).toBe(false);
  });

  test('Hospital-0 evidence still rejects stale SHA and oversized role arrays', () => {
    const base = {
      schemaVersion: 1,
      qualificationRunId: qualificationContext.qualificationRunId,
      gitCommitSha: qualificationContext.gitCommitSha,
      deploymentId: 'staging-h0-test',
      firebaseProjectId: 'ghims-test',
      deploymentUrl: 'https://example.test',
      runtime: 'STAGING',
      success: true,
      recordedAt: '2026-10-31T00:00:00.000Z',
      mainSha: qualificationContext.gitCommitSha,
      dedicatedProject: true,
    };
    expect(validateHospital0Evidence('staging-deployment-evidence.json', base, qualificationContext)).toEqual([]);
    expect(validateHospital0Evidence('staging-deployment-evidence.json',
      { ...base, mainSha: 'f'.repeat(40) }, qualificationContext).length).toBeGreaterThan(0);
    const rolesBase = {
      ...base,
      tenantId: 'hospital-test',
      syntheticOnly: true,
      canonicalMembershipsProvisioned: true,
      roles: Array.from({ length: 101 }, () => 'synthetic-reviewer'),
    };
    expect(validateHospital0Evidence('hospital0-identity-provisioning.json', rolesBase, qualificationContext).length).toBeGreaterThan(0);
  });
});
