import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_DATA_RETENTION_POLICY,
  validateDataRetentionPolicy,
} from '@/lib/governance/data-retention-policy';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('Wave 5 enterprise hardening', () => {
  test('retention policy preserves authoritative clinical/financial/audit evidence', () => {
    expect(validateDataRetentionPolicy(DEFAULT_DATA_RETENTION_POLICY)).toEqual([]);

    const byClass = new Map(
      DEFAULT_DATA_RETENTION_POLICY.map((rule) => [
        rule.retentionClass,
        rule,
      ])
    );

    for (const name of [
      'CLINICAL_AUTHORITY',
      'FINANCIAL_AUTHORITY',
      'SECURITY_AUDIT',
    ] as const) {
      const rule = byClass.get(name);
      expect(rule?.authoritative).toBe(true);
      expect(rule?.immutable).toBe(true);
      expect(rule?.applicationDeletionAllowed).toBe(false);
    }

    expect(byClass.get('DISPOSABLE_PROJECTION')?.operationalRebuildAllowed).toBe(true);
    expect(byClass.get('OPERATIONAL_TELEMETRY')?.containsPhi).toBe(false);
    expect(byClass.get('INTEGRATION_RAW')?.retainByDefault).toBe(false);
    expect(byClass.get('INTEGRATION_RAW')?.defaultRetentionDays).toBe(0);
  });

  test('Wave 5 evidence manifest refuses to equate repository state with production qualification', async () => {
    const manifest = await source('scripts/ops/wave5-evidence-manifest.ts');

    for (const evidence of [
      'wave5-staging-smoke.json',
      'wave5-p7-hospital-day.json',
      'wave5-cross-domain-rehearsal.json',
      'wave5-authenticated-load.json',
      'wave5-backup-restore.json',
      'wave5-projection-failure-injection.json',
      'wave5-projection-rebuild.json',
      'wave5-rollback-rehearsal.json',
      'wave5-independent-pentest.json',
      'wave5-operational-check.json',
      'wave5-alert-routing.json',
      'wave5-retention-governance.json',
    ]) {
      expect(manifest).toContain(evidence);
    }

    expect(manifest).toContain('productionQualified: false');
    expect(manifest).toContain('GHIMS_WAVE5_REQUIRE_COMPLETE');
    expect(manifest).toContain('Missing evidence must not be replaced');
  });

  test('observability remains PHI-sanitized and external alert routing is an evidence gate', async () => {
    const [telemetry, observability, manifest] = await Promise.all([
      source('lib/observability/server-telemetry.ts'),
      source('docs/operations/OBSERVABILITY.md'),
      source('scripts/ops/wave5-evidence-manifest.ts'),
    ]);

    expect(telemetry).toContain('SENSITIVE_KEY');
    for (const key of [
      'patient',
      'mrn',
      'email',
      'phone',
      'token',
      'authorization',
      'secret',
      'payload',
      'raw',
    ]) {
      expect(telemetry).toContain(key);
    }
    expect(observability).toContain('does not claim that an external dashboard');
    expect(manifest).toContain('wave5-alert-routing.json');
  });

  test('backup/restore and recovery remain isolated, explicit and measurable', async () => {
    const [workflow, dr] = await Promise.all([
      source('.github/workflows/drp-recovery-drill.yml'),
      source('docs/operations/DISASTER_RECOVERY.md'),
    ]);

    expect(workflow).toContain('RECOVERY_DRILL');
    expect(workflow).toContain('recovery_project_id');
    expect(workflow).toContain('GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD');
    expect(workflow).toContain('projection-rebuild-evidence.json');
    expect(dr).toContain('Target RPO');
    expect(dr).toContain('Target RTO');
    expect(dr).toContain('does **not** claim');
    expect(dr).toContain('actual RPO/RTO');
  });

  test('independent penetration assessment remains required outside repository CI', async () => {
    const [wave5, drpSecurity, p7Manifest] = await Promise.all([
      source('docs/operations/WAVE5_ENTERPRISE_HARDENING.md'),
      source('tests/drp11-security-qualification.test.ts'),
      source('scripts/ops/p7-evidence-manifest.ts'),
    ]);

    expect(wave5).toContain('independent security assessment');
    expect(wave5).toContain('not an independent penetration test');
    expect(p7Manifest).toContain('p7-independent-security-assessment.json');
    expect(drpSecurity).toContain('independent penetration evidence remains an explicit pre-pilot gate');
  });

  test('Wave 5 documentation keeps engineering and live qualification distinct', async () => {
    const doc = await source('docs/operations/WAVE5_ENTERPRISE_HARDENING.md');
    expect(doc).toContain('ENGINEERING_QUALIFIED');
    expect(doc).toContain('STAGING_QUALIFIED');
    expect(doc).toContain('PILOT_QUALIFIED');
    expect(doc).toContain('PRODUCTION_QUALIFIED');
    expect(doc).toContain('does **not** convert repository CI into a production claim');
    expect(doc).toContain('GHIMS_WAVE5_REQUIRE_COMPLETE=true');
  });
});
