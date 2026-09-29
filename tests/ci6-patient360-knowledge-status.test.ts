import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Patient360Projector } from '@/lib/clinical/patient360/patient360-projector';
import { PatientClinicalKnowledgeDomainService } from '@/lib/backend/services/patient-clinical-knowledge-domain-service';
import type { Patient360ProjectionSources } from '@/lib/clinical/patient360/patient360-projector';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

function emptySources(): Patient360ProjectionSources {
  return {
    tenantId: 'tenant-a',
    patient: {
      id: 'patient-a',
      patientId: 'patient-a',
      mrn: 'MRN-A',
      fullName: 'Synthetic Patient',
    },
    encounters: [],
    conditions: [],
    allergies: [],
    medicationOrders: [],
    observations: [],
    diagnosticReports: [],
    documents: [],
    events: [],
  };
}

describe('G-HIMS CI-6 Patient 360 clinical knowledge status', () => {
  test('domain records use independent document identities to avoid cross-domain lost updates', () => {
    expect(
      PatientClinicalKnowledgeDomainService.documentId('patient-a', 'ALLERGIES')
    ).toBe('patient-a__ALLERGIES');
    expect(
      PatientClinicalKnowledgeDomainService.documentId('patient-a', 'MEDICATIONS')
    ).toBe('patient-a__MEDICATIONS');
    expect(
      PatientClinicalKnowledgeDomainService.documentId('patient-a', 'PROBLEM_LIST')
    ).toBe('patient-a__PROBLEM_LIST');
  });

  test('zero facts default to NOT_ASSESSED, never inferred as known-none', () => {
    const { projection } = Patient360Projector.project(emptySources(), 1700000000000);

    expect(projection.dataQuality.allergyKnowledge).toBe('NOT_ASSESSED');
    expect(projection.dataQuality.problemListKnowledge).toBe('NOT_ASSESSED');
    expect(projection.dataQuality.medicationKnowledge).toBe('NOT_ASSESSED');
    expect(projection.dataQuality.missingCanonicalFacts).toContain(
      'ALLERGY_STATUS_NOT_ASSESSED'
    );
    expect(projection.dataQuality.missingCanonicalFacts).not.toContain(
      'ALLERGY_STATUS_UNKNOWN'
    );
  });

  test('explicit reviewed KNOWN_NONE survives an empty fact set', () => {
    const { projection } = Patient360Projector.project(
      {
        ...emptySources(),
        knowledgeStatus: {
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          allergyStatus: 'KNOWN_NONE',
          medicationStatus: 'KNOWN_NONE',
          problemListStatus: 'KNOWN_NONE',
          lastAllergyReviewAt: 1700000000100,
          lastMedicationReconciliationAt: 1700000000200,
          lastProblemListReviewAt: 1700000000300,
          updatedAt: 1700000000300,
        },
      },
      1700000000400
    );

    expect(projection.dataQuality.allergyKnowledge).toBe('KNOWN_NONE');
    expect(projection.dataQuality.problemListKnowledge).toBe('KNOWN_NONE');
    expect(projection.dataQuality.medicationKnowledge).toBe('KNOWN_NONE');
    expect(projection.dataQuality.missingCanonicalFacts).toHaveLength(0);
    expect(projection.dataQuality.lastAllergyReviewAt).toBe(1700000000100);
  });

  test('explicit unresolved states remain distinct in Patient 360', () => {
    const { projection } = Patient360Projector.project(
      {
        ...emptySources(),
        knowledgeStatus: {
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          allergyStatus: 'UNKNOWN',
          medicationStatus: 'PATIENT_UNABLE_TO_REPORT',
          problemListStatus: 'NOT_ASSESSED',
          updatedAt: 1700000000000,
        },
      },
      1700000000100
    );

    expect(projection.dataQuality.allergyKnowledge).toBe('UNKNOWN');
    expect(projection.dataQuality.problemListKnowledge).toBe('NOT_ASSESSED');
    expect(projection.dataQuality.medicationKnowledge).toBe(
      'PATIENT_UNABLE_TO_REPORT'
    );
    expect(projection.dataQuality.missingCanonicalFacts).toContain(
      'ALLERGY_STATUS_UNKNOWN'
    );
    expect(projection.dataQuality.missingCanonicalFacts).toContain(
      'PROBLEM_LIST_NOT_ASSESSED'
    );
    expect(projection.dataQuality.missingCanonicalFacts).toContain(
      'MEDICATION_HISTORY_PATIENT_UNABLE_TO_REPORT'
    );
  });

  test('real canonical facts override a stale KNOWN_NONE marker to prevent contradiction', () => {
    const sources = emptySources();
    const { projection } = Patient360Projector.project(
      {
        ...sources,
        allergies: [
          {
            allergyId: 'allergy-a',
            tenantId: 'tenant-a',
            patientId: 'patient-a',
            sourceEvidenceId: 'allergy-a',
            provenance: {
              provenanceId: 'prov-allergy-a',
              tenantId: 'tenant-a',
              patientId: 'patient-a',
              sourceEvidenceId: 'allergy-a',
              sourceType: 'CLINICIAN',
              recordedBy: 'doctor-a',
              recordedAt: 1700000000000,
            },
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
            version: 1,
            substance: {
              codings: [{ system: 'LOCAL', code: 'PEN', display: 'Penicillin' }],
              text: 'Penicillin',
            },
            type: 'ALLERGY',
            category: 'MEDICATION',
            clinicalStatus: 'ACTIVE',
            verificationStatus: 'CONFIRMED',
            criticality: 'HIGH',
            reactions: [],
            recordedAt: 1700000000000,
            recorderId: 'doctor-a',
          },
        ],
        knowledgeStatus: {
          tenantId: 'tenant-a',
          patientId: 'patient-a',
          allergyStatus: 'KNOWN_NONE',
          medicationStatus: 'NOT_ASSESSED',
          problemListStatus: 'NOT_ASSESSED',
          updatedAt: 1699999999000,
        },
      },
      1700000000100
    );

    expect(projection.allergies).toHaveLength(1);
    expect(projection.dataQuality.allergyKnowledge).toBe('KNOWN');
  });

  test('knowledge status is a governed CommandBus operation with patient and encounter validation', async () => {
    const service = await source(
      'lib/backend/services/patient-clinical-knowledge-domain-service.ts'
    );
    const bus = await source('lib/backend/commands/command-bus.ts');
    const tx = await source('lib/backend/transactions/transaction-manager.ts');

    expect(service).toContain('ReviewPatientClinicalKnowledgePayload');
    expect(service).toContain("'PATIENT_NOT_FOUND'");
    expect(service).toContain("'ENCOUNTER_PATIENT_MISMATCH'");
    expect(service).toContain("'PATIENT_CLINICAL_KNOWLEDGE_STATUS_UPDATED'");
    expect(service).toContain("domainDocumentId(patientId, domain)");
    expect(bus).toContain("'ReviewPatientClinicalKnowledgeCommand'");
    expect(bus).toContain('PatientClinicalKnowledgeDomainService.review');
    expect(tx).toContain(
      "PATIENT_CLINICAL_KNOWLEDGE_STATUS: 'patientClinicalKnowledgeStatus'"
    );
  });

  test('clinical fact creation atomically promotes the corresponding domain to KNOWN', async () => {
    const docs = await source(
      'lib/backend/services/clinical-documentation-domain-service.ts'
    );
    const orders = await source(
      'lib/backend/services/clinical-order-domain-service.ts'
    );

    expect(docs).toContain("domain: 'PROBLEM_LIST'");
    expect(docs).toContain("domain: 'ALLERGIES'");
    expect(docs).toContain("problemListKnowledgeStatus: 'KNOWN'");
    expect(docs).toContain("allergyKnowledgeStatus: 'KNOWN'");
    expect(docs).toContain("payload.reconciledMedicationIds.length > 0 ? 'KNOWN' : 'KNOWN_NONE'");
    expect(orders).toContain("domain: 'MEDICATIONS'");
    expect(orders).toContain("medicationKnowledgeStatus: 'KNOWN'");
  });

  test('projection service loads reviewed knowledge records and includes them in the deterministic source fingerprint', async () => {
    const service = await source(
      'lib/clinical/patient360/patient360-projection-service.ts'
    );
    const projector = await source(
      'lib/clinical/patient360/patient360-projector.ts'
    );

    expect(service).toContain(
      'PatientClinicalKnowledgeDomainService.getAggregate(tenantId, patientId)'
    );
    expect(service).toContain('knowledgeStatus,');
    expect(projector).toContain('knowledgeStatus: sources.knowledgeStatus || null');
    expect(projector).toContain("'PATIENT_CLINICAL_KNOWLEDGE_STATUS_UPDATED'");
  });

  test('clinician UI distinguishes reviewed none, unknown, not assessed and unable-to-report', async () => {
    const view = await source('components/patient360/Patient360View.tsx');

    expect(view).toContain("'KNOWN_NONE'");
    expect(view).toContain("'UNKNOWN'");
    expect(view).toContain("'NOT_ASSESSED'");
    expect(view).toContain("'PATIENT_UNABLE_TO_REPORT'");
    expect(view).toContain('reviewed: none known');
    expect(view).toContain('has not been assessed');
    expect(view).toContain('unable to report');
  });
});
