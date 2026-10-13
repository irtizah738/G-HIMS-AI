import type { TelehealthSession } from '@/lib/types/ghims';

/**
 * Returns true unless a telehealth session is demonstrably free of clinical or
 * connected-media activity. Ambiguous and malformed historical records fail closed.
 * Session-local activity is necessary but NOT sufficient for cancellation:
 * the domain service additionally checks related Firestore collections inside
 * its authoritative mutation transaction.
 */
export function hasTelehealthClinicalActivity(session: TelehealthSession): boolean {
  const note = session.soapNote as unknown;
  if (!note || typeof note !== 'object' || Array.isArray(note)) return true;
  const fields = note as Record<string, unknown>;
  if (Object.values(fields).some(value =>
    Array.isArray(value) ? value.length > 0 :
    typeof value === 'string' ? value.trim().length > 0 :
    value !== null && value !== undefined && value !== false
  )) return true;
  if (!Array.isArray(session.prescriptions) || !Array.isArray(session.transcription)) return true;
  if (session.prescriptions.length || session.transcription.length) return true;
  const duration = Number(session.callDurationSeconds);
  if (!Number.isFinite(duration) || duration !== 0 || session.isRecording !== false) return true;
  const vital = session.vitals as unknown;
  if (!vital || typeof vital !== 'object' || Array.isArray(vital)) return true;
  const v = vital as Record<string, unknown>;
  return Boolean(session.signedEvidenceId) ||
    Boolean(String(v.bp || '').trim()) ||
    ['hr', 'spo2', 'temp', 'glucose', 'respiratoryRate', 'rhythm', 'connectedDevice'].some(field =>
      typeof v[field] === 'number' ? v[field] !== 0 : Boolean(String(v[field] || '').trim())
    );
}
