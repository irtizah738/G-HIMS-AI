import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { ClinicalEncounterPreparationService } from '@/lib/clinical/intelligence/clinical-encounter-preparation-service';
import type {
  ClinicalEvidenceRef,
  ClinicalEvidenceSnapshot,
  ClinicalEvidenceSourceType,
} from '@/types/clinical-intelligence-evidence';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

function evidence(
  evidenceId: string,
  sourceType: ClinicalEvidenceSourceType,
  sourceEntityId: string,
  label: string,
  content: unknown,
  occurredAt?: number,
  eventVerified = true
): ClinicalEvidenceRef {
  return {
    evidenceId,
    tenantId: 'tenant-ci10c',
    patientId: 'patient-ci10c',
    sourceType,
    sourceEntityId,
    label,
    occurredAt,
    patient360Revision: 20,
    patient360SourceCheckpoint: '3000:evt-latest',
    sourceEventIds: eventVerified ? [`evt-${sourceEntityId}`] : [],
    sourceEventCount: eventVerified ? 1 : 0,
    sourceEventSetHash: `eventhash-${sourceEntityId}`,
    latestSourceEventId: eventVerified ? `evt-${sourceEntityId}` : undefined,
    provenanceStatus: eventVerified ? 'EVENT_VERIFIED' : 'PROJECTION_ONLY',
    content,
    contentHash: `contenthash-${sourceEntityId}`,
  };
}

function snapshot(): ClinicalEvidenceSnapshot {
  const refs: ClinicalEvidenceRef[] = [
    evidence('ev-context','ENCOUNTER_CONTEXT','enc-current','OPD encounter context',{
      encounter:{ encounterId:'enc-current', careSetting:'OPD', status:'ACTIVE', chiefComplaint:'Progressive dyspnea', startedAt:2000 },
      authoritativeEncounter:{ encounterId:'enc-current', patientId:'patient-ci10c', chiefComplaint:'Progressive dyspnea', startedAt:2000 },
      consultantRelationship:'PRIMARY_CONSULTANT',
      lastConsultantReviewAt:2200,
      lastConsultantReviewRevision:18,
    },2000),
    evidence('ev-condition','CONDITION','cond-hf','Heart failure',{
      display:'Heart failure', clinicalStatus:'ACTIVE', verificationStatus:'CONFIRMED'
    },1000),
    evidence('ev-change-med','CONSULTANT_CHANGE','chg-med','Medication changed',{
      category:'MEDICATIONS', severity:'REVIEW_REQUIRED', statement:'Furosemide was prescribed after the last review.', sourceEventIds:['evt-med']
    },2400),
    evidence('ev-change-critical','CONSULTANT_CHANGE','chg-critical','Critical result',{
      category:'DIAGNOSTICS', severity:'CRITICAL_REVIEW_REQUIRED', statement:'A critical potassium result requires review.', sourceEventIds:['evt-lab']
    },2500),
    evidence('ev-k','OBSERVATION_HISTORY','obs-k','Potassium',{
      status:'FINAL', effectiveAt:2500,
      value:{ valueType:'QUANTITY', quantity:{ value:6.2, unit:'mmol/L' } },
      interpretation:[{text:'CRITICAL'}]
    },2500),
    evidence('ev-order','DIAGNOSTIC_ORDER','order-rft','Renal function panel',{
      status:'ACTIVE', priority:'URGENT', orderedAt:2450
    },2450),
    evidence('ev-open','CLINICAL_OPEN_ITEM','open-1','Review critical potassium',{
      description:'Review and acknowledge critical potassium result',
      clinicalPriority:'CRITICAL_REVIEW_REQUIRED', status:'OPEN', category:'DIAGNOSTIC'
    },2510),
    evidence('ev-medsafe','MEDICATION_SAFETY_FINDING','medsafe-1','Medication reconciliation required',{
      type:'MEDICATION_RECONCILIATION_REQUIRED',
      severity:'ACTION_REQUIRED',
      description:'No medication reconciliation checkpoint exists after the current encounter began.',
      medicationOrderIds:['med-furosemide'],
      allergyIds:[],
    },2520,false),
    evidence('ev-med','MEDICATION_HISTORY','med-furosemide','Furosemide',{
      status:'ACTIVE', authoredAt:2400, dosageText:'40 mg daily'
    },2400),
    evidence('ev-knowledge','KNOWLEDGE_STATUS','patient-ci10c:knowledge-status','Knowledge status',{
      allergyKnowledge:'UNKNOWN',
      problemListKnowledge:'KNOWN',
      medicationKnowledge:'KNOWN',
      missingCanonicalFacts:['allergy verification'],
    },2300),
    evidence('ev-old-ipd','ENCOUNTER_HISTORY','enc-old-ipd','IPD',{
      careSetting:'IPD', status:'DISCHARGED', startedAt:500, completedAt:900
    },500),
    evidence('ev-det','DETERIORATION_FINDING','det-1','Physiology warning',{
      severity:'WARNING', explanation:'Recent physiology meets a deterministic watch rule.'
    },2550,false),
  ];

  return {
    snapshotId:'cisnap-ci10c',
    tenantId:'tenant-ci10c',
    patientId:'patient-ci10c',
    purpose:'ENCOUNTER_PREP',
    createdAt:3000,
    createdBy:'doctor-ci10c',
    immutable:true,
    schemaVersion:2,
    patient360ProjectionVersion:2,
    patient360Revision:20,
    patient360SourceCheckpoint:'3000:evt-latest',
    patient360ContentHash:'p360hash',
    evidenceRefs:refs,
    evidenceCount:refs.length,
    sourceEventCount:10,
    coverage:{
      encounterContext:{status:'COMPLETE',recordCount:1},
      consultantChanges:{status:'COMPLETE',recordCount:2},
      clinicalOpenItems:{status:'COMPLETE',recordCount:1},
      medicationSafety:{status:'COMPLETE',recordCount:1},
      deterioration:{status:'COMPLETE',recordCount:1},
      dischargeReadiness:{status:'NOT_INCLUDED',recordCount:0},
    },
    dateRange:{from:500,to:2550},
    snapshotHash:'snap-hash-ci10c',
    limitations:['Missing or incomplete source data must not be interpreted as clinical absence.'],
  };
}

describe('CI-10C encounter preparation intelligence', () => {
  test('builds a care-context-specific pre-consultation brief', () => {
    const brief = ClinicalEncounterPreparationService.build(
      snapshot(),
      'enc-current',
      'doctor-ci10c',
      4000
    );

    expect(brief.encounterId).toBe('enc-current');
    expect(brief.careSetting).toBe('OPD');
    expect(brief.lastConsultantReviewAt).toBe(2200);
    expect(
      brief.sections.find((item) => item.sectionId === 'REASON_FOR_VISIT')?.claims[0]?.text
    ).toContain('Progressive dyspnea');
    expect(
      brief.sections.find((item) => item.sectionId === 'MAJOR_ACTIVE_PROBLEMS')?.claims[0]?.text
    ).toContain('Heart failure');
  });

  test('surfaces changes, critical investigations, outstanding work and medication discrepancies', () => {
    const brief = ClinicalEncounterPreparationService.build(
      snapshot(),'enc-current','doctor-ci10c',4000
    );

    expect(
      brief.sections.find((item) => item.sectionId === 'CHANGES_SINCE_REVIEW')?.claims.length
    ).toBe(2);
    expect(
      brief.sections.find((item) => item.sectionId === 'NEW_ABNORMAL_INVESTIGATIONS')?.claims
        .some((item) => item.severity === 'CRITICAL_REVIEW_REQUIRED')
    ).toBe(true);
    expect(
      brief.sections.find((item) => item.sectionId === 'OUTSTANDING_WORK')?.claims
        .some((item) => item.text.includes('Renal function panel'))
    ).toBe(true);
    expect(
      brief.sections.find((item) => item.sectionId === 'MEDICATION_DISCREPANCIES')?.claims[0]?.classification
    ).toBe('POSSIBLE_DISCREPANCY');
  });

  test('all encounter-prep claims remain inside the CI-10A evidence boundary', () => {
    const input = snapshot();
    const brief = ClinicalEncounterPreparationService.build(
      input,'enc-current','doctor-ci10c',4000
    );
    const claims = brief.sections.flatMap((item) => item.claims);
    const grounding = ClinicalEvidenceService.validateClaims(input, claims);

    expect(grounding.valid).toBe(true);
    expect(claims.every((item) => item.evidenceRefs.length > 0)).toBe(true);
  });

  test('source-marked abnormal results are reported without autonomous diagnosis', () => {
    const brief = ClinicalEncounterPreparationService.build(
      snapshot(),'enc-current','doctor-ci10c',4000
    );
    const abnormal = brief.sections
      .find((item) => item.sectionId === 'NEW_ABNORMAL_INVESTIGATIONS')
      ?.claims.find((item) => item.text.includes('Potassium'));

    expect(abnormal?.text).toContain('source-marked CRITICAL');
    expect(abnormal?.caveat).toContain('no new diagnosis');
    expect(brief.safety.autonomousDiagnosisAllowed).toBe(false);
    expect(brief.safety.autonomousTreatmentAllowed).toBe(false);
    expect(brief.safety.autonomousOrdersAllowed).toBe(false);
    expect(brief.safety.directClinicalMutationAllowed).toBe(false);
  });

  test('missing allergy knowledge becomes missing information, not a negative allergy statement', () => {
    const brief = ClinicalEncounterPreparationService.build(
      snapshot(),'enc-current','doctor-ci10c',4000
    );
    const missing = brief.sections.find(
      (item) => item.sectionId === 'MISSING_INFORMATION'
    )!;

    expect(missing.claims.some((item) => item.text.includes('Allergy status is UNKNOWN'))).toBe(true);
    expect(
      brief.sections.flatMap((item) => item.claims)
        .some((item) => /no allergies|no known allergies/i.test(item.text))
    ).toBe(false);
  });

  test('deterministic knowledge contradictions are surfaced as discrepancies', () => {
    const input = snapshot();
    const knowledge = input.evidenceRefs.find((item) => item.sourceType === 'KNOWLEDGE_STATUS')!;
    knowledge.content = {
      ...(knowledge.content as Record<string, unknown>),
      medicationKnowledge:'KNOWN_NONE',
    };

    const brief = ClinicalEncounterPreparationService.build(
      input,'enc-current','doctor-ci10c',4000
    );
    const contradiction = brief.sections
      .find((item) => item.sectionId === 'CONTRADICTIONS')
      ?.claims.find((item) => item.text.includes('Medication knowledge'));

    expect(contradiction?.classification).toBe('POSSIBLE_DISCREPANCY');
    expect(contradiction?.evidenceRefs).toContain('ev-med');
  });

  test('wrong patient encounter context or wrong purpose fails closed', () => {
    const wrongPurpose = snapshot();
    wrongPurpose.purpose = 'LONGITUDINAL_SUMMARY';
    expect(() =>
      ClinicalEncounterPreparationService.build(
        wrongPurpose,'enc-current','doctor-ci10c',4000
      )
    ).toThrow('CI10C_EVIDENCE_PURPOSE_MISMATCH');

    expect(() =>
      ClinicalEncounterPreparationService.build(
        snapshot(),'enc-other','doctor-ci10c',4000
      )
    ).toThrow('CI10C_ENCOUNTER_CONTEXT_EVIDENCE_REQUIRED');
  });

  test('encounter evidence freezes consultant attention and current governed CI projections', async () => {
    const loader = await source(
      'lib/clinical/intelligence/encounter-preparation-evidence-loader.ts'
    );
    const evidenceService = await source(
      'lib/clinical/intelligence/clinical-evidence-service.ts'
    );

    expect(loader).toContain('ConsultantVisibilityService.buildForActor');
    expect(loader).toContain('MedicationSafetyService.getProjection');
    expect(loader).toContain('ClinicalDeteriorationService.getProjection');
    expect(loader).toContain('DischargeReadinessService.getProjection');
    expect(loader).toContain("sourceType: 'CONSULTANT_CHANGE'");
    expect(loader).toContain("sourceType: 'CLINICAL_OPEN_ITEM'");
    expect(evidenceService).toContain("purpose === 'ENCOUNTER_PREP'");
    expect(evidenceService).toContain('explicitSourceEventIds');
  });

  test('brief persistence is immutable, audited, outbox-evented and server-only', async () => {
    const service = await source(
      'lib/clinical/intelligence/clinical-encounter-preparation-service.ts'
    );
    const rules = await source('firestore.rules');

    expect(service).toContain("collection('clinicalEncounterPreparationBriefs')");
    expect(service).toContain('transaction.create(briefRef');
    expect(service).toContain("eventType: 'CLINICAL_ENCOUNTER_PREPARATION_BRIEF_GENERATED'");
    expect(service).toContain("action: 'GENERATE_CLINICAL_ENCOUNTER_PREPARATION_BRIEF'");
    expect(service).toContain("topic: 'g-hims-clinical-intelligence-events'");

    const index = rules.indexOf('match /clinicalEncounterPreparationBriefs/{briefId}');
    expect(index).toBeGreaterThan(-1);
    expect(rules.slice(index,index+180)).toContain('allow read, write: if false');
  });

  test('OPD consultation uses governed CI-10C and removes simulated AI/CDS content', async () => {
    const consultation = await source('components/opd/OpdConsultationSpecialties.tsx');
    const panel = await source('components/opd/EncounterPreparationPanel.tsx');

    expect(consultation).toContain('EncounterPreparationPanel');
    expect(consultation).not.toContain('handleSimulateAiCopilot');
    expect(consultation).not.toContain('AI Differential Proposals');
    expect(consultation).not.toContain('ACC/AHA Heart Failure 2026');
    expect(consultation).not.toContain('Known Allergy Alert: Penicillin');
    expect(consultation).toContain("const IS_DEMO_RUNTIME = process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO'");
    expect(consultation).toContain("IS_DEMO_RUNTIME ? 'Decompensated Heart Failure");
    expect(consultation).toContain(": [])");
    expect(panel).toContain('generateEncounterPreparationBrief');
    expect(panel).toContain('will not fabricate a fresh brief from stale offline-only state');
  });

  test('CI-10C adds no model-provider side door', async () => {
    const service = await source('lib/clinical/intelligence/clinical-encounter-preparation-service.ts');
    const route = await source('app/api/clinical/intelligence/encounter-preparation/route.ts');
    for (const forbidden of ['@google/genai','openai','anthropic','generateContent','chat.completions']) {
      expect(service.toLowerCase()).not.toContain(forbidden.toLowerCase());
      expect(route.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  test('CI-10C evidence creation self-heals unmaterialized Patient 360 projection before failing', async () => {
    const evidenceService = await source(
      'lib/clinical/intelligence/clinical-evidence-service.ts'
    );
    const projectionService = await source(
      'lib/clinical/patient360/patient360-projection-service.ts'
    );
    const loader = await source(
      'lib/clinical/intelligence/encounter-preparation-evidence-loader.ts'
    );

    expect(evidenceService).toContain('Patient360ProjectionService.readOrRebuildClinicalView');
    expect(projectionService).toContain('getOrRebuildProjection');
    expect(loader).toContain('options.encounterId');
  });
});
