import type {
  DicomSeriesMetadata,
  DicomSimulationProvider,
  DicomStudyMetadata,
} from './dicomweb-client';

/**
 * Explicit demo/test-only DICOM fixture provider.
 * Production DICOMweb code never imports or invokes these fixtures implicitly.
 */
export class DicomSimulationFixtures implements DicomSimulationProvider {
  public async searchStudies(params: {
    patientId?: string;
    accessionNumber?: string;
    studyDate?: string;
    modalitiesInStudy?: string;
    limit?: number;
  }): Promise<DicomStudyMetadata[]> {
    const studies: DicomStudyMetadata[] = [
      {
        studyInstanceUid: '1.2.840.113619.2.55.3.2831174.192.1',
        patientId: params.patientId || 'SIM-PATIENT-001',
        patientName: 'SIMULATION PATIENT',
        studyDate: '20260813',
        studyTime: '101500',
        accessionNumber: 'SIM-ACC-001',
        modalitiesInStudy: ['CT'],
        studyDescription: 'SIMULATION - CT Chest',
        numberOfStudyRelatedSeries: 1,
        numberOfStudyRelatedInstances: 2,
        referringPhysicianName: 'SIMULATION',
      },
    ];

    return studies.slice(0, params.limit || studies.length);
  }

  public async searchSeries(studyInstanceUid: string): Promise<DicomSeriesMetadata[]> {
    return [
      {
        studyInstanceUid,
        seriesInstanceUid: studyInstanceUid + '.1',
        modality: 'CT',
        seriesNumber: 1,
        seriesDescription: 'SIMULATION - Axial Series',
        numberOfInstances: 2,
        bodyPartExamined: 'CHEST',
      },
    ];
  }
}
