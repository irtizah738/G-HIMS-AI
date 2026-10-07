import { describe, expect, test } from 'bun:test';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = (file: string) => readFile(path.join(root, file), 'utf8');

describe('Wave 3 complete clinical integration closure', () => {
  test('all Wave 3 domain qualification suites exist', async () => {
    for (const file of [
      'tests/wave3a-ipd-closure.test.ts',
      'tests/wave3b-emergency-telemetry-qualification.test.ts',
      'tests/wave3c-or-pacu-transition.test.ts',
      'tests/wave3d-telehealth-resilience.test.ts',
      'tests/ci10i-offline-production-qualification.test.ts',
      'tests/hospital0-clinical-intelligence-evidence.test.ts',
    ]) {
      await expect(access(path.join(root, file))).resolves.toBeUndefined();
    }
  });

  test('obsolete browser PACU authority is removed', async () => {
    for (const file of [
      'lib/clinical/pacu-atomic-engine.ts',
      'components/clinical/surgical-chain-modal.tsx',
      'tests/pacu-atomic-allocation.test.ts',
    ]) {
      await expect(access(path.join(root, file))).rejects.toBeDefined();
    }
  });

  test('Clinical Intelligence remains bounded to governed evidence', async () => {
    const roadmap = await source('docs/operations/GHIMS_FULL_MODULE_COMPLETION_PROGRAM.md');
    expect(roadmap).toContain('continue specialty evaluation and Hospital-0 evidence');
    expect(roadmap).toContain('do not reintroduce generic autonomous');
  });
});
