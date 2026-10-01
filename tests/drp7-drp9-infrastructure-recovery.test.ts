import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('DRP-7/8/9 staging infrastructure and recovery closure', () => {
  test('staging preflight requires isolated Firebase projects and disabled integrations', async () => {
    const preflight = await source('scripts/ops/drp-staging-preflight.ts');
    expect(preflight).toContain("runtime !== 'STAGING'");
    expect(preflight).toContain('STAGING_PROJECT_COLLISION');
    expect(preflight).toContain('STAGING_CLIENT_SERVER_PROJECT_MISMATCH');
    expect(preflight).toContain('UNQUALIFIED_STAGING_INTEGRATION_ENABLED');
    expect(preflight).toContain('STAGING_FIREBASE_ADMIN_CREDENTIALS_REQUIRED');
    for (const integration of [
      'AI',
      'HL7',
      'FHIR_R4',
      'DICOMWEB',
      'DEVICE_TELEMETRY',
      'EDI_X12',
    ]) {
      expect(preflight).toContain(integration);
    }
  });

  test('staging deploy checks exact main, runs preflight and records deploy evidence', async () => {
    const workflow = await source('.github/workflows/staging-deploy.yml');
    expect(workflow).toContain('git rev-parse origin/main');
    expect(workflow).toContain('ops:staging-preflight');
    expect(workflow).toContain('ops:staging-smoke');
    expect(workflow).toContain('staging-preflight.json');
    expect(workflow).toContain('staging-deployment-evidence.txt');
  });

  test('backup and restore commands fail closed on environment targeting', async () => {
    const [backup, restore] = await Promise.all([
      source('scripts/ops/firestore-backup.mjs'),
      source('scripts/ops/firestore-restore.mjs'),
    ]);

    expect(backup).toContain('Backup project does not match');
    expect(backup).toContain('GHIMS_BACKUP_BUCKET');
    expect(restore).toContain('GHIMS_RESTORE_CONFIRM_PROJECT');
    expect(restore).toContain('Production restore is blocked');
    expect(restore).toContain('Restore project does not match');
  });

  test('recovery drill refuses protected environment targets and rebuilds projections only after restore', async () => {
    const workflow = await source('.github/workflows/drp-recovery-drill.yml');
    expect(workflow).toContain('RECOVERY_DRILL');
    expect(workflow).toContain('GHIMS_PRODUCTION_PROJECT_ID');
    expect(workflow).toContain('GHIMS_STAGING_PROJECT_ID');
    expect(workflow).toContain('GHIMS_DEMO_PROJECT_ID');
    expect(workflow).toContain('bun run ops:restore');
    expect(workflow).toContain('bun run ops:projection-rebuild');
    expect(workflow).toContain('GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD');
  });

  test('projection recovery is prohibited against production and validates event/checkpoint completeness', async () => {
    const recovery = await source(
      'lib/backend/recovery/projection-recovery-service.ts'
    );
    expect(recovery).toContain('PROJECTION_REBUILD_FORBIDDEN_IN_PRODUCTION');
    expect(recovery).toContain('GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD');
    expect(recovery).toContain('GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT');
    expect(recovery).toContain('PROJECTION_REBUILD_DUPLICATE_EVENT');
    expect(recovery).toContain('PROJECTION_REBUILD_INCOMPLETE');
    expect(recovery).toContain('eventStreamSha256');
    expect(recovery).toContain('projectionSha256');
  });

  test('operational readiness executable detects outbox dead letters, expired leases and aged backlog', async () => {
    const ops = await source('scripts/ops/drp-operational-check.ts');
    expect(ops).toContain('OUTBOX_DEAD_LETTER_PRESENT');
    expect(ops).toContain('OUTBOX_PROCESSING_LEASE_EXPIRED');
    expect(ops).toContain('OUTBOX_BACKLOG_TOO_OLD');
    expect(ops).toContain("where('status', 'in'");
  });

  test('operational logging removes PHI-like attributes', async () => {
    const telemetry = await source('lib/observability/server-telemetry.ts');
    expect(telemetry).toContain('SENSITIVE_KEY');
    expect(telemetry).toContain('tenantFingerprint');
    expect(telemetry).not.toContain('console.log(input)');
  });
});
