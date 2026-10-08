import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('PCI — Patient Context Integrity Closure', () => {
  test('hospital context exposes encounter-bound clinical identity with a monotonic revision', async () => {
    const hospital = await source('lib/context/hospital-context.tsx');

    expect(hospital).toContain('export interface ClinicalContextBinding');
    expect(hospital).toContain('encounterId: string;');
    expect(hospital).toContain('patientId: string;');
    expect(hospital).toContain('contextRevision: number;');
    expect(hospital).toContain('bindClinicalEncounter');
    expect(hospital).toContain('clinicalContextRevisionRef.current += 1');
    expect(hospital).toContain('setClinicalContext(next)');
    expect(hospital).toContain('setSelectedPatientId(patientId)');
  });

  test('hospital shell never invents the first patient after hydration', async () => {
    const hospital = await source('lib/context/hospital-context.tsx');

    expect(hospital).not.toContain("models.patients[0]?.id || null");
    expect(hospital).toContain(': null\n      );');
  });

  test('OPD master suite never silently falls back to the first encounter', async () => {
    const opd = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(opd).not.toContain('encounters.find((e) => e.id === selectedEncounterId) || encounters[0]');
    expect(opd).toContain("if (!selectedEncounterId) return undefined");
    expect(opd).toContain("Production never silently selects the first clinical encounter");
  });

  test('OPD master suite binds encounter to shell and blocks patient-bound tabs until verified', async () => {
    const opd = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(opd).toContain("source: 'OPD_MASTER'");
    expect(opd).toContain('patientIdentityMatchesEncounter');
    expect(opd).toContain('clinicalContextSynchronized');
    expect(opd).toContain('patientContextReady');
    expect(opd).toContain('PatientContextSafetyBlock');
    expect(opd).toContain("code={");
    expect(opd).toContain("'PATIENT_CONTEXT_MISMATCH'");
  });

  test('consultation desk never substitutes the first queue token or patient', async () => {
    const desk = await source('components/views/opd-encounters-view.tsx');

    expect(desk).not.toContain('opdQueue.find(t => t.id === selectedTokenId) || opdQueue[0]');
    expect(desk).not.toContain('patients.find(p => p.id === selectedToken?.patientId) || patients[0]');
    expect(desk).toContain("source: 'OPD_CONSULTATION_DESK'");
    expect(desk).toContain('patientContextReady');
    expect(desk).toContain('PATIENT_CONTEXT_MISMATCH');
  });

  test('offline OPD queue projection preserves authoritative encounter identity', async () => {
    const adapter = await source('lib/offline/read-model-adapter.ts');

    expect(adapter).toContain("encounterId: asString((raw as any).encounterId) || undefined");
  });

  test('clinical shell resolves patient identity from encounter context, never browsing selection', async () => {
    const shell = await source(
      'components/navigation/hospital-operational-context-bar.tsx'
    );

    expect(shell).toContain('clinicalContext?.patientId || null');
    expect(shell).toContain('PATIENT_CONTEXT_UNRESOLVED');
    expect(shell).toContain("clinicalContextActive");
  });

  test('server clinical documentation rejects encounter and patient lineage mismatch', async () => {
    const service = await source(
      'lib/backend/services/clinical-documentation-domain-service.ts'
    );

    expect(service).toContain('validatePatientEncounter');
    expect(service).toContain("String(encounter.patientId || '') !== patientId");
    expect(service).toContain("'ENCOUNTER_PATIENT_MISMATCH'");
  });
});
