export type SSOProviderType =
  | 'SAML_2_0'
  | 'OIDC'
  | 'AZURE_AD'
  | 'OKTA'
  | 'GOOGLE_WORKSPACE'
  | 'PING_IDENTITY';

export type SSOStatus = 'ACTIVE' | 'TESTING' | 'DISABLED' | 'ERROR';

export interface AttributeMapping {
  emailField: string;
  nameField: string;
  roleField: string;
  departmentField: string;
  npiField: string;
}

export interface SSOConfiguration {
  id: string;
  tenantId: string;
  enabled: boolean;
  providerType: SSOProviderType;
  providerName: string;
  entityId: string;
  ssoSignOnUrl: string;
  ssoLogoutUrl?: string;
  acsUrl: string; // Assertion Consumer Service / Redirect Callback URL
  certificate?: string; // X.509 Certificate in PEM format
  clientId?: string; // OIDC Client ID
  clientSecret?: string; // OIDC Client Secret
  oidcDiscoveryUrl?: string; // e.g. https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration
  allowedEmailDomains: string[];
  defaultRole: string;
  defaultDepartment: string;
  enforceSSO: boolean; // Forces matching email domains to authenticate strictly via SSO
  allowPasswordFallback: boolean; // Permits break-glass local accounts
  autoProvisionUsers: boolean; // Just-In-Time (JIT) user account creation
  attributeMapping: AttributeMapping;
  lastVerifiedAt?: string;
  status: SSOStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SSOTestResult {
  success: boolean;
  providerType: SSOProviderType;
  entityId: string;
  statusMessage: string;
  certificateValid: boolean;
  certificateExpiry?: string;
  endpointsReachable: boolean;
  simulatedAttributes?: Record<string, string>;
  latencyMs: number;
  testedAt: string;
}

export interface SSOLoginRequest {
  tenantId: string;
  providerId?: string;
  email?: string;
  relayState?: string;
}

export interface SSOCallbackPayload {
  tenantId: string;
  providerType: SSOProviderType;
  samlResponse?: string;
  oidcToken?: string;
  email?: string;
  displayName?: string;
  role?: string;
  department?: string;
  rememberDevice?: boolean;
}
