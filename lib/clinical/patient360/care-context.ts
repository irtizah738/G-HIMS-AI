import type { PatientCareContextPointers } from '@/types/mpi';
import type {
  Patient360CareContexts,
  Patient360EncounterSummary,
} from '@/types/patient360-projection';
import type { ClinicalCareSetting } from '@/types/consultant-visibility';

const TERMINAL = new Set(['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED']);

export function normalizeCareSetting(value: unknown): ClinicalCareSetting {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized.startsWith('OPD')) return 'OPD';
  if (normalized === 'IPD' || normalized === 'INPATIENT') return 'IPD';
  if (normalized === 'ED' || normalized === 'ER' || normalized === 'EMERGENCY') return 'EMERGENCY';
  if (normalized === 'TELEHEALTH' || normalized === 'VIRTUAL') return 'TELEHEALTH';
  return 'UNKNOWN';
}

export function isActiveEncounterStatus(value: unknown): boolean {
  return !TERMINAL.has(String(value || '').trim().toUpperCase());
}

export function normalizePatientCarePointers(
  value?: Partial<PatientCareContextPointers> | null
): PatientCareContextPointers {
  return {
    activeOpdEncounterIds: Array.from(new Set(value?.activeOpdEncounterIds || [])),
    activeTelehealthEncounterIds: Array.from(new Set(value?.activeTelehealthEncounterIds || [])),
    ...(value?.activeIpdEncounterId ? { activeIpdEncounterId: value.activeIpdEncounterId } : {}),
    ...(value?.activeEmergencyEncounterId ? { activeEmergencyEncounterId: value.activeEmergencyEncounterId } : {}),
    ...(value?.latestOpdEncounterId ? { latestOpdEncounterId: value.latestOpdEncounterId } : {}),
    ...(value?.latestIpdEncounterId ? { latestIpdEncounterId: value.latestIpdEncounterId } : {}),
    ...(value?.latestEmergencyEncounterId ? { latestEmergencyEncounterId: value.latestEmergencyEncounterId } : {}),
    ...(value?.latestTelehealthEncounterId ? { latestTelehealthEncounterId: value.latestTelehealthEncounterId } : {}),
    ...(value?.updatedAt ? { updatedAt: value.updatedAt } : {}),
  };
}

export function activateCareContext(
  current: Partial<PatientCareContextPointers> | undefined,
  careSetting: ClinicalCareSetting,
  encounterId: string,
  now = Date.now()
): PatientCareContextPointers {
  const next = normalizePatientCarePointers(current);
  if (careSetting === 'OPD') {
    next.activeOpdEncounterIds = Array.from(new Set([...next.activeOpdEncounterIds, encounterId]));
    next.latestOpdEncounterId = encounterId;
  } else if (careSetting === 'IPD') {
    next.activeIpdEncounterId = encounterId;
    next.latestIpdEncounterId = encounterId;
  } else if (careSetting === 'EMERGENCY') {
    next.activeEmergencyEncounterId = encounterId;
    next.latestEmergencyEncounterId = encounterId;
  } else if (careSetting === 'TELEHEALTH') {
    next.activeTelehealthEncounterIds = Array.from(new Set([...next.activeTelehealthEncounterIds, encounterId]));
    next.latestTelehealthEncounterId = encounterId;
  }
  next.updatedAt = now;
  return next;
}

export function closeCareContext(
  current: Partial<PatientCareContextPointers> | undefined,
  careSetting: ClinicalCareSetting,
  encounterId: string,
  now = Date.now()
): PatientCareContextPointers {
  const next = normalizePatientCarePointers(current);
  if (careSetting === 'OPD') {
    next.activeOpdEncounterIds = next.activeOpdEncounterIds.filter((id) => id !== encounterId);
    next.latestOpdEncounterId = encounterId;
  } else if (careSetting === 'IPD') {
    if (next.activeIpdEncounterId === encounterId) delete next.activeIpdEncounterId;
    next.latestIpdEncounterId = encounterId;
  } else if (careSetting === 'EMERGENCY') {
    if (next.activeEmergencyEncounterId === encounterId) delete next.activeEmergencyEncounterId;
    next.latestEmergencyEncounterId = encounterId;
  } else if (careSetting === 'TELEHEALTH') {
    next.activeTelehealthEncounterIds = next.activeTelehealthEncounterIds.filter((id) => id !== encounterId);
    next.latestTelehealthEncounterId = encounterId;
  }
  next.updatedAt = now;
  return next;
}

function latestBySetting(
  encounters: Patient360EncounterSummary[],
  setting: ClinicalCareSetting
): Patient360EncounterSummary | undefined {
  return encounters.find((encounter) => encounter.careSetting === setting);
}

export function compatibilityEncounterId(
  current: Partial<PatientCareContextPointers> | undefined
): string | undefined {
  const pointers = normalizePatientCarePointers(current);
  return (
    pointers.activeIpdEncounterId ||
    pointers.activeEmergencyEncounterId ||
    pointers.activeOpdEncounterIds[0] ||
    pointers.activeTelehealthEncounterIds[0]
  );
}

export function buildPatient360CareContexts(
  encounters: Patient360EncounterSummary[]
): Patient360CareContexts {
  const active = encounters.filter((encounter) => isActiveEncounterStatus(encounter.status));
  const activeOpdEncounters = active.filter((encounter) => encounter.careSetting === 'OPD');
  const activeTelehealthEncounters = active.filter((encounter) => encounter.careSetting === 'TELEHEALTH');
  const activeIpdEncounter = active.find((encounter) => encounter.careSetting === 'IPD');
  const activeEmergencyEncounter = active.find((encounter) => encounter.careSetting === 'EMERGENCY');

  return {
    activeOpdEncounters,
    activeIpdEncounter,
    activeEmergencyEncounter,
    activeTelehealthEncounters,
    latestOpdEncounter: latestBySetting(encounters, 'OPD'),
    latestIpdEncounter: latestBySetting(encounters, 'IPD'),
    latestEmergencyEncounter: latestBySetting(encounters, 'EMERGENCY'),
    latestTelehealthEncounter: latestBySetting(encounters, 'TELEHEALTH'),
  };
}

export function selectCareContextEncounter(
  careContexts: Patient360CareContexts,
  careSetting?: ClinicalCareSetting
): Patient360EncounterSummary | undefined {
  switch (careSetting) {
    case 'IPD':
      return careContexts.activeIpdEncounter || careContexts.latestIpdEncounter;
    case 'EMERGENCY':
      return careContexts.activeEmergencyEncounter || careContexts.latestEmergencyEncounter;
    case 'OPD':
      return careContexts.activeOpdEncounters[0] || careContexts.latestOpdEncounter;
    case 'TELEHEALTH':
      return careContexts.activeTelehealthEncounters[0] || careContexts.latestTelehealthEncounter;
    default:
      return preferredCompatibilityEncounter(careContexts);
  }
}

export function preferredCompatibilityEncounter(
  careContexts: Patient360CareContexts
): Patient360EncounterSummary | undefined {
  return (
    careContexts.activeIpdEncounter ||
    careContexts.activeEmergencyEncounter ||
    careContexts.activeOpdEncounters[0] ||
    careContexts.activeTelehealthEncounters[0] ||
    careContexts.latestIpdEncounter ||
    careContexts.latestEmergencyEncounter ||
    careContexts.latestOpdEncounter ||
    careContexts.latestTelehealthEncounter
  );
}
