import { describe, expect, test } from 'bun:test';
import { reconstructDemoClinicalContext, type DemoObservation } from '@/lib/clinical/intelligence/demo-case-reconstruction';
import type { Patient360Projection } from '@/types/patient360-projection';

// Minimal explicit synthetic fixture for the deterministic, non-diagnostic
// context assembler. This is a source-contract test, not clinical validation.
function fixture(): Patient360Projection {
  return {
    tenantId: 'central-metro-hospital', patientId: 'demo-ci-patient-001',
    identity: { patientId: 'demo-ci-patient-001', mrn: 'CI-DEMO-001', fullName: 'Amina Shah (Synthetic)' },
    projectionVersion: 6, revision: 10, timelineReady: true,
    sourceCheckpoint: '1791276300000:demo-ci-event-10',
    recentEncounters: [
      { encounterId: 'demo-ci-opd-current', encounterType: 'OPD', careSetting: 'OPD', status: 'ACTIVE', startedAt: 1791275400000 },
      { encounterId: 'demo-ci-opd-prior', encounterType: 'OPD', careSetting: 'OPD', status: 'COMPLETED', startedAt: 1780909200000 },
    ],
    activeProblems: [
      { conditionId: 'demo-ci-cond-htn', display: 'Hypertension', category: 'CHRONIC', clinicalStatus: 'ACTIVE', verificationStatus: 'CONFIRMED' },
    ],
    allergies: [
      { allergyId: 'demo-ci-allergy-pen', substance: 'Penicillin', category: 'MEDICATION', criticality: 'HIGH', verificationStatus: 'CONFIRMED' },
    ],
    currentMedications: [
      { medicationOrderId: 'demo-ci-med-lisinopril', medication: 'Lisinopril 20 mg', status: 'ACTIVE', dosageText: '20 mg once daily', prescribedBy: 'demo.doctor@example.invalid', authoredAt: 1789470000000 },
    ],
    latestVitals: [
      { observationId: 'demo-ci-bp-current', display: 'Blood pressure', category: 'VITAL_SIGNS', status: 'FINAL',
        effectiveAt: 1791276300000, value: { valueType: 'STRING', value: 'See components' } },
    ],
    recentDocuments: [
      { clinicalDocumentId: 'demo-ci-doc-prior', title: 'Prior outpatient follow-up', documentType: 'SOAP',
        status: 'FINAL', signedBy: 'demo.doctor@example.invalid', signedAt: 1780911300000 },
    ],
    recentResults: [], recentDiagnosticOrders: [], recentProcedures: [], activeCarePlans: [],
    recentDiseaseIntakes: [], recentMedicationAdministrations: [], recentSpecialtyActivities: [], resolvedProblems: [],
    careContexts: { activeOpdEncounters: [], activeTelehealthEncounters: [] },
    dataQuality: {
      allergyKnowledge: 'KNOWN', problemListKnowledge: 'KNOWN', medicationKnowledge: 'KNOWN',
      hasUnverifiedAllergies: false, hasUnverifiedProblems: false, hasPreliminaryResults: false,
      missingCanonicalFacts: [],
    },
    counts: {
      encounters: 2, conditions: 1, allergies: 1, medicationOrders: 1, observations: 4,
      diagnosticOrders: 1, diagnosticReports: 1, procedures: 0, carePlans: 0, documents: 1,
      diseaseIntakes: 0, medicationAdministrations: 0, specialtyActivities: 0,
    },
    sourceFingerprint: 'synthetic-test-source', contentHash: 'synthetic-test-content',
    projectedAt: 1791276300000,
  } as Patient360Projection;
}
const labs: DemoObservation[] = [
  { observationId: 'demo-ci-creatinine-old', sourceEvidenceId: 'demo-ci-creatinine-old', sourceType: 'LAB_SYSTEM',
    display: 'Creatinine', value: 0.9, unit: 'mg/dL', loincCode: '2160-0', status: 'FINAL', effectiveAt: 1789891200000 },
  { observationId: 'demo-ci-creatinine-new', sourceEvidenceId: 'demo-ci-creatinine-new', sourceType: 'LAB_SYSTEM',
    display: 'Creatinine', value: 1.5, unit: 'mg/dL', loincCode: '2160-0', status: 'FINAL', effectiveAt: 1791091200000 },
  { observationId: 'demo-ci-potassium-new', sourceEvidenceId: 'demo-ci-potassium-new', sourceType: 'LAB_SYSTEM',
    display: 'Potassium', value: 5.6, unit: 'mmol/L', loincCode: '2823-3', status: 'FINAL', effectiveAt: 1791091200000 },
];

describe('synthetic clinical-context reconstruction contracts', () => {
  test('groups canonical evidence by original record category and builds chronology', () => {
    const x = reconstructDemoClinicalContext(fixture(), labs);
    expect(x.sourceGroups.map(g => g.id)).toEqual([
      'encounters', 'problems', 'medications', 'laboratory', 'observations',
    ]);
    expect(x.sourceGroups.find(g => g.id === 'laboratory')?.facts.map(f => f.evidenceId))
      .toEqual(['demo-ci-creatinine-old', 'demo-ci-creatinine-new', 'demo-ci-potassium-new']);
    expect(x.chronology.length).toBeGreaterThan(3);
    expect(x.chronology.every((item, i) =>
      i === 0 || (item.recordedAt || 0) >= (x.chronology[i - 1].recordedAt || 0))).toBe(true);
    expect(x.observationsCompared?.arithmeticDelta).toBe(0.6);
    expect(x.observationsCompared?.unit).toBe('mg/dL');
    expect(x.projectionCheckpoint).toContain('demo-ci-event-10');
  });

  test('prepares a non-authoritative, source-cited encounter brief without invented claims', () => {
    const x = reconstructDemoClinicalContext(fixture(), labs);
    expect(x.encounterBrief.length).toBeGreaterThanOrEqual(3);
    expect(x.encounterBrief.every(item => item.evidenceRefs.length > 0)).toBe(true);
    expect(x.encounterBrief.find(item => item.id === 'lab-comparison')?.evidenceRefs)
      .toEqual([
        'clinicalObservations/demo-ci-creatinine-old',
        'clinicalObservations/demo-ci-creatinine-new',
      ]);
    expect(x.encounterBrief.find(item => item.id === 'medication-orders')?.statement)
      .toContain('Administration and adherence are not established');
    const statements = x.encounterBrief.map(item => item.statement).join(' ');
    expect(statements).not.toContain('acute kidney injury');
    expect(statements).not.toContain('urgent treatment');
    expect(statements).not.toContain('diagnosed');
  });

  test('does not equate prescriptions with actual administrations or arithmetic with diagnosis', () => {
    const x = reconstructDemoClinicalContext(fixture(), labs);
    expect(x.reviewGaps.some(g => g.id === 'admin-not-documented')).toBe(true);
    expect(x.reviewGaps.some(g => g.id === 'clinical-meaning' &&
      g.classification === 'CLINICIAN_INTERPRETATION_REQUIRED')).toBe(true);
    expect(x.reviewGaps.some(g => g.id === 'external-source' &&
      g.classification === 'NOT_VERIFIED')).toBe(true);
  });

  test('uses canonical unknown and missing facts; absence never becomes normal', () => {
    const p = fixture();
    p.dataQuality.allergyKnowledge = 'UNKNOWN';
    p.dataQuality.missingCanonicalFacts = ['Medication adherence not recorded'];
    const x = reconstructDemoClinicalContext(p, labs);
    expect(x.reviewGaps.some(g => g.classification === 'NOT_VERIFIED' &&
      g.label.includes('Allergy'))).toBe(true);
    expect(x.reviewGaps.some(g => g.label === 'Medication adherence not recorded' &&
      g.classification === 'NOT_DOCUMENTED')).toBe(true);
  });

  test('rejects cross-tenant and stale or incomplete projections', () => {
    expect(() => reconstructDemoClinicalContext({ ...fixture(), tenantId: 'foreign-tenant' }, labs)).toThrow();
    expect(() => reconstructDemoClinicalContext({ ...fixture(), timelineReady: false }, labs)).toThrow();
    expect(() => reconstructDemoClinicalContext({ ...fixture(), projectionVersion: 5 }, labs)).toThrow();
  });

  test('rejects forged source IDs, non-final labs and nonnumeric measurements', () => {
    expect(() => reconstructDemoClinicalContext(fixture(), labs.slice(1))).toThrow();
    expect(() => reconstructDemoClinicalContext(fixture(), [
      { ...labs[0], sourceEvidenceId: 'wrong-record' }, labs[1], labs[2],
    ])).toThrow();
    expect(() => reconstructDemoClinicalContext(fixture(), [
      labs[0], { ...labs[1], status: 'PRELIMINARY' }, labs[2],
    ])).toThrow();
    expect(() => reconstructDemoClinicalContext(fixture(), [
      labs[0], labs[1], { ...labs[2], value: Number.NaN },
    ])).toThrow();
  });

  test('no mathematical trend if two creatinine dates cannot be ordered', () => {
    const x = reconstructDemoClinicalContext(fixture(), [
      labs[0], { ...labs[1], effectiveAt: labs[0].effectiveAt }, labs[2],
    ]);
    expect(x.observationsCompared).toBeNull();
  });
});
