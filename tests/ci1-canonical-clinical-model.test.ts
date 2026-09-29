import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildCanonicalAllergy,
  buildCanonicalClinicalDocument,
  buildCanonicalCondition,
  buildCanonicalMedicationAdministration,
  buildCanonicalMedicationOrder,
  buildCanonicalVitalObservations,
} from '@/lib/clinical/canonical-fact-builders';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

describe('G-HIMS CI-1 canonical clinical model', () => {
  test('canonical model defines Patient 360 clinical fact primitives', async () => {
    const canonical = await source('types/clinical-canonical.ts');

    for (const typeName of [
      'CodeableConcept',
      'ClinicalProvenance',
      'ClinicalObservation',
      'ClinicalCondition',
      'ClinicalAllergy',
      'MedicationOrder',
      'MedicationDispense',
      'MedicationAdministration',
      'ClinicalProcedure',
      'DiagnosticOrder',
      'DiagnosticReport',
      'ClinicalDocument',
      'CarePlan',
      'PatientClinicalKnowledgeStatus',
    ]) {
      expect(canonical).toContain(`interface ${typeName}`);
    }

    expect(canonical).toContain("'KNOWN_NONE'");
    expect(canonical).toContain("'NOT_ASSESSED'");
    expect(canonical).toContain("'PATIENT_UNABLE_TO_REPORT'");
  });

  test('vitals normalize into machine-readable observations with LOINC and UCUM semantics', () => {
    const observations = buildCanonicalVitalObservations({
      tenantId: 'tenant-a',
      patientId: 'patient-a',
      encounterId: 'enc-a',
      sourceEvidenceId: 'ev-vitals-a',
      actorId: 'nurse-a',
      measuredAt: 1700000000000,
      heartRate: 88,
      bloodPressure: '122/78',
      temperature: 36.8,
      respiratoryRate: 16,
      oxygenSaturation: 98,
    });

    expect(observations.length).toBe(5);
    expect(observations.every((item) => item.patientId === 'patient-a')).toBe(true);
    expect(observations.every((item) => item.sourceEvidenceId === 'ev-vitals-a')).toBe(true);

    const heartRate = observations.find((item) =>
      item.code.codings.some((coding) => coding.code === '8867-4')
    );
    expect(heartRate).toBeTruthy();
    expect(heartRate?.value.valueType).toBe('QUANTITY');

    const bp = observations.find((item) =>
      item.code.codings.some((coding) => coding.code === '85354-9')
    );
    expect(bp?.value.valueType).toBe('COMPONENTS');
  });

  test('canonical provenance binds facts to source evidence and actor', () => {
    const doc = buildCanonicalClinicalDocument({
      tenantId: 'tenant-a',
      patientId: 'patient-a',
      encounterId: 'enc-a',
      sourceEvidenceId: 'ev-note-a',
      actorId: 'doctor-a',
      category: 'SOAP',
      content: 'Reviewed and signed clinical note.',
      signedAt: 1700000000100,
      sourceDraftId: 'draft-a',
    });

    expect(doc.sourceEvidenceId).toBe('ev-note-a');
    expect(doc.provenance.sourceEvidenceId).toBe('ev-note-a');
    expect(doc.provenance.recordedBy).toBe('doctor-a');
    expect(doc.provenance.aiDraftId).toBe('draft-a');
    expect(doc.status).toBe('FINAL');
  });

  test('conditions and allergies are first-class facts rather than string arrays', () => {
    const condition = buildCanonicalCondition({
      tenantId: 'tenant-a',
      patientId: 'patient-a',
      encounterId: 'enc-a',
      conditionId: 'cond-a',
      actorId: 'doctor-a',
      code: 'E11.9',
      display: 'Type 2 diabetes mellitus',
      codingSystem: 'ICD10',
      category: 'CHRONIC',
      recordedAt: 1700000000200,
    });

    const allergy = buildCanonicalAllergy({
      tenantId: 'tenant-a',
      patientId: 'patient-a',
      encounterId: 'enc-a',
      allergyId: 'allergy-a',
      actorId: 'doctor-a',
      substanceCode: 'AMOX',
      substanceDisplay: 'Amoxicillin',
      category: 'MEDICATION',
      criticality: 'HIGH',
      reactionText: 'Anaphylaxis',
      reactionSeverity: 'SEVERE',
      recordedAt: 1700000000300,
    });

    expect(condition.verificationStatus).toBe('CONFIRMED');
    expect(condition.code.codings[0].system).toBe('ICD10');
    expect(allergy.criticality).toBe('HIGH');
    expect(allergy.reactions[0].severity).toBe('SEVERE');
  });

  test('medication order and administration keep prescribed and administered concepts separate', () => {
    const order = buildCanonicalMedicationOrder({
      tenantId: 'tenant-a',
      patientId: 'patient-a',
      encounterId: 'enc-a',
      prescriptionId: 'rx-a',
      actorId: 'doctor-a',
      drugCode: 'PARA500',
      drugName: 'Paracetamol 500 mg',
      dosage: '500 mg',
      route: 'PO',
      frequency: 'BID',
      durationDays: 3,
      quantityPrescribed: 6,
      authoredAt: 1700000000400,
    });

    const administration = buildCanonicalMedicationAdministration({
      tenantId: 'tenant-a',
      patientId: 'patient-a',
      encounterId: 'enc-a',
      administrationId: 'medadm-a',
      actorId: 'nurse-a',
      medicationOrderId: order.medicationOrderId,
      medicationCode: 'PARA500',
      medicationName: 'Paracetamol 500 mg',
      doseText: '500 mg',
      route: 'PO',
      status: 'GIVEN',
      administeredAt: 1700000000500,
    });

    expect(order.status).toBe('ACTIVE');
    expect(administration.status).toBe('COMPLETED');
    expect(administration.medicationOrderId).toBe(order.medicationOrderId);
  });

  test('authoritative services dual-write canonical facts in the same domain mutation', async () => {
    const docs = await source('lib/backend/services/clinical-documentation-domain-service.ts');
    const orders = await source('lib/backend/services/clinical-order-domain-service.ts');
    const inpatient = await source('lib/backend/services/inpatient-clinical-domain-service.ts');
    const tx = await source('lib/backend/transactions/transaction-manager.ts');

    expect(docs).toContain("entityType: 'CLINICAL_OBSERVATION'");
    expect(docs).toContain("entityType: 'CLINICAL_DOCUMENT'");
    expect(orders).toContain("entityType: 'CANONICAL_DIAGNOSTIC_ORDER'");
    expect(orders).toContain("entityType: 'MEDICATION_ORDER'");
    expect(orders).toContain("entityType: 'MEDICATION_DISPENSE'");
    expect(inpatient).toContain("entityType: 'CANONICAL_MEDICATION_ADMINISTRATION'");

    for (const collection of [
      "'clinicalObservations'",
      "'clinicalDocuments'",
      "'clinicalConditions'",
      "'clinicalAllergies'",
      "'medicationOrders'",
      "'medicationDispenses'",
      "'canonicalMedicationAdministrations'",
      "'canonicalDiagnosticOrders'",
      "'diagnosticReports'",
      "'carePlans'",
    ]) {
      expect(tx).toContain(collection);
    }
  });

  test('condition and allergy writes are governed CommandBus operations', async () => {
    const docs = await source('lib/backend/services/clinical-documentation-domain-service.ts');
    const bus = await source('lib/backend/commands/command-bus.ts');

    expect(docs).toContain('recordClinicalCondition');
    expect(docs).toContain('recordClinicalAllergy');
    expect(docs).toContain('validatePatientEncounter');
    expect(docs).toContain("entityType: 'CLINICAL_CONDITION'");
    expect(docs).toContain("entityType: 'CLINICAL_ALLERGY'");
    expect(bus).toContain("'RecordClinicalConditionCommand'");
    expect(bus).toContain("'RecordClinicalAllergyCommand'");
  });
});
