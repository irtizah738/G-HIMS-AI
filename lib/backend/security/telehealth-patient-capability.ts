import { createHash, timingSafeEqual } from 'node:crypto';

/** Verify a room-scoped 256-bit patient capability; the room ID is not authorization. */
export function assertTelehealthPatientJoinToken(presented: string, expectedHash?: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(presented) ||
      !expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error('TELEHEALTH_PATIENT_JOIN_TOKEN_INVALID');
  }
  const hash = createHash('sha256').update(presented).digest();
  const expected = Buffer.from(expectedHash, 'hex');
  if (expected.length !== hash.length || !timingSafeEqual(hash, expected)) {
    throw new Error('TELEHEALTH_PATIENT_JOIN_TOKEN_INVALID');
  }
}
