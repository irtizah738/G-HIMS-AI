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

  test('completion requires same-encounter signed evidence', async () => {
    const service = await source('lib/backend/services/telehealth-domain-service.ts');
    expect(service).toContain("'encounterEvidence'");
    expect(service).toContain("'TELEHEALTH_SIGNED_EVIDENCE_REQUIRED'");
    expect(service).toContain("String(signedEvidence.evidenceType || '') !== 'SIGNED_CLINICAL_NOTE'");
    expect(service).toContain('signedEvidenceId:payload.signedEvidenceId');
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
});
