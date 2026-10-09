import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('Login portal viewport density', () => {
  test('keeps login shell compact without page-wide zoom or clipped content', async () => {
    const source = await readFile(join(process.cwd(), 'components/auth/login-portal.tsx'), 'utf8');
    expect(source).toContain('min-h-dvh bg-slate-950');
    expect(source).toContain('max-w-lg space-y-3');
    expect(source).toContain('sm:py-6 relative');
    expect(source).toContain('p-5 sm:p-6 shadow-2xl');
    expect(source).toContain('min-h-11 py-2.5');
    expect(source).toContain('min-h-10 py-2');
    expect(source).not.toMatch(/\bzoom\s*:/);
    expect(source).not.toContain('overflow-hidden');
    for (const testId of ['login-tenant-id', 'login-email', 'login-password', 'login-submit', 'login-google-identity', 'login-hospital-sso']) {
      expect(source).toContain(`data-testid="${testId}"`);
    }
  });
});
