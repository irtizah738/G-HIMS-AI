/**
 * G-HIMS investor DEMO: deterministic clinical-context reconstruction.
 *
 * No AI generation, diagnostic significance, deterioration thresholds,
 * external-EHR integration, user-created facts or authoritative clinical writes.
 * Every fact points to its existing canonical synthetic evidence ID.
 */
import type { Patient360Projection } from '@/types/patient360-projection';

export type DemoSourceFact = {
  id: string;
  collection: string;
  label: string;
  value: string;
  recordedAt?: number;
  evidenceId: string;
};
export type DemoSourceGroup = {
  id: 'encounters' | 'problems' | 'medications' | 'laboratory' | 'observations';
  label: string;
  sourceDescription: string;
  facts: DemoSourceFact[];
};
export type DemoObservation = {
  observationId: string;
  display: string;
  value: number;
  unit: string;
  loincCode: string;
  effectiveAt: number;
  status: string;
  sourceEvidenceId: string;
  sourceType: string;
  recordedInterpretation?: string;
};
export type DemoReviewGap = {
  id: string;
  classification: 'NOT_DOCUMENTED' | 'NOT_VERIFIED' | 'CLINICIAN_INTERPRETATION_REQUIRED';
  label: string;
  explanation: string;
};
export type DemoReconstruction = {
  sourceGroups: DemoSourceGroup[];
  chronology: DemoSourceFact[];
  observationsCompared: {
    earlier: DemoObservation;
    later: DemoObservation;
    arithmeticDelta: number;
    unit: 'mg/dL';
  } | null;
  reviewGaps: DemoReviewGap[];
  projectionCheckpoint: string;
  totalFacts: number;
  /** Deterministic source-backed pre-encounter facts, never a generated diagnosis. */
  encounterBrief: Array<{
    id: string;
    statement: string;
    evidenceRefs: string[];
  }>;
};

/** Fail closed if the DEMO scope, source identity, or numeric evidence is invalid. */
export function reconstructDemoClinicalContext(
  projection: Patient360Projection,
  observations: readonly DemoObservation[],
): DemoReconstruction {
  if (
    projection.tenantId !== 'central-metro-hospital' ||
    projection.patientId !== 'demo-ci-patient-001' ||
    projection.identity?.mrn !== 'CI-DEMO-001' ||
    projection.projectionVersion !== 6 ||
    projection.timelineReady !== true ||
    !Number.isInteger(projection.revision) || projection.revision < 10 ||
    typeof projection.sourceCheckpoint !== 'string' || !projection.sourceCheckpoint ||
    !projection.dataQuality || !projection.counts
  ) throw new Error('DEMO_CONTEXT_UNTRUSTED_PROJECTION');

  const expectedLabIds = [
    'demo-ci-creatinine-old',
    'demo-ci-creatinine-new',
    'demo-ci-potassium-new',
  ];
  if (
    observations.length !== 3 ||
    expectedLabIds.some(id => observations.filter(item => item.observationId === id).length !== 1) ||
    observations.some(item =>
      item.sourceEvidenceId !== item.observationId ||
      item.sourceType !== 'LAB_SYSTEM' ||
      item.status !== 'FINAL' ||
      !Number.isFinite(item.value) ||
      !Number.isFinite(item.effectiveAt) ||
      (item.loincCode === '2160-0' && item.unit !== 'mg/dL') ||
      (item.loincCode === '2823-3' && item.unit !== 'mmol/L') ||
      !['2160-0', '2823-3'].includes(item.loincCode)
    )
  ) throw new Error('DEMO_CONTEXT_UNTRUSTED_OBSERVATIONS');

  const fact = (
    collection: string, evidenceId: string, label: string,
    value: string, recordedAt?: number,
  ): DemoSourceFact => ({
    id: collection + ':' + evidenceId,
    collection,
    label,
    value,
    recordedAt: typeof recordedAt === 'number' && Number.isFinite(recordedAt) ? recordedAt : undefined,
    evidenceId,
  });

  const groups: DemoSourceGroup[] = [
    {
      id: 'encounters',
      label: 'Encounter and historical documentation',
      sourceDescription: 'Canonical encounter summaries and clinical documents',
      facts: [
        ...projection.recentEncounters.slice(0, 5).map(encounter =>
          fact('encounters', encounter.encounterId, 'Encounter ' + encounter.careSetting,
            [encounter.status, encounter.chiefComplaint].filter(Boolean).join(' · '),
            typeof encounter.startedAt === 'number' ? encounter.startedAt : undefined)),
        ...projection.recentDocuments.slice(0, 5).map(document =>
          fact('clinicalDocuments', document.clinicalDocumentId,
            document.title || document.documentType,
            'Existing ' + document.status.toLowerCase() + ' clinical document',
            document.signedAt)),
      ],
    },
    {
      id: 'problems',
      label: 'Conditions and recorded allergies',
      sourceDescription: 'Canonical longitudinal conditions and allergy facts',
      facts: [
        ...projection.activeProblems.slice(0, 10).map(item =>
          fact('clinicalConditions', item.conditionId, item.display,
            item.clinicalStatus + ' · ' + item.verificationStatus, item.onsetAt)),
        ...projection.allergies.slice(0, 10).map(item =>
          fact('clinicalAllergies', item.allergyId, item.substance,
            item.verificationStatus + ' · Recorded criticality: ' + item.criticality)),
      ],
    },
    {
      id: 'medications',
      label: 'Medication orders',
      sourceDescription: 'Prescription orders, not proven ingestion or administrations',
      facts: projection.currentMedications.slice(0, 10).map(item =>
        fact('medicationOrders', item.medicationOrderId, item.medication,
          item.dosageText + ' · ' + item.status, item.authoredAt)),
    },
    {
      id: 'laboratory',
      label: 'Laboratory observations',
      sourceDescription: 'Final lab-system observations, verified with original evidence IDs',
      facts: observations.slice().sort((a, b) => a.effectiveAt - b.effectiveAt).map(item =>
        fact('clinicalObservations', item.sourceEvidenceId, item.display,
          item.value + ' ' + item.unit + ' · ' + item.status,
          item.effectiveAt)),
    },
    {
      id: 'observations',
      label: 'Current vital observations',
      sourceDescription: 'Canonical vital-sign observations, not an invented result',
      facts: projection.latestVitals.slice(0, 10).map(item =>
        fact('clinicalObservations', item.observationId, item.display,
          item.status + ' · Recorded vital sign', item.effectiveAt)),
    },
  ];

  const creatinines = observations.filter(o => o.loincCode === '2160-0')
    .sort((a, b) => a.effectiveAt - b.effectiveAt);
  const earlier = creatinines[0], later = creatinines[1];
  const observationsCompared =
    creatinines.length === 2 && earlier.effectiveAt < later.effectiveAt
      ? {
          earlier, later,
          arithmeticDelta: Number((later.value - earlier.value).toFixed(4)),
          unit: 'mg/dL' as const,
        } : null;

  const reviewGaps: DemoReviewGap[] = [];
  const quality = projection.dataQuality;
  for (const [label, status] of [
    ['Allergy history', quality.allergyKnowledge],
    ['Problem list', quality.problemListKnowledge],
    ['Medication history', quality.medicationKnowledge],
  ] as const) {
    if (status !== 'KNOWN' && status !== 'KNOWN_NONE') reviewGaps.push({
      id: 'knowledge:' + label.toLowerCase().replaceAll(' ', '-'),
      classification: 'NOT_VERIFIED',
      label: label + ' knowledge not confirmed',
      explanation: 'The canonical knowledge state is ' + status + '; do not interpret absence as a negative finding.',
    });
  }
  for (const missing of quality.missingCanonicalFacts.slice(0, 8)) {
    reviewGaps.push({
      id: 'missing:' + missing,
      classification: 'NOT_DOCUMENTED',
      label: missing,
      explanation: 'The canonical projection identifies this information as missing, not normal.',
    });
  }
  if (!projection.counts.medicationAdministrations) reviewGaps.push({
    id: 'admin-not-documented',
    classification: 'NOT_DOCUMENTED',
    label: 'Medication administration not documented in this case',
    explanation: 'Active prescriptions do not establish that a patient took or received medication.',
  });
  if (quality.hasPreliminaryResults || quality.hasUnverifiedProblems || quality.hasUnverifiedAllergies) reviewGaps.push({
    id: 'source-verification',
    classification: 'NOT_VERIFIED',
    label: 'Some source records require verification',
    explanation: 'The canonical data-quality flags include preliminary or unverified clinical content.',
  });
  reviewGaps.push({
    id: 'clinical-meaning',
    classification: 'CLINICIAN_INTERPRETATION_REQUIRED',
    label: 'Clinical meaning and escalation are not determined',
    explanation: 'The observed laboratory change is arithmetic only. Clinical interpretation, alert thresholds and any escalation need qualified review.',
  });
  reviewGaps.push({
    id: 'external-source',
    classification: 'NOT_VERIFIED',
    label: 'External EHR integration has not been demonstrated',
    explanation: 'These source categories are from the isolated synthetic G-HIMS dataset; they do not prove live integration with a third-party EHR.',
  });

  const evidenceRef = (collection: string, id: string) => collection + '/' + id;
  const activeProblems = projection.activeProblems.filter(p => p.clinicalStatus === 'ACTIVE');
  const documentedAllergies = projection.allergies;
  const medications = projection.currentMedications.filter(m => m.status === 'ACTIVE');
  const encounterBrief = [
    ...(activeProblems.length ? [{
      id: 'documented-conditions',
      statement: 'Documented active conditions: ' + activeProblems.map(i => i.display).join('; ') + '.',
      evidenceRefs: activeProblems.map(i => evidenceRef('clinicalConditions', i.conditionId)),
    }] : []),
    ...(documentedAllergies.length ? [{
      id: 'documented-allergies',
      statement: 'Recorded allergies: ' + documentedAllergies.map(i => i.substance).join('; ') +
        '. Verification and clinical relevance require clinician review.',
      evidenceRefs: documentedAllergies.map(i => evidenceRef('clinicalAllergies', i.allergyId)),
    }] : []),
    ...(medications.length ? [{
      id: 'medication-orders',
      statement: 'Active medication orders: ' + medications.map(i => i.medication + ' (' + i.dosageText + ')').join('; ') +
        '. Administration and adherence are not established.',
      evidenceRefs: medications.map(i => evidenceRef('medicationOrders', i.medicationOrderId)),
    }] : []),
    ...(observationsCompared ? [{
      id: 'lab-comparison',
      statement: 'Documented creatinine observations changed from ' +
        observationsCompared.earlier.value + ' to ' + observationsCompared.later.value +
        ' mg/dL across two dates (arithmetic difference ' +
        (observationsCompared.arithmeticDelta > 0 ? '+' : '') +
        observationsCompared.arithmeticDelta + ' mg/dL). No clinical classification is assigned.',
      evidenceRefs: [
        evidenceRef('clinicalObservations', observationsCompared.earlier.sourceEvidenceId),
        evidenceRef('clinicalObservations', observationsCompared.later.sourceEvidenceId),
      ],
    }] : []),
  ];

  return {
    sourceGroups: groups,
    chronology: groups.flatMap(group => group.facts).filter(item => item.recordedAt !== undefined)
      .sort((a, b) => (a.recordedAt || 0) - (b.recordedAt || 0)),
    observationsCompared,
    reviewGaps,
    projectionCheckpoint: projection.sourceCheckpoint,
    totalFacts: groups.reduce((sum, group) => sum + group.facts.length, 0),
    encounterBrief,
  };
}
