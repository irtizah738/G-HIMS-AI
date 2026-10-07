import type { IntegrationState } from './integration-state';

export interface DicomStudyMetadata {
  studyInstanceUid: string;
  patientId: string;
  patientName: string;
  studyDate: string;
  studyTime?: string;
  accessionNumber: string;
  modalitiesInStudy: string[];
  studyDescription: string;
  numberOfStudyRelatedSeries: number;
  numberOfStudyRelatedInstances: number;
  referringPhysicianName?: string;
}

export interface DicomSeriesMetadata {
  studyInstanceUid: string;
  seriesInstanceUid: string;
  modality: string;
  seriesNumber: number;
  seriesDescription: string;
  numberOfInstances: number;
  bodyPartExamined?: string;
}

export interface DicomInstanceMetadata {
  studyInstanceUid: string;
  seriesInstanceUid: string;
  sopInstanceUid: string;
  instanceNumber: number;
  sopClassUid: string;
  rows?: number;
  columns?: number;
  bitsAllocated?: number;
  wadoUri: string;
}

export interface DicomSimulationProvider {
  searchStudies(params: {
    patientId?: string;
    accessionNumber?: string;
    studyDate?: string;
    modalitiesInStudy?: string;
    limit?: number;
  }): Promise<DicomStudyMetadata[]>;
  searchSeries(studyInstanceUid: string): Promise<DicomSeriesMetadata[]>;
}

export interface DicomWebQualificationReport {
  valid: boolean;
  checkedAt: number;
  qidoReachable: boolean;
  responseContentType?: string;
  errors: string[];
}

export interface DicomWebClientConfig {
  baseUrl?: string;
  authToken?: string;
  state?: IntegrationState;
  simulationProvider?: DicomSimulationProvider;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxReadRetries?: number;
  allowedHosts?: string[];
  requireHttpsInProduction?: boolean;
}

function isProductionRuntime(): boolean {
  return String(process.env.GHIMS_RUNTIME_MODE || process.env.NODE_ENV || '')
    .trim()
    .toUpperCase() === 'PRODUCTION';
}

function retryable(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * DICOMweb PS3.18 client.
 *
 * There is no automatic mock fallback. Synthetic data is available only through an
 * explicitly supplied simulationProvider while state === SIMULATION.
 *
 * LIVE mode is read-only by default in G-HIMS Wave 4: QIDO-RS/WADO-RS access is
 * permitted only through an explicitly configured PACS endpoint. STOW-RS remains
 * outside the approved Wave 4 contract until a deployment intentionally enables it.
 */
export class DicomWebClient {
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly state: IntegrationState;
  private readonly simulationProvider?: DicomSimulationProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxReadRetries: number;
  private readonly allowedHosts: Set<string>;
  private readonly requireHttpsInProduction: boolean;

  constructor(config: DicomWebClientConfig = {}) {
    this.baseUrl = (config.baseUrl || '/api/pacs/dicomweb').replace(/\\/$/, '');
    this.authToken = config.authToken;
    this.state = config.state || 'DISABLED';
    this.simulationProvider = config.simulationProvider;
    this.fetchImpl = config.fetchImpl || fetch;
    this.timeoutMs = config.timeoutMs || 15000;
    this.maxReadRetries = Math.max(0, Math.min(3, config.maxReadRetries ?? 1));
    this.allowedHosts = new Set((config.allowedHosts || []).map((host) => host.trim().toLowerCase()).filter(Boolean));
    this.requireHttpsInProduction = config.requireHttpsInProduction ?? true;

    if (this.state === 'LIVE') {
      let url: URL;
      try {
        url = new URL(this.baseUrl);
      } catch {
        throw new Error('DICOM_LIVE_BASE_URL_MUST_BE_ABSOLUTE');
      }
      if (
        isProductionRuntime() &&
        this.requireHttpsInProduction &&
        url.protocol !== 'https:'
      ) {
        throw new Error('DICOM_TLS_REQUIRED_IN_PRODUCTION');
      }
      if (
        this.allowedHosts.size > 0 &&
        !this.allowedHosts.has(url.hostname.toLowerCase())
      ) {
        throw new Error('DICOM_HOST_NOT_ALLOWLISTED');
      }
    }
  }

  public getState(): IntegrationState {
    return this.state;
  }

  private getHeaders(accept = 'application/dicom+json'): HeadersInit {
    const headers: Record<string, string> = { Accept: accept };
    if (this.authToken) headers.Authorization = 'Bearer ' + this.authToken;
    return headers;
  }

  private assertLive(): void {
    if (this.state !== 'LIVE') {
      throw new Error(
        'DICOM_INTEGRATION_NOT_LIVE: current state is ' + this.state + '; PACS traffic is blocked.'
      );
    }
  }

  private simulation(): DicomSimulationProvider {
    if (this.state !== 'SIMULATION') {
      throw new Error('DICOM_SIMULATION_NOT_ENABLED');
    }
    if (!this.simulationProvider) {
      throw new Error('DICOM_SIMULATION_PROVIDER_REQUIRED');
    }
    return this.simulationProvider;
  }

  private async request(
    path: string,
    accept = 'application/dicom+json'
  ): Promise<Response> {
    this.assertLive();
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxReadRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(this.baseUrl + path, {
          method: 'GET',
          headers: this.getHeaders(accept),
          signal: controller.signal,
        });

        if (
          !response.ok &&
          retryable(response.status) &&
          attempt < this.maxReadRetries
        ) {
          lastError = new Error('DICOM_HTTP_' + response.status);
          continue;
        }

        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= this.maxReadRetries) throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('DICOM_REQUEST_FAILED');
  }

  public async qualifyLiveEnvironment(): Promise<DicomWebQualificationReport> {
    this.assertLive();
    const errors: string[] = [];
    let responseContentType: string | undefined;

    try {
      const response = await this.request('/studies?limit=1');
      responseContentType = response.headers.get('content-type') || undefined;
      if (!response.ok) {
        errors.push('DICOM_QIDO_PROBE_FAILED:' + response.status);
      } else {
        const payload = await response.json();
        if (!Array.isArray(payload)) {
          errors.push('DICOM_QIDO_PROBE_INVALID_BODY');
        } else {
          this.parseQidoStudiesResponse(payload);
        }
      }
      if (
        responseContentType &&
        !responseContentType.toLowerCase().includes('application/dicom+json') &&
        !responseContentType.toLowerCase().includes('application/json')
      ) {
        errors.push('DICOM_QIDO_CONTENT_TYPE_INVALID:' + responseContentType);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'DICOM_QIDO_PROBE_FAILED');
    }

    return {
      valid: errors.length === 0,
      checkedAt: Date.now(),
      qidoReachable: errors.length === 0,
      responseContentType,
      errors,
    };
  }

  public async searchStudies(params: {
    patientId?: string;
    accessionNumber?: string;
    studyDate?: string;
    modalitiesInStudy?: string;
    limit?: number;
  }): Promise<DicomStudyMetadata[]> {
    if (this.state === 'SIMULATION') {
      return this.simulation().searchStudies(params);
    }

    this.assertLive();

    const patientId = String(params.patientId || '').trim();
    const accessionNumber = String(params.accessionNumber || '').trim();
    if (!patientId && !accessionNumber) {
      throw new Error(
        'DICOM_BOUNDED_QUERY_REQUIRED: LIVE study search requires PatientID or AccessionNumber.'
      );
    }

    const query = new URLSearchParams();
    if (patientId) query.set('PatientID', patientId);
    if (accessionNumber) query.set('AccessionNumber', accessionNumber);
    if (params.studyDate) query.set('StudyDate', params.studyDate);
    if (params.modalitiesInStudy) query.set('ModalitiesInStudy', params.modalitiesInStudy);
    query.set('limit', String(Math.max(1, Math.min(100, params.limit || 25))));

    const response = await this.request('/studies?' + query.toString());
    if (!response.ok) {
      throw new Error('DICOM_QIDO_STUDIES_FAILED: ' + response.status + ' ' + response.statusText);
    }

    return this.parseQidoStudiesResponse(await response.json());
  }

  public async searchSeries(studyInstanceUid: string): Promise<DicomSeriesMetadata[]> {
    if (this.state === 'SIMULATION') {
      return this.simulation().searchSeries(studyInstanceUid);
    }

    this.assertLive();

    const uid = String(studyInstanceUid || '').trim();
    if (!uid) throw new Error('DICOM_STUDY_UID_REQUIRED');

    const response = await this.request(
      '/studies/' + encodeURIComponent(uid) + '/series'
    );

    if (!response.ok) {
      throw new Error('DICOM_QIDO_SERIES_FAILED: ' + response.status + ' ' + response.statusText);
    }

    return this.parseQidoSeriesResponse(await response.json(), uid);
  }

  public async fetchInstanceMetadata(
    studyInstanceUid: string,
    seriesInstanceUid: string,
    sopInstanceUid: string
  ): Promise<unknown[]> {
    const study = String(studyInstanceUid || '').trim();
    const series = String(seriesInstanceUid || '').trim();
    const instance = String(sopInstanceUid || '').trim();
    if (!study || !series || !instance) {
      throw new Error('DICOM_INSTANCE_IDENTIFIERS_REQUIRED');
    }

    const response = await this.request(
      '/studies/' + encodeURIComponent(study) +
      '/series/' + encodeURIComponent(series) +
      '/instances/' + encodeURIComponent(instance) +
      '/metadata'
    );
    if (!response.ok) {
      throw new Error('DICOM_WADO_METADATA_FAILED: ' + response.status + ' ' + response.statusText);
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('DICOM_WADO_METADATA_INVALID');
    return payload;
  }

  public getRenderedFrameUrl(
    studyInstanceUid: string,
    seriesInstanceUid: string,
    sopInstanceUid: string,
    frameNumber = 1
  ): string {
    this.assertLive();
    if (!Number.isInteger(frameNumber) || frameNumber < 1) {
      throw new Error('DICOM_FRAME_NUMBER_INVALID');
    }
    return (
      this.baseUrl +
      '/studies/' + encodeURIComponent(studyInstanceUid) +
      '/series/' + encodeURIComponent(seriesInstanceUid) +
      '/instances/' + encodeURIComponent(sopInstanceUid) +
      '/frames/' + frameNumber +
      '/rendered'
    );
  }

  public parseQidoStudiesResponse(dicomJsonArray: unknown): DicomStudyMetadata[] {
    if (!Array.isArray(dicomJsonArray)) {
      throw new Error('DICOM_INVALID_QIDO_RESPONSE: expected an array.');
    }

    return dicomJsonArray.map((item: any) => {
      const getVal = (tag: string): string => String(item?.[tag]?.Value?.[0] ?? '');
      const studyInstanceUid = getVal('0020000D');
      if (!studyInstanceUid) {
        throw new Error('DICOM_INVALID_STUDY: StudyInstanceUID is required.');
      }

      return {
        studyInstanceUid,
        patientId: getVal('00100020'),
        patientName:
          typeof item?.['00100010']?.Value?.[0] === 'object'
            ? String(item['00100010'].Value[0].Alphabetic || 'Unknown')
            : getVal('00100010') || 'Unknown',
        studyDate: getVal('00080020'),
        studyTime: getVal('00080030'),
        accessionNumber: getVal('00080050'),
        modalitiesInStudy: Array.isArray(item?.['00080061']?.Value)
          ? item['00080061'].Value.map(String)
          : [],
        studyDescription: getVal('00081030'),
        numberOfStudyRelatedSeries: Number.parseInt(getVal('00201206') || '0', 10),
        numberOfStudyRelatedInstances: Number.parseInt(getVal('00201208') || '0', 10),
        referringPhysicianName: getVal('00080090'),
      };
    });
  }

  private parseQidoSeriesResponse(
    dicomJsonArray: unknown,
    studyUid: string
  ): DicomSeriesMetadata[] {
    if (!Array.isArray(dicomJsonArray)) {
      throw new Error('DICOM_INVALID_QIDO_RESPONSE: expected an array.');
    }

    return dicomJsonArray.map((item: any) => {
      const getVal = (tag: string): string => String(item?.[tag]?.Value?.[0] ?? '');
      const seriesInstanceUid = getVal('0020000E');
      if (!seriesInstanceUid) {
        throw new Error('DICOM_INVALID_SERIES: SeriesInstanceUID is required.');
      }

      return {
        studyInstanceUid: studyUid,
        seriesInstanceUid,
        modality: getVal('00080060'),
        seriesNumber: Number.parseInt(getVal('00200011') || '0', 10),
        seriesDescription: getVal('0008103E'),
        numberOfInstances: Number.parseInt(getVal('00201209') || '0', 10),
        bodyPartExamined: getVal('00180015'),
      };
    });
  }
}
