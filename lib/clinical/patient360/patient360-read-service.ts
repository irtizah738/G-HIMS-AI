import { getAdminFirestore } from '@/server/firebase/admin';
import type {
  Patient360Projection,
  Patient360TimelineItem,
} from '@/types/patient360-projection';
import type {
  Patient360Freshness,
  Patient360ProjectionResponse,
  Patient360TimelinePage,
} from '@/types/patient360-api';
import { Patient360ProjectionService } from './patient360-projection-service';

interface TimelineCursor {
  occurredAt: number;
  eventId: string;
}

function encodeCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value?: string | null): TimelineCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8')
    ) as Partial<TimelineCursor>;
    const occurredAt = Number(parsed.occurredAt);
    const eventId = String(parsed.eventId || '').trim();
    if (!Number.isFinite(occurredAt) || !eventId) {
      throw new Error('invalid');
    }
    return { occurredAt, eventId };
  } catch {
    throw new Error('PATIENT360_CURSOR_INVALID');
  }
}

export function evaluatePatient360Freshness(params: {
  projection: Patient360Projection | null;
  authoritativeEvents: Array<{
    eventId: string;
    recordedAt?: number;
    occurredAt?: number;
  }>;
  now?: number;
}): Patient360Freshness {
  const now = params.now ?? Date.now();
  const projection = params.projection;
  const authoritativeEvents = [...params.authoritativeEvents].sort(
    (left, right) =>
      Number(left.recordedAt || left.occurredAt || 0) -
        Number(right.recordedAt || right.occurredAt || 0) ||
      left.eventId.localeCompare(right.eventId)
  );

  const authoritativeEventCount = authoritativeEvents.length;
  const latest = authoritativeEvents[authoritativeEvents.length - 1];
  const authoritativeCheckpoint = latest
    ? {
        eventId: latest.eventId,
        recordedAt: Number(latest.recordedAt || latest.occurredAt || 0),
      }
    : undefined;

  if (!projection) {
    return {
      status: 'NOT_READY',
      authoritativeEventCount,
      lagEventCount: authoritativeEventCount,
      authoritativeCheckpoint,
    };
  }

  const lagEventCount = Math.max(
    0,
    authoritativeEventCount - Number(projection.revision || 0)
  );
  const checkpointMatches =
    (!authoritativeCheckpoint && !projection.eventCheckpoint) ||
    (
      authoritativeCheckpoint?.eventId === projection.eventCheckpoint?.eventId &&
      authoritativeCheckpoint?.recordedAt === projection.eventCheckpoint?.recordedAt
    );

  const status =
    lagEventCount === 0 && checkpointMatches
      ? 'FRESH'
      : authoritativeEventCount >= Number(projection.revision || 0)
        ? 'STALE'
        : 'UNKNOWN';

  return {
    status,
    projectionRevision: projection.revision,
    authoritativeEventCount,
    lagEventCount,
    projectedAt: projection.projectedAt,
    ageMs: Math.max(0, now - Number(projection.projectedAt || now)),
    projectionCheckpoint: projection.eventCheckpoint,
    authoritativeCheckpoint,
  };
}

export class Patient360ReadService {
  private static async loadPatientAuthority(
    tenantId: string,
    patientId: string
  ): Promise<Record<string, unknown>> {
    const db = getAdminFirestore();
    if (!db) throw new Error('PATIENT360_READ_STORE_UNAVAILABLE');

    const snapshot = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('patients')
      .doc(patientId)
      .get();

    if (!snapshot.exists) {
      throw new Error('PATIENT360_PATIENT_NOT_FOUND');
    }

    const patient = snapshot.data() as Record<string, unknown>;
    if (String(patient.status || '').toUpperCase() === 'MERGED') {
      const canonicalPatientId = String(
        patient.mergedIntoPatientId || patient.mergedIntoMrn || ''
      ).trim();
      throw new Error(
        `PATIENT360_PATIENT_MERGED:${canonicalPatientId || 'UNKNOWN'}`
      );
    }

    return patient;
  }

  public static async getProjection(
    tenantId: string,
    patientId: string
  ): Promise<Patient360ProjectionResponse> {
    const db = getAdminFirestore();
    if (!db) throw new Error('PATIENT360_READ_STORE_UNAVAILABLE');

    await this.loadPatientAuthority(tenantId, patientId);

    const [projectionSnapshot, authoritativeEvents] = await Promise.all([
      db
        .collection('tenants')
        .doc(tenantId)
        .collection('patient360Projections')
        .doc(patientId)
        .get(),
      Patient360ProjectionService.loadPatientEvents(tenantId, patientId),
    ]);

    const projection = projectionSnapshot.exists
      ? (projectionSnapshot.data() as Patient360Projection)
      : null;

    const freshness = evaluatePatient360Freshness({
      projection,
      authoritativeEvents,
    });

    if (!projection) {
      throw new Error('PATIENT360_PROJECTION_NOT_READY');
    }

    if (projection.tenantId !== tenantId || projection.patientId !== patientId) {
      throw new Error('PATIENT360_PROJECTION_SCOPE_MISMATCH');
    }

    return {
      success: true,
      tenantId,
      patientId,
      projection,
      freshness,
    };
  }

  public static async getTimelinePage(params: {
    tenantId: string;
    patientId: string;
    limit?: number;
    cursor?: string | null;
  }): Promise<Patient360TimelinePage> {
    const db = getAdminFirestore();
    if (!db) throw new Error('PATIENT360_READ_STORE_UNAVAILABLE');

    const limit = Math.min(100, Math.max(1, Number(params.limit || 50)));
    const cursor = decodeCursor(params.cursor);

    const projectionResponse = await this.getProjection(
      params.tenantId,
      params.patientId
    );

    let query = db
      .collection('tenants')
      .doc(params.tenantId)
      .collection('patient360Timeline')
      .where('patientId', '==', params.patientId)
      .orderBy('occurredAt', 'desc')
      .orderBy('eventId', 'desc')
      .limit(limit + 1);

    if (cursor) {
      query = query.startAfter(cursor.occurredAt, cursor.eventId);
    }

    const snapshot = await query.get();
    const rows = snapshot.docs.map(
      (document) => document.data() as Patient360TimelineItem
    );

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            occurredAt: Number(last.occurredAt || 0),
            eventId: last.eventId,
          })
        : undefined;

    return {
      success: true,
      tenantId: params.tenantId,
      patientId: params.patientId,
      items,
      page: {
        limit,
        nextCursor,
        hasMore,
      },
      projection: {
        projectionVersion: projectionResponse.projection.projectionVersion,
        revision: projectionResponse.projection.revision,
        contentHash: projectionResponse.projection.contentHash,
        sourceCheckpoint: projectionResponse.projection.sourceCheckpoint,
        freshness: projectionResponse.freshness.status,
      },
    };
  }
}
