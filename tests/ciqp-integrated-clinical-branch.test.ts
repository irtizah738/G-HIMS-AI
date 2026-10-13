import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DecodedIdToken } from 'firebase-admin/auth';

import { mapHcmPrivilegeToAuthorization } from '@/server/auth/clinical-privilege-map';
import { assertPrivilegedSecondFactor } from '@/server/auth/identity-assurance';
import { validateDevelopmentSandbox, SANDBOX_ACK, SANDBOX_PROJECT_ID, SANDBOX_TENANT_ID } from '@/lib/dev-sandbox/safety';
import { assertTelehealthRoomLease, filterCurrentTelehealthLeaseMessages } from '@/lib/backend/security/telehealth-room-policy';
import { isPatient360ClinicalSourceEvent } from '@/lib/clinical/patient360/clinical-source-event-policy';

const source = (filename: string) => readFile(path.join(process.cwd(), filename), 'utf8');
const decodedToken = (factor?: string) => ({
  firebase: factor ? { sign_in_second_factor: factor } : {},
} as DecodedIdToken);

describe('PR #189 integrated authority and patient-safety contracts', () => {
  test('Firebase MFA cannot manufacture clinical signing or death certificate rights', async () => {
    for (const role of ['DOCTOR', 'ADMINISTRATOR', 'receptionist', 'billing', 'nurse']) {
      expect(() => assertPrivilegedSecondFactor(decodedToken(), [role], 'STAGING'))
        .toThrow('requires verified MFA');
      expect(() => assertPrivilegedSecondFactor(decodedToken(), [role], 'PRODUCTION'))
        .toThrow('requires verified MFA');
      expect(() => assertPrivilegedSecondFactor(decodedToken('totp'), [role], 'STAGING'))
        .not.toThrow();
    }
    expect(mapHcmPrivilegeToAuthorization('SIGN_DEATH_CERTIFICATE'))
      .toEqual(['SIGN_DEATH_CERTIFICATE']);
    expect(mapHcmPrivilegeToAuthorization('SIGN_DEATH_CERTIFICATE'))
      .not.toContain('SIGN_CLINICAL_NOTES');
    expect(mapHcmPrivilegeToAuthorization('SIGN_CLINICAL_NOTE'))
      .toContain('SIGN_CLINICAL_NOTES');

    const authorization = await source('server/auth/authorization-context.ts');
    expect(authorization).toContain('assertPrivilegedSecondFactor(verifiedToken.claims, membership.roles, getRuntimeMode())');
    expect(authorization).toContain('mapHcmPrivilegeToAuthorization(privilege.privilegeType)');
    expect(authorization).toContain('credentialsValid(credentials, Date.now())');
  });

  test('Patient 360 ignores unsigned AI audit but retains clinical signing events', () => {
    for (const eventType of [
      'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT_CREATED',
      'CLINICAL_INTELLIGENCE_SAFETY_BLOCKED',
      'CLINICAL_DRAFT_GENERATED',
      'CLINICAL_DRAFT_APPROVED_FOR_SIGNATURE',
      'CLINICAL_DRAFT_REJECTED',
    ]) {
      expect(isPatient360ClinicalSourceEvent({ eventType })).toBe(false);
    }
    expect(isPatient360ClinicalSourceEvent({ eventType: 'CLINICAL_DRAFT_SIGNED' })).toBe(true);
  });

  test('Telehealth call authorization rejects changed patient, clinician and expired room', () => {
    const expected = {
      roomToken: 'governed-room', sessionId: 'session-1',
      encounterId: 'encounter-1', patientId: 'patient-1', clinicianId: 'doctor-1',
    };
    const active = { ...expected, active: true, expiresAt: 3000 };
    expect(() => assertTelehealthRoomLease(active, expected, 2000)).not.toThrow();
    expect(() => assertTelehealthRoomLease({ ...active, patientId: 'patient-2' }, expected, 2000)).toThrow();
    expect(() => assertTelehealthRoomLease({ ...active, clinicianId: 'doctor-2' }, expected, 2000)).toThrow();
    expect(() => assertTelehealthRoomLease(active, expected, 3000)).toThrow();

    const messages = [
      { leaseId: 'abcdefghijklmnopqrstuv', senderRole: 'doctor', payload: 'current' },
      { leaseId: 'abcdefghijklmnopqrstuw', senderRole: 'doctor', payload: 'previous' },
      { leaseId: 'abcdefghijklmnopqrstuv', senderRole: 'patient', payload: 'own' },
    ];
    expect(filterCurrentTelehealthLeaseMessages(messages, 'abcdefghijklmnopqrstuv', 'patient')
      .map(message => message.payload)).toEqual(['current']);
  });

  test('Local sandbox cannot be used to bypass hosted clinical environment safety', () => {
    const safe = {
      GHIMS_RUNTIME_MODE: 'TEST',
      NODE_ENV: 'test',
      FIREBASE_PROJECT_ID: SANDBOX_PROJECT_ID,
      GHIMS_FIREBASE_PROJECT_ID_TEST: SANDBOX_PROJECT_ID,
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      GHIMS_DEV_SANDBOX_TENANT_ID: SANDBOX_TENANT_ID,
      GHIMS_DEV_SANDBOX_ACK: SANDBOX_ACK,
      GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'g-hims-ai',
    };
    expect(validateDevelopmentSandbox(safe).projectId).toBe(SANDBOX_PROJECT_ID);
    expect(() => validateDevelopmentSandbox({ ...safe, GHIMS_RUNTIME_MODE: 'STAGING' })).toThrow();
    expect(() => validateDevelopmentSandbox({ ...safe, NODE_ENV: 'production' })).toThrow();
    expect(() => validateDevelopmentSandbox({ ...safe, FIREBASE_PROJECT_ID: 'g-hims-ai' })).toThrow();
  });

  test('Known MPI identity cannot be re-registered and unhydrated data cannot fake zero patients', async () => {
    const [workspace, lookup, shell] = await Promise.all([
      source('components/opd/OpdMasterWorkspace.tsx'),
      source('components/opd/OpdPatientSearchMpi.tsx'),
      source('components/views/patient-mpi-view.tsx'),
    ]);
    expect(workspace).not.toContain('handleRegisterSuccess(p);');
    expect(workspace).toContain('hospitalPatientsToOpdMpi(sharedMpiPatients)');
    expect(lookup).toContain("Registration is disabled until lookup succeeds.");
    expect(lookup).toContain("MPI results are unavailable");
    expect(lookup).toContain('/api/clinical/mpi/lookup?');
    expect(shell).toContain('const visiblePatients = searchFilter.trim() ? filteredPatients : activePatients;');
  });
});
