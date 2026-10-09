import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

describe('Wave 3D telehealth resilience and remote signing qualification', () => {
  test('telehealth has governed low-bandwidth and recovery commands', async () => {
    const service = await source('lib/backend/services/telehealth-domain-service.ts');
    expect(service).toContain('transitionConnectivity');
    expect(service).toContain("'AUDIO_ONLY'");
    expect(service).toContain("'TEXT_ONLY'");
    expect(service).toContain("'PAUSED_OFFLINE'");
    expect(service).toContain('TELEHEALTH_SESSION_RECOVERED');
    expect(service).toContain('TELEHEALTH_RECOVERY_VERSION_CONFLICT');
    expect(service).toContain('expectedPrimaryServerVersion:Number(session._serverVersion || 0)');
  });

  test('generic telehealth update cannot carry clinical content', async () => {
    const schemas = await source('lib/backend/commands/command-schema-registry.ts');
    const start = schemas.indexOf('UpdateTelehealthSessionCommand');
    const end = schemas.indexOf('TransitionTelehealthConnectivityCommand', start);
    const block = schemas.slice(start, end);
    expect(block).not.toContain('vitals:');
    expect(block).not.toContain('transcription:');
    expect(block).not.toContain('soapNote:');
    expect(block).not.toContain('isRecording');
  });

  test('completion requires signed evidence and atomically closes telehealth care context', async () => {
    const service = await source('lib/backend/services/telehealth-domain-service.ts');
    expect(service).toContain("entityType: 'ENCOUNTER_EVIDENCE'");
    expect(service).toContain('TELEHEALTH_SIGNED_EVIDENCE_REQUIRED');
    expect(service).toContain("String(signedEvidence.evidenceType || '') !== 'SIGNED_CLINICAL_NOTE'");
    expect(service).toContain('signedEvidenceId: payload.signedEvidenceId');
    expect(service).toContain("entityType: 'ENCOUNTER'");
    expect(service).toContain("entityType: 'PATIENT_MPI'");
    expect(service).toContain("closeCareContext(");
    expect(service).toContain("'TELEHEALTH'");
    expect(service).toContain("activeEncounterId: compatibilityEncounterId(nextCareContexts)");
  });

  test('visible telehealth surface contains no fabricated clinical or integration claims', async () => {
    const view = await source('components/views/telehealth-view.tsx');
    expect(view).not.toContain('generateFallbackSoap');
    expect(view).not.toContain('Surescripts');
    expect(view).not.toContain('HIPAA Certified');
    expect(view).not.toContain('BLE vitals');
    expect(view).not.toContain('NCPDP-SCRIPT');
    expect(view).toContain('Resume from authoritative state');
    expect(view).toContain('Sign note & complete encounter');
  });

  test('hospital completion signs evidence before finalizing telehealth', async () => {
    const context = await source('lib/context/hospital-context.tsx');
    expect(context).toContain("'SignClinicalNoteCommand'");
    expect(context).toContain("'CompleteTelehealthSessionCommand'");
    expect(context).toContain('signedEvidenceId: signed.entityId');
    expect(context).toContain('TELEHEALTH_ERX_INTEGRATION_NOT_LIVE');
  });
  test('unused encounter cancellation is wired to governed command validation and dispatch', async () => {
    const schemas = await source('lib/backend/commands/command-schema-registry.ts');
    const bus = await source('lib/backend/commands/command-bus.ts');
    const service = await source('lib/backend/services/telehealth-domain-service.ts');
    expect(schemas).toContain('CancelUnusedTelehealthEncounterCommand');
    expect(schemas).toContain('expectedUpdatedAt: nonEmpty.max(100)');
    expect(schemas).toContain('reason: z.string().trim().min(20).max(1000)');
    expect(bus).toContain('TelehealthDomainService.cancelUnused(');
    expect(service).toContain('TELEHEALTH_UNUSED_ENCOUNTER_CANCELLED');
    expect(service).toContain('TELEHEALTH_CANCELLATION_CLINICAL_ACTIVITY');
    expect(service).toContain("hasTelehealthClinicalActivity(session)");
    expect(service).toContain('TELEHEALTH_CANCELLATION_POINTER_MISMATCH');
    expect(service).toContain('emptyQueryGuards: [');
    expect(service).toContain("'telehealthSignaling'");
    expect(service).toContain("closeCareContext(");
    expect(service).toContain("auditMetadata: { disposition: 'UNUSED_NO_CARE', noClinicalDischarge: true }");
  });

  test('atomic transaction checks absent cross-domain references within its transaction', async () => {
    const tx = await source('lib/backend/transactions/transaction-manager.ts');
    expect(tx).toContain('emptyQueryGuards?: AtomicEmptyQueryGuard[]');
    expect(tx).toContain('await transaction.get(');
    expect(tx).toContain('tenantRef.collection(guard.collectionName)');
    expect(tx).toContain('DOMAIN_REFERENCED_STATE_PRESENT');
    expect(tx).toContain('getEphemeralCollectionForTesting(params.tenantId, guard.collectionName)');
  });

  test('legacy room link repair requires a zero-signaling, active, version-matched session', async () => {
    const service = await source('lib/backend/services/telehealth-domain-service.ts');
    const schema = await source('lib/backend/commands/command-schema-registry.ts');
    const signaling = await source('app/api/telehealth/signaling/route.ts');
    expect(schema).toContain('RepairTelehealthRoomTokenCommand');
    expect(service).toContain('TELEHEALTH_MEDIA_ROOM_TOKEN_REPAIRED');
    expect(service).toContain('TELEHEALTH_ROOM_REPAIR_VERSION_CONFLICT');
    expect(service).toContain("collectionName: 'telehealthSignaling'");
    expect(signaling).toContain('TELEHEALTH_MEDIA_ROOM_TOKEN_INVALID');
    expect(signaling).toContain('ROOM-[0-9A-F]{8}');
  });

  test('telehealth UI separates clinical signing, unused cancellation and legacy room repair', async () => {
    const view = await source('components/views/telehealth-view.tsx');
    const context = await source('lib/context/hospital-context.tsx');
    expect(view).toContain('telehealth-cancel-unused-encounter');
    expect(view).toContain('telehealth-repair-media-room');
    expect(view).toContain('Cancel unused encounter (audited)');
    expect(view).toContain("!['COMPLETED', 'CANCELLED'].includes(selected.status)");
    expect(context).toContain('CancelUnusedTelehealthEncounterCommand');
    expect(context).toContain('RepairTelehealthRoomTokenCommand');
  });

  test('retry preserves signing and completion idempotency keys to avoid duplicate notes', async () => {
    const context = await source('lib/context/hospital-context.tsx');
    expect(context).toContain('pendingTelehealthSigningRef');
    expect(context).toContain('pending.signedEvidenceId');
    expect(context).toContain('idempotencyKey: pending.signIdempotencyKey');
    expect(context).toContain('idempotencyKey: pending.completionIdempotencyKey');
    expect(context).toContain('TELEHEALTH_SIGNED_NOTE_PENDING_COMPLETION');
    expect(context).toContain('pendingTelehealthSigningRef.current.clear()');
  });

});
