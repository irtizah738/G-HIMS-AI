import { describe, expect, test } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertTelehealthPatientJoinToken } from '@/lib/backend/security/telehealth-patient-capability';

const source = (name: string) => readFileSync(name, 'utf8');

describe('Governed Telehealth TURN issuance and patient capability', () => {
  test('exact room-bound 256-bit token required; empty, tampered, revoked credentials fail', () => {
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    expect(() => assertTelehealthPatientJoinToken(token, hash)).not.toThrow();
    const other = randomBytes(32).toString('base64url');
    for (const [bad, hashValue] of [
      ['', hash], [other, hash], [token.slice(1), hash], [token, undefined],
      [token, createHash('sha256').update(other).digest('hex')],
    ] as Array<[string, string | undefined]>) {
      expect(() => assertTelehealthPatientJoinToken(bad, hashValue))
        .toThrow('TELEHEALTH_PATIENT_JOIN_TOKEN_INVALID');
    }
  });

  test('patient ICE endpoint checks independent token after room lease and before credential issuance', () => {
    const api = source('app/api/telehealth/ice-config/route.ts');
    const leaseCheck = api.indexOf('data?.active !== true');
    const verifyJoin = api.indexOf('assertTelehealthPatientJoinToken(patientJoinToken, data.patientJoinTokenHash)');
    const mint = api.indexOf('buildTelehealthIceConfiguration(roomToken)');
    expect(leaseCheck).toBeGreaterThan(-1);
    expect(verifyJoin).toBeGreaterThan(leaseCheck);
    expect(mint).toBeGreaterThan(verifyJoin);
    for (const check of [
      'data.expiresAt <= Date.now()', 'data.sessionId !== session.id',
      'data.encounterId !== session.encounterId', 'data.patientId !== session.patientId',
      "data.clinicianId !== String(encounter.data()?.assignedProviderId || '')",
      'deriveAuthoritativeContext(req, tenantId)', 'TELEHEALTH_CLINICIAN_ASSIGNMENT_MISMATCH',
      "'Cache-Control': 'no-store, private'",
    ]) expect(api).toContain(check);
    expect(api).not.toContain('NEXT_PUBLIC_GHIMS_WEBRTC_ICE_SERVERS_JSON');
  });

  test('clients preserve patient signaling and ICE capabilities with no browser TURN secret', () => {
    const client = source('lib/telehealth/ice-client.ts');
    const patient = source('components/telehealth/TelehealthPatientJoin.tsx');
    const clinician = source('components/telehealth/TelehealthCallPanel.tsx');
    const signaling = source('app/api/telehealth/signaling/route.ts');
    expect(client).toContain("role: 'PATIENT';");
    expect(client).toContain('patientJoinToken: string;');
    expect(patient).toContain("role: 'PATIENT', patientJoinToken");
    expect(patient).toContain("'x-ghims-patient-join-token': patientJoinToken");
    expect(clinician).toContain("role: 'CLINICIAN'");
    expect(clinician).toContain("await clinicianSignal('LEAVE').catch(() => {})");
    expect(clinician).toContain('setPatientJoinToken(null)');
    expect(signaling).toContain('assertTelehealthPatientJoinToken(patientJoinToken, room.patientJoinTokenHash)');
    expect(signaling).toContain('TELEHEALTH_SESSION_AMBIGUOUS');
    expect(signaling).toContain("['DOCTOR', 'CONSULTANT']");
    expect(signaling).not.toContain("['DOCTOR', 'CONSULTANT', 'NURSE']");
    for (const code of [client, patient, clinician]) {
      expect(code).not.toContain('GHIMS_WEBRTC_TURN_REST_SECRET');
      expect(code).not.toContain('NEXT_PUBLIC_GHIMS_WEBRTC_ICE_SERVERS_JSON');
    }
  });

  test('TURN credentials come only from server-side HMAC secret with bounded TTL', () => {
    const server = source('lib/backend/services/telehealth-ice-configuration.ts');
    expect(server).toContain("import 'server-only'");
    expect(server).toContain("createHmac('sha1', secret)");
    expect(server).toContain('Math.floor(Date.now() / 1000) + 3600');
    expect(server).toContain('GHIMS_WEBRTC_TURN_REST_SECRET');
    expect(server).toContain('GHIMS_WEBRTC_TURN_URLS_JSON');
  });
});
