/**
 * Study-scoped, engineering-only synthetic cohort. These generated records are
 * NOT the clinician-unapproved 120-case ZIP. No diagnostic labels are embedded.
 * A signed policy and approved frozen-manifest importer are prerequisites to
 * clinical use. Explicitly separate rehearsal from an approved study.
 */
import crypto from 'node:crypto';
import type { ValidationEvidenceItem } from '@/types/clinical-validation-workspace';

export const REHEARSAL_COHORT_ID = 'renal-ciqp-generated-rehearsal-120-v1';
export interface RenalRehearsalCase {
  caseId: string;
  evidence: ValidationEvidenceItem[];
  question: string;
  sourceHash: string;
  stratum: 'RATIO_CHANGE' | 'ABSOLUTE_CHANGE' | 'STABLE' |
    'FALLING' | 'AMBIGUOUS_SOURCE' | 'SPECIAL_POPULATION';
}
const strata: RenalRehearsalCase['stratum'][] = [
  'RATIO_CHANGE', 'ABSOLUTE_CHANGE', 'STABLE', 'FALLING',
  'AMBIGUOUS_SOURCE', 'SPECIAL_POPULATION',
];

export function createSyntheticRehearsalCohort(): RenalRehearsalCase[] {
  const all: RenalRehearsalCase[] = [];
  for (const [group, stratum] of strata.entries()) {
    for (let index = 0; index < 20; index++) {
      const caseId = 'SYN-CIQP-' + String(group * 20 + index + 1).padStart(3, '0');
      const first = Number((0.85 + (index % 6) * 0.11).toFixed(2));
      const second = stratum === 'RATIO_CHANGE' ? Number((first * 1.6).toFixed(2))
        : stratum === 'ABSOLUTE_CHANGE' ? Number((first + 0.34).toFixed(2))
        : stratum === 'FALLING' ? Number((first * 0.8).toFixed(2))
        : stratum === 'STABLE' ? first : Number((first + 0.4).toFixed(2));
      const elapsedHours = stratum === 'ABSOLUTE_CHANGE' ? 24 : 120;
      const evidence: ValidationEvidenceItem[] = [
        {
          evidenceId: caseId + '-E1', label: 'Synthetic serum creatinine',
          fact: '2026-10-17T12:00Z: ' + first + ' mg/dL, FINAL, LOINC 2160-0',
        },
        {
          evidenceId: caseId + '-E2', label: 'Synthetic repeat result',
          fact: 'After ' + elapsedHours + ' hours: ' + second +
            ' mg/dL, ' + (stratum === 'AMBIGUOUS_SOURCE' ? 'PRELIMINARY' : 'FINAL') +
            ', LOINC 2160-0',
        },
        {
          evidenceId: caseId + '-CTX', label: 'Synthetic context',
          fact: stratum === 'SPECIAL_POPULATION'
            ? 'PREGNANT; pregnancy-specific applicability requires qualified clinician review.'
            : 'True pre-illness baseline and urine output are not established.',
        },
      ];
      const question = 'Independently judge whether this synthetic source warrants clinician renal deterioration review, and cite evidence. Do not diagnose.';
      const sourceHash = crypto.createHash('sha256').update(
        JSON.stringify({ caseId, evidence, question, stratum })
      ).digest('hex');
      all.push({ caseId, evidence, question, stratum, sourceHash });
    }
  }
  if (all.length !== 120 || new Set(all.map(x => x.caseId)).size !== 120) {
    throw new Error('CIQP_REHEARSAL_COHORT_CARDINALITY_FAILURE');
  }
  return all;
}

export function syntheticCohortFingerprint(cases: RenalRehearsalCase[]): string {
  return crypto.createHash('sha256').update(
    cases.map(c => c.caseId + ':' + c.sourceHash).join('\n')
  ).digest('hex');
}
