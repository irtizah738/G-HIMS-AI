import type {
  Patient,
  Bed,
  BillingAuditMismatch,
  OpdQueueToken,
  StaffMember,
  AuditLogEntry,
  Hl7Message,
  TelehealthSession,
} from '@/lib/types/ghims';

/**
 * Legacy browser Firestore adapter.
 *
 * Root-level hospital collections were retired at the P0/P5C trust boundary.
 * firestore.rules intentionally deny those paths. Keeping real client reads/writes
 * here creates permission-denied storms and tempts callers to bypass tenant/session
 * authority. The compatibility exports remain temporarily so older UI modules fail
 * closed while they are migrated to tenant-scoped read models and server commands.
 */

type Unsubscribe = () => void;

function retiredSubscription(_name: string): Unsubscribe {
  return () => {};
}

function retiredMutation(name: string): never {
  throw new Error(
    'LEGACY_CLIENT_FIRESTORE_RETIRED: ' + name +
    ' cannot access root Firestore collections. Use tenant-scoped projections or authenticated server commands.'
  );
}

export function subscribeToPatients(_callback: (patients: Patient[]) => void): Unsubscribe {
  return retiredSubscription('patients');
}

export function subscribeToBeds(_callback: (beds: Bed[]) => void): Unsubscribe {
  return retiredSubscription('beds');
}

export function subscribeToBillingMismatches(
  _callback: (mismatches: BillingAuditMismatch[]) => void
): Unsubscribe {
  return retiredSubscription('billingMismatches');
}

export function subscribeToOpdQueue(_callback: (tokens: OpdQueueToken[]) => void): Unsubscribe {
  return retiredSubscription('opdQueue');
}

export function subscribeToAuditLogs(_callback: (logs: AuditLogEntry[]) => void): Unsubscribe {
  return retiredSubscription('auditLogs');
}

export function subscribeToTelehealthSessions(
  _callback: (sessions: TelehealthSession[]) => void
): Unsubscribe {
  return retiredSubscription('telehealthSessions');
}

export async function syncPatientToFirestore(_patient: Patient): Promise<void> {
  retiredMutation('syncPatientToFirestore');
}

export async function syncBedToFirestore(_bed: Bed): Promise<void> {
  retiredMutation('syncBedToFirestore');
}

export async function syncMismatchToFirestore(_mismatch: BillingAuditMismatch): Promise<void> {
  retiredMutation('syncMismatchToFirestore');
}

export async function syncOpdTokenToFirestore(_token: OpdQueueToken): Promise<void> {
  retiredMutation('syncOpdTokenToFirestore');
}

export async function syncAuditLogToFirestore(_log: AuditLogEntry): Promise<void> {
  retiredMutation('syncAuditLogToFirestore');
}

export async function syncHl7ToFirestore(_message: Hl7Message): Promise<void> {
  retiredMutation('syncHl7ToFirestore');
}

export async function syncTelehealthSessionToFirestore(_session: TelehealthSession): Promise<void> {
  retiredMutation('syncTelehealthSessionToFirestore');
}

export async function deleteTelehealthSessionFromFirestore(_sessionId: string): Promise<void> {
  retiredMutation('deleteTelehealthSessionFromFirestore');
}

export async function seedInitialFirestoreData(
  _initialPatients: Patient[],
  _initialBeds: Bed[],
  _initialMismatches: BillingAuditMismatch[],
  _initialTokens: OpdQueueToken[],
  _initialStaff: StaffMember[],
  _initialTelehealth?: TelehealthSession[]
): Promise<void> {
  retiredMutation('seedInitialFirestoreData');
}
