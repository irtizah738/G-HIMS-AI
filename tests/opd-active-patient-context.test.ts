import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('OPD active patient context safety', () => {
  test('the active OPD encounter drives the hospital shell patient identity', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');

    expect(workspace).toContain("import { useHospital } from '@/lib/context/hospital-context';");
    expect(workspace).toContain('selectedPatientId: shellSelectedPatientId');
    expect(workspace).toContain('setSelectedPatientId: setShellSelectedPatientId');
    expect(workspace).toContain("const patientId = String(activeEncounter?.patientId || '').trim();");
    expect(workspace).toContain('shellSelectedPatientId === patientId');
    expect(workspace).toContain('setShellSelectedPatientId(patientId)');
  });
});
