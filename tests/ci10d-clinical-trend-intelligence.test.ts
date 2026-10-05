import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { ClinicalTrendEngine } from '@/lib/clinical/intelligence/clinical-trend-engine';
import { ClinicalTrendIntelligenceService } from '@/lib/clinical/intelligence/clinical-trend-intelligence-service';
import type {
  ClinicalEvidenceRef,
  ClinicalEvidenceSnapshot,
} from '@/types/clinical-intelligence-evidence';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

function quantityObservation(
  evidenceId: string,
  observationId: string,
  code: string,
  display: string,
  value: number,
  unit: string,
  effectiveAt: number,
  options: {
    status?: string;
    interpretation?: string;
    system?: string;
    provenance?: Record<string, unknown>;
    referenceLow?: number;
    referenceHigh?: number;
    patientId?: string;
  } = {}
): ClinicalEvidenceRef {
  const status = options.status || 'FINAL';
  const patientId = options.patientId || 'patient-ci10d';
  return {
    evidenceId,
    tenantId: 'tenant-ci10d',
    patientId,
    sourceType: 'OBSERVATION_HISTORY',
    sourceEntityId: observationId,
    label: display,
    status,
    occurredAt: effectiveAt,
    recordedAt: effectiveAt + 10,
    patient360Revision: 30,
    patient360SourceCheckpoint: '9000:evt-latest',
    sourceEventIds: ['evt-' + observationId],
    sourceEventCount: 1,
    sourceEventSetHash: 'eventhash-' + observationId,
    latestSourceEventId: 'evt-' + observationId,
    provenanceStatus: 'EVENT_VERIFIED',
    content: {
      observationId,
      patientId,
      status,
      effectiveAt,
      code: {
        text: display,
        codings: [
          {
            system: options.system || 'LOINC',
            code,
            display,
          },
        ],
      },
      value: {
        valueType: 'QUANTITY',
        quantity: {
          value,
          unit,
          system: 'UCUM',
          code: unit,
        },
      },
      interpretation: options.interpretation
        ? [{ text: options.interpretation, codings: [] }]
        : [],
      referenceRange:
        options.referenceLow !== undefined ||
        options.referenceHigh !== undefined
          ? [
              {
                low:
                  options.referenceLow !== undefined
                    ? {
                        value: options.referenceLow,
                        unit,
                        system: 'UCUM',
                        code: unit,
                      }
                    : undefined,
                high:
                  options.referenceHigh !== undefined
                    ? {
                        value: options.referenceHigh,
                        unit,
                        system: 'UCUM',
                        code: unit,
                      }
                    : undefined,
              },
            ]
          : [],
      provenance: options.provenance || {},
    },
    contentHash: 'hash-' + observationId,
  };
}

function componentObservation(
  evidenceId: string,
  observationId: string,
  effectiveAt: number,
  systolic: number,
  diastolic: number
): ClinicalEvidenceRef {
  return {
    evidenceId,
    tenantId: 'tenant-ci10d',
    patientId: 'patient-ci10d',
    sourceType: 'OBSERVATION_HISTORY',
    sourceEntityId: observationId,
    label: 'Blood pressure panel',
    status: 'FINAL',
    occurredAt: effectiveAt,
    recordedAt: effectiveAt + 10,
    patient360Revision: 30,
    patient360SourceCheckpoint: '9000:evt-latest',
    sourceEventIds: ['evt-' + observationId],
    sourceEventCount: 1,
    sourceEventSetHash: 'eventhash-' + observationId,
    latestSourceEventId: 'evt-' + observationId,
    provenanceStatus: 'EVENT_VERIFIED',
    content: {
      observationId,
      patientId: 'patient-ci10d',
      status: 'FINAL',
      effectiveAt,
      code: {
        text: 'Blood pressure panel',
        codings: [
          {
            system: 'LOINC',
            code: '85354-9',
            display: 'Blood pressure panel',
          },
        ],
      },
      value: {
        valueType: 'COMPONENTS',
        components: [
          {
            code: {
              text: 'Systolic blood pressure',
              codings: [
                {
                  system: 'LOINC',
                  code: '8480-6',
                  display: 'Systolic blood pressure',
                },
              ],
            },
            value: {
              valueType: 'QUANTITY',
              quantity: {
                value: systolic,
                unit: 'mmHg',
                system: 'UCUM',
                code: 'mm[Hg]',
              },
            },
          },
          {
            code: {
              text: 'Diastolic blood pressure',
              codings: [
                {
                  system: 'LOINC',
                  code: '8462-4',
                  display: 'Diastolic blood pressure',
                },
              ],
            },
            value: {
              valueType: 'QUANTITY',
              quantity: {
                value: diastolic,
                unit: 'mmHg',
                system: 'UCUM',
                code: 'mm[Hg]',
              },
            },
          },
        ],
      },
      interpretation: [{ text: 'HIGH', codings: [] }],
      provenance: {},
    },
    contentHash: 'hash-' + observationId,
  };
}

function snapshot(
  refs: ClinicalEvidenceRef[],
  purpose: ClinicalEvidenceSnapshot['purpose'] = 'TREND_EXPLANATION'
): ClinicalEvidenceSnapshot {
  return {
    snapshotId: 'cisnap-ci10d',
    tenantId: 'tenant-ci10d',
    patientId: 'patient-ci10d',
    purpose,
    createdAt: 20_000,
    createdBy: 'doctor-ci10d',
    immutable: true,
    schemaVersion: 2,
    patient360ProjectionVersion: 2,
    patient360Revision: 30,
    patient360SourceCheckpoint: '9000:evt-latest',
    patient360ContentHash: 'patient360-hash-ci10d',
    evidenceRefs: refs,
    evidenceCount: refs.length,
    sourceEventCount: refs.length,
    coverage: {
      observations: {
        status: 'COMPLETE',
        recordCount: refs.length,
      },
    },
    dateRange: {
      from: refs.length
        ? Math.min(...refs.map((item) => item.occurredAt || 0))
        : undefined,
      to: refs.length
        ? Math.max(...refs.map((item) => item.occurredAt || 0))
        : undefined,
    },
    snapshotHash: 'snapshot-hash-ci10d',
    limitations: [
      'Missing or incomplete source data must not be interpreted as clinical absence.',
    ],
  };
}

describe('CI-10D clinical trend intelligence', () => {
  test('computes coded same-unit trends deterministically', () => {
    const input = snapshot([
      quantityObservation('ev-a1c-1','obs-a1c-1','4548-4','HbA1c',7.1,'%',1_000),
      quantityObservation('ev-a1c-2','obs-a1c-2','4548-4','HbA1c',8.4,'%',5_000),
    ]);

    const metric = ClinicalTrendEngine.compute(input).metrics[0];

    expect(metric.metricKey).toBe('LOINC:4548-4');
    expect(metric.status).toBe('COMPUTED');
    expect(metric.direction).toBe('INCREASING');
    expect(metric.firstValue).toBe(7.1);
    expect(metric.lastValue).toBe(8.4);
    expect(metric.absoluteChange).toBeCloseTo(1.3);
    expect(metric.pointCount).toBe(2);
    expect(metric.explanation?.text).toContain('changed from 7.1 % to 8.4 %');
    expect(metric.explanation?.classification).toBe('TREND');
    expect(metric.explanation?.evidenceRefs.sort()).toEqual(
      ['ev-a1c-1', 'ev-a1c-2'].sort()
    );
  });

  test('groups by canonical coding rather than mutable display labels', () => {
    const input = snapshot([
      quantityObservation('ev-1','obs-1','2160-0','Creatinine',1.0,'mg/dL',1_000),
      quantityObservation('ev-2','obs-2','2160-0','Serum creatinine',1.5,'mg/dL',2_000),
      quantityObservation('ev-3','obs-3','99999-9','Creatinine',10,'mg/dL',3_000),
    ]);

    const result = ClinicalTrendEngine.compute(input);
    expect(result.metrics).toHaveLength(2);
    expect(
      result.metrics.find((item) => item.metricKey === 'LOINC:2160-0')
        ?.pointCount
    ).toBe(2);
  });

  test('suppresses mixed-unit trajectories rather than converting implicitly', () => {
    const metric = ClinicalTrendEngine.compute(
      snapshot([
        quantityObservation('ev-g1','obs-g1','2345-7','Glucose',100,'mg/dL',1_000),
        quantityObservation('ev-g2','obs-g2','2345-7','Glucose',5.5,'mmol/L',2_000),
      ])
    ).metrics[0];

    expect(metric.status).toBe('MIXED_UNITS');
    expect(metric.direction).toBe('NOT_COMPUTED');
    expect(metric.explanation).toBeUndefined();
    expect(metric.caveats.join(' ')).toContain('does not convert units');
  });

  test('removes explicitly superseded observations before computation', () => {
    const result = ClinicalTrendEngine.compute(
      snapshot([
        quantityObservation('ev-old','obs-old','2160-0','Creatinine',1.2,'mg/dL',1_000),
        quantityObservation('ev-corrected','obs-corrected','2160-0','Creatinine',1.0,'mg/dL',1_000,{
          status:'CORRECTED',
          provenance:{ correctedFromId:'obs-old' },
        }),
        quantityObservation('ev-next','obs-next','2160-0','Creatinine',1.4,'mg/dL',2_000),
      ])
    );
    const metric = result.metrics[0];

    expect(metric.pointCount).toBe(2);
    expect(metric.firstValue).toBe(1.0);
    expect(result.excludedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ evidenceId:'ev-old', reason:'SUPERSEDED' }),
      ])
    );
  });

  test('excludes preliminary, cancelled, entered-in-error and future observations', () => {
    const result = ClinicalTrendEngine.compute(
      snapshot([
        quantityObservation('ev-v1','obs-v1','2160-0','Creatinine',1.0,'mg/dL',1_000),
        quantityObservation('ev-p','obs-p','2160-0','Creatinine',1.2,'mg/dL',2_000,{status:'PRELIMINARY'}),
        quantityObservation('ev-c','obs-c','2160-0','Creatinine',1.3,'mg/dL',3_000,{status:'CANCELLED'}),
        quantityObservation('ev-e','obs-e','2160-0','Creatinine',99,'mg/dL',4_000,{status:'ENTERED_IN_ERROR'}),
        quantityObservation('ev-f','obs-f','2160-0','Creatinine',2.0,'mg/dL',400_001),
        quantityObservation('ev-v2','obs-v2','2160-0','Creatinine',1.4,'mg/dL',5_000),
      ])
    );

    expect(result.metrics[0].pointCount).toBe(2);
    expect(new Set(result.excludedEvidence.map((item) => item.reason))).toEqual(
      new Set(['PRELIMINARY','CANCELLED','ENTERED_IN_ERROR','FUTURE_EFFECTIVE_TIME'])
    );
  });

  test('conflicting values at one effective time suppress direction', () => {
    const metric = ClinicalTrendEngine.compute(
      snapshot([
        quantityObservation('ev-1','obs-1','2160-0','Creatinine',1.0,'mg/dL',1_000),
        quantityObservation('ev-2','obs-2','2160-0','Creatinine',1.4,'mg/dL',1_000),
        quantityObservation('ev-3','obs-3','2160-0','Creatinine',1.6,'mg/dL',2_000),
      ])
    ).metrics[0];

    expect(metric.status).toBe('CONFLICTING_SAME_TIME');
    expect(metric.direction).toBe('NOT_COMPUTED');
    expect(metric.explanation).toBeUndefined();
    expect(
      metric.exclusions.some((item) => item.reason === 'CONFLICTING_SAME_TIME')
    ).toBe(true);
  });

  test('identical same-time duplicates are deduplicated deterministically', () => {
    const first = quantityObservation('ev-1','obs-1','2160-0','Creatinine',1.0,'mg/dL',1_000);
    const duplicate = quantityObservation('ev-2','obs-2','2160-0','Creatinine',1.0,'mg/dL',1_000);
    duplicate.recordedAt = 1_100;
    const next = quantityObservation('ev-3','obs-3','2160-0','Creatinine',1.5,'mg/dL',2_000);

    const metric = ClinicalTrendEngine.compute(
      snapshot([first, duplicate, next])
    ).metrics[0];

    expect(metric.status).toBe('COMPUTED');
    expect(metric.pointCount).toBe(2);
    expect(
      metric.exclusions.some((item) => item.reason === 'DUPLICATE_IDENTICAL')
    ).toBe(true);
  });

  test('component observations create independent coded series without inheriting parent abnormality', () => {
    const result = ClinicalTrendEngine.compute(
      snapshot([
        componentObservation('ev-bp-1','obs-bp-1',1_000,120,80),
        componentObservation('ev-bp-2','obs-bp-2',2_000,140,90),
      ])
    );

    const systolic = result.metrics.find((item) => item.metricKey === 'LOINC:8480-6');
    const diastolic = result.metrics.find((item) => item.metricKey === 'LOINC:8462-4');

    expect(systolic?.direction).toBe('INCREASING');
    expect(diastolic?.direction).toBe('INCREASING');
    expect(systolic?.abnormalPointCount).toBe(0);
    expect(diastolic?.abnormalPointCount).toBe(0);
  });

  test('same-unit source reference ranges mark abnormality without diagnostic inference', () => {
    const metric = ClinicalTrendEngine.compute(
      snapshot([
        quantityObservation('ev-k1','obs-k1','2823-3','Potassium',4.2,'mmol/L',1_000,{
          referenceLow:3.5, referenceHigh:5.1,
        }),
        quantityObservation('ev-k2','obs-k2','2823-3','Potassium',6.1,'mmol/L',2_000,{
          referenceLow:3.5, referenceHigh:5.1,
        }),
      ])
    ).metrics[0];

    expect(metric.abnormalPointCount).toBe(1);
    expect(metric.points[1].abnormalBasis).toBe('SOURCE_REFERENCE_RANGE');
    expect(metric.explanation?.text).not.toMatch(/diagnos|hyperkalemia|treat/i);
  });

  test('scope and purpose mismatches fail closed', () => {
    const wrongPurpose = snapshot(
      [quantityObservation('ev-1','obs-1','2160-0','Creatinine',1,'mg/dL',1_000)],
      'ENCOUNTER_PREP'
    );
    expect(() => ClinicalTrendEngine.compute(wrongPurpose)).toThrow(
      'CI10D_EVIDENCE_PURPOSE_MISMATCH'
    );

    const wrongPatient = snapshot([
      quantityObservation('ev-f','obs-f','2160-0','Creatinine',1,'mg/dL',1_000,{
        patientId:'patient-other',
      }),
    ]);
    expect(() => ClinicalTrendEngine.compute(wrongPatient)).toThrow(
      'CI10D_EVIDENCE_SCOPE_MISMATCH'
    );
  });

  test('artifact explanations pass CI-10A grounding and remain non-autonomous', () => {
    const input = snapshot([
      quantityObservation('ev-a1','obs-a1','4548-4','HbA1c',7.1,'%',1_000),
      quantityObservation('ev-a2','obs-a2','4548-4','HbA1c',8.4,'%',5_000),
    ]);

    const artifact = ClinicalTrendIntelligenceService.build(
      input,
      'doctor-ci10d',
      30_000
    );
    const claims = artifact.metrics
      .map((item) => item.explanation)
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    expect(ClinicalEvidenceService.validateClaims(input, claims).valid).toBe(true);
    expect(artifact.safety).toEqual({
      sourceLinked:true,
      deterministicComputation:true,
      clinicianInterpretationRequired:true,
      autonomousDiagnosisAllowed:false,
      autonomousTreatmentAllowed:false,
      autonomousOrdersAllowed:false,
      directClinicalMutationAllowed:false,
    });
  });

  test('CI-10B delegates longitudinal trend descriptions to CI-10D', async () => {
    const summaryService = await source(
      'lib/clinical/intelligence/clinical-longitudinal-summary-service.ts'
    );

    expect(summaryService).toContain('ClinicalTrendEngine.compute');
    expect(summaryService).not.toContain('item.label.toLowerCase()');
  });

  test('trend evidence is purpose-specific and authoritative', async () => {
    const loader = await source(
      'lib/clinical/intelligence/trend-evidence-loader.ts'
    );
    const evidenceService = await source(
      'lib/clinical/intelligence/clinical-evidence-service.ts'
    );

    expect(loader).toContain("'clinicalObservations'");
    expect(loader).toContain('queryAllEqual<ClinicalObservation>');
    expect(evidenceService).toContain("purpose === 'TREND_EXPLANATION'");
    expect(evidenceService).toContain('TrendEvidenceLoader.load');
  });

  test('trend persistence is immutable, audited, evented and server-only', async () => {
    const service = await source(
      'lib/clinical/intelligence/clinical-trend-intelligence-service.ts'
    );
    const rules = await source('firestore.rules');

    expect(service).toContain("collection('clinicalTrendIntelligence')");
    expect(service).toContain('transaction.create(');
    expect(service).toContain("eventType: 'CLINICAL_TREND_INTELLIGENCE_GENERATED'");
    expect(service).toContain("action: 'GENERATE_CLINICAL_TREND_INTELLIGENCE'");
    expect(service).toContain("topic: 'g-hims-clinical-intelligence-events'");

    const index = rules.indexOf('match /clinicalTrendIntelligence/{artifactId}');
    expect(index).toBeGreaterThan(-1);
    expect(rules.slice(index,index+180)).toContain('allow read, write: if false');
  });

  test('Patient 360 exposes suppressed reasons through the canonical workspace and adds no model-provider side door', async () => {
    const workspace = await source(
      'components/patient360/ClinicalCopilotWorkspace.tsx'
    );
    const view = await source('components/patient360/Patient360View.tsx');
    const route = await source(
      'app/api/clinical/intelligence/trends/route.ts'
    );
    const service = await source(
      'lib/clinical/intelligence/clinical-trend-intelligence-service.ts'
    );

    expect(workspace).toContain('generateClinicalTrendIntelligence');
    expect(workspace).toContain('Excluded observation evidence');
    expect(workspace).toContain('Suppressed / excluded evidence');
    expect(workspace).toContain(
      'Fresh clinical intelligence requires authoritative server connectivity.'
    );
    expect(workspace).toContain(
      'Cached intelligence is read-only and is never treated as'
    );
    expect(view).toContain('ClinicalCopilotWorkspace');
    expect(route).toContain('deriveAuthoritativeContext');
    expect(route).toContain('assertPatient360PatientAccess');

    for (const forbidden of [
      '@google/genai',
      'openai',
      'anthropic',
      'generateContent',
      'chat.completions',
    ]) {
      expect(route.toLowerCase()).not.toContain(forbidden.toLowerCase());
      expect(service.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
