/**
 * Master Patient Index (MPI) Type Definitions
 * Deterministic deduplication, multi-identifier indexing & demographic models
 */

export type Gender = 'male' | 'female' | 'other' | 'unknown';

export interface PatientIdentifier {
  type: 'CNIC' | 'MRN' | 'PASSPORT' | 'PHONE';
  value: string;
  issuer: string;
}

export interface PatientMPI {
  id: string;
  tenantId: string;
  mrn: string;
  fullName: string;
  gender: Gender;
  dateOfBirth: string;
  identifiers: PatientIdentifier[];
  contactPhone: string;
  address: string;
  createdAt: number;
  updatedAt: number;
  createdById: string;
  version: number;
  status?: 'ACTIVE' | 'MERGED' | 'DECEASED' | 'INACTIVE';
  mergedIntoPatientId?: string;
  activeEncounterId?: string;
  activeBedId?: string;
  email?: string;
  bloodGroup?: string;
  allergies?: string[];
  chronicConditions?: string[];
  emergencyContact?: {
    name: string;
    relationship: string;
    phone: string;
  };
}

export interface MpiMatchCandidate {
  patient: PatientMPI;
  matchScore: number;
  matchType: 'EXACT_CNIC' | 'EXACT_PHONE' | 'EXACT_MRN' | 'SOUNDEX_DOB' | 'FUZZY_NAME';
  matchedFields: string[];
  confidence: number;
}
