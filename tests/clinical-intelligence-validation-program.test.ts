import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('Clinical Intelligence preclinical validation program', () => {
  test('synthetic runner combines safety and clinical evaluation gates', async () => {
    const runner = await source('scripts/ops/ci-synthetic-validation.ts');

    expect(runner).toContain('runClinicalSafetyReleaseSuite');
    expect(runner).toContain('ClinicalIntelligenceClinicalEvaluator.evaluate');
    expect(runner).toContain("validationType: 'SYNTHETIC_PRECLINICAL'");
    expect(runner).toContain('Synthetic benchmark only');
    expect(runner).toContain('Retrospective de-identified validation is required');
    expect(runner).toContain('Hospital-0 evidence is required');
    expect(runner).toContain('if (!passed) process.exitCode = 1');
  });

  test('retrospective package cannot masquerade as completed evidence', async () => {
    const template = JSON.parse(
      await source('evaluation/retrospective/clinical-evaluation-template.json')
    );
    const runbook = await source(
      'docs/clinical-intelligence/RETROSPECTIVE_VALIDATION_RUNBOOK.md'
    );

    expect(template.cohortType).toBe('RETROSPECTIVE_DEIDENTIFIED');
    expect(template.caseCount).toBe(0);
    expect(template.reviewerCount).toBe(0);
    expect(runbook).toContain('institutional permission');
    expect(runbook).toContain('At least two qualified clinicians');
    expect(runbook).toContain('third qualified clinician');
    expect(runbook).toContain('Hospital-0 evidence remains a separate requirement');
  });

  test('retrospective runbook defines stop rules for serious failures', async () => {
    const runbook = await source(
      'docs/clinical-intelligence/RETROSPECTIVE_VALIDATION_RUNBOOK.md'
    );

    for (const stopRule of [
      'cross-patient evidence contamination',
      'a harmful recommendation',
      'failure to surface a critical safety issue',
      'provenance links that point to the wrong patient or encounter',
      'evidence tampering/integrity failure',
      'systematic temporal misattribution',
    ]) {
      expect(runbook).toContain(stopRule);
    }
  });
});
