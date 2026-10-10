import type { Patient } from '@/lib/types/ghims';
import type { PatientDemographics } from '@/types/opd-domain';

/**
 * OPD and hospital-wide MPI must display the SAME tenant-authorized identity
 * directory. OPD encounter/worklist state is separate from permanent MPI.
 * Never mint a new identity because a patient has no active OPD encounter.
 */
export function hospitalPatientsToOpdMpi(patients: Patient[]): PatientDemographics[] {
  const seen = new Set<string>();
  return patients.flatMap((patient) => {
    const id = String(patient.id || '').trim();
    const mrn = String(patient.mrn || '').trim();
    if (!id || !mrn ||
        ['MERGED', 'REMOVED'].includes(String(patient.status || 'ACTIVE').toUpperCase()) ||
        seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      mrn,
      fullName: patient.fullName,
      status: patient.status,
      gender: patient.gender,
      dob: patient.dateOfBirth,
      age: patient.age,
      nationalId: patient.nationalId || '',
      maritalStatus: 'Unknown' as const,
      nationality: '',
      primaryLanguage: '',
      phone: patient.contactNumber || '',
      email: patient.email || undefined,
      residentialAddress: patient.address || '',
      emergencyContact: patient.emergencyContact?.name && patient.emergencyContact?.phone
        ? {
            name: patient.emergencyContact.name,
            relation: patient.emergencyContact.relationship,
            phone: patient.emergencyContact.phone,
          }
        : undefined,
      tariffPlan: 'UNASSIGNED' as const,
      bloodGroup: patient.bloodGroup,
      knownAllergies: patient.allergies,
      chronicConditions: patient.chronicConditions,
      createdAt: Date.parse(patient.registeredAt || '') || 0,
    } satisfies PatientDemographics];
  });
}
