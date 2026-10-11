/**
 * One stable room lease must identify exactly one still-active clinical context.
 * Expiry, clinician reassignment and malformed legacy rooms fail closed.
 */
export interface ExpectedTelehealthRoom {
  roomToken: string;
  sessionId: string;
  encounterId: string;
  patientId: string;
  clinicianId: string;
}

export function assertTelehealthRoomLease(
  room: Record<string, unknown> | undefined,
  expected: ExpectedTelehealthRoom,
  nowMs = Date.now(),
): void {
  if (!room || room.active !== true ||
      typeof room.expiresAt !== 'number' ||
      !Number.isSafeInteger(room.expiresAt) ||
      room.expiresAt <= nowMs ||
      !expected.clinicianId ||
      room.roomToken !== expected.roomToken ||
      room.sessionId !== expected.sessionId ||
      room.encounterId !== expected.encounterId ||
      room.patientId !== expected.patientId ||
      room.clinicianId !== expected.clinicianId) {
    throw new Error('TELEHEALTH_CALL_NOT_ACTIVE');
  }
}

/** Historical messages in a reused signaling document must never be visible
 * to another call even if the room token and participant role are unchanged.
 */
export function filterCurrentTelehealthLeaseMessages<T extends { leaseId?: string; senderRole?: string }>(
  messages: T[],
  leaseId: string,
  receiverRole: string,
): T[] {
  if (!/^[A-Za-z0-9_-]{22}$/.test(leaseId)) return [];
  return messages.filter(
    (message) => message.leaseId === leaseId && message.senderRole !== receiverRole,
  );
}
