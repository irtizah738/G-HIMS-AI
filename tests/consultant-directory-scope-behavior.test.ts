import { describe, expect, test } from 'bun:test';
import { activePrivileges, availabilityFor, credentialsValid } from '@/lib/clinical/intelligence/consultant-directory-service';
import type { ClinicalPrivilege, EmployeeCredential, RosterShiftEntry } from '@/types/hcm-advanced';

const now = Date.parse('2026-10-09T12:00:00.000Z');

function privilege(overrides: Partial<ClinicalPrivilege> = {}): ClinicalPrivilege {
  return {
    privilegeId: 'p1', employeeId: 'e1', employeeName: 'Clinician',
    privilegeType: 'SIGN_CLINICAL_NOTES' as ClinicalPrivilege['privilegeType'],
    specialty: 'Internal Medicine', facilityId: 'hospital-a', facilityName: 'Hospital A',
    departmentId: 'medicine', departmentName: 'Medicine',
    effectiveFrom: '2026-01-01', effectiveUntil: '2026-12-31',
    status: 'GRANTED', grantedByActorId: 'admin', createdAt: '', updatedAt: '',
    ...overrides,
  };
}

function roster(overrides: Partial<RosterShiftEntry> = {}): RosterShiftEntry {
  return {
    rosterId: 'r1', tenantId: 'tenant-a', facilityId: 'hospital-a', facilityName: 'Hospital A',
    departmentId: 'medicine', departmentName: 'Medicine', employeeId: 'e1',
    employeeName: 'Clinician', positionTitle: 'Consultant', date: '2026-10-09',
    shiftId: 'shift-1', shiftName: 'DAY', startTime: '2026-10-09T08:00:00.000Z',
    endTime: '2026-10-09T16:00:00.000Z', durationHours: 8,
    status: 'PUBLISHED', isOvertime: false, createdAt: '', updatedAt: '',
    ...overrides,
  };
}

describe('HCM consultant qualification behavior', () => {
  test('only effective granted privileges for the exact facility and department qualify', () => {
    const data = [
      privilege(), privilege({ privilegeId: 'p2', facilityId: 'hospital-b' }),
      privilege({ privilegeId: 'p3', departmentId: 'surgery' }),
      privilege({ privilegeId: 'p4', status: 'REVOKED' as ClinicalPrivilege['status'] }),
      privilege({ privilegeId: 'p5', effectiveUntil: '2026-10-08' }),
      privilege({ privilegeId: 'p6', effectiveFrom: '2026-10-10' }),
    ];
    expect(activePrivileges(data, now, 'hospital-a', 'medicine').map(p => p.privilegeId)).toEqual(['p1']);
    expect(activePrivileges(data, now, 'hospital-b', 'medicine').map(p => p.privilegeId)).toEqual(['p2']);
    expect(activePrivileges(data, now, 'hospital-c', 'medicine')).toEqual([]);
  });

  test('requires an active independently verified mandatory credential', () => {
    const credential = {
      employeeId: 'e1', isMandatoryForPractice: true, verificationStatus: 'VERIFIED',
      verifiedByActorId: 'credential-reviewer', verifiedAt: '2026-01-01T09:00:00Z',
      expiryDate: '2027-01-01',
    } as EmployeeCredential;
    expect(credentialsValid([], now)).toBe(false);
    expect(credentialsValid([credential], now)).toBe(true);
    expect(credentialsValid([{ ...credential, verifiedByActorId: undefined }], now)).toBe(false);
    expect(credentialsValid([{ ...credential, verifiedAt: undefined }], now)).toBe(false);
    expect(credentialsValid([{ ...credential, verificationStatus: 'PENDING' as EmployeeCredential['verificationStatus'] }], now)).toBe(false);
    expect(credentialsValid([{ ...credential, expiryDate: '2026-10-08' }], now)).toBe(false);
    expect(credentialsValid([credential, { ...credential, expiryDate: '2026-10-08' }], now)).toBe(false);
  });

  test('availability is derived only from a correctly scoped roster', () => {
    const shifts = [
      roster({ rosterId: 'other-facility', facilityId: 'hospital-b' }),
      roster({ rosterId: 'other-dept', departmentId: 'surgery' }),
      roster({ rosterId: 'other-tenant', tenantId: 'tenant-b' }),
    ];
    const scoped = shifts.filter(s => s.facilityId === 'hospital-a' && s.departmentId === 'medicine' && s.tenantId === 'tenant-a');
    expect(availabilityFor(scoped, now).availability).toBe('UNKNOWN');
    expect(availabilityFor([roster()], now).availability).toBe('ON_DUTY');
    expect(availabilityFor([roster({ status: 'CANCELLED' as RosterShiftEntry['status'] })], now).availability).toBe('OFF_DUTY');
  });
});
