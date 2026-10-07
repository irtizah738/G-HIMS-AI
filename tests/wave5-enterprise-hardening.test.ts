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

  test('authenticated load qualification uses real session authority and emits bounded evidence only', async () => {
    const load = await source('scripts/ops/wave5-authenticated-load.ts');
    expect(load).toContain('WAVE5_LOAD_STAGING_ONLY');
    expect(load).toContain('WAVE5_LOAD_REMOTE_HTTPS_STAGING_REQUIRED');
    expect(load).toContain('accounts:signInWithPassword');
    expect(load).toContain('/api/auth/session');
    expect(load).toContain('/api/offline/bootstrap?tenantId=');
    expect(load).toContain("'x-ghims-session-id': sessionId");
    expect(load).toContain('GHIMS_WAVE5_LOAD_CONCURRENCY');
    expect(load).toContain('GHIMS_WAVE5_LOAD_P95_LIMIT_MS');
    expect(load).toContain('GHIMS_WAVE5_LOAD_MAX_ERROR_RATE');

    const evidenceBlock = load.slice(load.indexOf('const evidence = {'));
    expect(evidenceBlock).not.toContain('email,');
    expect(evidenceBlock).not.toContain('password,');
    expect(evidenceBlock).not.toContain('idToken,');
    expect(evidenceBlock).not.toContain('sessionId,');
  });

  test('deployed Wave 5 staging qualification covers multi-role, cross-domain, load and operational health', async () => {
    const workflow = await source(
      '.github/workflows/wave5-staging-qualification.yml'
    );

    expect(workflow).toContain('WAVE5-STAGING');
    expect(workflow).toContain('bun run ops:staging-smoke');
    expect(workflow).toContain('bun run ops:p7:rehearsal');
    expect(workflow).toContain('bun run ops:drp10:rehearsal');
    expect(workflow).toContain('bun run ops:wave5:load');
    expect(workflow).toContain('bun run ops:drp-operational-check');
    expect(workflow).toContain('bun run test:opd-sq1:staging');
    expect(workflow).toContain('Backup/restore, rollback, alert routing');
  });

  test('projection failure injection stays isolated and clean recovery remains required', async () => {
    const [service, drill, recovery] = await Promise.all([
      source('lib/backend/recovery/projection-recovery-service.ts'),
      source('scripts/ops/wave5-projection-failure-injection.ts'),
      source('docs/operations/PROJECTION_RECOVERY.md'),
    ]);

    expect(service).toContain('PROJECTION_REBUILD_FORBIDDEN_IN_PRODUCTION');
    expect(service).toContain('GHIMS_PROJECTION_REBUILD_INJECT_FAILURE');
    expect(service).toContain('PROJECTION_REBUILD_INJECTED_FAILURE');
    expect(service).toContain("status: 'FAILED'");
    expect(drill).toContain('WAVE5_FAILURE_INJECTION_FORBIDDEN_IN_PRODUCTION');
    expect(drill).toContain('AFTER_PROJECTION_WORKER');
    expect(drill).toContain('Run a clean projection rebuild');
    expect(recovery).toContain('identical authoritative input must yield the same projection fingerprint');
  });

  test('rollback rehearsal can only redeploy a known-good main ancestor into guarded STAGING', async () => {
    const workflow = await source(
      '.github/workflows/wave5-staging-rollback.yml'
    );

    expect(workflow).toContain('WAVE5-ROLLBACK');
    expect(workflow).toContain('git merge-base --is-ancestor');
    expect(workflow).toContain('vercel pull --yes --environment=preview');
    expect(workflow).toContain('vercel deploy --prebuilt --yes');
    expect(workflow).toContain('bun run ops:staging-smoke');
    expect(workflow).toContain('wave5-rollback-rehearsal.json');
    expect(workflow).not.toContain('vercel deploy --prod');
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

  test('deployed browser qualification supports protected previews without hardcoding a bypass credential', async () => {
    const [opdConfig, wave2Config] = await Promise.all([
      source('playwright.opd-staging.config.ts'),
      source('playwright.wave2-staging.config.ts'),
    ]);

    for (const config of [opdConfig, wave2Config]) {
      expect(config).toContain('GHIMS_STAGING_BYPASS_HEADER_NAME');
      expect(config).toContain('GHIMS_STAGING_BYPASS_HEADER_VALUE');
      expect(config).toContain('extraHTTPHeaders');
      expect(config).not.toContain('x-vercel-protection-bypass:');
    }
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
