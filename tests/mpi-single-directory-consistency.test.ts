import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { adaptEdgeSnapshot } from '@/lib/offline/read-model-adapter';
import { hospitalPatientsToOpdMpi } from '@/lib/clinical/mpi/shared-patient-directory';
import type { EdgeSnapshot } from '@/lib/offline/hydration';

const source = (file: string) => readFile(join(process.cwd(), file), 'utf8');

const snapshot: EdgeSnapshot = {
  tenantId: 'tenant-mpi-test',
  snapshotVersion: 'server-mpi-1',
  generatedAt: 123,
  source: 'SERVER',
  freshness: 'CURRENT',
  collections: {
    patients: [
      {
        id: 'p-1001', tenantId: 'tenant-mpi-test',
        mrn: 'GH-2026-9812', fullName: 'Elena Rostova',
        gender: 'Female', dateOfBirth: '1982-04-14', status: 'ACTIVE',
        contactPhone: '+92 300 1234567',
        identifiers: [{ type: 'CNIC', value: '61101-1234567-8' }],
        bloodGroup: '',
      },
      {
        id: 'p-1002', tenantId: 'tenant-mpi-test',
        mrn: 'GH-2026-9813', fullName: 'Closed Patient',
        gender: 'Male', dateOfBirth: '1981-01-01', status: 'REMOVED',
      },
    ],
    encounters: [
      { id: 'enc-201', patientId: 'p-1001', encounterType: 'TELEHEALTH',
        status: 'COMPLETED' },
      { id: 'enc-202', patientId: 'p-1001', encounterType: 'OPD',
        status: 'CANCELLED' },
      { id: 'enc-203', patientId: 'p-1001', encounterType: 'OPD',
        status: 'ACTIVE' },
    ],
  },
};

describe('Single tenant-authorized MPI across OPD and hospital modules', () => {
  test('the two views adapt exactly the same authorized identity, MRN and CNIC', () => {
    const hospital = adaptEdgeSnapshot(snapshot).patients;
    const consultation = hospitalPatientsToOpdMpi(hospital);
    expect(hospital.map(p => p.id)).toEqual(['p-1001']);
    expect(consultation.map(p => p.id)).toEqual(hospital.map(p => p.id));
    expect(consultation[0].mrn).toBe(hospital[0].mrn);
    expect(consultation[0].nationalId).toBe('61101-1234567-8');
    expect(consultation[0].phone).toBe(hospital[0].contactNumber);
    expect(consultation[0].bloodGroup).toBe('Unknown');
  });

  test('terminal telehealth and cancelled encounters are never reported as active by UI read model', () => {
    const p = adaptEdgeSnapshot(snapshot).patients[0];
    expect(p.encounters.find(e => e.id === 'enc-201')).toMatchObject({
      type: 'Telehealth', status: 'completed',
    });
    expect(p.encounters.find(e => e.id === 'enc-202')?.status).toBe('cancelled');
    expect(p.encounters.find(e => e.id === 'enc-203')?.status).toBe('active');
  });

  test('unknown encounter lifecycle stays active rather than fabricating a discharge', () => {
    const withUnknown: EdgeSnapshot = {
      ...snapshot, collections: {
        ...snapshot.collections,
        encounters: [{ id: 'enc-unverified', patientId: 'p-1001',
          encounterType: 'TELEHEALTH', status: 'UNVERIFIED' }],
      },
    };
    expect(adaptEdgeSnapshot(withUnknown).patients[0].encounters[0].status).toBe('active');
  });

  test('consultation searches the shared HospitalContext directory and never re-registers an existing patient', async () => {
    const opd = await source('components/opd/OpdMasterWorkspace.tsx');
    const panel = await source('components/opd/OpdPatientSearchMpi.tsx');
    const context = await source('lib/context/hospital-context.tsx');
    expect(opd).toContain('hospitalPatientsToOpdMpi(sharedMpiPatients)');
    expect(opd).toContain('patients={directoryPatients}');
    expect(opd).not.toContain('handleRegisterSuccess(p);');
    expect(opd).toContain("String(mpiDirectoryTenantId || '').trim().toLowerCase()");
    expect(opd).toContain("String(auth.activeTenant?.tenantId || '').trim().toLowerCase()");
    expect(panel).toContain('directoryReadiness');
    expect(panel).toContain('opd-mpi-not-hydrated');
    expect(panel).toContain('Review Patient 360');
    expect(panel).toContain("searchTerm.trim() && directoryCurrent");
    expect(context).toContain('mpiDirectoryTenantId');
    expect(context).toContain("'ghims:mpi-directory-refresh'");
  });

  test('hospital MPI clearly identifies DEMO data and never takes terminal encounter as active', async () => {
    const view = await source('components/views/patient-mpi-view.tsx');
    expect(view).toContain('Synthetic DEMO patient directory — not Firestore');
    expect(view).toContain("encounter.status === 'active'");
    expect(view).toContain('directoryMatchesTenant');
  });
});
