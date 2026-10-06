import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AuthError } from '@/lib/auth/auth-errors';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { assertDiagnosticResultReadAccess } from '@/lib/clinical/diagnostics/diagnostic-result-access';
import type { CommandContext } from '@/lib/backend/types';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

function context(
  overrides: Partial<CommandContext> = {}
): CommandContext {
  return {
    tenantId: 'tenant-rp18',
    actorId: 'actor-rp18',
    roles: ['DOCTOR'],
    permissions: [],
    correlationId: 'corr-rp18',
    facilityIds: ['facility-a'],
    departmentId: 'dept-a',
    departmentIds: ['dept-a'],
    ...overrides,
  } as CommandContext;
}

describe('OPD-RP18 least-privilege reads', () => {
  test('Patient 360 requires role/permission plus exact care scope', () => {
    const patient = {
      id: 'patient-a',
      patientId: 'patient-a',
      facilityId: 'facility-a',
      departmentId: 'dept-a',
    };
    const encounter = {
      id: 'enc-a',
      encounterId: 'enc-a',
      patientId: 'patient-a',
      facilityId: 'facility-a',
      departmentId: 'dept-a',
    };

    expect(() =>
      assertPatient360PatientAccess(context(), patient, encounter)
    ).not.toThrow();

    expect(() =>
      assertPatient360PatientAccess(
        context({ facilityIds: [], departmentId: undefined, departmentIds: [] }),
        patient,
        encounter
      )
    ).toThrow(AuthError);

    expect(() =>
      assertPatient360PatientAccess(
        context({ roles: ['LAB_TECHNICIAN'] }),
        patient,
        encounter
      )
    ).toThrow(AuthError);
  });

  test('diagnostic ancillary reads are modality and facility bounded', () => {
    const order = {
      orderId: 'order-a',
      patientId: 'patient-a',
      encounterId: 'enc-a',
      orderType: 'LAB',
      facilityId: 'facility-a',
    };
    const encounter = {
      id: 'enc-a',
      encounterId: 'enc-a',
      patientId: 'patient-a',
      facilityId: 'facility-a',
      departmentId: 'dept-a',
    };
    const patient = { id: 'patient-a', patientId: 'patient-a' };

    expect(() =>
      assertDiagnosticResultReadAccess(
        context({ roles: ['LAB_TECHNICIAN'] }),
        order,
        encounter,
        patient
      )
    ).not.toThrow();

    expect(() =>
      assertDiagnosticResultReadAccess(
        context({
          roles: ['RADIOLOGY_TECHNICIAN'],
          facilityIds: ['facility-a'],
        }),
        order,
        encounter,
        patient
      )
    ).toThrow(AuthError);

    expect(() =>
      assertDiagnosticResultReadAccess(
        context({
          roles: ['LAB_TECHNICIAN'],
          facilityIds: ['facility-b'],
        }),
        order,
        encounter,
        patient
      )
    ).toThrow(AuthError);
  });

  test('diagnostic API authorizes before report and observation PHI reads', async () => {
    const route = await source(
      'app/api/clinical/diagnostics/results/[orderId]/route.ts'
    );
    const accessIndex = route.indexOf(
      'assertDiagnosticResultReadAccess(context, order, encounter, patient)'
    );
    const reportIndex = route.indexOf(
      "DomainStateRepository.queryEqual<DiagnosticReport>"
    );

    expect(accessIndex).toBeGreaterThan(0);
    expect(reportIndex).toBeGreaterThan(accessIndex);
    expect(route).toContain('DIAGNOSTIC_RESULT_ACCESS_DENIED');
    expect(route).toContain('presentDiagnosticOrder(order)');
    expect(route).not.toContain('billingInvoiceId: order.billingInvoiceId');
    expect(route).not.toContain('deferredRevenueJournalId');
    expect(route).not.toContain('recognitionJournalId');
    expect(route).not.toContain('{ success: false, error: message }');
  });

  test('Patient 360 authorizes before projection PHI is loaded', async () => {
    const route = await source(
      'app/api/clinical/patient360/[patientId]/route.ts'
    );
    const accessIndex = route.indexOf(
      'assertPatient360PatientAccess(context, patient, accessEncounter)'
    );
    const clinicalReadIndex = route.indexOf(
      'Patient360ProjectionService.readOrRebuildClinicalView'
    );

    expect(accessIndex).toBeGreaterThan(0);
    expect(clinicalReadIndex).toBeGreaterThan(accessIndex);
    expect(route).not.toContain('projectionPreview');
    expect(route).toContain('PATIENT360_ACCESS_DENIED');
    expect(route).toContain('PATIENT360_READ_FAILED');
  });

  test('legacy client-supplied timeline projection is retired fail closed', async () => {
    const route = await source('app/api/clinical/timeline/route.ts');

    expect(route).toContain('LEGACY_CLINICAL_TIMELINE_RETIRED');
    expect(route).toContain('status: 410');
    expect(route).not.toContain('TimelineProjector.project');
    expect(route).not.toContain('patientMrn');
    expect(route).not.toContain('events as ClinicalEventEnvelope');
  });

  test('offline bootstrap empty organizational scope is deny-by-default', async () => {
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');

    expect(bootstrap).toContain('Boolean(normalized)');
    expect(bootstrap).toContain('allowed.size > 0');
    expect(bootstrap).toContain('allowed.has(normalized)');
    expect(bootstrap).not.toContain(
      'return !normalized || allowed.size === 0 || allowed.has(normalized);'
    );
    expect(bootstrap).toContain('facilities.size > 0');
    expect(bootstrap).toContain('departments.size > 0');
  });

  test('front desk and cashier patient hydration is field-minimized', async () => {
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');

    expect(bootstrap).toContain('function minimizePatientRows(');
    expect(bootstrap).toContain("'BILLING_CASHIER'");
    expect(bootstrap).toContain('tariffPlan: row.tariffPlan');
    expect(bootstrap).not.toContain('message,\n        },\n      },');
  });

  test('scheduling reads require explicit department scope', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );

    expect(service).toContain(
      'departmentIds.size === 0 || !departmentIds.has(departmentId)'
    );
    expect(service).toContain(
      'Actor requires an authoritative department assignment'
    );
  });
  test('direct Firestore OPD PHI reads are server-only', async () => {
    const rules = await source('firestore.rules');

    for (const collection of [
      'patients',
      'encounters',
      'opd_queue',
      'opdAppointments',
      'opdWaitlist',
      'opdReferrals',
      'orders',
      'prescriptions',
      'labResults',
      'radiologyResults',
    ]) {
      const matchIndex = rules.indexOf(`match /${collection}/{`);
      expect(matchIndex).toBeGreaterThan(0);
      const block = rules.slice(matchIndex, matchIndex + 220);
      expect(block).toContain('allow read, write: if false;');
    }
  });

  test('ancillary offline hydration is modality and facility scoped', async () => {
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');

    expect(bootstrap).toContain("'PATHOLOGIST'");
    expect(bootstrap).toContain("'RADIOLOGY_TECHNICIAN'");
    expect(bootstrap).toContain('ancillaryOrderIds');
    expect(bootstrap).toContain('ancillaryEncounterIds');
    expect(bootstrap).toContain('resolveRelatedFacility');
    expect(bootstrap).toContain(
      "collection === 'orders' && (labRole || radiologyRole)"
    );
  });

  test('clinical OPD timeline redacts financial payload details', async () => {
    const route = await source('app/api/opd/timeline/route.ts');

    expect(route).toContain('invoice|receipt|journal|amount|price|balance|payment');
    expect(route).toContain('coverage|copay|charge');
    expect(route).toContain("output[key] = '[REDACTED]'");
  });


});
