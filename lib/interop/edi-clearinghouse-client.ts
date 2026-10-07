import { Edi837Generator, type Edi837ClaimPayload } from './edi-837-generator';
import type { IntegrationState } from './integration-state';

export interface EdiClearinghouseClientConfig {
  baseUrl: string;
  state: IntegrationState;
  programEnabled: boolean;
  externalConformanceQualified: boolean;
  apiKey?: string;
  getAccessToken?: () => Promise<string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface Edi837SubmissionResult {
  acceptedForTransport: boolean;
  clearinghouseSubmissionId?: string;
  receivedAt?: string;
  rawResponse?: string;
}

function isProductionRuntime(): boolean {
  return String(process.env.GHIMS_RUNTIME_MODE || process.env.NODE_ENV || '')
    .trim()
    .toUpperCase() === 'PRODUCTION';
}

export class EdiClearinghouseClient {
  private readonly baseUrl: string;
  private readonly state: IntegrationState;
  private readonly programEnabled: boolean;
  private readonly externalConformanceQualified: boolean;
  private readonly apiKey?: string;
  private readonly getAccessToken?: () => Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: EdiClearinghouseClientConfig) {
    this.baseUrl = String(config.baseUrl || '').replace(/\/$/, '');
    this.state = config.state;
    this.programEnabled = config.programEnabled;
    this.externalConformanceQualified = config.externalConformanceQualified;
    this.apiKey = config.apiKey;
    this.getAccessToken = config.getAccessToken;
    this.fetchImpl = config.fetchImpl || fetch;
    this.timeoutMs = config.timeoutMs || 20000;

    if (!this.baseUrl) throw new Error('EDI_CLEARINGHOUSE_BASE_URL_REQUIRED');
    if (this.state === 'LIVE' && isProductionRuntime()) {
      const url = new URL(this.baseUrl);
      if (url.protocol !== 'https:') {
        throw new Error('EDI_TLS_REQUIRED_IN_PRODUCTION');
      }
    }
  }

  private assertLive(): void {
    if (this.state !== 'LIVE') {
      throw new Error('EDI_INTEGRATION_NOT_LIVE');
    }
    if (!this.programEnabled) {
      throw new Error('EDI_PROGRAM_NOT_ENABLED');
    }
    if (!this.externalConformanceQualified) {
      throw new Error('EDI_EXTERNAL_CONFORMANCE_NOT_QUALIFIED');
    }
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = this.getAccessToken
      ? String((await this.getAccessToken()) || '').trim()
      : '';
    if (token) return { Authorization: 'Bearer ' + token };
    if (this.apiKey) return { 'x-api-key': this.apiKey };
    throw new Error('EDI_CLEARINGHOUSE_CREDENTIAL_REQUIRED');
  }

  public async submit837P(
    claim: Edi837ClaimPayload,
    options: { endpointPath?: string } = {}
  ): Promise<Edi837SubmissionResult> {
    this.assertLive();

    const edi = Edi837Generator.generate837P(claim);
    const conformance = Edi837Generator.validate837PStructure(edi);
    if (!conformance.valid) {
      throw new Error(
        'EDI_837_STRUCTURAL_VALIDATION_FAILED:' + conformance.errors.join('|')
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        this.baseUrl + (options.endpointPath || '/837'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/edi-x12',
            Accept: 'application/json, text/plain, application/edi-x12',
            'x-ghims-claim-id': claim.claimId,
            'x-ghims-control-number': claim.controlNumber,
            ...(await this.authHeaders()),
          },
          body: edi,
          signal: controller.signal,
        }
      );

      const body = await response.text();
      if (!response.ok) {
        throw new Error(
          'EDI_CLEARINGHOUSE_HTTP_' + response.status + ':' + body.slice(0, 500)
        );
      }

      let submissionId: string | undefined;
      let receivedAt: string | undefined;
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        submissionId = String(
          parsed.submissionId || parsed.id || parsed.trackingId || ''
        ).trim() || undefined;
        receivedAt = String(parsed.receivedAt || parsed.timestamp || '').trim() || undefined;
      } catch {
        // Clearinghouses may return a textual TA1/999 envelope or plain acknowledgement.
      }

      return {
        acceptedForTransport: true,
        clearinghouseSubmissionId: submissionId,
        receivedAt,
        rawResponse: body.slice(0, 20000),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
