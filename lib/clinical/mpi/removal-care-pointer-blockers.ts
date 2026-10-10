/** Pure fail-closed active-care pointer inspection for read-only MPI removal readiness. */
export type RemovalBlocker = {
  source: 'ENCOUNTER' | 'ACTIVE_CARE_POINTER' | 'ACTIVE_BED';
  domain: string;
  encounterId?: string;
  status: string;
  detail: string;
};

export function pointerBlockers(patient: Record<string, unknown>): RemovalBlocker[] {
  const c = patient.activeCareContexts && typeof patient.activeCareContexts === 'object' &&
    !Array.isArray(patient.activeCareContexts)
    ? patient.activeCareContexts as Record<string, unknown> : {};
  const blockers: RemovalBlocker[] = [];
  const add = (domain: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value !== 'string' || !value.trim()) {
      blockers.push({
        source: 'ACTIVE_CARE_POINTER', domain, status: 'POINTER_MALFORMED',
        detail: 'Encounter reference has an invalid type. Authoritative reconciliation is required.',
      });
      return;
    }
    blockers.push({
      source: 'ACTIVE_CARE_POINTER', domain, encounterId: value.trim(),
      status: 'UNRESOLVED_POINTER',
      detail: 'Patient still references this encounter. Confirm its authoritative status and reconcile through the responsible clinical workflow.',
    });
  };
  if (patient.activeBedId) {
    blockers.push({
      source: 'ACTIVE_BED', domain: 'IPD', status: 'BED_ASSIGNED',
      detail: 'An active bed assignment is recorded. Verify census and clinical disposition before removal.',
    });
  }
  add('LEGACY', patient.activeEncounterId);
  add('IPD', c.activeIpdEncounterId);
  add('EMERGENCY', c.activeEmergencyEncounterId);
  const arrays: Array<[string, unknown]> = [
    ['OPD', c.activeOpdEncounterIds], ['TELEHEALTH', c.activeTelehealthEncounterIds],
  ];
  for (const [domain, value] of arrays) {
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      blockers.push({
        source: 'ACTIVE_CARE_POINTER', domain, status: 'POINTER_MALFORMED',
        detail: 'Care pointer is malformed. Authoritative reconciliation is required.',
      });
      continue;
    }
    for (const id of value) {
      if (typeof id === 'string' && id.trim()) add(domain, id);
      else blockers.push({
        source: 'ACTIVE_CARE_POINTER', domain, status: 'POINTER_MALFORMED',
        detail: 'Encounter pointer is not a valid string. Authoritative reconciliation is required.',
      });
    }
  }
  return blockers;
}

