import type {
  AuthorizationContext,
  OfflineCaptureCapabilityLease,
  UserSessionRecord,
} from '@/lib/auth/auth-types';
import { getAdminFirestore } from '@/server/firebase/admin';

const MAX_LEASE_HOURS = 24;

function allowedCaptureCommands(context: AuthorizationContext): string[] {
  const roles = new Set(context.roles.map((role) => role.trim().toUpperCase()));
  const privileges = new Set(
    context.clinicalPrivileges.map((value) => value.trim().toUpperCase())
  );
  const allowed = new Set<string>();

  if (
    ['RECEPTIONIST', 'REGISTRAR', 'ADMISSION_OFFICER', 'ADMIN', 'ADMINISTRATOR', 'SYSTEM_ADMIN']
      .some((role) => roles.has(role))
  ) {
    allowed.add('RegisterPatientAndEncounterCommand');
  }

  if (privileges.has('RECORD_VITALS')) {
    allowed.add('RecordVitalsCommand');
  }

  if (
    privileges.has('SIGN_CLINICAL_NOTES') ||
    privileges.has('SIGN_CLINICAL_NOTE') ||
    privileges.has('SIGN_SOAP_CLINICAL_NOTE')
  ) {
    allowed.add('SignClinicalNoteCommand');
  }

  if (
    privileges.has('ORDER_DIAGNOSTICS') ||
    privileges.has('ORDER_LAB') ||
    privileges.has('ORDER_RADIOLOGY')
  ) {
    allowed.add('PlaceDiagnosticOrderCommand');
  }

  return [...allowed].sort();
}

export async function issueOfflineCaptureCapability(
  context: AuthorizationContext,
  session: UserSessionRecord
): Promise<OfflineCaptureCapabilityLease | undefined> {
  const deviceId = String(session.deviceId || context.deviceId || '').trim();
  if (!deviceId) return undefined;

  const allowedCommandTypes = allowedCaptureCommands(context);
  if (allowedCommandTypes.length === 0) return undefined;

  const requestedHours = Number(process.env.GHIMS_OFFLINE_CAPTURE_LEASE_HOURS || MAX_LEASE_HOURS);
  const leaseHours = Number.isFinite(requestedHours)
    ? Math.min(MAX_LEASE_HOURS, Math.max(1, requestedHours))
    : MAX_LEASE_HOURS;
  const issuedAtMs = Date.now();

  const lease: OfflineCaptureCapabilityLease = {
    leaseId: `ocap_${crypto.randomUUID()}`,
    tenantId: context.tenantId,
    actorId: context.uid,
    deviceId,
    allowedCommandTypes,
    facilityIds: [...context.facilityIds],
    departmentIds: [...context.departmentIds],
    clinicalPrivileges: [...context.clinicalPrivileges],
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + leaseHours * 60 * 60 * 1000).toISOString(),
    policyVersion: 1,
    captureOnly: true,
    replayRequiresOnlineReauthorization: true,
  };

  const db = getAdminFirestore();
  if (db) {
    await db
      .collection('tenants')
      .doc(context.tenantId)
      .collection('offlineCaptureCapabilities')
      .doc(lease.leaseId)
      .create({
        ...lease,
        status: 'ACTIVE',
        sessionId: session.sessionId,
      });
  }

  return lease;
}
