import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectionWorkers } from '../lib/backend/projections/projection-workers';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('G-HIMS P4 release-candidate recovery boundary', () => {
  test('registration joins the canonical event, audit and projection-outbox stream', async () => {
    const registration = await source('server/runtime/registration-orchestrator.ts');

    expect(registration).toContain("eventType: 'PATIENT_REGISTERED'");
    expect(registration).toContain("collection('events').doc(canonicalEventId)");
    expect(registration).toContain("collection('outbox').doc(canonicalOutboxId)");
    expect(registration).toContain('eventId: canonicalEventId');
    expect(registration).toContain('outboxId: canonicalOutboxId');
    expect(registration).toContain('auditId: auditLogId');
  });

  test('projection rebuild rejects cross-tenant streams before destructive work', async () => {
    await expect(
      ProjectionWorkers.rebuildProjections(
        [
          {
            eventId: 'evt-a',
            tenantId: 'tenant-a',
            eventType: 'ENCOUNTER_CREATED',
            payload: { encounterId: 'enc-a', patientId: 'pat-a' },
            occurredAt: 1,
          },
          {
            eventId: 'evt-b',
            tenantId: 'tenant-b',
            eventType: 'ENCOUNTER_CREATED',
            payload: { encounterId: 'enc-b', patientId: 'pat-b' },
            occurredAt: 2,
          },
        ],
        { expectedTenantId: 'tenant-a', allowDestructive: true }
      )
    ).rejects.toThrow(/PROJECTION_REBUILD_TENANT_SCOPE_INVALID/);
  });

  test('recovery tooling forbids in-place production rebuilds', async () => {
    const recovery = await source(
      'lib/backend/recovery/projection-recovery-service.ts'
    );
    const worker = await source('lib/backend/projections/projection-workers.ts');

    expect(recovery).toContain("mode === 'PRODUCTION'");
    expect(recovery).toContain('PROJECTION_REBUILD_FORBIDDEN_IN_PRODUCTION');
    expect(recovery).toContain('GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT');
    expect(recovery).toContain('GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD');

    expect(worker).toContain("getRuntimeMode() === 'PRODUCTION'");
    expect(worker).toContain('PROJECTION_REBUILD_CONFIRMATION_REQUIRED');
  });

  test('recovery manifest is PHI-free and evidence-oriented', async () => {
    const recovery = await source(
      'lib/backend/recovery/projection-recovery-service.ts'
    );

    expect(recovery).toContain('eventStreamSha256');
    expect(recovery).toContain('projectionSha256');
    expect(recovery).toContain('checkpointCount');
    expect(recovery).toContain('eventTypeCounts');
    expect(recovery).not.toContain('fullName');
    expect(recovery).not.toContain('contactPhone');
    expect(recovery).not.toContain('clinicalNote');
  });

  test('operator projection rebuild command is explicit and non-production by contract', async () => {
    const script = await source('scripts/ops/projection-rebuild.ts');
    expect(script).toContain('GHIMS_PROJECTION_REBUILD_TENANT');
    expect(script).toContain('rebuildTenantInIsolatedEnvironment');
  });
});
