import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('HCM clinical authorization least privilege', () => {
  test('death-certificate grants do not imply general clinical-note signing', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'server/auth/authorization-context.ts'),
      'utf8'
    );
    expect(source).toMatch(/SIGN_DEATH_CERTIFICATE:\s*\['SIGN_DEATH_CERTIFICATE'\]/);
    expect(source).not.toMatch(
      /SIGN_DEATH_CERTIFICATE:\s*\[[^\]]*'SIGN_CLINICAL_NOTES'/
    );
    // General clinical-note signing remains explicitly grantable via HCM.
    expect(source).toMatch(
      /SIGN_CLINICAL_NOTE:\s*\['SIGN_CLINICAL_NOTE','SIGN_CLINICAL_NOTES'\]/
    );
    expect(source).toContain('const clinicalPrivileges = hcmPrivileges');
  });
});
