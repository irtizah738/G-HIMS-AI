/**
 * Patient MPI Creation Flow
 * Validates, indexes, deduplicates, and creates Patient Master Index profiles.
 */

import { PatientMpiRecord } from '@/types/clinical-workflow';
import {
  generateDeterministicMatchKeys,
  generateInstitutionalMrn,
  normalizePhoneNumber,
} from './patient-mpi';

export interface PatientRegistrationInput {
  tenantId: string;
  facilityCode?: string;
  nationalId?: string;
  passportNumber?: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: 'Male' | 'Female' | 'Other';
  bloodGroup: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
  phone: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  emergencyContact?: {
    name?: string;
    relationship?: string;
    phone?: string;
  };
  allergies?: string[];
  chronicConditions?: string[];
  primaryPayerId?: string;
  primaryPayerName?: string;
  policyNumber?: string;
  existingMrn?: string;
}

export class PatientMpiCreationFlow {
  /**
   * Builds and validates a normalized PatientMpiRecord from intake registration input.
   */
  public static createPatientRecord(input: PatientRegistrationInput): PatientMpiRecord {
    if (!input.firstName?.trim() || !input.lastName?.trim()) {
      throw new Error('Patient First and Last names are mandatory for MPI registration.');
    }
    if (!input.dateOfBirth?.trim()) {
      throw new Error('Patient Date of Birth (YYYY-MM-DD) is mandatory.');
    }
    if (!input.phone?.trim()) {
      throw new Error('Primary contact telephone number is mandatory.');
    }

    const tenantId = input.tenantId || 'central-metro-hospital';
    const facilityCode = input.facilityCode || 'METRO';
    const timestamp = new Date().toISOString();

    // Calculate age from DOB
    const birthDate = new Date(input.dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    age = Math.max(0, age);

    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const middleName = input.middleName?.trim() || '';
    const fullName = middleName ? `${firstName} ${middleName} ${lastName}` : `${firstName} ${lastName}`;

    const id = `pat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const mrn = input.existingMrn || generateInstitutionalMrn(facilityCode);

    const matchKeys = generateDeterministicMatchKeys({
      nationalId: input.nationalId,
      firstName,
      lastName,
      dateOfBirth: input.dateOfBirth.trim(),
      phone: input.phone,
    });

    return {
      id,
      tenantId,
      mrn,
      nationalId: input.nationalId?.trim().toUpperCase(),
      passportNumber: input.passportNumber?.trim(),
      firstName,
      lastName,
      middleName: middleName || undefined,
      fullName,
      dateOfBirth: input.dateOfBirth.trim(),
      age,
      gender: input.gender || 'Other',
      bloodGroup: input.bloodGroup || 'O+',
      phone: normalizePhoneNumber(input.phone),
      email: input.email?.trim().toLowerCase(),
      address: {
        street: input.address?.street?.trim() || 'Not specified',
        city: input.address?.city?.trim() || 'Central City',
        state: input.address?.state?.trim() || 'State',
        postalCode: input.address?.postalCode?.trim() || '00000',
        country: input.address?.country?.trim() || 'USA',
      },
      emergencyContact: {
        name: input.emergencyContact?.name?.trim() || 'Next of Kin',
        relationship: input.emergencyContact?.relationship?.trim() || 'Family',
        phone: normalizePhoneNumber(input.emergencyContact?.phone || input.phone),
      },
      allergies: input.allergies || ['None Known'],
      chronicConditions: input.chronicConditions || [],
      primaryPayerId: input.primaryPayerId,
      primaryPayerName: input.primaryPayerName,
      policyNumber: input.policyNumber,
      status: 'ACTIVE',
      matchKeys,
      registeredAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
