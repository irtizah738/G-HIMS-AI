import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCanonicalCondition } from '@/lib/clinical/canonical-fact-builders';
import { Patient360Projector } from '@/lib/clinical/patient360/patient360-projector';

async function source(path: string): Promise<string> {
  return readFile(join(process.cwd(), path), 'utf8');
}

describe('OPD-RP9 consultation and Patient 360 facts', () => {
  test('signed notes validate patient/encounter lineage before creating facts', async () => {
    const service = await source(
      'lib/backend/services/clinical-documentation-domain-service.ts'
    );

    expect(service).toContain('validatePatientEncounter(');
    expect(service).toContain("'ENCOUNTER_PATIENT_MISMATCH'");
    expect(service).toContain('normalizeSignedDiagnoses');
    expect(service).toContain("'INVALID_STRUCTURED_DIAGNOSES'");
  });

  test('clinician-selected diagnoses are canonical conditions in the same note transaction', async () => {
    const service = await source(
      'lib/backend/services/clinical-documentation-domain-service.ts'
    );

    expect(service).toContain("codingSystem: 'ICD10'");
    expect(service).toContain("category: 'ENCOUNTER_DIAGNOSIS'");
    expect(service).toContain('sourceEvidenceId: evidenceId');
    expect(service).toContain("entityType: 'CLINICAL_CONDITION'");
    expect(service).toContain('canonicalConditionIds');
    expect(service).not.toContain('AI_EXTRACTED');
  });

  test('nursing-note authority cannot create canonical diagnoses', async () => {
    const service = await source(
      'lib/backend/services/clinical-documentation-domain-service.ts'
    );

    expect(service).toContain("payload.category === 'NURSING'");
    expect(service).toContain("'DIAGNOSIS_AUTHORITY_REQUIRED'");
    expect(service).toContain(
      'Nursing-note authority cannot create canonical encounter diagnoses'
    );
  });

  test('structured diagnosis boundary rejects ambiguous role and verification semantics', async () => {
    const service = await source(
      'lib/backend/services/clinical-documentation-domain-service.ts'
    );

    expect(service).toContain("Unsupported structured diagnosis type");
    expect(service).toContain("Unsupported diagnosis verification status");
    expect(service).toContain("A signed consultation may contain at most one principal diagnosis.");
    expect(service).toContain("isPrincipal = record.isPrincipal === true || rawType === 'PRINCIPAL'");
  });

  test('Patient 360 UI separates encounter diagnoses from reconciled problem list', async () => {
    const view = await source('components/patient360/Patient360View.tsx');

    expect(view).toContain("item.category !== 'ENCOUNTER_DIAGNOSIS'");
    expect(view).toContain("item.category === 'ENCOUNTER_DIAGNOSIS'");
    expect(view).toContain('Longitudinal problem list');
    expect(view).toContain('Signed encounter diagnoses');
  });

  test('canonical encounter diagnosis preserves signed-note evidence lineage', () => {
    const condition = buildCanonicalCondition({
      tenantId: 'tenant-rp9',
      patientId: 'patient-rp9',
      encounterId: 'enc-rp9',
      conditionId: 'cond-note-dx-1',
      sourceEvidenceId: 'ev-note-rp9',
      actorId: 'clinician-rp9',
      code: 'I10',
      display: 'Essential (primary) hypertension',
      codingSystem: 'ICD10',
      category: 'ENCOUNTER_DIAGNOSIS',
      clinicalStatus: 'ACTIVE',
      verificationStatus: 'CONFIRMED',
      recordedAt: 1_760_000_000_000,
    });

    expect(condition.sourceEvidenceId).toBe('ev-note-rp9');
    expect(condition.provenance.sourceEvidenceId).toBe('ev-note-rp9');
    expect(condition.provenance.provenanceId).toBe('prov_cond-note-dx-1');
    expect(condition.code.codings[0]?.system).toBe('ICD10');
    expect(condition.code.codings[0]?.code).toBe('I10');
  });

  test('encounter diagnosis reaches Patient 360 without pretending problem list review occurred', () => {
    const diagnosis = buildCanonicalCondition({
      tenantId: 'tenant-rp9',
      patientId: 'patient-rp9',
      encounterId: 'enc-rp9',
      conditionId: 'cond-rp9',
      sourceEvidenceId: 'ev-note-rp9',
      actorId: 'clinician-rp9',
      code: 'J45.909',
      display: 'Unspecified asthma, uncomplicated',
      codingSystem: 'ICD10',
      category: 'ENCOUNTER_DIAGNOSIS',
      clinicalStatus: 'ACTIVE',
      verificationStatus: 'CONFIRMED',
      recordedAt: 1_760_000_000_000,
    });

    const projected = Patient360Projector.project(
      {
        tenantId: 'tenant-rp9',
        patient: {
          id: 'patient-rp9',
          patientId: 'patient-rp9',
          mrn: 'MRN-RP9',
          fullName: 'RP9 Patient',
        },
        encounters: [
          {
            encounterId: 'enc-rp9',
            patientId: 'patient-rp9',
            encounterType: 'OPD',
            status: 'ACTIVE',
            createdAt: 1_760_000_000_000,
          },
        ],
        conditions: [diagnosis],
        allergies: [],
        medicationOrders: [],
        observations: [],
        diagnosticReports: [],
        documents: [],
        events: [
          {
            eventId: 'evt-rp9',
            eventType: 'CLINICAL_NOTE_SIGNED',
            aggregateType: 'ENCOUNTER_EVIDENCE',
            aggregateId: 'ev-note-rp9',
            payload: {
              patientId: 'patient-rp9',
              encounterId: 'enc-rp9',
              canonicalConditionIds: ['cond-rp9'],
            },
            recordedAt: 1_760_000_000_001,
          },
        ],
      },
      1_760_000_000_100
    );

    expect(projected.projection.activeProblems).toHaveLength(1);
    expect(projected.projection.activeProblems[0]?.conditionId).toBe('cond-rp9');
    expect(projected.projection.activeProblems[0]?.category).toBe(
      'ENCOUNTER_DIAGNOSIS'
    );
    expect(projected.projection.dataQuality.problemListKnowledge).toBe(
      'NOT_ASSESSED'
    );
    expect(
      projected.projection.dataQuality.missingCanonicalFacts
    ).toContain('PROBLEM_LIST_NOT_ASSESSED');
  });
});
