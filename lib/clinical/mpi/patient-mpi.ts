/**
 * Patient Master Patient Index (MPI) Domain Model & Matching Engine
 * Deterministic and Probabilistic Deduplication, MRN Issuance, and Identity Reconciliation
 */

import { DeterministicMatchKey, MpiMatchScore, PatientMpiRecord } from '@/types/clinical-workflow';

/**
 * Standard Soundex algorithm for phonetic indexing of patient surnames.
 */
export function calculateSoundex(name: string): string {
  if (!name) return '0000';
  const clean = name.toUpperCase().replace(/[^A-Z]/g, '');
  if (!clean) return '0000';

  const firstLetter = clean[0];
  const mapping: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };

  let result = firstLetter;
  let prevCode = mapping[firstLetter] || '0';

  for (let i = 1; i < clean.length && result.length < 4; i++) {
    const char = clean[i];
    const code = mapping[char] || '0';
    if (code !== '0' && code !== prevCode) {
      result += code;
      prevCode = code;
    } else if (code === '0') {
      prevCode = '0';
    }
  }

  return (result + '0000').slice(0, 4);
}

/**
 * Canonical external patient identifier normalization.
 *
 * MRN is the immutable institution-issued patient identifier. CNIC is a
 * deterministic national identifier when present. Both can be used alone to
 * resolve the authoritative MPI record; neither replaces the internal opaque
 * patient UUID used by clinical event references.
 */
export function normalizeMrn(value: string): string {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeCnic(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

export function buildMpiRegistryKey(
  type: 'MRN' | 'CNIC',
  value: string
): string {
  const normalized = type === 'MRN' ? normalizeMrn(value) : normalizeCnic(value);
  if (!normalized) {
    throw new Error(`MPI_${type}_VALUE_REQUIRED`);
  }
  return `${type}_${normalized}`.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Normalizes phone numbers to pure numeric digits.
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

/**
 * Generates deterministic hashing and lookup keys for an MPI profile.
 */
export function generateDeterministicMatchKeys(params: {
  nationalId?: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
}): DeterministicMatchKey {
  const normFirst = (params.firstName || '').trim().toLowerCase();
  const normLast = (params.lastName || '').trim().toLowerCase();
  const normDob = (params.dateOfBirth || '').trim();
  const normPhone = normalizePhoneNumber(params.phone);
  const normNatId = normalizeCnic(params.nationalId || '');

  const dobNameHash = `dob_name_${normDob}_${normLast}_${normFirst}`;
  const nationalIdHash = normNatId ? `natid_${normNatId}` : undefined;
  const soundexLastName = calculateSoundex(normLast);

  return {
    nationalIdHash,
    dobNameHash,
    normalizedPhone: normPhone ? `phone_${normPhone}` : undefined,
    soundexLastName,
  };
}

/**
 * Generates an institutional Master Record Number (MRN).
 * Format: MRN-{FACILITY}-{YEAR}-{SEQUENCE}
 */
export function generateInstitutionalMrn(facilityCode = 'METRO', sequenceNumber?: number): string {
  const year = new Date().getFullYear();
  const seq = sequenceNumber
    ? String(sequenceNumber).padStart(6, '0')
    : String(Math.floor(Math.random() * 900000) + 100000);
  const sanitizedFacility = facilityCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return `MRN-${sanitizedFacility}-${year}-${seq}`;
}

/**
 * Levenshtein distance calculation for fuzzy string matching.
 */
export function calculateLevenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  const lenA = a.length;
  const lenB = b.length;

  for (let i = 0; i <= lenA; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= lenB; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[lenA][lenB];
}

/**
 * String similarity ratio (0 to 1).
 */
export function calculateStringSimilarity(a: string, b: string): number {
  const s1 = (a || '').trim().toLowerCase();
  const s2 = (b || '').trim().toLowerCase();
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const maxLen = Math.max(s1.length, s2.length);
  const dist = calculateLevenshteinDistance(s1, s2);
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Evaluates probabilistic match score between an incoming registration payload and an existing MPI candidate.
 */
export function evaluateMpiMatch(
  incoming: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    phone: string;
    nationalId?: string;
    gender?: string;
  },
  candidate: PatientMpiRecord
): MpiMatchScore {
  let score = 0;
  const matchedFields: string[] = [];

  // 1. National ID Exact Match (High weight)
  if (
    incoming.nationalId &&
    candidate.nationalId &&
    normalizeCnic(incoming.nationalId) === normalizeCnic(candidate.nationalId)
  ) {
    score += 50;
    matchedFields.push('nationalId (Exact)');
  }

  // 2. Date of Birth Exact Match
  if (incoming.dateOfBirth && candidate.dateOfBirth === incoming.dateOfBirth.trim()) {
    score += 25;
    matchedFields.push('dateOfBirth');
  }

  // 3. Name Similarity
  const firstSim = calculateStringSimilarity(incoming.firstName, candidate.firstName);
  const lastSim = calculateStringSimilarity(incoming.lastName, candidate.lastName);

  if (firstSim > 0.85 && lastSim > 0.85) {
    score += 25;
    matchedFields.push('name (Fuzzy High)');
  } else if (firstSim > 0.7 && lastSim > 0.7) {
    score += 15;
    matchedFields.push('name (Fuzzy Moderate)');
  }

  // 4. Phone Match
  const normIncomingPhone = normalizePhoneNumber(incoming.phone);
  const normCandidatePhone = normalizePhoneNumber(candidate.phone);
  if (normIncomingPhone && normCandidatePhone && normIncomingPhone === normCandidatePhone) {
    score += 15;
    matchedFields.push('phone');
  }

  // 5. Gender Match
  if (incoming.gender && candidate.gender && incoming.gender.toLowerCase() === candidate.gender.toLowerCase()) {
    score += 5;
    matchedFields.push('gender');
  }

  const finalScore = Math.min(100, score);
  const isDeterministicExact =
    (incoming.nationalId &&
      candidate.nationalId &&
      normalizeCnic(incoming.nationalId) === normalizeCnic(candidate.nationalId)) ||
    (candidate.dateOfBirth === incoming.dateOfBirth && firstSim === 1.0 && lastSim === 1.0);

  let confidence: 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  if (finalScore >= 95 || isDeterministicExact) confidence = 'EXACT';
  else if (finalScore >= 75) confidence = 'HIGH';
  else if (finalScore >= 50) confidence = 'MEDIUM';

  return {
    candidateId: candidate.id,
    candidateMrn: candidate.mrn,
    candidateName: candidate.fullName,
    matchScore: finalScore,
    matchedFields,
    isDeterministicExact: !!isDeterministicExact,
    confidence,
  };
}
