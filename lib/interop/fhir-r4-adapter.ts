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

export interface FhirR4AdapterConfig {
  baseUrl: string;
  state: IntegrationState;
  accessToken?: string;
  getAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

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

/**
 * Standards-native FHIR R4 HTTP adapter.
 *
 * This adapter never fabricates resources and never falls back to local mock data.
 * It is usable only when explicitly configured LIVE; INTEGRATION_READY is a deployment
 * readiness state, not permission to exchange PHI.
 */
export class FhirR4Adapter {
  private readonly baseUrl: string;
  private readonly state: IntegrationState;
  private readonly accessToken?: string;
  private readonly getAccessToken?: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: FhirR4AdapterConfig) {
    this.baseUrl = String(config.baseUrl || '').replace(/\/$/, '');
    this.state = config.state;
    this.accessToken = config.accessToken;
    this.getAccessToken = config.getAccessToken;
    this.fetchImpl = config.fetchImpl || fetch;
    this.timeoutMs = config.timeoutMs || 15000;

    if (!this.baseUrl) {
      throw new Error('FHIR_CONFIG_INVALID: baseUrl is required.');
    }
  }

  public getState(): IntegrationState {
    return this.state;
  }

  private assertLive(): void {
    if (this.state !== 'LIVE') {
      throw new Error(
        'FHIR_INTEGRATION_NOT_LIVE: current state is ' + this.state + '; external FHIR traffic is blocked.'
      );
    }
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
    expectedType?: string
  ): Promise<T> {
    this.assertLive();

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
      const payload = text ? JSON.parse(text) : {};

      if (!response.ok) {
        throw new Error(
          'FHIR_HTTP_' + response.status + ': ' + outcomeMessage(payload)
        );
      }

      return assertResource(payload, expectedType) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  public async readResource<T extends FhirResource>(
    resourceType: string,
    id: string
  ): Promise<T> {
    const type = encodeURIComponent(String(resourceType || '').trim());
    const resourceId = encodeURIComponent(String(id || '').trim());
    if (!type || !resourceId) {
      throw new Error('FHIR_READ_INVALID: resourceType and id are required.');
    }
    return this.request<T>('/' + type + '/' + resourceId, { method: 'GET' }, resourceType);
  }

  public async search<T extends FhirResource>(
    resourceType: string,
    params: Record<string, string | number | boolean | undefined>
  ): Promise<FhirBundle<T>> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined) query.set(key, String(value));
    }

    const suffix = query.toString() ? '?' + query.toString() : '';
    const bundle = await this.request<FhirBundle<T>>(
      '/' + encodeURIComponent(resourceType) + suffix,
      { method: 'GET' },
      'Bundle'
    );

    if (bundle.type !== 'searchset') {
      throw new Error('FHIR_INVALID_BUNDLE: expected searchset bundle.');
    }

    return bundle;
  }

  public async createResource<T extends FhirResource>(resource: T): Promise<T> {
    assertResource(resource);
    return this.request<T>(
      '/' + encodeURIComponent(resource.resourceType),
      { method: 'POST', body: JSON.stringify(resource) },
      resource.resourceType
    );
  }

  public async updateResource<T extends FhirResource>(resource: T): Promise<T> {
    assertResource(resource);
    if (!resource.id) {
      throw new Error('FHIR_UPDATE_INVALID: resource.id is required.');
    }

    return this.request<T>(
      '/' + encodeURIComponent(resource.resourceType) + '/' + encodeURIComponent(resource.id),
      { method: 'PUT', body: JSON.stringify(resource) },
      resource.resourceType
    );
  }
}
