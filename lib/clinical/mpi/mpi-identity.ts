export type AuthoritativeMpiIdentifierType = 'CNIC' | 'MRN';

export function normalizeMpiIdentifierValue(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function mpiRegistryKey(
  type: AuthoritativeMpiIdentifierType,
  value: string
): string {
  const normalized = normalizeMpiIdentifierValue(value);
  if (!normalized) {
    throw new Error(`MPI_IDENTIFIER_VALUE_REQUIRED:${type}`);
  }
  return `${type}_${normalized}`;
}

/**
 * Registration releases before canonical key normalization replaced punctuation
 * with underscores. Read this alias during migration so an existing CNIC can
 * never be registered twice.
 */
export function legacyCnicRegistryKey(value: string): string {
  return `CNIC_${String(value || '').trim()}`.replace(
    /[^a-zA-Z0-9_]/g,
    '_'
  );
}
