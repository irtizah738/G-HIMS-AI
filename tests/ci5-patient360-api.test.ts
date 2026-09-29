import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  evaluatePatient360Freshness,
} from '@/lib/clinical/patient360/patient360-read-service';
import type { Patient360Projection } from '@/types/patient360-projection';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

function projection(params: {
  revision: number;
  eventId?: string;
  recordedAt?: number;
  projectedAt?: number;
}): Patient360Projection {
  const eventCheckpoint =
    params.eventId && params.recordedAt !== undefined
      ? { eventId: params.eventId, recordedAt: params.recordedAt }
      : undefined;

  return {
    tenantId: 'tenant-a',
    patientId: 'patient-a',
    identity: {
      patientId: 'patient-a',
      mrn: 'MRN-A',
      fullName: 'Synthetic Patient',
    },
    recentEncounters: [],
    activeProblems: [],
    resolvedProblems: [],
    allergies: [],
    currentMedications: [],
    latestVitals: [],
    recentResults: [],
    recentDocuments: [],
    dataQuality: {
      allergyKnowledge: 'UNKNOWN',
      problemListKnowledge: 'UNKNOWN',
      medicationKnowledge: 'UNKNOWN',
      hasUnverifiedAllergies: false,
      hasUnverifiedProblems: false,
      hasPreliminaryResults: false,
      missingCanonicalFacts: [],
    },
    counts: {
      encounters: 0,
      conditions: 0,
      allergies: 0,
      medicationOrders: 0,
      observations: 0,
      diagnosticReports: 0,
      documents: 0,
    },
    projectionVersion: 1,
    revision: params.revision,
    eventCheckpoint,
    sourceFingerprint: 'fingerprint',
    sourceCheckpoint: eventCheckpoint
      ? `${eventCheckpoint.recordedAt}:${eventCheckpoint.eventId}`
      : '0:NO_PATIENT_EVENT',
    contentHash: 'content-hash',
    projectedAt: params.projectedAt ?? 1700000001000,
    lastEventId: params.eventId,
    lastEventRecordedAt: params.recordedAt,
  };
}

describe('G-HIMS CI-5 Patient 360 API', () => {
  test('freshness is FRESH only when revision and authoritative checkpoint both match', () => {
    const result = evaluatePatient360Freshness({
      projection: projection({
        revision: 2,
        eventId: 'evt-2',
        recordedAt: 200,
        projectedAt: 900,
      }),
      authoritativeEvents: [
        { eventId: 'evt-1', recordedAt: 100 },
        { eventId: 'evt-2', recordedAt: 200 },
      ],
      now: 1000,
    });

    expect(result.status).toBe('FRESH');
    expect(result.authoritativeEventCount).toBe(2);
    expect(result.lagEventCount).toBe(0);
    expect(result.ageMs).toBe(100);
    expect(result.authoritativeCheckpoint).toEqual({
      eventId: 'evt-2',
      recordedAt: 200,
    });
  });

  test('freshness reports exact event lag when projection trails authoritative events', () => {
    const result = evaluatePatient360Freshness({
      projection: projection({
        revision: 1,
        eventId: 'evt-1',
        recordedAt: 100,
      }),
      authoritativeEvents: [
        { eventId: 'evt-1', recordedAt: 100 },
        { eventId: 'evt-2', recordedAt: 200 },
        { eventId: 'evt-3', recordedAt: 300 },
      ],
    });

    expect(result.status).toBe('STALE');
    expect(result.authoritativeEventCount).toBe(3);
    expect(result.lagEventCount).toBe(2);
    expect(result.authoritativeCheckpoint?.eventId).toBe('evt-3');
  });

  test('missing projection is explicitly NOT_READY instead of silently rebuilding on GET', async () => {
    const result = evaluatePatient360Freshness({
      projection: null,
      authoritativeEvents: [{ eventId: 'evt-1', recordedAt: 100 }],
    });
    const service = await source('lib/clinical/patient360/patient360-read-service.ts');

    expect(result.status).toBe('NOT_READY');
    expect(result.lagEventCount).toBe(1);
    expect(service).not.toContain('rebuildPatient(');
    expect(service).not.toContain('rebuildTenantFromEventStream(');
  });

  test('Patient 360 API derives authoritative tenant/session context and enforces full-chart access', async () => {
    const route = await source('app/api/clinical/patient360/[patientId]/route.ts');
    const timeline = await source('app/api/clinical/patient360/[patientId]/timeline/route.ts');
    const access = await source('lib/clinical/patient360/patient360-access.ts');

    for (const api of [route, timeline]) {
      expect(api).toContain('deriveAuthoritativeContext(req)');
      expect(api).toContain('assertPatient360ReadAccess(context)');
      expect(api).toContain("'Cache-Control': 'no-store'");
    }

    expect(access).toContain("'DOCTOR'");
    expect(access).toContain("'NURSE'");
    expect(access).toContain("'PHARMACIST'");
    expect(access).not.toContain("'RECEPTIONIST'");
    expect(access).not.toContain("'BILLING_CLERK'");
    expect(access).not.toContain("'PATIENT'");
  });

  test('projection API exposes version, revision, freshness and event checkpoint metadata', async () => {
    const route = await source('app/api/clinical/patient360/[patientId]/route.ts');

    expect(route).toContain("'X-GHIMS-Patient360-Version'");
    expect(route).toContain("'X-GHIMS-Patient360-Revision'");
    expect(route).toContain("'X-GHIMS-Patient360-Freshness'");
    expect(route).toContain("'X-GHIMS-Patient360-Checkpoint'");
    expect(route).toContain("'PATIENT360_PROJECTION_NOT_READY'");
    expect(route).toContain("'Retry-After': '2'");
    expect(route).toContain("'PATIENT360_PATIENT_MERGED'");
  });

  test('timeline API uses stable bounded cursor pagination and chronological ordering', async () => {
    const service = await source('lib/clinical/patient360/patient360-read-service.ts');
    const route = await source('app/api/clinical/patient360/[patientId]/timeline/route.ts');

    expect(service).toContain(".where('patientId', '==', params.patientId)");
    expect(service).toContain(".orderBy('occurredAt', 'desc')");
    expect(service).toContain(".orderBy('eventId', 'desc')");
    expect(service).toContain('startAfter(cursor.occurredAt, cursor.eventId)');
    expect(service).toContain('.limit(limit + 1)');
    expect(service).toContain("toString('base64url')");
    expect(route).toContain('limit < 1 || limit > 100');
    expect(route).toContain("'PATIENT360_CURSOR_INVALID'");
  });

  test('projection source scans are paged and fail loudly at a safety ceiling instead of silently truncating', async () => {
    const service = await source('lib/clinical/patient360/patient360-projection-service.ts');

    expect(service).toContain('PATIENT360_PAGE_SIZE = 500');
    expect(service).toContain('PATIENT360_SOURCE_MAX = 50000');
    expect(service).toContain('orderBy(FieldPath.documentId())');
    expect(service).toContain('startAfter(lastDocument)');
    expect(service).toContain('PATIENT360_SOURCE_LIMIT_EXCEEDED');
    expect(service).toContain('PATIENT360_EVENT_LIMIT_EXCEEDED');
    expect(service).not.toContain(".limit(2000)");
    expect(service).not.toContain(".limit(3000)");
  });

  test('Patient 360 Firestore collections are explicitly server-only and timeline index is declared', async () => {
    const rules = await source('firestore.rules');
    const firebase = JSON.parse(await source('firebase.json'));
    const indexes = JSON.parse(await source('firestore.indexes.json'));

    expect(rules).toContain('match /patient360Projections/{patientId}');
    expect(rules).toContain('match /patient360Timeline/{timelineItemId}');
    expect(rules).toContain('match /patient360ProjectionCheckpoints/{eventId}');
    expect(firebase.firestore.indexes).toBe('firestore.indexes.json');

    const timelineIndex = indexes.indexes.find(
      (item: any) => item.collectionGroup === 'patient360Timeline'
    );
    expect(timelineIndex).toBeTruthy();
    expect(timelineIndex.fields.map((field: any) => [field.fieldPath, field.order])).toEqual([
      ['patientId', 'ASCENDING'],
      ['occurredAt', 'DESCENDING'],
      ['eventId', 'DESCENDING'],
    ]);
  });

  test('existing Firestore emulator suite contains direct-read denial coverage for Patient 360', async () => {
    const rulesTest = await source('emulator-security/firestore-rules.test.ts');

    expect(rulesTest).toContain('Patient 360 PHI projections are server-only');
    expect(rulesTest).toContain("'patient360Projections'");
    expect(rulesTest).toContain("'patient360Timeline'");
    expect(rulesTest).toContain("'patient360ProjectionCheckpoints'");
    expect(rulesTest).toContain('assertFails');
  });
});
