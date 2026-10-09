import { describe, expect, test } from 'bun:test';
import {
  activePrivileges,
  credentialsValid,
  isoDayActive,
  isClinicalConsultantMembership,
} from '@/lib/clinical/intelligence/consultant-directory-service';
import type { ClinicalPrivilege, EmployeeCredential } from '@/types/hcm-advanced';

const now = Date.parse('2026-10-09T12:00:00.000Z');

const credential = (value: Record<string, unknown> = {}) => ({
  employeeId: 'employee-1',
  isMandatoryForPractice: true,
  issueDate: '2026-01-01',
  expiryDate: '2027-01-01',
  verificationStatus: 'VERIFIED',
  verifiedByActorId: 'reviewer-1',
  verifiedAt: '2026-01-10T08:00:00Z',
  ...value,
} as unknown as EmployeeCredential);

const privilege = (value: Record<string, unknown> = {}) => ({
  employeeId: 'employee-1',
  privilegeType: 'CONSULT_OPD',
  status: 'GRANTED',
  effectiveFrom: '2026-01-01',
  effectiveUntil: '2027-01-01',
  ...value,
} as unknown as ClinicalPrivilege);

describe('ORC-2 consultant authority behavioral regressions', () => {
  test('explicit active clinical membership is mandatory', () => {
    expect(isClinicalConsultantMembership({ roles: ['CONSULTANT'], status: 'ACTIVE' })).toBe(true);
    expect(isClinicalConsultantMembership({ roles: ['DOCTOR'], status: 'SUSPENDED' })).toBe(false);
    expect(isClinicalConsultantMembership({ roles: ['DOCTOR'] })).toBe(false);
    expect(isClinicalConsultantMembership({ roles: ['BILLING_CLERK'], status: 'ACTIVE' })).toBe(false);
  });

  test('mandatory verified credential must be currently valid', () => {
    expect(credentialsValid([credential()], now)).toBe(true);
    expect(credentialsValid([], now)).toBe(false);
    expect(credentialsValid([credential({ verificationStatus: 'PENDING' })], now)).toBe(false);
    expect(credentialsValid([credential({ issueDate: '2026-12-01' })], now)).toBe(false);
    expect(credentialsValid([credential({ expiryDate: '2026-01-01' })], now)).toBe(false);
    expect(credentialsValid([credential(), credential({ expiryDate: '2020-01-01' })], now)).toBe(false);
    expect(credentialsValid([credential({ issueDate: '' })], now)).toBe(false);
  });

  test('malformed and open-ended grants cannot be used as active authority', () => {
    expect(isoDayActive('2026-01-01', '2027-01-01', now)).toBe(true);
    expect(isoDayActive(undefined, '2027-01-01', now)).toBe(false);
    expect(isoDayActive('2026-01-01', undefined, now)).toBe(false);
    expect(isoDayActive('2026-02-30', '2027-01-01', now)).toBe(false);
    expect(isoDayActive('2027-01-01', '2026-01-01', now)).toBe(false);
    expect(isoDayActive('2026-01-01', '2027-01-01', Number.NaN)).toBe(false);
  });

  test('only current explicit grants survive the privilege filter', () => {
    const grants = activePrivileges([
      privilege(),
      privilege({ status: 'REVOKED' }),
      privilege({ effectiveFrom: '2027-01-01' }),
      privilege({ effectiveUntil: '' }),
    ], now);
    expect(grants).toHaveLength(1);
    expect(grants[0].privilegeType).toBe('CONSULT_OPD');
  });
});
