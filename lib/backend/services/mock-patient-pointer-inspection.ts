import type { PatientMPI } from '@/types/mpi';

/**
 * Report only the blocking field names. Do not turn missing/malformed care
 * pointers into assumptions about patient discharge or permission to retire.
 */
export function mockRetirementNonOpdPointerBlockers(
  patient: Pick<PatientMPI, 'activeBedId' | 'activeCareContexts'>
): string[] {
  const blockers: string[] = [];
  const care = patient.activeCareContexts as Record<string, unknown> | null | undefined;
  const bedId = patient.activeBedId as unknown;

  if (bedId !== undefined && bedId !== null && bedId !== '') {
    blockers.push('activeBedId');
  }
  if (care === undefined || care === null) return blockers;
  if (typeof care !== 'object' || Array.isArray(care)) {
    blockers.push('activeCareContexts (malformed)');
    return blockers;
  }

  for (const field of ['activeIpdEncounterId', 'activeEmergencyEncounterId'] as const) {
    const value = care[field];
    if (value !== undefined && value !== null && value !== '') {
      blockers.push('activeCareContexts.' + field);
    }
  }

  const telehealth = care.activeTelehealthEncounterIds;
  if (telehealth !== undefined && telehealth !== null) {
    if (!Array.isArray(telehealth)) {
      blockers.push('activeCareContexts.activeTelehealthEncounterIds (malformed)');
    } else if (telehealth.length > 0) {
      blockers.push('activeCareContexts.activeTelehealthEncounterIds');
    }
  }

  return blockers;
}
