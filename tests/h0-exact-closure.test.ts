import { describe, expect, test } from 'bun:test';
import { requireEdgeHydrationSurface } from '@/lib/offline/hydration-policy';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import type { CommandContext } from '@/lib/backend/types';

describe('Hospital-0 exact engineering closure', () => {
  test('offline hydration is explicit and GENERIC can never be selected', () => {
    expect(() => requireEdgeHydrationSurface('')).toThrow('EDGE_HYDRATION_SURFACE_REQUIRED');
    expect(() => requireEdgeHydrationSurface('GENERIC')).toThrow('EDGE_HYDRATION_SURFACE_INVALID');
    expect(requireEdgeHydrationSurface('hospital_shell')).toBe('HOSPITAL_SHELL');
    expect(requireEdgeHydrationSurface('opd')).toBe('OPD');
  });

  test('authoritative transaction events retain source, roles, device and session provenance', async () => {
    const context: CommandContext = {
      actorId: 'integration-test-actor',
      tenantId: 'tenant-provenance-test',
      roles: ['DOCTOR', 'CONSULTANT'],
      permissions: ['PATIENT360:READ'],
      clinicalPrivileges: ['SIGN_CLINICAL_NOTES'],
      facilityIds: ['facility-1'],
      departmentIds: ['medicine'],
      deviceId: 'device-1',
      sessionId: 'session-1',
      correlationId: 'corr-provenance-1',
      requestId: 'req-provenance-1',
      source: 'integration',
    };

    const result = await TransactionManager.executeAtomicWrite(
      context,
      'cmd-provenance-1',
      'idemp-provenance-1',
      {
        entityType: 'RESOURCE',
        entityId: 'resource-provenance-1',
        eventType: 'PROVENANCE_TEST_EVENT',
        domainState: { resourceId: 'resource-provenance-1', status: 'ACTIVE' },
        eventPayload: { status: 'ACTIVE' },
      }
    );

    expect(result.event.source).toBe('integration');
    expect(result.event.actorRole).toBe('DOCTOR');
    expect(result.event.actorRoles).toEqual(['DOCTOR', 'CONSULTANT']);
    expect(result.event.deviceId).toBe('device-1');
    expect(result.event.sessionId).toBe('session-1');

    const authorization = result.audit.metadata?.authorization as Record<string, unknown>;
    expect(authorization.effectiveRoles).toEqual(['DOCTOR', 'CONSULTANT']);
    expect(authorization.deviceId).toBe('device-1');
    expect(authorization.sessionId).toBe('session-1');
    expect(authorization.source).toBe('integration');
  });

  test('direct atomic mutations default to system rather than fabricating a web origin', async () => {
    const result = await TransactionManager.executeAtomicMutation({
      tenantId: 'tenant-provenance-test',
      actorId: 'system:test',
      actorRole: 'SYSTEM',
      aggregateType: 'RESOURCE',
      aggregateId: 'resource-provenance-system',
      eventType: 'SYSTEM_PROVENANCE_TEST_EVENT',
      eventPayload: { status: 'ACTIVE' },
      domainState: { resourceId: 'resource-provenance-system', status: 'ACTIVE' },
    });

    expect(result.success).toBe(true);
    const events = TransactionManager.getInMemoryEvents();
    const event = events.find((item) => item.eventId === result.eventId);
    expect(event?.source).toBe('system');
  });
});
