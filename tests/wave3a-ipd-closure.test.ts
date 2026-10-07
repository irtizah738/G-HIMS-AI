import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Patient360Projector } from '@/lib/clinical/patient360/patient360-projector';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('Wave 3A IPD closure', () => {
  test('OPD to IPD admission creates immutable evidence-linked continuity', async () => {
    const service = await source(
      'lib/backend/services/care-transition-domain-service.ts'
    );

    expect(service).toContain("'ADMISSION_PATIENT360_CONTEXT_REQUIRED'");
    expect(service).toContain("'CARE_TRANSITION_EVIDENCE'");
    expect(service).toContain("'OPD_TO_IPD_ADMISSION'");
    expect(service).toContain("'DIRECT_IPD_ADMISSION'");
    expect(service).toContain('admissionTransitionEvidenceId');
    expect(service).toContain('patient360Revision: transitionPatient360?.revision');
    expect(service).toContain(
      'patient360SourceCheckpoint: transitionPatient360?.sourceCheckpoint'
    );
    expect(service).toContain(
      "sourceArtifactType: 'OTHER'"
    );
    expect(service).toContain(
      'careTransitionEvidence: admissionTransitionEvidence'
    );
  });

  test('inpatient discharge persists the authoritative resolved discharge evidence chain', async () => {
    const service = await source(
      'lib/backend/services/care-transition-domain-service.ts'
    );

    expect(service).toContain('resolvedDischargeSummaryEvidenceId');
    expect(service).toContain(
      "'DISCHARGE_SUMMARY_EVIDENCE_ID_REQUIRED'"
    );
    expect(service).toContain(
      'resolvedMedicationReconciliationEvidenceId'
    );
    expect(service).toContain(
      "'MEDICATION_RECONCILIATION_EVIDENCE_ID_REQUIRED'"
    );
    expect(service).toContain('currentReadinessReview');
    expect(service).toContain(
      "'DISCHARGE_READINESS_REVIEW_ID_REQUIRED'"
    );
    expect(service).toContain("'IPD_DISCHARGE'");
    expect(service).toContain('dischargeTransitionEvidenceId');
    expect(service).toContain(
      'dischargeSummaryEvidenceId: resolvedDischargeSummaryEvidenceId'
    );
    expect(service).toContain(
      'dischargeReadinessEvaluationId: readiness.evaluationId'
    );
    expect(service).toContain('dischargeReadinessReviewId');
    expect(service).toContain('patient360Revision: patient360.revision');
    expect(service).toContain(
      'patient360SourceCheckpoint: patient360.sourceCheckpoint'
    );
    expect(service).not.toContain(
      'dischargeSummaryEvidenceId: payload.dischargeSummaryEvidenceId'
    );
  });

  test('care transition evidence is a server-only immutable aggregate', async () => {
    const [tx, rules] = await Promise.all([
      source('lib/backend/transactions/transaction-manager.ts'),
      source('firestore.rules'),
    ]);

    expect(tx).toContain(
      "CARE_TRANSITION_EVIDENCE: 'careTransitionEvidence'"
    );
    expect(rules).toContain(
      'match /careTransitionEvidence/{careTransitionEvidenceId}'
    );

    const ruleStart = rules.indexOf(
      'match /careTransitionEvidence/{careTransitionEvidenceId}'
    );
    expect(ruleStart).toBeGreaterThan(-1);
    expect(rules.slice(ruleStart, ruleStart + 180)).toContain(
      'allow read, write: if false'
    );
  });

  test('Patient 360 v6 exposes the full encounter transition lineage', () => {
    const { projection, timeline } = Patient360Projector.project(
      {
        tenantId: 'tenant-wave3a',
        patient: {
          id: 'pat-wave3a',
          mrn: 'MRN-W3A',
          fullName: 'Wave 3A Patient',
        },
        encounters: [
          {
            encounterId: 'enc-opd',
            patientId: 'pat-wave3a',
            encounterType: 'OPD',
            status: 'TRANSFERRED',
            linkedEncounterId: 'enc-ipd',
            completedAt: 100,
          },
          {
            encounterId: 'enc-ipd',
            patientId: 'pat-wave3a',
            encounterType: 'IPD',
            status: 'DISCHARGED',
            sourceEncounterId: 'enc-opd',
            admissionTransitionEvidenceId: 'care-transition-admit',
            dischargeTransitionEvidenceId: 'care-transition-discharge',
            dischargeSummaryEvidenceId: 'summary-evidence',
            disposition: 'HOME_OR_SELF_CARE',
            dischargedAt: 300,
            completedAt: 300,
          },
        ],
        conditions: [],
        allergies: [],
        medicationOrders: [],
        observations: [],
        diagnosticOrders: [],
        diagnosticReports: [],
        procedures: [],
        carePlans: [],
        documents: [],
        diseaseIntakeArtifacts: [],
        events: [
          {
            eventId: 'evt-admit',
            eventType: 'INPATIENT_ADMISSION_CREATED',
            aggregateType: 'ENCOUNTER',
            aggregateId: 'enc-ipd',
            occurredAt: 200,
            recordedAt: 200,
            payload: {
              patientId: 'pat-wave3a',
              encounterId: 'enc-ipd',
              sourceEncounterId: 'enc-opd',
              admissionTransitionEvidenceId: 'care-transition-admit',
            },
          },
          {
            eventId: 'evt-discharge',
            eventType: 'INPATIENT_ENCOUNTER_DISCHARGED',
            aggregateType: 'ENCOUNTER',
            aggregateId: 'enc-ipd',
            occurredAt: 300,
            recordedAt: 300,
            payload: {
              patientId: 'pat-wave3a',
              encounterId: 'enc-ipd',
              dischargeTransitionEvidenceId: 'care-transition-discharge',
              dischargeSummaryEvidenceId: 'summary-evidence',
            },
          },
        ],
      },
      400
    );

    expect(projection.projectionVersion).toBe(6);
    const ipd = projection.recentEncounters.find(
      (item) => item.encounterId === 'enc-ipd'
    );
    const opd = projection.recentEncounters.find(
      (item) => item.encounterId === 'enc-opd'
    );

    expect(opd?.linkedEncounterId).toBe('enc-ipd');
    expect(ipd?.sourceEncounterId).toBe('enc-opd');
    expect(ipd?.admissionTransitionEvidenceId).toBe(
      'care-transition-admit'
    );
    expect(ipd?.dischargeTransitionEvidenceId).toBe(
      'care-transition-discharge'
    );
    expect(ipd?.dischargeSummaryEvidenceId).toBe('summary-evidence');
    expect(ipd?.disposition).toBe('HOME_OR_SELF_CARE');
    expect(ipd?.dischargedAt).toBe(300);

    expect(
      timeline.some(
        (item) => item.summary === 'Patient admitted to inpatient care'
      )
    ).toBe(true);
    expect(
      timeline.some(
        (item) => item.summary === 'Inpatient discharge completed'
      )
    ).toBe(true);
  });

  test('legacy admission and discharge bypasses remain blocked', async () => {
    const [bus, encounter, architecture] = await Promise.all([
      source('lib/backend/commands/command-bus.ts'),
      source('lib/backend/services/encounter-domain-service.ts'),
      source('tests/clinical-workflow-architecture-contract.test.ts'),
    ]);

    expect(bus).toContain(
      'Inpatient admission must use AdmitPatientToInpatientCareCommand'
    );
    expect(bus).toContain(
      'Inpatient discharge must use DischargeInpatientEncounterCommand'
    );
    expect(encounter).toContain("'CARE_TRANSITION_COMMAND_REQUIRED'");
    expect(architecture).toContain(
      'governed inpatient discharge requires explicit disposition and follow-up'
    );
  });
});
