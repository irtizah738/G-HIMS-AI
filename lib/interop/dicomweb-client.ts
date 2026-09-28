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

export interface DicomWebClientConfig {
  baseUrl?: string;
  authToken?: string;
  state?: IntegrationState;
  simulationProvider?: DicomSimulationProvider;
  fetchImpl?: typeof fetch;
}

/**
 * DICOMweb PS3.18 client.
 *
 * There is no automatic mock fallback. Synthetic data is available only through an
 * explicitly supplied simulationProvider while state === SIMULATION.
 */
export class DicomWebClient {
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly state: IntegrationState;
  private readonly simulationProvider?: DicomSimulationProvider;
  private readonly fetchImpl: typeof fetch;

  constructor(config: DicomWebClientConfig = {}) {
    this.baseUrl = (config.baseUrl || '/api/pacs/dicomweb').replace(/\/$/, '');
    this.authToken = config.authToken;
    this.state = config.state || 'DISABLED';
    this.simulationProvider = config.simulationProvider;
    this.fetchImpl = config.fetchImpl || fetch;
  }

  public getState(): IntegrationState {
    return this.state;
  }

  private getHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      Accept: 'application/dicom+json',
    };
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

    const query = new URLSearchParams();
    if (params.patientId) query.set('PatientID', params.patientId);
    if (params.accessionNumber) query.set('AccessionNumber', params.accessionNumber);
    if (params.studyDate) query.set('StudyDate', params.studyDate);
    if (params.modalitiesInStudy) query.set('ModalitiesInStudy', params.modalitiesInStudy);
    if (params.limit) query.set('limit', String(params.limit));

    const response = await this.fetchImpl(
      this.baseUrl + '/studies?' + query.toString(),
      { method: 'GET', headers: this.getHeaders() }
    );

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

    const response = await this.fetchImpl(
      this.baseUrl + '/studies/' + encodeURIComponent(studyInstanceUid) + '/series',
      { method: 'GET', headers: this.getHeaders() }
    );

    if (!response.ok) {
      throw new Error('DICOM_QIDO_SERIES_FAILED: ' + response.status + ' ' + response.statusText);
    }

    return this.parseQidoSeriesResponse(await response.json(), studyInstanceUid);
  }

  public getRenderedFrameUrl(
    studyInstanceUid: string,
    seriesInstanceUid: string,
    sopInstanceUid: string,
    frameNumber = 1
  ): string {
    this.assertLive();
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
