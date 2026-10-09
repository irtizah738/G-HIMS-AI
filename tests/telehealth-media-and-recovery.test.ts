import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const read = (p: string) => readFile(path.join(process.cwd(), p), 'utf8');

describe('Telehealth media authority and durable completion recovery', () => {
  test('TURN credentials are minted from server-only REST secret with TTL', async () => {
    const source = await read('lib/backend/services/telehealth-ice-configuration.ts');
    expect(source).toContain("import 'server-only'");
    expect(source).toContain("GHIMS_WEBRTC_TURN_REST_SECRET");
    expect(source).toContain("createHmac('sha1', secret)");
    expect(source).toContain("Math.floor(Date.now() / 1000) + 3600");
    expect(source).not.toContain("NEXT_PUBLIC_GHIMS_WEBRTC_ICE_SERVERS_JSON");
  });

  test('ICE API checks assigned clinician or active patient room capability', async () => {
    const source = await read('app/api/telehealth/ice-config/route.ts');
    expect(source).toContain('deriveAuthoritativeContext(req, tenantId)');
    expect(source).toContain('TELEHEALTH_CLINICIAN_ASSIGNMENT_MISMATCH');
    expect(source).toContain('TELEHEALTH_CALL_NOT_ACTIVE');
    expect(source).toContain("'Cache-Control': 'no-store, private'");
    expect(source).toContain("data?.sessionId !== session.id");
    expect(source).toContain('buildTelehealthIceConfiguration(roomToken)');
  });

  test('both WebRTC peers use scoped credentials and no embedded client secrets', async () => {
    const clinician = await read('components/telehealth/TelehealthCallPanel.tsx');
    const patient = await read('components/telehealth/TelehealthPatientJoin.tsx');
    for (const source of [clinician, patient]) {
      expect(source).toContain('loadTelehealthIceConfiguration');
      expect(source).toContain('new RTCPeerConnection({ iceServers: ice.iceServers })');
      expect(source).not.toContain('NEXT_PUBLIC_GHIMS_WEBRTC_ICE_SERVERS_JSON');
    }
    expect(clinician).toContain("role: 'CLINICIAN'");
    expect(patient).toContain("role: 'PATIENT'");
  });

  test('signing recovery examines authoritative final evidence without minting signatures', async () => {
    const status = await read('app/api/telehealth/signed-evidence/route.ts');
    const context = await read('lib/context/hospital-context.tsx');
    expect(status).toContain("where('encounterId', '==', session.encounterId).limit(101)");
    expect(status).toContain('TELEHEALTH_SIGNED_EVIDENCE_REVIEW_REQUIRED');
    expect(status).toContain('doc.data().signedBy !== context.actorId');
    expect(context).toContain("'/api/telehealth/signed-evidence'");
    expect(context).toContain('pending.signedEvidenceId = existing.signedEvidenceId');
    expect(context).toContain('pending.signIdempotencyKey');
    expect(context).toContain('pending.completionIdempotencyKey');
    const service = await read('lib/backend/services/telehealth-domain-service.ts');
    expect(service).toContain("String(signedEvidence.signedBy || '') !== context.actorId");
  });

  test('signing remains HCM privilege gated, with explicit auth refresh', async () => {
    const view = await read('components/views/telehealth-view.tsx');
    expect(view).toContain("hasPrivilege('SIGN_CLINICAL_NOTES')");
    expect(view).toContain('refreshAuth()');
    expect(view).toContain('disabled={busy || networkMode === \'offline\' || !canSignTelehealth || !assignedToMe}');
    expect(view).toContain('TELEHEALTH_SIGNED_EVIDENCE_REVIEW_REQUIRED');
  });
  test('scheduler cannot silently become a treating consultant', async () => {
    const service = await read('lib/backend/services/telehealth-domain-service.ts');
    const view = await read('components/views/telehealth-view.tsx');
    const schema = await read('lib/backend/commands/command-schema-registry.ts');
    const bus = await read('lib/backend/commands/command-bus.ts');
    expect(service).toContain('const clinicianCanSign = context.roles.some(role =>');
    expect(service).toContain('const initialAssignedProviderId = clinicianCanSign ? context.actorId');
    expect(service).toContain("requiredPrivilege: 'SIGN_CLINICAL_NOTES'");
    expect(service).toContain('TELEHEALTH_CONSULTATION_ACCEPTED');
    expect(service).toContain('TELEHEALTH_ALREADY_ASSIGNED');
    expect(schema).toContain('ClaimTelehealthEncounterCommand');
    expect(bus).toContain('TelehealthDomainService.claimEncounter(');
    expect(view).toContain('telehealth-accept-consultation');
    expect(view).toContain('assignedToMe');
    const signaling = await read('app/api/telehealth/signaling/route.ts');
    expect(signaling).toContain('!assignedProviderId || assignedProviderId !== context.actorId');
  });

});
