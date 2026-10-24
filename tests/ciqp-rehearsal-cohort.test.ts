import { describe, expect, test } from 'bun:test';
import { createSyntheticRehearsalCohort, syntheticCohortFingerprint } from '@/lib/clinical/validation/synthetic-rehearsal-cohort';

describe('CIQP 120-case engineering rehearsal (not a clinical validation study)', () => {
  test('locks reproducible unique, label-free synthetic cases', () => {
    const cases = createSyntheticRehearsalCohort();
    expect(cases).toHaveLength(120);
    expect(new Set(cases.map(c => c.caseId)).size).toBe(120);
    expect(new Set(cases.map(c => c.stratum)).size).toBe(6);
    for (const c of cases) {
      expect(c.evidence).toHaveLength(3);
      expect(c.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(c)).not.toContain('patientId');
      expect(JSON.stringify(c)).not.toContain('diagnosis');
      expect(JSON.stringify(c)).not.toContain('goldStandard');
    }
    expect(syntheticCohortFingerprint(cases)).toBe(
      syntheticCohortFingerprint(createSyntheticRehearsalCohort())
    );
  });
});
