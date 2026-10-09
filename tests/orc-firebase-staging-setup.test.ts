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
});
