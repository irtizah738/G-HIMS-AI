import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

describe('G-HIMS CI-5 Patient 360 clinical read surface', () => {
  test('server read service returns only tenant/patient-scoped projection and timeline', async () => {
    const service = await source(
      'lib/clinical/patient360/patient360-projection-service.ts'
    );

    expect(service).toContain('getProjection(');
    expect(service).toContain('getTimeline(');
    expect(service).toContain('readClinicalView(');
    expect(service).toContain('readOrRebuildClinicalView(');
    expect(service).toContain('await this.rebuildPatient(tenantId, patientId)');
    expect(service).toContain(
      'PATIENT360_PROJECTION_REBUILD_DID_NOT_MATERIALIZE'
    );
    expect(service).toContain("'PATIENT360_PROJECTION_SCOPE_MISMATCH'");
    expect(service).toContain("'PATIENT360_TIMELINE_SCOPE_MISMATCH'");
    expect(service).toContain("collection('patient360Projections')");
    expect(service).toContain("collection('patient360Timeline')");
    expect(service).toContain("where('patientId', '==', patientId)");
  });

  test('Patient 360 API authenticates tenant context and never stitches raw browser data', async () => {
    const route = await source(
      'app/api/clinical/patient360/[patientId]/route.ts'
    );

    expect(route).toContain('deriveAuthoritativeContext(req, requestedTenantId)');
    expect(route).toContain(
      'Patient360ProjectionService.readOrRebuildClinicalView'
    );
    expect(route).not.toContain("'PATIENT360_PROJECTION_NOT_READY'");
    expect(route).toContain("'X-GHIMS-Patient360-Repaired'");
    expect(route).toContain("'Cache-Control': 'no-store'");
    expect(route).toContain("'X-GHIMS-Patient360-Revision'");
    expect(route).not.toContain("collection('clinicalObservations')");
    expect(route).not.toContain("collection('clinicalConditions')");
    expect(route).not.toContain("collection('clinicalAllergies')");
  });

  test('offline bootstrap hydrates bounded projection summaries but not tenant-wide timeline PHI', async () => {
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');
    const hydration = await source('lib/offline/hydration.ts');

    expect(bootstrap).toContain("'patient360Projections'");
    expect(hydration).toContain("'patient360Projections'");
    expect(bootstrap).not.toContain("'patient360Timeline'");
    expect(hydration).not.toContain("'patient360Timeline'");
  });

  test('client uses authoritative API first and encrypted edge projection only as fallback', async () => {
    const client = await source(
      'lib/clinical/patient360/patient360-client.ts'
    );

    expect(client).toContain('AuthClient.authorizedFetch');
    expect(client).toContain("listSecureEdgeEntities<Record<string, unknown>>");
    expect(client).toContain('as unknown as Patient360Projection[]');
    expect(client).toContain("'patient360Projections'");
    expect(client).toContain("source: 'SERVER'");
    expect(client).toContain("source: 'LOCAL_EDGE'");
    expect(client).toContain('[400, 401, 403, 404, 409, 422].includes(serverResponseStatus)');
    expect(client).not.toContain("'patient360Timeline'");
  });

  test('Patient 360 clinician UI keeps reviewed and unresolved knowledge states explicit', async () => {
    const view = await source('components/patient360/Patient360View.tsx');

    expect(view).toContain('status is unknown');
    expect(view).toContain('status has not been assessed');
    expect(view).toContain('reviewed: none known');
    expect(view).toContain('could not be established because the patient was unable to report');
    expect(view).toContain('Encrypted offline snapshot');
    expect(view).toContain('Detailed timeline requires server connectivity');
    expect(view).not.toContain('NKDA');
    expect(view).not.toContain('No known allergies');
  });

  test('legacy MPI no longer turns blank allergy/problem data into known-none', async () => {
    const mpi = await source('components/views/patient-mpi-view.tsx');

    expect(mpi).toContain("useState('')");
    expect(mpi).toContain('Allergy status not confirmed');
    expect(mpi).toContain('Problem list not confirmed');
    expect(mpi).not.toContain('No known allergies (NKDA)');
    expect(mpi).not.toContain('None reported');
    expect(mpi).toContain('btn-open-patient360');
    expect(mpi).toContain('/patients/');
    expect(mpi).toContain('/360');
  });

  test('dedicated route renders the projection-backed Patient 360 view', async () => {
    const page = await source(
      'app/[tenantId]/patients/[patientId]/360/page.tsx'
    );

    expect(page).toContain('Patient360View');
    expect(page).not.toContain('useHospital');
  });
});
