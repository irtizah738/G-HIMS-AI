import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('Hospital-0 login facility boundary', () => {
  test('login requires explicit Central Metro facility selection', async () => {
    const portal = await source('components/auth/login-portal.tsx');

    expect(portal).toContain("tenantId: 'central-metro-hospital'");
    expect(portal).toContain("name: 'Central Metro General Hospital'");
    expect(portal).toContain('list="ghims-hospital-facilities"');
    expect(portal).toContain('Facility selection is required');
    expect(portal).toContain('resolveFacilityTenantId');
  });

  test('session establishment rejects missing facility selection', async () => {
    const authClient = await source('lib/auth/auth-client.ts');

    expect(authClient).toContain("code: 'TENANT_SELECTION_REQUIRED'");
    expect(authClient).toContain(
      'Explicit hospital facility selection is required before a G-HIMS session can be established.'
    );
  });

  test('server auth routes enforce the configured Hospital-0 tenant boundary', async () => {
    const sessionRoute = await source('app/api/auth/session/route.ts');
    const selectionRoute = await source('app/api/auth/tenant-selection/route.ts');

    expect(sessionRoute).toContain('GHIMS_HOSPITAL0_TENANT_ID');
    expect(sessionRoute).toContain('assertHospital0TenantScope');
    expect(selectionRoute).toContain('filterHospital0Tenants');
    expect(selectionRoute).toContain('assertHospital0TenantScope');
  });

  test('attached Firebase config names the Hospital-0 Firestore database', async () => {
    const config = JSON.parse(await source('firebase-applet-config.json'));

    expect(config.projectId).toBe('g-hims-ai');
    expect(config.firestoreDatabaseId).toBe(
      'ai-studio-ghimsos-8d860f4b-3a80-47b3-bf97-15b9dc0d7fa7'
    );
  });
});
