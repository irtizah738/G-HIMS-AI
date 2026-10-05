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

export interface PatientCareContextPointers {
  activeOpdEncounterIds: string[];
  activeIpdEncounterId?: string;
  activeEmergencyEncounterId?: string;
  activeTelehealthEncounterIds: string[];
  latestOpdEncounterId?: string;
  latestIpdEncounterId?: string;
  latestEmergencyEncounterId?: string;
  latestTelehealthEncounterId?: string;
  updatedAt?: number;
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
  /**
   * Compatibility pointer for legacy consumers. New care-setting logic must use
   * activeCareContexts so concurrent OPD/IPD/ED contexts cannot overwrite each other.
   */
  activeEncounterId?: string;
  activeCareContexts?: PatientCareContextPointers;
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
