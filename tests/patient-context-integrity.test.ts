import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyPatientContextIdentity } from '@/lib/clinical/patient-context-integrity';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('PCI — Patient Context Integrity Closure', () => {
  test('hospital context exposes encounter-bound clinical identity with a monotonic revision', async () => {
    const hospital = await source('lib/context/hospital-context.tsx');

    expect(hospital).toContain('export interface ClinicalContextBinding');
    expect(hospital).toContain('encounterId: string;');
    expect(hospital).toContain('patientId: string;');
    expect(hospital).toContain('patientMrn: string;');
    expect(hospital).toContain("status: 'VERIFIED' | 'UNRESOLVED' | 'MISMATCH';");
    expect(hospital).toContain('contextRevision: number;');
    expect(hospital).toContain('bindClinicalEncounter');
    expect(hospital).toContain('clinicalContextRevisionRef.current += 1');
    expect(hospital).toContain('setClinicalContext(next)');
    expect(hospital).toContain('setSelectedPatientId(patientId)');
    expect(hospital).toContain("shellPatient.mrn !== patientMrn");
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
    expect(opd).toContain('verifyPatientContextIdentity');
    expect(opd).toContain('patientContextVerification');
    expect(opd).toContain('patientContextReady');
    expect(opd).toContain('PatientContextSafetyBlock');
  });

  test('pure verifier reproduces and blocks the exact wrong-patient screenshot class', () => {
    const patientA = { id: 'patient-a', mrn: 'MRN-A' };
    const encounterB = {
      id: 'encounter-b',
      tenantId: 'tenant-1',
      patientId: 'patient-b',
      mrn: 'MRN-B',
    };
    const patientB = { id: 'patient-b', mrn: 'MRN-B' };
    const staleHeaderContext = {
      tenantId: 'tenant-1',
      encounterId: 'encounter-a',
      patientId: patientA.id,
      patientMrn: patientA.mrn,
      status: 'VERIFIED' as const,
    };

    const result = verifyPatientContextIdentity({
      tenantId: 'tenant-1',
      encounter: encounterB,
      patient: patientB,
      context: staleHeaderContext,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('PATIENT_CONTEXT_MISMATCH');
    }
  });

  test('pure verifier accepts only one encounter/patient/MRN/tenant identity', () => {
    const result = verifyPatientContextIdentity({
      tenantId: 'tenant-1',
      encounter: {
        id: 'encounter-1',
        tenantId: 'tenant-1',
        patientId: 'patient-1',
        mrn: 'MRN-1',
      },
      patient: { id: 'patient-1', mrn: 'MRN-1' },
      context: {
        tenantId: 'tenant-1',
        encounterId: 'encounter-1',
        patientId: 'patient-1',
        patientMrn: 'MRN-1',
        status: 'VERIFIED',
      },
    });

    expect(result).toEqual({ ok: true });
  });

  test('pure verifier rejects same patient ID with a different MRN', () => {
    const result = verifyPatientContextIdentity({
      tenantId: 'tenant-1',
      encounter: {
        id: 'encounter-1',
        tenantId: 'tenant-1',
        patientId: 'patient-1',
        mrn: 'MRN-CANONICAL',
      },
      patient: { id: 'patient-1', mrn: 'MRN-STALE' },
      context: null,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('PATIENT_CONTEXT_MISMATCH');
    }
  });

  test('consultation desk never substitutes the first queue token or patient', async () => {
    const desk = await source('components/views/opd-encounters-view.tsx');

    expect(desk).not.toContain('opdQueue.find(t => t.id === selectedTokenId) || opdQueue[0]');
    expect(desk).not.toContain('patients.find(p => p.id === selectedToken?.patientId) || patients[0]');
    expect(desk).toContain("source: 'OPD_CONSULTATION_DESK'");
    expect(desk).toContain('patientContextReady');
    expect(desk).toContain('PATIENT_CONTEXT_MISMATCH');
  });

  test('patient-bound editors remount when the encounter changes', async () => {
    const opd = await source('components/opd/OpdMasterWorkspace.tsx');
    const desk = await source('components/views/opd-encounters-view.tsx');

    expect(opd).toContain("key={\`consultation:\${activeEncounter.id}:\${activeEncounter.patientId}\`}");
    expect(opd).toContain("key={\`triage:\${activeEncounter.id}:\${activeEncounter.patientId}\`}");
    expect(opd).toContain("key={\`pharmacy:\${activeEncounter.id}:\${activeEncounter.patientId}\`}");
    expect(desk).toContain("Clear every transient clinical draft when the encounter changes");
    expect(desk).toContain("}, [selectedTokenId]);");
  });

  test('offline OPD queue projection preserves authoritative encounter identity', async () => {
    const adapter = await source('lib/offline/read-model-adapter.ts');

    expect(adapter).toContain("encounterId: asString((raw as any).encounterId) || undefined");
  });

  test('clinical shell resolves patient identity from encounter context, never browsing selection', async () => {
    const shell = await source(
      'components/navigation/hospital-operational-context-bar.tsx'
    );

    expect(shell).toContain("clinicalContext?.status === 'VERIFIED'");
    expect(shell).toContain('clinicalContext.patientId');
    expect(shell).toContain('PATIENT_CONTEXT_UNRESOLVED');
    expect(shell).toContain('PATIENT_CONTEXT_MISMATCH');
    expect(shell).toContain("clinicalContext?.status === 'VERIFIED'");
    expect(shell).toContain("clinicalContextActive");
  });

  test('command bus rejects wrong-patient lineage before idempotency reservation', async () => {
    const bus = await source('lib/backend/commands/command-bus.ts');
    const guard = await source(
      'lib/backend/commands/patient-context-integrity-guard.ts'
    );

    expect(bus).toContain('PatientContextIntegrityGuard.verify(context, command)');
    expect(bus.indexOf('PatientContextIntegrityGuard.verify(context, command)')).toBeLessThan(
      bus.indexOf('IdempotencyService.acquireExecution')
    );
    expect(guard).toContain("code: 'PATIENT_CONTEXT_MISMATCH'");
    expect(guard).toContain('normalize(encounter.patientId) !== patientId');
    expect(guard).toContain('PATIENT_CONTEXT_AUTHORITY_UNAVAILABLE');
    expect(guard).toContain('isProductionLikeRuntime()');
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
