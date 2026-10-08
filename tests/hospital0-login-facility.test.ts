import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('Login facility directory boundary', () => {
  test('login facility dropdown is populated from the server Firestore directory', async () => {
    const portal = await source('components/auth/login-portal.tsx');
    const route = await source('app/api/auth/facilities/route.ts');

    expect(portal).toContain('<select');
    expect(portal).toContain('data-testid="login-tenant-id"');
    expect(portal).toContain("fetch('/api/auth/facilities'");
    expect(portal).toContain('facilities.map((facility)');
    expect(portal).toContain('Facilities are loaded from the Firestore tenant directory');
    expect(portal).not.toContain('NEXT_PUBLIC_GHIMS_HOSPITAL0_TENANT_ID');
    expect(portal).not.toContain('HOSPITAL_FACILITIES');
    expect(portal).not.toContain('DEMO_PERSONAS');
    expect(portal).not.toContain('handleSelectPersona');
    expect(portal).not.toContain('showDemoPersonas');
    expect(portal).not.toContain('central-metro-hospital');

    expect(route).toContain("db.collection('tenants').get()");
    expect(route).toContain("headers: { 'Cache-Control': 'no-store' }");
    expect(route).toContain('tenantId: doc.id');
  });

  test('facility selection remains non-authoritative and server membership gates session creation', async () => {
    const sessionRoute = await source('app/api/auth/session/route.ts');
    const selectionRoute = await source('app/api/auth/tenant-selection/route.ts');
    const membership = await source('server/auth/tenant-membership.ts');

    expect(sessionRoute).toContain('await resolveAuthorizationContext(verifiedToken, requestedTenantId)');
    expect(sessionRoute).not.toContain('assertHospital0TenantScope');
    expect(sessionRoute).not.toContain('filterHospital0Tenants');

    expect(selectionRoute).toContain('getTenantMembership(targetTenantId');
    expect(selectionRoute).toContain("membership.status !== 'ACTIVE'");
    expect(selectionRoute).not.toContain('assertHospital0TenantScope');
    expect(selectionRoute).not.toContain('filterHospital0Tenants');

    expect(membership).toContain(".collection('tenants')");
    expect(membership).toContain(".collection('users')");
    expect(membership).toContain("code: 'TENANT_ACCESS_DENIED'");
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

  test('session establishment still rejects missing facility selection', async () => {
    const authClient = await source('lib/auth/auth-client.ts');

    expect(authClient).toContain("code: 'TENANT_SELECTION_REQUIRED'");
    expect(authClient).toContain(
      'Explicit hospital facility selection is required before a G-HIMS session can be established.'
    );
  });

  test('attached Firebase config retains the named Firestore database', async () => {
    const config = JSON.parse(await source('firebase-applet-config.json'));

    expect(config.projectId).toBe('g-hims-ai');
    expect(config.firestoreDatabaseId).toBe(
      'ai-studio-ghimsos-8d860f4b-3a80-47b3-bf97-15b9dc0d7fa7'
    );
  });
});
