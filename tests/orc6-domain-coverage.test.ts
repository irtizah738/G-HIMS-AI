import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auditDomainRegistry } from '../scripts/ops/orc6-domain-coverage';

describe('ORC-6 executable 52-domain inventory', () => {
  test('all registry entries have unique IDs and complete numbering without invented readiness', async () => {
    const source = await readFile(join(process.cwd(), 'components/views/all-modules-directory.tsx'), 'utf8');
    const rows = auditDomainRegistry(source);
    expect(rows).toHaveLength(52);
    expect(new Set(rows.map(x => x.id)).size).toBe(52);
    expect(rows.map(x=>x.domainNumber)).toEqual(Array.from({length:52},(_,i)=>i+1));
    expect(rows.every(x=>x.operationalQualification==='UNVERIFIED')).toBe(true);
  });
  test('missing/duplicate domains fail closed', () => {
    expect(() => auditDomainRegistry('const a = [{domainNumber:1,id:"only",name:"Partial",status:"REGISTERED"}]')).toThrow('ORC_DOMAIN_COVERAGE_INVALID');
  });
});
