import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

interface FirestoreIndexField {
  fieldPath: string;
  order?: 'ASCENDING' | 'DESCENDING';
  arrayConfig?: string;
}

interface FirestoreIndex {
  collectionGroup: string;
  queryScope: string;
  fields: FirestoreIndexField[];
}

function indexKey(
  collectionGroup: string,
  fields: Array<[string, 'ASCENDING' | 'DESCENDING']>
): string {
  return JSON.stringify([collectionGroup, fields]);
}

describe('OPD-RP19 Firestore indexes and projections', () => {
  test('OPD workspace uses a bounded OPD-only edge surface', async () => {
    const workspace = await source('components/opd/OpdMasterWorkspace.tsx');
    const hydration = await source('lib/offline/hydration.ts');
    const route = await source('app/api/offline/bootstrap/route.ts');
    const surface = await source('lib/opd/edge-surface.ts');

    expect(workspace).toContain("surface: 'OPD'");
    expect(hydration).toContain("surface === 'OPD'");
    expect(hydration).toContain('OPD_EDGE_COLLECTIONS');
    expect(route).toContain("surface === 'OPD'");
    expect(route).toContain('loadOpdScopedEdgeCollections');
    expect(route).toContain('readCollectionSnapshot');
    expect(surface).not.toContain("'accounts'");
    expect(surface).not.toContain("'inventoryBalances'");
    expect(surface).not.toContain("'payrollPayslips'");
  });

  test('scope-first OPD bootstrap queries active encounters before linked PHI', async () => {
    const loader = await source('lib/opd/opd-edge-bootstrap.ts');

    expect(loader).toContain(".where('encounterType', '==', 'OPD')");
    expect(loader).toContain(".where('status', '==', 'ACTIVE')");
    expect(loader).toContain(".where('facilityId', 'in', facilityGroup)");
    expect(loader).toContain(".where('departmentId', '==', departmentId)");
    expect(loader).toContain("'OPD_EDGE_FACILITY_SCOPE_REQUIRED'");
    expect(loader).toContain('OPD_ACTIVE_ENCOUNTER_MAX');
    expect(loader).toContain('OPD_RELATED_MAX');
    expect(loader).toContain("readByFieldValues(\n        tenantRef,\n        collection,\n        'encounterId'");
  });

  test('appointments and waitlist are bounded to active operational states', async () => {
    const loader = await source('lib/opd/opd-edge-bootstrap.ts');

    expect(loader).toContain("'CONFIRMED'");
    expect(loader).toContain("'RESCHEDULED'");
    expect(loader).toContain("'CHECKED_IN'");
    expect(loader).toContain("'WAITING'");
    expect(loader).toContain("'OFFERED'");
    expect(loader).toContain(".where('scheduledEndAt', '>=', cutoff)");
    expect(loader).toContain(".orderBy('scheduledEndAt', 'asc')");
    expect(loader).toContain(".orderBy('updatedAt', 'desc')");
    expect(loader).toContain(
      ".where('preferredDepartmentId', '==', departmentId)"
    );
  });

  test('availability no longer scans whole department roster and provider lock history', async () => {
    const service = await source(
      'lib/backend/services/opd-appointment-domain-service.ts'
    );
    const start = service.indexOf('public static async listAvailability');
    const end = service.indexOf('public static async addToWaitlist', start);
    const block = service.slice(start, end);

    expect(block).toContain(".where('facilityId', '==', input.facilityId)");
    expect(block).toContain(".where('departmentId', '==', input.departmentId)");
    expect(block).toContain(".where('date', '==', input.date)");
    expect(block).toContain(
      ".where('status', 'in', ['PUBLISHED', 'ACKNOWLEDGED', 'IN_PROGRESS'])"
    );
    expect(block).toContain(".where('bucketStartAt', '>=', rosterStart)");
    expect(block).toContain(".where('bucketStartAt', '<', rosterEnd)");
    expect(block).not.toContain(
      "queryAllEqual<RosterShiftEntry>(\n      context.tenantId,\n      'rosterAssignments'"
    );
  });

  test('consultant worklist queries only active projection rows for owned scopes', async () => {
    const projection = await source(
      'lib/clinical/intelligence/consultant-attention-projection-service.ts'
    );
    const start = projection.indexOf('public static async getWorklist');
    const block = projection.slice(start);

    expect(block).toContain(
      ".where('status', 'in', ['OPEN', 'ACKNOWLEDGED'])"
    );
    expect(block).toContain(".where('ownerId', '==', ownerId)");
    expect(block).toContain(".orderBy('updatedAt', 'desc')");
    expect(block).toContain('CONSULTANT_WORKLIST_LIMIT_EXCEEDED');
  });

  test('consultant review metrics query current worklist patients instead of arbitrary checkpoint history', async () => {
    const metrics = await source(
      'lib/clinical/intelligence/consultant-blindness-metrics-service.ts'
    );

    expect(metrics).toContain('worklistPatientIds');
    expect(metrics).toContain(".where('consultantId', '==', context.actorId)");
    expect(metrics).toContain(".where('patientId', 'in', patientChunk)");
    expect(metrics).toContain(".orderBy('reviewedAt', 'desc')");
    expect(metrics).not.toContain(".where('consultantId', '==', context.actorId)\n      .limit(500)");
  });

  test('all RP19 composite query shapes are declared in firestore indexes', async () => {
    const config = JSON.parse(
      await source('firestore.indexes.json')
    ) as {
      indexes: FirestoreIndex[];
      fieldOverrides: Array<{
        collectionGroup: string;
        fieldPath: string;
        indexes: unknown[];
      }>;
    };

    const existing = new Set(
      config.indexes.map((index) =>
        indexKey(
          index.collectionGroup,
          index.fields.map((field) => [
            field.fieldPath,
            field.order as 'ASCENDING' | 'DESCENDING',
          ])
        )
      )
    );

    const required: Array<
      [string, Array<[string, 'ASCENDING' | 'DESCENDING']>]
    > = [
      [
        'encounters',
        [
          ['encounterType', 'ASCENDING'],
          ['status', 'ASCENDING'],
          ['updatedAt', 'DESCENDING'],
        ],
      ],
      [
        'encounters',
        [
          ['facilityId', 'ASCENDING'],
          ['departmentId', 'ASCENDING'],
          ['encounterType', 'ASCENDING'],
          ['status', 'ASCENDING'],
          ['updatedAt', 'DESCENDING'],
        ],
      ],
      [
        'opdAppointments',
        [
          ['facilityId', 'ASCENDING'],
          ['departmentId', 'ASCENDING'],
          ['status', 'ASCENDING'],
          ['scheduledEndAt', 'ASCENDING'],
        ],
      ],
      [
        'opdWaitlist',
        [
          ['facilityId', 'ASCENDING'],
          ['preferredDepartmentId', 'ASCENDING'],
          ['status', 'ASCENDING'],
          ['updatedAt', 'DESCENDING'],
        ],
      ],
      [
        'rosterAssignments',
        [
          ['facilityId', 'ASCENDING'],
          ['departmentId', 'ASCENDING'],
          ['date', 'ASCENDING'],
          ['status', 'ASCENDING'],
          ['startTime', 'ASCENDING'],
        ],
      ],
      [
        'opdAppointmentSlots',
        [
          ['providerEmployeeId', 'ASCENDING'],
          ['bucketStartAt', 'ASCENDING'],
        ],
      ],
      [
        'clinicalOpenItems',
        [
          ['ownerId', 'ASCENDING'],
          ['status', 'ASCENDING'],
          ['updatedAt', 'DESCENDING'],
        ],
      ],
      [
        'consultantReviewCheckpoints',
        [
          ['consultantId', 'ASCENDING'],
          ['patientId', 'ASCENDING'],
          ['reviewedAt', 'DESCENDING'],
        ],
      ],
    ];

    for (const [collection, fields] of required) {
      expect(existing.has(indexKey(collection, fields))).toBe(true);
    }
  });

  test('large Patient 360 projection payloads are exempt from automatic indexing', async () => {
    const config = JSON.parse(
      await source('firestore.indexes.json')
    ) as {
      fieldOverrides: Array<{
        collectionGroup: string;
        fieldPath: string;
        indexes: unknown[];
      }>;
    };

    const exempt = new Set(
      config.fieldOverrides
        .filter(
          (entry) =>
            entry.collectionGroup === 'patient360Projections' &&
            Array.isArray(entry.indexes) &&
            entry.indexes.length === 0
        )
        .map((entry) => entry.fieldPath)
    );

    for (const field of [
      'careContexts',
      'recentEncounters',
      'activeProblems',
      'resolvedProblems',
      'allergies',
      'currentMedications',
      'latestVitals',
      'recentResults',
      'recentDocuments',
      'dataQuality',
      'counts',
    ]) {
      expect(exempt.has(field)).toBe(true);
    }
  });
});
