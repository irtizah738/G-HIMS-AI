import { describe, expect, test } from 'bun:test';
import type { AuthorizationContext, UserSessionRecord } from '@/lib/auth/auth-types';
import { issueOfflineCaptureCapability } from '@/server/auth/offline-capability';

const baseContext: AuthorizationContext = {
  uid: 'doctor-offline-test',
  email: 'doctor@example.invalid',
  tenantId: 'tenant-offline-test',
  roles: ['DOCTOR'],
  permissions: ['PATIENT360:READ'],
  departmentIds: ['medicine'],
  facilityIds: ['hospital-0'],
  clinicalPrivileges: [
    'RECORD_VITALS',
    'SIGN_CLINICAL_NOTES',
    'ORDER_DIAGNOSTICS',
  ],
  accountStatus: 'ACTIVE',
  sessionId: 'session-offline-test',
  deviceId: 'device-offline-test',
  isEmergencyOverride: false,
};

const session: UserSessionRecord = {
  sessionId: 'session-offline-test',
  userId: baseContext.uid,
  tenantId: baseContext.tenantId,
  deviceId: 'device-offline-test',
  status: 'ACTIVE',
  createdAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  authenticatedAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
};

describe('governed extended-outage capture capability', () => {
  test('issues a device-bound capture-only lease for narrow clinical commands', async () => {
    const lease = await issueOfflineCaptureCapability(baseContext, session);
    expect(lease).toBeDefined();
    expect(lease?.tenantId).toBe(baseContext.tenantId);
    expect(lease?.actorId).toBe(baseContext.uid);
    expect(lease?.deviceId).toBe(session.deviceId);
    expect(lease?.captureOnly).toBe(true);
    expect(lease?.replayRequiresOnlineReauthorization).toBe(true);
    expect(lease?.allowedCommandTypes).toContain('RecordVitalsCommand');
    expect(lease?.allowedCommandTypes).toContain('SignClinicalNoteCommand');
    expect(lease?.allowedCommandTypes).toContain('PlaceDiagnosticOrderCommand');
  });

  test('does not grant medication, stock, bed or financial mutation authority', async () => {
    const lease = await issueOfflineCaptureCapability(baseContext, session);
    for (const forbidden of [
      'DispensePrescriptionCommand',
      'RecordStockTransactionCommand',
      'UpdateBedStatusCommand',
      'RecordCashReceiptCommand',
      'PostJournalCommand',
    ]) {
      expect(lease?.allowedCommandTypes).not.toContain(forbidden);
    }
  });

  test('refuses to issue an extended-outage lease without a bound device', async () => {
    const lease = await issueOfflineCaptureCapability(
      { ...baseContext, deviceId: undefined },
      { ...session, deviceId: undefined }
    );
    expect(lease).toBeUndefined();
  });

  test('never exceeds the 24-hour capture ceiling', async () => {
    const lease = await issueOfflineCaptureCapability(baseContext, session);
    expect(lease).toBeDefined();
    const durationMs =
      Date.parse(lease!.expiresAt) - Date.parse(lease!.issuedAt);
    expect(durationMs).toBeGreaterThan(0);
    expect(durationMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});
