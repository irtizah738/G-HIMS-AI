import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = async (relPath: string) => {
  const content = await readFile(join(process.cwd(), relPath), 'utf8');
  return content.replace(/\r\n/g, '\n');
};

describe('ORC-8 Matrix: NEWS2 Incomplete Inputs Detection', () => {
  test('ClinicalDocumentationDomainService evaluates NEWS2 input completeness', async () => {
    const service = await source('lib/backend/services/clinical-documentation-domain-service.ts');

    expect(service).toContain('canCalculateNews2');
    expect(service).toContain('Number.isFinite(systolicBloodPressure)');
    expect(service).toContain('payload.spO2Scale === 1 || payload.spO2Scale === 2');
    expect(service).toContain("typeof payload.onSupplementalOxygen === 'boolean'");
    expect(service).toContain("(!!payload.consciousness || typeof payload.gcsScore === 'number')");
  });

  test('news2Status explicitly sets INCOMPLETE_INPUTS rather than silent null omission', async () => {
    const service = await source('lib/backend/services/clinical-documentation-domain-service.ts');

    expect(service).toContain("const news2Status: 'CALCULATED' | 'INCOMPLETE_INPUTS' = canCalculateNews2");
    expect(service).toContain("? 'CALCULATED'");
    expect(service).toContain(": 'INCOMPLETE_INPUTS'");

    // Score is null when incomplete, but status informs the clinician of missing parameters
    expect(service).toContain('const news2 = canCalculateNews2');
  });

  test('clinical observation domain payload includes news2Status attribute', async () => {
    const service = await source('lib/backend/services/clinical-documentation-domain-service.ts');

    const domainStateSection = service.slice(
      service.indexOf('const domainState = {'),
      service.indexOf('await this.commitWithDeterministicOutbox(')
    );

    expect(domainStateSection).toContain('news2Status');
    expect(domainStateSection).toContain("evidenceType: 'VITALS'");
  });
});
