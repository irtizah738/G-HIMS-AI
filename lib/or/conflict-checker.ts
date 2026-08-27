import { SurgicalCase, ORConflict } from '@/types/inpatient-or';

interface ConflictCheckOptions {
  turnaroundMinutes?: number;
  ignoreCaseId?: string;
}

export interface ConflictCheckResult {
  hasCriticalConflict: boolean;
  hasWarning: boolean;
  conflicts: ORConflict[];
  summary: string[];
}

/**
 * Parses time strings into timestamps (milliseconds)
 */
function parseTime(timeStr?: string): number | null {
  if (!timeStr) return null;
  const parsed = new Date(timeStr).getTime();
  return isNaN(parsed) ? null : parsed;
}

/**
 * Checks for schedule collisions between candidate case and existing cases in the tenant
 */
export function detectORConflicts(
  candidateCase: Partial<SurgicalCase>,
  existingCases: SurgicalCase[],
  options: ConflictCheckOptions = {}
): ConflictCheckResult {
  const turnaroundMs = (options.turnaroundMinutes ?? 30) * 60 * 1000;
  const ignoreId = options.ignoreCaseId || candidateCase.id;

  const candidateStart = parseTime(candidateCase.scheduledStartTime);
  const candidateEnd = parseTime(candidateCase.scheduledEndTime);

  const conflicts: ORConflict[] = [];
  const summary: string[] = [];

  if (!candidateStart || !candidateEnd) {
    return {
      hasCriticalConflict: false,
      hasWarning: false,
      conflicts: [],
      summary: [],
    };
  }

  if (candidateEnd <= candidateStart) {
    conflicts.push({
      id: `invalid-time-${Date.now()}`,
      type: 'room_overlap',
      severity: 'critical',
      title: 'Invalid Time Range',
      description: 'Scheduled end time must be after scheduled start time.',
      resourceName: candidateCase.orRoomName || 'OR Room',
    });
    summary.push('Scheduled end time must be after scheduled start time.');
  }

  const activeExistingCases = existingCases.filter(
    (c) => c.id !== ignoreId && c.status !== 'cancelled' && c.status !== 'completed'
  );

  for (const existing of activeExistingCases) {
    const exStart = parseTime(existing.scheduledStartTime);
    const exEnd = parseTime(existing.scheduledEndTime);

    if (!exStart || !exEnd) continue;

    // Check direct time overlap: (StartA < EndB) and (EndA > StartB)
    const isDirectOverlap = candidateStart < exEnd && candidateEnd > exStart;

    const timeRangeStr = `${new Date(exStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(exEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    // 1. Check OR Room Direct Overlap
    if (
      candidateCase.orRoomId &&
      existing.orRoomId === candidateCase.orRoomId &&
      isDirectOverlap
    ) {
      const conflict: ORConflict = {
        id: `room-overlap-${existing.id}`,
        type: 'room_overlap',
        severity: 'critical',
        title: 'OR Suite Overlap Conflict',
        description: `Room "${existing.orRoomName || candidateCase.orRoomName}" is already booked by case "${existing.surgicalProcedureName}" (${existing.patientName}) from ${timeRangeStr}.`,
        conflictingCaseId: existing.id,
        conflictingCaseName: existing.surgicalProcedureName,
        conflictingTimeRange: timeRangeStr,
        resourceName: existing.orRoomName || 'OR Suite',
      };
      conflicts.push(conflict);
      summary.push(`OR Room overlap with Case ${existing.id}: ${conflict.description}`);
    }

    // 2. Check OR Room Turnaround Buffer Violation (within turnaround window)
    if (
      candidateCase.orRoomId &&
      existing.orRoomId === candidateCase.orRoomId &&
      !isDirectOverlap
    ) {
      const gapBefore = candidateStart - exEnd; // candidate is after existing
      const gapAfter = exStart - candidateEnd;  // candidate is before existing

      if ((gapBefore >= 0 && gapBefore < turnaroundMs) || (gapAfter >= 0 && gapAfter < turnaroundMs)) {
        const gapMin = Math.round(Math.max(gapBefore, gapAfter) / 60000);
        const conflict: ORConflict = {
          id: `room-turnaround-${existing.id}`,
          type: 'room_turnaround_violation',
          severity: 'warning',
          title: 'Insufficient OR Turnaround Time',
          description: `Only ${gapMin} min buffer available before/after "${existing.surgicalProcedureName}". Minimum standard is ${options.turnaroundMinutes || 30} minutes for terminal cleaning & sterile tray setup.`,
          conflictingCaseId: existing.id,
          conflictingCaseName: existing.surgicalProcedureName,
          conflictingTimeRange: timeRangeStr,
          resourceName: existing.orRoomName || 'OR Suite',
        };
        conflicts.push(conflict);
        summary.push(`Turnaround warning with Case ${existing.id}: ${conflict.description}`);
      }
    }

    // 3. Check Surgeon Double-Booking
    if (
      candidateCase.surgeonId &&
      existing.surgeonId === candidateCase.surgeonId &&
      isDirectOverlap
    ) {
      const conflict: ORConflict = {
        id: `surgeon-double-book-${existing.id}`,
        type: 'surgeon_double_booking',
        severity: 'critical',
        title: 'Surgeon Double-Booking',
        description: `Surgeon "${existing.surgeonName}" is concurrently assigned to "${existing.surgicalProcedureName}" in ${existing.orRoomName} from ${timeRangeStr}.`,
        conflictingCaseId: existing.id,
        conflictingCaseName: existing.surgicalProcedureName,
        conflictingTimeRange: timeRangeStr,
        resourceName: existing.surgeonName || existing.leadSurgeon || 'Surgeon',
      };
      conflicts.push(conflict);
      summary.push(`Surgeon double-booked: ${conflict.description}`);
    }

    // 4. Check Anesthesiologist Double-Booking
    if (
      candidateCase.anesthesiologistId &&
      existing.anesthesiologistId === candidateCase.anesthesiologistId &&
      isDirectOverlap
    ) {
      const conflict: ORConflict = {
        id: `anesthesia-double-book-${existing.id}`,
        type: 'anesthesiologist_double_booking',
        severity: 'critical',
        title: 'Anesthesiologist Double-Booking',
        description: `Anesthesiologist "${existing.anesthesiologistName || 'Assigned Anesthesiologist'}" is assigned to "${existing.surgicalProcedureName}" in ${existing.orRoomName} from ${timeRangeStr}.`,
        conflictingCaseId: existing.id,
        conflictingCaseName: existing.surgicalProcedureName,
        conflictingTimeRange: timeRangeStr,
        resourceName: existing.anesthesiologistName || existing.anesthesiologist || 'Anesthesiologist',
      };
      conflicts.push(conflict);
      summary.push(`Anesthesiologist double-booked: ${conflict.description}`);
    }
  }

  const hasCriticalConflict = conflicts.some((c) => c.severity === 'critical');
  const hasWarning = conflicts.some((c) => c.severity === 'warning');

  return {
    hasCriticalConflict,
    hasWarning,
    conflicts,
    summary,
  };
}

/**
 * Scans an entire list of scheduled cases and finds all conflicting pairs
 */
export function checkAllORConflicts(cases: SurgicalCase[]): Map<string, ORConflict[]> {
  const conflictMap = new Map<string, ORConflict[]>();

  for (let i = 0; i < cases.length; i++) {
    const candidate = cases[i];
    if (candidate.status === 'cancelled' || candidate.status === 'completed') continue;

    const remaining = cases.filter((_, idx) => idx !== i);
    const { conflicts } = detectORConflicts(candidate, remaining, { ignoreCaseId: candidate.id });

    if (conflicts.length > 0) {
      conflictMap.set(candidate.id, conflicts);
    }
  }

  return conflictMap;
}
