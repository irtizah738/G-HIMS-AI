import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('OPD-RP16 real timeline and audit', () => {
  test('timeline API uses authoritative tenant/session and patient access boundaries', async () => {
    const route = await source('app/api/opd/timeline/route.ts');

    expect(route).toContain('deriveAuthoritativeContext');
    expect(route).toContain('assertPatient360PatientAccess');
    expect(route).toContain("'encounters'");
    expect(route).toContain("'patients'");
    expect(route).toContain("'ENCOUNTER_PATIENT_MISMATCH'");
    expect(route).toContain("'Cache-Control': 'no-store'");
    expect(route).toContain("'OPD_TIMELINE_ACCESS_DENIED'");
    expect(route).toContain("'OPD_TIMELINE_READ_FAILED'");
    expect(route).toContain('truncated: eventRead.truncated');
    expect(route).toContain(
      'unlinkedEventCount === 0 && !eventRead.truncated'
    );
  });

  test('production timeline requires durable server event and audit stores with no local fallback', async () => {
    const route = await source('app/api/opd/timeline/route.ts');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(route).toContain('AUTHORITATIVE_TIMELINE_STORE_UNAVAILABLE');
    expect(route).toContain(".collection('events')");
    expect(route).toContain(".collection('audit_logs')");
    expect(route).not.toContain('localStorage');
    expect(route).not.toContain('sessionStorage');
    expect(workspace).toContain('// DEMO-only visual event helper.');
    expect(workspace).toContain('if (!IS_DEMO_RUNTIME) return;');
  });

  test('event and audit provenance must match tenant actor command and correlation lineage', async () => {
    const route = await source('app/api/opd/timeline/route.ts');

    expect(route).toContain(
      "String(event.tenantId || '') === tenantId"
    );
    expect(route).toContain(
      "String(event.payload?.encounterId || '') === encounterId"
    );
    expect(route).toContain(
      "String(audit?.eventId || '') === event.eventId"
    );
    expect(route).toContain(
      "String(audit?.commandId || '') === String(event.commandId || '')"
    );
    expect(route).toContain(
      "String(audit?.actorId || '') === String(event.actorId || '')"
    );
    expect(route).toContain(
      "String(audit?.actorRole || '') === String(event.actorRole || '')"
    );
    expect(route).toContain(
      "String(audit?.correlationId || '')"
    );
    expect(route).toContain('ambiguousEventIds.add(eventId)');
    expect(route).toContain('ambiguousAuditCount');
  });

  test('timeline payload sanitization redacts secrets and bounds nested content', async () => {
    const route = await source('app/api/opd/timeline/route.ts');

    expect(route).toContain('REDACTED_KEY');
    expect(route).toContain("'[REDACTED]'");
    expect(route).toContain("'[TRUNCATED]'");
    expect(route).toContain('value.slice(0, 1000)');
    expect(route).toContain('value.slice(0, 50)');
    expect(route).toContain('.slice(0, 80)');
  });

  test('client requires authenticated tenant-scoped online fetch with no cache', async () => {
    const client = await source('lib/opd/timeline-client.ts');

    expect(client).toContain('AUTHENTICATION_REQUIRED');
    expect(client).toContain('TENANT_MISMATCH');
    expect(client).toContain("cache: 'no-store'");
    expect(client).toContain("Authorization: `Bearer ${idToken}`");
    expect(client).toContain("'x-ghims-session-id'");
    expect(client).toContain("'x-ghims-device-id'");
  });

  test('production UI does not claim fabricated cryptographic audit proof', async () => {
    const view = await source('components/opd/OpdPatientTimelineAudit.tsx');
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(view).toContain(
      'This surface does not'
    );
    expect(view).toContain(
      'claim a cryptographic signature unless cryptographic proof is'
    );
    expect(view).toContain('EVENT_AUDIT_LINKED');
    expect(view).toContain('EVENT_ONLY');
    expect(view).toContain(
      'timeline truncated by server safety limit'
    );
    expect(view).toContain('duplicate audit linkage');

    expect(workspace).toContain("hash: 'DEMO-NON-AUTHORITATIVE'");
    expect(workspace).toContain('IS_DEMO_RUNTIME ? SEED_EVENTS : []');
    expect(workspace).not.toContain('Math.random().toString(36)');
  });

  test('timeline errors fail visibly instead of falling back to synthetic production events', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(workspace).toContain('OPD_TIMELINE_ONLINE_REQUIRED');
    expect(workspace).toContain(
      'Authoritative OPD timeline could not be loaded.'
    );
    expect(workspace).toContain('setTimelineIntegrity(null)');
    expect(workspace).not.toContain(
      'setEvents(SEED_EVENTS)'
    );
  });
});
