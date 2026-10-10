import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = (file: string) => readFile(join(process.cwd(), file), 'utf8');

describe('ORC Firebase STAGING project and deployment isolation', () => {
  test('Next.js hosting remains Vercel; Firebase deploy config is Firestore-only', async () => {
    const firebase = JSON.parse(await source('firebase.json'));
    const vercel = JSON.parse(await source('vercel.json'));
    expect(firebase.firestore?.rules).toBe('firestore.rules');
    expect(firebase.firestore?.indexes).toBe('firestore.indexes.json');
    expect(firebase.hosting).toBeUndefined();
    expect(vercel.git?.deploymentEnabled).toBe(false);
  });
  test('staging preflight rejects project collisions and wrong-project Admin credentials', async () => {
    const preflight = await source('scripts/ops/drp-staging-preflight.ts');
    expect(preflight).toContain('STAGING_PRODUCTION_REFERENCE_REQUIRED');
    expect(preflight).toContain('STAGING_PROJECT_COLLISION');
    expect(preflight).toContain('STAGING_SERVICE_ACCOUNT_PROJECT_MISMATCH');
    expect(preflight).toContain('.iam.gserviceaccount.com');
    expect(preflight).toContain('firebaseCredentialsPresent');
  });
  test('guarded staging workflow verifies identity before any build or fixture writes', async () => {
    const workflow = await source('.github/workflows/staging-deploy.yml');
    expect(workflow.indexOf('Validate isolated STAGING runtime contract')).toBeGreaterThan(-1);
    expect(workflow.indexOf('Validate isolated STAGING runtime contract')).toBeLessThan(workflow.indexOf('Build exact main'));
    expect(workflow.indexOf('Validate Vercel credentials')).toBeLessThan(workflow.indexOf('Build exact main'));
    expect(workflow).toContain('vercel deploy --prebuilt --yes');
    expect(workflow).not.toContain('vercel deploy --prod');
  });
  test('operator runbook requires new project and explicit Firestore-only deployment', async () => {
    const guide = await source('docs/operations/ORC_FIREBASE_STAGING_SETUP.md');
    expect(guide).toContain('firebase use --add');
    expect(guide).toContain('firebase deploy --only firestore:rules,firestore:indexes --project staging');
    expect(guide).toContain('GHIMS_FIREBASE_PROJECT_ID_PRODUCTION');
    expect(guide).toContain('STAGING_PROJECT_ID.iam.gserviceaccount.com');
  });
  test('preflight behavior rejects project collision and wrong-project Admin service accounts', () => {
    const environment: Record<string,string> = {
      PATH: process.env.PATH || '',
      GHIMS_RUNTIME_MODE: 'STAGING',
      NEXT_PUBLIC_GHIMS_RUNTIME_MODE: 'STAGING',
      GHIMS_FIREBASE_PROJECT_ID_STAGING: 'ghims-staging-isolated-test',
      NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_STAGING: 'ghims-staging-isolated-test',
      GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'ghims-production-isolated-test',
      NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'ghims-production-isolated-test',
      FIREBASE_PROJECT_ID: 'ghims-staging-isolated-test',
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'ghims-staging-isolated-test',
      FIRESTORE_DATABASE_ID: '(default)',
      FIREBASE_CLIENT_EMAIL: 'test-admin@ghims-staging-isolated-test.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: 'fake-credential-for-preflight-only',
    };
    const run = (changes: Record<string,string> = {}) => {
      const result = Bun.spawnSync(
        [process.execPath, 'scripts/ops/drp-staging-preflight.ts'],
        { cwd: process.cwd(), env: { ...environment, ...changes }, stdout: 'pipe', stderr: 'pipe' }
      );
      return {
        exitCode: result.exitCode,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
      };
    };
    const valid = run();
    expect(valid.exitCode).toBe(0);
    expect(JSON.parse(valid.stdout).success).toBe(true);

    const collision = run({ GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'ghims-staging-isolated-test' });
    expect(collision.exitCode).not.toBe(0);
    expect(JSON.parse(collision.stderr).code).toBe('STAGING_PROJECT_COLLISION');

    const missingComparison = run({ GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: '' });
    expect(missingComparison.exitCode).not.toBe(0);
    expect(JSON.parse(missingComparison.stderr).code).toBe('STAGING_PRODUCTION_REFERENCE_REQUIRED');

    const missingPublicComparison = run({ NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: '' });
    expect(missingPublicComparison.exitCode).not.toBe(0);
    expect(JSON.parse(missingPublicComparison.stderr).code).toBe('STAGING_PUBLIC_PRODUCTION_REFERENCE_REQUIRED');

    const mismatchedPublicComparison = run({ NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_PRODUCTION: 'other-project' });
    expect(mismatchedPublicComparison.exitCode).not.toBe(0);
    expect(JSON.parse(mismatchedPublicComparison.stderr).code).toBe('STAGING_PUBLIC_PRODUCTION_REFERENCE_MISMATCH');

    const wrongAdmin = run({ FIREBASE_CLIENT_EMAIL: 'prod-admin@ghims-production-isolated-test.iam.gserviceaccount.com' });
    expect(wrongAdmin.exitCode).not.toBe(0);
    expect(JSON.parse(wrongAdmin.stderr).code).toBe('STAGING_SERVICE_ACCOUNT_PROJECT_MISMATCH');
  });

});
