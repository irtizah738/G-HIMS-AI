import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('G-HIMS login facility directory', () => {
  test('login requires an explicit facility selected from the Firestore tenant directory', async () => {
    const portal = await source('components/auth/login-portal.tsx');
    const directoryRoute = await source('app/api/auth/facilities/route.ts');

    expect(portal).toContain('<select');
    expect(portal).toContain('data-testid="login-tenant-id"');
    expect(portal).toContain('Select hospital facility');
    expect(portal).toContain("fetch('/api/auth/facilities'");
    expect(portal).toContain('facilities.map((facility)');
    expect(portal).toContain('resolveFacilityTenantId(tenantId, facilities)');
    expect(portal).toContain('Facility selection is required');

    expect(directoryRoute).toContain("db.collection('tenants').get()");
    expect(directoryRoute).toContain('document.id');
    expect(directoryRoute).toContain('facilityCode');
    expect(directoryRoute).toContain("'Cache-Control': 'no-store'");
  });

  test('federated identity controls surface failures instead of silently doing nothing', async () => {
    const portal = await source('components/auth/login-portal.tsx');
    const firebaseAuth = await source('lib/firebase/auth-context.tsx');
    const ssoRoute = await source('app/api/auth/sso/login/route.ts');

    expect(portal).toContain('data-testid="login-google-identity"');
    expect(portal).toContain('data-testid="login-hospital-sso"');
    expect(portal).toContain('data-testid="login-sso-submit"');
    expect(portal).toContain('data-testid="login-sso-error"');
    expect(portal).toContain('mapAuthError(err)');
    expect(portal).toContain('ssoProvider');
    expect(firebaseAuth).not.toContain(
      "errorCode === 'auth/popup-blocked' ||\n        errorMessage.includes('popup-closed-by-user')"
    );
    expect(ssoRoute).toContain("provider !== 'OKTA' && provider !== 'AZURE_AD'");
    expect(ssoRoute).toContain('SSO_CONFIG_ERROR');
  });

  test('session establishment rejects missing facility selection', async () => {
    const authClient = await source('lib/auth/auth-client.ts');

    expect(authClient).toContain("code: 'TENANT_SELECTION_REQUIRED'");
    expect(authClient).toContain(
      'Explicit hospital facility selection is required before a G-HIMS session can be established.'
    );
  });

  test('tenant access remains membership-governed rather than hard-restricted to Hospital-0', async () => {
    const sessionRoute = await source('app/api/auth/session/route.ts');
    const selectionRoute = await source('app/api/auth/tenant-selection/route.ts');

    expect(sessionRoute).toContain('resolveAuthorizationContext(verifiedToken, requestedTenantId)');
    expect(sessionRoute).toContain('getUserAccessibleTenants');
    expect(sessionRoute).not.toContain('assertHospital0TenantScope');
    expect(selectionRoute).toContain('getTenantMembership');
    expect(selectionRoute).not.toContain('filterHospital0Tenants');
  });

  test('attached Firebase config names the Hospital-0 Firestore database used by the directory', async () => {
    const config = JSON.parse(await source('firebase-applet-config.json'));

    expect(config.projectId).toBe('g-hims-ai');
    expect(config.firestoreDatabaseId).toBe(
      'ai-studio-ghimsos-8d860f4b-3a80-47b3-bf97-15b9dc0d7fa7'
    );
  });
});
