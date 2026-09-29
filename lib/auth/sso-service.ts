import {
  SSOConfiguration,
  SSOTestResult,
  SSOLoginRequest,
  SSOCallbackPayload,
  SSOProviderType,
} from './sso-types';

const SSO_STORAGE_KEY_PREFIX = 'ghims_sso_config_';

export const DEFAULT_SSO_CONFIG: SSOConfiguration = {
  id: 'sso_okta_centralmetro',
  tenantId: 'central-metro-hospital',
  enabled: true,
  providerType: 'OKTA',
  providerName: 'Central Metro Okta SAML 2.0 Identity Provider',
  entityId: 'https://centralmetro.okta.com/app/ghims_production/sso/saml/metadata',
  ssoSignOnUrl: 'https://centralmetro.okta.com/app/ghims_production/sso/saml',
  ssoLogoutUrl: 'https://centralmetro.okta.com/app/ghims_production/sso/saml/logout',
  acsUrl: 'https://centralmetro.health/api/auth/sso/callback',
  certificate: `-----BEGIN CERTIFICATE-----
MIICljCCAX4CCQDzW1m7u9q+PTANBgkqhkiG9w0BAQsFADANMQswCQYDVQQGEwJV
UzEgMB4GA1UECgwXQ2VudHJhbCBNZXRybyBIZWFsdGhjYXJlMSAwHgYDVQQLDBdI
SVBBQSBJZGVudGl0eSBHdWlyZDEiMCAGA1UEAwwZQ2VudHJhbE1ldHJvIFNBTUwg
U2lnbmVyMB4XDTI2MDEwMTAwMDAwMFoXDTM2MDEwMTAwMDAwMFowDTELMAkGA1UE
BhMCVVMxIDAeBgNVBAoMF0NlbnRyYWwgTWV0cm8gSGVhbHRoY2FyZTEgMB4GA1UE
CwwXSElQQUEgSWRlbnRpdHkgR3VpcmQxIjAgBgNVBAMMGUNlbnRyYWxNZXRybyBT
QU1MIFNpZ25lcjCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAL0y3...
-----END CERTIFICATE-----`,
  clientId: '0oa4819z1x88BqPl7697',
  clientSecret: '••••••••••••••••••••••••••••••••',
  oidcDiscoveryUrl: 'https://centralmetro.okta.com/.well-known/openid-configuration',
  allowedEmailDomains: ['centralmetro.health', 'nyc-health.org', 'specialist-clinics.org'],
  defaultRole: 'physician',
  defaultDepartment: 'Cardiology & Intensive Care',
  enforceSSO: false,
  allowPasswordFallback: true,
  autoProvisionUsers: true,
  attributeMapping: {
    emailField: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    nameField: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
    roleField: 'https://ghims.health/claims/clinical_role',
    departmentField: 'https://ghims.health/claims/department',
    npiField: 'https://ghims.health/claims/npi_number',
  },
  lastVerifiedAt: '2026-02-18T10:15:00.000Z',
  status: 'ACTIVE',
  createdAt: '2026-01-05T00:00:00.000Z',
  updatedAt: '2026-02-18T10:15:00.000Z',
};

/**
 * SSO configuration is server-owned. Browser Firestore access to
 * tenants/{tenantId}/config is intentionally denied by firestore.rules.
 *
 * Until the real OIDC/SAML integration is installed, only DEMO runtime may
 * expose the local synthetic configuration. TEST/STAGING/PRODUCTION return an
 * explicit disabled configuration and never probe Firestore from the browser.
 */
function isDemoClientRuntime(): boolean {
  return process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO';
}

function disabledSSOConfiguration(tenantId: string): SSOConfiguration {
  return {
    ...DEFAULT_SSO_CONFIG,
    tenantId,
    enabled: false,
    enforceSSO: false,
    autoProvisionUsers: false,
    status: 'DISABLED',
    certificate: undefined,
    clientSecret: undefined,
    lastVerifiedAt: undefined,
  };
}

/**
 * Loads SSO configuration for a tenant.
 */
export async function getSSOConfiguration(tenantId: string): Promise<SSOConfiguration> {
  const cleanTenant = tenantId || 'central-metro-hospital';

  if (!isDemoClientRuntime()) {
    return disabledSSOConfiguration(cleanTenant);
  }

  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem(`${SSO_STORAGE_KEY_PREFIX}${cleanTenant}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.providerType) {
          return parsed as SSOConfiguration;
        }
      }
    } catch {
      // A missing/corrupt demo cache falls back to the deterministic demo config.
    }
  }

  const config = { ...DEFAULT_SSO_CONFIG, tenantId: cleanTenant };
  saveSSOToLocalStorage(cleanTenant, config);
  return config;
}

/**
 * Saves SSO configuration for a tenant.
 *
 * Live SSO administration is not implemented yet. Keep this fail-closed outside
 * DEMO instead of attempting a browser write to a server-only Firestore path.
 */
export async function saveSSOConfiguration(
  tenantId: string,
  config: SSOConfiguration
): Promise<SSOConfiguration> {
  const cleanTenant = tenantId || 'central-metro-hospital';

  if (!isDemoClientRuntime()) {
    throw new Error(
      'SSO_CONFIG_DISABLED: live SSO configuration is server-owned and not enabled in this runtime.'
    );
  }

  const updated: SSOConfiguration = {
    ...config,
    tenantId: cleanTenant,
    updatedAt: new Date().toISOString(),
  };

  saveSSOToLocalStorage(cleanTenant, updated);
  return updated;
}

/**
 * Tests SSO Connection, validating metadata and certificate
 */
export async function testSSOConfiguration(
  config: SSOConfiguration
): Promise<SSOTestResult> {
  const startTime = Date.now();

  try {
    const response = await fetch('/api/auth/sso/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    });

    const data = await response.json();
    return data;
  } catch (err: any) {
    return {
      success: false,
      providerType: config.providerType,
      entityId: config.entityId,
      statusMessage: err?.message || 'Failed to connect to SSO Identity Provider',
      certificateValid: false,
      endpointsReachable: false,
      latencyMs: Date.now() - startTime,
      testedAt: new Date().toISOString(),
    };
  }
}

/**
 * Performs federated SSO login (Mock / Real SAML / OIDC exchange)
 */
export async function executeSSOLogin(payload: SSOCallbackPayload): Promise<any> {
  const response = await fetch('/api/auth/sso/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || data.message || 'SSO Authentication failed');
  }

  return data;
}

function saveSSOToLocalStorage(tenantId: string, config: SSOConfiguration) {
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`${SSO_STORAGE_KEY_PREFIX}${tenantId}`, JSON.stringify(config));
    } catch {
      // ignore
    }
  }
}
