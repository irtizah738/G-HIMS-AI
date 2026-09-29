import { describe, expect, test } from 'bun:test';
import { TerminologyService } from '@/lib/clinical/terminology/terminology-service';
import { buildCanonicalVitalObservations } from '@/lib/clinical/canonical-fact-builders';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

describe('G-HIMS CI-2 terminology foundation', () => {
  test('lookup and validation resolve curated LOINC and UCUM concepts', () => {
    expect(TerminologyService.lookup('LOINC', '8867-4')?.display).toBe('Heart rate');
    expect(TerminologyService.lookup('ucum', 'mm[Hg]')?.display).toBe('millimeter of mercury');

    expect(TerminologyService.validate('LOINC', '8867-4')).toMatchObject({
      valid: true,
      active: true,
    });
    expect(TerminologyService.validate('LOINC', 'does-not-exist').error).toBe('UNKNOWN_CODE');
    expect(TerminologyService.validate('UNKNOWN_SYSTEM', 'X').error).toBe('UNKNOWN_SYSTEM');
  });

  test('search resolves codes, displays and common clinical synonyms', () => {
    expect(TerminologyService.search('HR')[0]?.concept.code).toBe('8867-4');
    expect(TerminologyService.search('blood pressure')[0]?.concept.code).toBe('85354-9');
    expect(
      TerminologyService.search('mmHg', { systems: ['UCUM'] })[0]?.concept.code
    ).toBe('mm[Hg]');
  });

  test('local aliases normalize through explicit terminology mappings', () => {
    expect(TerminologyService.map('LOCAL', 'HR', 'LOINC')).toMatchObject({
      targetSystem: 'LOINC',
      targetCode: '8867-4',
      equivalence: 'EQUIVALENT',
    });

    const normalized = TerminologyService.normalizeCoding({
      system: 'LOCAL',
      code: 'HR',
      display: 'Pulse',
    });

    expect(normalized.system).toBe('LOINC');
    expect(normalized.code).toBe('8867-4');
    expect(normalized.display).toBe('Heart rate');
  });

  test('value set expansion can select by system or explicit codes', () => {
    const loinc = TerminologyService.expandValueSet({ systems: ['LOINC'] });
    expect(loinc.some((concept) => concept.code === '8867-4')).toBe(true);
    expect(loinc.some((concept) => concept.system === 'UCUM')).toBe(false);

    const explicit = TerminologyService.expandValueSet({
      codes: [{ system: 'UCUM', code: 'Cel' }],
    });
    expect(explicit).toHaveLength(1);
    expect(explicit[0].code).toBe('Cel');
  });

  test('runtime terminology extension is restricted to LOCAL concepts', () => {
    const code = `LOCAL_TEST_${Date.now()}`;
    TerminologyService.registerLocalConcept({
      system: 'LOCAL',
      code,
      display: 'Test local concept',
      active: true,
    });
    expect(TerminologyService.lookup('LOCAL', code)?.display).toBe('Test local concept');

    expect(() =>
      TerminologyService.registerLocalConcept({
        system: 'LOINC',
        code: 'FAKE',
        display: 'Invalid external concept',
      })
    ).toThrow('ONLY_LOCAL_TERMINOLOGY_CAN_BE_REGISTERED_AT_RUNTIME');
  });

  test('canonical vital builders consume terminology service concepts', () => {
    const observations = buildCanonicalVitalObservations({
      tenantId: 'tenant-a',
      patientId: 'patient-a',
      encounterId: 'enc-a',
      sourceEvidenceId: 'ev-a',
      actorId: 'nurse-a',
      measuredAt: 1700000000000,
      heartRate: 90,
      bloodPressure: '120/80',
      temperature: 37,
      respiratoryRate: 18,
      oxygenSaturation: 97,
    });

    const heartRate = observations.find((item) =>
      item.code.codings.some((coding) => coding.code === '8867-4')
    );
    expect(heartRate?.code.codings[0].system).toBe('LOINC');

    if (heartRate?.value.valueType === 'QUANTITY') {
      expect(heartRate.value.quantity.system).toBe('UCUM');
      expect(heartRate.value.quantity.code).toBe('/min');
      expect(heartRate.value.quantity.unit).toBe('per minute');
    } else {
      throw new Error('Heart-rate observation was not normalized as quantity.');
    }
  });

  test('canonical builders do not maintain a separate hard-coded terminology table', async () => {
    const builders = await source('lib/clinical/canonical-fact-builders.ts');
    expect(builders).toContain('TerminologyService.lookup');
    expect(builders).toContain("concept('LOINC', '8867-4'");
    expect(builders).toContain("concept('LOINC', '85354-9'");
    expect(builders).not.toContain("codings: [{ system: 'LOINC', code: '8867-4'");
  });
});
