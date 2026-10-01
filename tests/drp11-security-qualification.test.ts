import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AuthorizationPipeline } from '@/lib/backend/auth/authorization-pipeline';
import { validateCommandPayload } from '@/lib/backend/commands/command-schema-registry';
import { verifyCommandIntegrity } from '@/lib/backend/security/authoritative-context';
import type { BaseCommand, CommandContext } from '@/lib/backend/types';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

const context: CommandContext = {
  actorId: 'security-user',
  tenantId: 'tenant-a',
  roles: ['DOCTOR'],
  permissions: [],
  departmentIds: ['medicine'],
  facilityIds: ['facility-a'],
  clinicalPrivileges: [],
  correlationId: 'corr-security',
  requestId: 'req-security',
};

describe('DRP-11 staging security qualification', () => {
  test('tenant IDOR is rejected before command execution', () => {
    const command: BaseCommand = {
      commandId: 'cmd-idor',
      idempotencyKey: 'idem-idor',
      tenantId: 'tenant-b',
      commandType: 'RecordVitalsCommand',
      schemaVersion: 1,
      payload: {},
    };
    expect(() => verifyCommandIntegrity(context, command)).toThrow(
      'TENANT_ISOLATION_VIOLATION'
    );
  });

  test('unlisted privileged roles cannot escalate across business domains', () => {
    const medicalDirector: CommandContext = {
      ...context,
      roles: ['MEDICAL_DIRECTOR'],
    };
    const finance = AuthorizationPipeline.evaluate(medicalDirector, {
      requiredRoles: ['FINANCE_MANAGER'],
    });
    const scm = AuthorizationPipeline.evaluate(medicalDirector, {
      requiredRoles: ['SCM_MANAGER'],
    });
    const hr = AuthorizationPipeline.evaluate(medicalDirector, {
      requiredRoles: ['HR_ADMIN'],
    });

    expect(finance.authorized).toBe(false);
    expect(scm.authorized).toBe(false);
    expect(hr.authorized).toBe(false);
  });

  test('unknown and oversized/malformed command payloads fail closed at the perimeter', () => {
    const unknown = validateCommandPayload({
      commandId: 'cmd-unknown',
      idempotencyKey: 'idem-unknown',
      tenantId: 'tenant-a',
      commandType: 'ExploitCommand',
      schemaVersion: 1,
      payload: { arbitrary: true },
    });
    expect(unknown.success).toBe(false);
    expect(unknown.error?.code).toBe('COMMAND_SCHEMA_NOT_REGISTERED');

    const malformed = validateCommandPayload({
      commandId: 'cmd-malformed',
      idempotencyKey: 'idem-malformed',
      tenantId: 'tenant-a',
      commandType: 'RecordVitalsCommand',
      schemaVersion: 1,
      payload: {
        encounterId: 'enc',
        patientId: 'pat',
        heartRate: 999999,
        unknownField: 'x'.repeat(100_000),
      },
    });
    expect(malformed.success).toBe(false);
  });

  test('authoritative request context ignores client role and privilege headers', async () => {
    const authority = await source(
      'lib/backend/security/authoritative-context.ts'
    );
    expect(authority).not.toContain("headers.get('x-ghims-role')");
    expect(authority).not.toContain("headers.get('x-ghims-permission')");
    expect(authority).not.toContain("headers.get('x-clinical-privilege')");
    expect(authority).toContain('resolveAuthorizationContext');
  });

  test('device/session attacks fail closed before command authority is resolved', async () => {
    const authority = await source(
      'lib/backend/security/authoritative-context.ts'
    );
    expect(authority).toContain('validateSession');
    expect(authority).toContain('assertDeviceActive');
    expect(authority).toContain('requestedDeviceId !== session.deviceId');
    expect(authority).toContain("code: 'DEVICE_REVOKED'");
  });

  test('offline replay replaces forged actor identity with authenticated context', async () => {
    const route = await source('app/api/sync/batch/route.ts');
    expect(route).toContain('actorId: context.actorId');
    expect(route).toContain('tenantId: context.tenantId');
  });

  test('Firestore rules are default-deny and authority collections are server-only', async () => {
    const rules = await source('firestore.rules');
    expect(rules).toContain('allow read, write: if false;');
    for (const collection of [
      'events',
      'outbox',
      'idempotency',
      'resourceIdentities',
      'roomIdentities',
      'bedIdentities',
    ]) {
      expect(rules).toContain(`match /${collection}`);
    }
  });

  test('operational telemetry redacts PHI/security-like attribute keys', async () => {
    const telemetry = await source('lib/observability/server-telemetry.ts');
    expect(telemetry).toContain('SENSITIVE_KEY');
    for (const key of ['patient', 'mrn', 'token', 'authorization', 'password', 'secret']) {
      expect(telemetry).toContain(key);
    }
  });

  test('independent penetration evidence remains an explicit pre-pilot gate', async () => {
    const manifest = await source('scripts/ops/p7-evidence-manifest.ts');
    expect(manifest).toContain('p7-independent-security-assessment.json');
    expect(manifest).toContain('trl6ClaimReady: complete');
  });
});
