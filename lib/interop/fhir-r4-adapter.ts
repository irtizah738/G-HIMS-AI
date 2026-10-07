import type { IntegrationState } from './integration-state';

export interface FhirResource {
  resourceType: string;
  id?: string;
  meta?: {
    versionId?: string;
    lastUpdated?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface FhirBundle<TResource extends FhirResource = FhirResource> extends FhirResource {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  link?: Array<{ relation: string; url: string }>;
  entry?: Array<{ fullUrl?: string; resource?: TResource }>;
}

export interface FhirOperationOutcome extends FhirResource {
  resourceType: 'OperationOutcome';
  issue?: Array<{
    severity?: string;
    code?: string;
    diagnostics?: string;
    details?: { text?: string };
  }>;
}

export interface FhirCapabilityStatement extends FhirResource {
  resourceType: 'CapabilityStatement';
  fhirVersion?: string;
  rest?: Array<{
    mode?: string;
    resource?: Array<{
      type?: string;
      interaction?: Array<{ code?: string }>;
      searchParam?: Array<{ name?: string; type?: string }>;
    }>;
  }>;
}

export interface FhirResourceCapabilityRequirement {
  resourceType: string;
  read?: boolean;
  search?: boolean;
  create?: boolean;
  update?: boolean;
}

export interface FhirConformanceReport {
  valid: boolean;
  fhirVersion?: string;
  checkedAt: number;
  errors: string[];
  warnings: string[];
  resources: Array<{
    resourceType: string;
    interactions: string[];
  }>;
}

export interface FhirR4AdapterConfig {
  baseUrl: string;
  state: IntegrationState;
  accessToken?: string;
  getAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxReadRetries?: number;
  approvedResourceTypes?: string[];
  writableResourceTypes?: string[];
  requireHttpsInProduction?: boolean;
}

export const DEFAULT_APPROVED_FHIR_R4_RESOURCES = [
  'Patient',
  'Encounter',
  'Observation',
  'DiagnosticReport',
  'Condition',
  'AllergyIntolerance',
  'MedicationRequest',
  'MedicationAdministration',
  'Procedure',
  'CarePlan',
  'DocumentReference',
] as const;

export const DEFAULT_WRITABLE_FHIR_R4_RESOURCES = [
  'Observation',
  'DiagnosticReport',
  'DocumentReference',
] as const;

function assertResource(value: unknown, expectedType?: string): FhirResource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('FHIR_INVALID_RESOURCE: response must be a JSON object.');
  }

  const resource = value as FhirResource;
  if (!resource.resourceType || typeof resource.resourceType !== 'string') {
    throw new Error('FHIR_INVALID_RESOURCE: resourceType is required.');
  }

  if (expectedType && resource.resourceType !== expectedType) {
    throw new Error(
      'FHIR_RESOURCE_TYPE_MISMATCH: expected ' + expectedType + ' but received ' + resource.resourceType + '.'
    );
  }

  return resource;
}

function outcomeMessage(value: unknown): string {
  try {
    const outcome = value as FhirOperationOutcome;
    const issue = outcome?.resourceType === 'OperationOutcome' ? outcome.issue?.[0] : undefined;
    return issue?.diagnostics || issue?.details?.text || issue?.code || 'FHIR server rejected the request.';
  } catch {
    return 'FHIR server rejected the request.';
  }
}

function isProductionRuntime(): boolean {
  return String(process.env.GHIMS_RUNTIME_MODE || process.env.NODE_ENV || '')
    .trim()
    .toUpperCase() === 'PRODUCTION';
}

function shouldRetryRead(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Standards-native FHIR R4 HTTP adapter.
 *
 * The adapter exposes only explicitly approved resource types. Writes are further
 * restricted to a separate writable-resource allowlist. No mock fallback exists.
 */
export class FhirR4Adapter {
  private readonly baseUrl: string;
  private readonly state: IntegrationState;
  private readonly accessToken?: string;
  private readonly getAccessToken?: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxReadRetries: number;
  private readonly approvedResourceTypes: Set<string>;
  private readonly writableResourceTypes: Set<string>;
  private readonly requireHttpsInProduction: boolean;

  constructor(config: FhirR4AdapterConfig) {
    const configuredBaseUrl = String(config.baseUrl || '');
    this.baseUrl = configuredBaseUrl.endsWith('/') ? configuredBaseUrl.slice(0, -1) : configuredBaseUrl;
    this.state = config.state;
    this.accessToken = config.accessToken;
    this.getAccessToken = config.getAccessToken;
    this.fetchImpl = config.fetchImpl || fetch;
    this.timeoutMs = config.timeoutMs || 15000;
    this.maxReadRetries = Math.max(0, Math.min(3, config.maxReadRetries ?? 1));
    this.approvedResourceTypes = new Set(
      config.approvedResourceTypes || [...DEFAULT_APPROVED_FHIR_R4_RESOURCES]
    );
    this.writableResourceTypes = new Set(
      config.writableResourceTypes || [...DEFAULT_WRITABLE_FHIR_R4_RESOURCES]
    );
    this.requireHttpsInProduction = config.requireHttpsInProduction ?? true;

    if (!this.baseUrl) {
      throw new Error('FHIR_CONFIG_INVALID: baseUrl is required.');
    }
    if (
      this.state === 'LIVE' &&
      this.requireHttpsInProduction &&
      isProductionRuntime()
    ) {
      const url = new URL(this.baseUrl);
      if (url.protocol !== 'https:') {
        throw new Error('FHIR_TLS_REQUIRED_IN_PRODUCTION');
      }
    }

    for (const resourceType of this.writableResourceTypes) {
      if (!this.approvedResourceTypes.has(resourceType)) {
        throw new Error(
          'FHIR_CONFIG_INVALID: writable resource ' + resourceType + ' is not approved.'
        );
      }
    }
  }

  public getState(): IntegrationState {
    return this.state;
  }

  public getApprovedResourceTypes(): string[] {
    return [...this.approvedResourceTypes];
  }

  public getWritableResourceTypes(): string[] {
    return [...this.writableResourceTypes];
  }

  private assertLive(): void {
    if (this.state !== 'LIVE') {
      throw new Error(
        'FHIR_INTEGRATION_NOT_LIVE: current state is ' + this.state + '; external FHIR traffic is blocked.'
      );
    }
  }

  private assertApproved(resourceType: string): string {
    const normalized = String(resourceType || '').trim();
    if (!normalized || !this.approvedResourceTypes.has(normalized)) {
      throw new Error('FHIR_RESOURCE_NOT_APPROVED: ' + normalized);
    }
    return normalized;
  }

  private assertWritable(resourceType: string): string {
    const normalized = this.assertApproved(resourceType);
    if (!this.writableResourceTypes.has(normalized)) {
      throw new Error('FHIR_RESOURCE_WRITE_NOT_APPROVED: ' + normalized);
    }
    return normalized;
  }

  private async token(): Promise<string | undefined> {
    if (this.getAccessToken) {
      const token = await this.getAccessToken();
      return String(token || '').trim() || undefined;
    }
    return String(this.accessToken || '').trim() || undefined;
  }

  private async request<T extends FhirResource>(
    path: string,
    init: RequestInit,
    expectedType?: string,
    retrySafeRead = false
  ): Promise<T> {
    this.assertLive();
    const attempts = retrySafeRead ? this.maxReadRetries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const token = await this.token();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchImpl(this.baseUrl + path, {
          ...init,
          signal: controller.signal,
          headers: {
            Accept: 'application/fhir+json',
            ...(init.body ? { 'Content-Type': 'application/fhir+json' } : {}),
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
            ...(init.headers || {}),
          },
        });

        const text = await response.text();
        let payload: unknown = {};
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch {
            throw new Error('FHIR_INVALID_JSON_RESPONSE');
          }
        }

        if (!response.ok) {
          if (
            retrySafeRead &&
            shouldRetryRead(response.status) &&
            attempt + 1 < attempts
          ) {
            lastError = new Error('FHIR_HTTP_' + response.status);
            continue;
          }
          throw new Error(
            'FHIR_HTTP_' + response.status + ': ' + outcomeMessage(payload)
          );
        }

        return assertResource(payload, expectedType) as T;
      } catch (error) {
        lastError = error;
        if (!retrySafeRead || attempt + 1 >= attempts) throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('FHIR_REQUEST_FAILED');
  }

  public async readCapabilityStatement(): Promise<FhirCapabilityStatement> {
    return this.request<FhirCapabilityStatement>(
      '/metadata',
      { method: 'GET' },
      'CapabilityStatement',
      true
    );
  }

  public async qualifyApprovedResources(
    requirements: FhirResourceCapabilityRequirement[]
  ): Promise<FhirConformanceReport> {
    const capability = await this.readCapabilityStatement();
    const errors: string[] = [];
    const warnings: string[] = [];
    const serverResources = new Map<string, Set<string>>();

    for (const rest of capability.rest || []) {
      if (rest.mode && rest.mode !== 'server') continue;
      for (const resource of rest.resource || []) {
        const type = String(resource.type || '').trim();
        if (!type) continue;
        serverResources.set(
          type,
          new Set((resource.interaction || []).map((item) => String(item.code || '').trim()))
        );
      }
    }

    for (const requirement of requirements) {
      const type = this.assertApproved(requirement.resourceType);
      const interactions = serverResources.get(type);
      if (!interactions) {
        errors.push('FHIR_RESOURCE_UNSUPPORTED:' + type);
        continue;
      }
      const checks: Array<[keyof FhirResourceCapabilityRequirement, string]> = [
        ['read', 'read'],
        ['search', 'search-type'],
        ['create', 'create'],
        ['update', 'update'],
      ];
      for (const [flag, interaction] of checks) {
        if (requirement[flag] && !interactions.has(interaction)) {
          errors.push('FHIR_INTERACTION_UNSUPPORTED:' + type + ':' + interaction);
        }
      }
    }

    if (capability.fhirVersion && !String(capability.fhirVersion).startsWith('4.')) {
      errors.push('FHIR_VERSION_NOT_R4:' + capability.fhirVersion);
    } else if (!capability.fhirVersion) {
      warnings.push('FHIR_CAPABILITY_VERSION_MISSING');
    }

    return {
      valid: errors.length === 0,
      fhirVersion: capability.fhirVersion,
      checkedAt: Date.now(),
      errors,
      warnings,
      resources: [...serverResources.entries()].map(([resourceType, interactions]) => ({
        resourceType,
        interactions: [...interactions],
      })),
    };
  }

  public async readResource<T extends FhirResource>(
    resourceType: string,
    id: string
  ): Promise<T> {
    const type = this.assertApproved(resourceType);
    const resourceId = encodeURIComponent(String(id || '').trim());
    if (!resourceId) {
      throw new Error('FHIR_READ_INVALID: resourceType and id are required.');
    }
    return this.request<T>(
      '/' + encodeURIComponent(type) + '/' + resourceId,
      { method: 'GET' },
      type,
      true
    );
  }

  public async search<T extends FhirResource>(
    resourceType: string,
    params: Record<string, string | number | boolean | undefined>
  ): Promise<FhirBundle<T>> {
    const type = this.assertApproved(resourceType);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined) query.set(key, String(value));
    }

    const suffix = query.toString() ? '?' + query.toString() : '';
    const bundle = await this.request<FhirBundle<T>>(
      '/' + encodeURIComponent(type) + suffix,
      { method: 'GET' },
      'Bundle',
      true
    );

    if (bundle.type !== 'searchset') {
      throw new Error('FHIR_INVALID_BUNDLE: expected searchset bundle.');
    }

    for (const entry of bundle.entry || []) {
      if (entry.resource && entry.resource.resourceType !== type) {
        throw new Error('FHIR_SEARCH_RESOURCE_TYPE_MISMATCH');
      }
    }

    return bundle;
  }

  public async createResource<T extends FhirResource>(
    resource: T,
    options: { ifNoneExist?: string } = {}
  ): Promise<T> {
    assertResource(resource);
    const type = this.assertWritable(resource.resourceType);
    return this.request<T>(
      '/' + encodeURIComponent(type),
      {
        method: 'POST',
        body: JSON.stringify(resource),
        ...(options.ifNoneExist
          ? { headers: { 'If-None-Exist': options.ifNoneExist } }
          : {}),
      },
      type,
      false
    );
  }

  public async updateResource<T extends FhirResource>(
    resource: T,
    options: { expectedVersionId?: string } = {}
  ): Promise<T> {
    assertResource(resource);
    const type = this.assertWritable(resource.resourceType);
    if (!resource.id) {
      throw new Error('FHIR_UPDATE_INVALID: resource.id is required.');
    }

    const expectedVersionId = String(
      options.expectedVersionId || resource.meta?.versionId || ''
    ).trim();

    return this.request<T>(
      '/' + encodeURIComponent(type) + '/' + encodeURIComponent(resource.id),
      {
        method: 'PUT',
        body: JSON.stringify(resource),
        ...(expectedVersionId
          ? { headers: { 'If-Match': 'W/"' + expectedVersionId + '"' } }
          : {}),
      },
      type,
      false
    );
  }
}
