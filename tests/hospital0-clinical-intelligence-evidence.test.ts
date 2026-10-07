import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('Clinical Intelligence Hospital-0 evidence package', () => {
  test('pilot charter keeps Clinical Intelligence as the pilot wedge', async () => {
    const charter = await source(
      'docs/clinical-intelligence/HOSPITAL0_PILOT_CHARTER.md'
    );

    expect(charter).toContain('G-HIMS Clinical Intelligence');
    expect(charter).toContain('The pilot is not a generic HIS rollout');
    expect(charter).toContain('AI-generated content remains non-authoritative');
    expect(charter).toContain('qualified clinician');
    expect(charter).toContain('cross-patient evidence contamination');
  });

  test('templates remain explicitly pending and cannot masquerade as evidence', async () => {
    for (const file of [
      'evaluation/hospital0/hospital0-consent-template.json',
      'evaluation/hospital0/clinical-collaborator-attestation-template.json',
      'evaluation/hospital0/hospital0-metrics-template.json',
      'evaluation/hospital0/hospital0-site-signoff-template.json',
    ]) {
      const body = JSON.parse(await source(file));
      expect(String(body.status)).toMatch(/^PENDING_/);
    }
  });

  test('Hospital-0 manifest requires signed consent, collaborator observation, metrics and signoff', async () => {
    const manifest = await source(
      'scripts/ops/hospital0-evidence-manifest.ts'
    );

    for (const required of [
      'hospital0-consent.json',
      'clinical-collaborator-attestation.json',
      'hospital0-metrics.json',
      'hospital0-daily-log.json',
      'hospital0-site-signoff.json',
      'CONSENT_NOT_SIGNED',
      'COLLABORATOR_ATTESTATION_NOT_SIGNED',
      'RELEVANT_ENVIRONMENT_OBSERVATION_REQUIRED',
      'METRICS_NOT_FINAL',
      'SITE_SIGNOFF_NOT_SIGNED',
    ]) {
      expect(manifest).toContain(required);
    }

    expect(manifest).toContain('hospital0EvidenceReady: complete');
    expect(manifest).toContain('synthetic validation are not substitutes');
  });

  test('site signoff cannot pass with unresolved Critical or High issues', async () => {
    const manifest = await source(
      'scripts/ops/hospital0-evidence-manifest.ts'
    );

    expect(manifest).toContain('UNRESOLVED_CRITICAL_ISSUES');
    expect(manifest).toContain('UNRESOLVED_HIGH_ISSUES');
  });
});
