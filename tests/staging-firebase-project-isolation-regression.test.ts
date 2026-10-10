import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertStagingProjectDistinct } from '@/lib/runtime/environment-contract';

describe('Staging Firebase isolation is mandatory across server and browser', () => {
  test('missing production comparator never permits a staging Firebase session', () => {
    expect(() => assertStagingProjectDistinct('staging-hospital', undefined, 'client'))
      .toThrow('ENVIRONMENT_STAGING_ISOLATION_UNVERIFIED');
    expect(() => assertStagingProjectDistinct('staging-hospital', '', 'server'))
      .toThrow('ENVIRONMENT_STAGING_ISOLATION_UNVERIFIED');
    expect(() => assertStagingProjectDistinct('', 'production-hospital', 'client'))
      .toThrow('ENVIRONMENT_STAGING_ISOLATION_UNVERIFIED');
  });

  test('the same project for preview and production is rejected for both SDKs', () => {
    for (const scope of ['client', 'server'] as const) {
      expect(() => assertStagingProjectDistinct('shared-project', 'shared-project', scope))
        .toThrow('ENVIRONMENT_PROJECT_COLLISION');
      expect(() => assertStagingProjectDistinct(' staging-only ', 'production-only', scope))
        .not.toThrow();
    }
  });

  test('all Firebase SDK constructors must check isolation before initialization', async () => {
    const env = await readFile(path.join(process.cwd(), 'lib/runtime/environment-contract.ts'), 'utf8');
    const client = await readFile(path.join(process.cwd(), 'lib/firebase/client.ts'), 'utf8');
    const admin = await readFile(path.join(process.cwd(), 'server/firebase/admin.ts'), 'utf8');
    const preflight = await readFile(path.join(process.cwd(), 'scripts/ops/drp-staging-preflight.ts'), 'utf8');

    expect(env).toContain("assertStagingProjectDistinct(projects.STAGING, projects.PRODUCTION, 'client')");
    expect(env).toContain("assertStagingProjectDistinct(projects.STAGING, projects.PRODUCTION, 'server')");
    expect(client.indexOf('assertClientFirebaseProjectIsolation(')).toBeLessThan(client.indexOf('initializeApp(clientCredentials)'));
    expect(admin.indexOf('assertServerFirebaseProjectIsolation(String(projectId ||')).
      toBeLessThan(admin.indexOf('initializeApp({'));
    expect(preflight).toContain('STAGING_PUBLIC_PRODUCTION_REFERENCE_REQUIRED');
    expect(preflight).toContain('STAGING_PUBLIC_PRODUCTION_REFERENCE_MISMATCH');
    expect(preflight).toContain('publicProductionProject !== productionProject');
  });
});
