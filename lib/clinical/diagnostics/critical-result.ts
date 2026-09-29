const FINAL_DIAGNOSTIC_STATUSES = new Set([
  'FINAL',
  'AMENDED',
  'CORRECTED',
]);

const CRITICAL_INTERPRETATION_CODES = new Set([
  'C',
  'HH',
  'LL',
  'INTERP_C',
  'INTERP_HH',
  'INTERP_LL',
]);

function value(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

export function isFinalDiagnosticStatus(status: unknown): boolean {
  return FINAL_DIAGNOSTIC_STATUSES.has(value(status));
}

export function isCriticalDiagnosticObservation(
  observation: Record<string, unknown>
): boolean {
  const interpretations = Array.isArray(observation.interpretation)
    ? observation.interpretation
    : [];

  for (const interpretation of interpretations) {
    if (!interpretation || typeof interpretation !== 'object') continue;
    const concept = interpretation as Record<string, unknown>;
    const codings = Array.isArray(concept.codings) ? concept.codings : [];

    for (const coding of codings) {
      if (!coding || typeof coding !== 'object') continue;
      const entry = coding as Record<string, unknown>;
      const code = value(entry.code);
      const display = value(entry.display);
      if (
        CRITICAL_INTERPRETATION_CODES.has(code) ||
        display.includes('CRITICAL')
      ) {
        return true;
      }
    }

    if (value(concept.text).includes('CRITICAL')) {
      return true;
    }
  }

  return false;
}

export function criticalObservationIds(
  observations: Array<Record<string, unknown>>
): Set<string> {
  return new Set(
    observations
      .filter(isCriticalDiagnosticObservation)
      .map((observation) =>
        String(observation.observationId || observation.id || '').trim()
      )
      .filter(Boolean)
  );
}

export function isCriticalDiagnosticResult(
  result: Record<string, unknown>,
  criticalIds: Set<string>
): boolean {
  if (!isFinalDiagnosticStatus(result.status)) return false;
  if (result.hasCriticalResult === true) return true;

  const observationIds = Array.isArray(result.resultObservationIds)
    ? result.resultObservationIds
    : [];

  return observationIds.some((id) => criticalIds.has(String(id || '').trim()));
}
