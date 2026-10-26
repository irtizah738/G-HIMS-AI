import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (filename: string) => readFile(path.join(process.cwd(), filename), 'utf8');

describe('P0 clinical and telehealth security invariants', () => {
  test('clinical privileges always come from canonical HCM grants, never membership fallbacks', async () => {
    const code = await source('server/auth/authorization-context.ts');
    expect(code).toContain('const clinicalPrivileges = hcmPrivileges;');
    expect(code).toContain('credentialsValid(credentials, Date.now())');
    expect(code).toContain("privilege.status!=='GRANTED'");
    expect(code).toContain("employee.employmentStatus!=='ACTIVE'");
    expect(code).not.toContain('membership.clinicalPrivileges || []');
    expect(code).not.toContain('credentialGatedRoleBaseline');
  });

  test('telehealth session PHI is server-only (also covered by Firestore emulator)', async () => {
    const rules = await source('firestore.rules');
    const block = rules.split('match /telehealthSessions/{sessionId} {')[1]?.split('}')[0] || '';
    expect(block).toContain('allow read, write: if false;');
    expect(block).not.toContain('canReadClinical');
  });

  test('patient signaling uses separate hashed room-scoped expiring join credentials', async () => {
    const signaling = await source('app/api/telehealth/signaling/route.ts');
    const capability = await source('lib/backend/security/telehealth-patient-capability.ts');
    const patient = await source('components/telehealth/TelehealthPatientJoin.tsx');
    const clinician = await source('components/telehealth/TelehealthCallPanel.tsx');
    const join = await source('app/telehealth/join/page.tsx');

    expect(signaling).toContain("randomBytes(32).toString('base64url')");
    expect(signaling).toContain("createHash('sha256').update(issuedPatientJoinToken)");
    expect(capability).toContain('timingSafeEqual(hash, expected)');
    expect(signaling).toContain('assertTelehealthPatientJoinToken(patientJoinToken, room.patientJoinTokenHash)');
    expect(signaling).toContain("['SIGN_CLINICAL_NOTES', 'UNRESTRICTED_CLINICAL_CHIEF']");
    expect(signaling).toContain('!assignedProviderId || assignedProviderId !== context.actorId');
    expect(clinician).toContain('setPatientJoinToken(startedRoom.patientJoinToken)');
    expect(patient).toContain("'x-ghims-patient-join-token': patientJoinToken");
    expect(patient).toContain('patientJoinToken,');
    expect(join).toContain("fragment.get('join')");
    expect(join).toContain("url.searchParams.get('join')");
    expect(join).toContain("window.history.replaceState");
  });

  test('Bun frozen-lockfile root manifest dependency ranges are exact', async () => {
    const pkg = JSON.parse(await source('package.json'));
    // bun.lock is JSONC; remove trailing commas for this structural assertion.
    const lock = JSON.parse((await source('bun.lock')).replace(/,\s*([}\]])/g, '$1'));
    expect(pkg.dependencies).toEqual(lock.workspaces[''].dependencies);
    expect(pkg.devDependencies).toEqual(lock.workspaces[''].devDependencies);
  });
});
