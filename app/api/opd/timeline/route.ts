import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { assertPatient360PatientAccess } from '@/lib/clinical/patient360/patient360-access';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';
import { getAdminFirestore } from '@/server/firebase/admin';
import type {
  AuditRecord,
  DomainEventEnvelope,
} from '@/lib/backend/types';
import type { OpdTimelineEvent } from '@/types/opd-domain';

const MAX_EVENTS_PER_QUERY = 250;
const MAX_TIMELINE_EVENTS = 300;
const AUDIT_IN_CHUNK = 10;
const REDACTED_KEY =
  /(password|token|authorization|secret|credential|private|raw|content|noteBody|noteContent)/i;

function boundedScalar(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, 1000);
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return undefined;
}

function sanitizePayload(
  value: unknown,
  depth = 0
): unknown {
  if (depth > 3) return '[TRUNCATED]';

  const scalar = boundedScalar(value);
  if (scalar !== undefined) return scalar;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizePayload(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    ).slice(0, 80)) {
      if (REDACTED_KEY.test(key)) {
        output[key] = '[REDACTED]';
        continue;
      }
      output[key.slice(0, 100)] = sanitizePayload(child, depth + 1);
    }
    return output;
  }

  return undefined;
}

async function readEncounterEvents(
  tenantId: string,
  encounterId: string
): Promise<{ events: DomainEventEnvelope[]; truncated: boolean }> {
  const db = getAdminFirestore();
  if (!db) {
    throw new Error(
      'AUTHORITATIVE_TIMELINE_STORE_UNAVAILABLE: durable Firestore event store is required.'
    );
  }

  const eventsRef = db
    .collection('tenants')
    .doc(tenantId)
    .collection('events');

  const [aggregateSnapshot, payloadSnapshot] = await Promise.all([
    eventsRef
      .where('aggregateId', '==', encounterId)
      .limit(MAX_EVENTS_PER_QUERY)
      .get(),
    eventsRef
      .where('payload.encounterId', '==', encounterId)
      .limit(MAX_EVENTS_PER_QUERY)
      .get(),
  ]);

  const byId = new Map<string, DomainEventEnvelope>();
  for (const snapshot of [aggregateSnapshot, payloadSnapshot]) {
    for (const doc of snapshot.docs) {
      const event = doc.data() as DomainEventEnvelope;
      const eventId = String(event.eventId || doc.id).trim();
      if (!eventId) continue;
      byId.set(eventId, {
        ...event,
        eventId,
      });
    }
  }

  const scopedEvents = [...byId.values()]
    .filter(
      (event) =>
        String(event.tenantId || '') === tenantId &&
        (String(event.aggregateId || '') === encounterId ||
          String(event.payload?.encounterId || '') === encounterId)
    )
    .sort(
      (left, right) =>
        Number(left.recordedAt || left.occurredAt || 0) -
          Number(right.recordedAt || right.occurredAt || 0) ||
        left.eventId.localeCompare(right.eventId)
    );

  return {
    events: scopedEvents.slice(-MAX_TIMELINE_EVENTS),
    truncated:
      aggregateSnapshot.size >= MAX_EVENTS_PER_QUERY ||
      payloadSnapshot.size >= MAX_EVENTS_PER_QUERY ||
      scopedEvents.length > MAX_TIMELINE_EVENTS,
  };
}

async function readLinkedAudits(
  tenantId: string,
  eventIds: string[],
  encounterId: string
): Promise<{
  audits: Map<string, AuditRecord>;
  ambiguousEventIds: Set<string>;
}> {
  const db = getAdminFirestore();
  if (!db) {
    throw new Error(
      'AUTHORITATIVE_TIMELINE_STORE_UNAVAILABLE: durable Firestore audit store is required.'
    );
  }

  const auditRef = db
    .collection('tenants')
    .doc(tenantId)
    .collection('audit_logs');

  const chunks: string[][] = [];
  for (let index = 0; index < eventIds.length; index += AUDIT_IN_CHUNK) {
    chunks.push(eventIds.slice(index, index + AUDIT_IN_CHUNK));
  }

  const snapshots = await Promise.all([
    ...chunks.map((ids) =>
      auditRef.where('eventId', 'in', ids).limit(AUDIT_IN_CHUNK).get()
    ),
    auditRef
      .where('resourceId', '==', encounterId)
      .limit(MAX_EVENTS_PER_QUERY)
      .get(),
  ]);

  const byEventId = new Map<string, AuditRecord>();
  const ambiguousEventIds = new Set<string>();
  const seenAuditIds = new Set<string>();
  for (const snapshot of snapshots) {
    for (const doc of snapshot.docs) {
      const audit = doc.data() as AuditRecord;
      const auditId = String(audit.auditId || doc.id).trim();
      const eventId = String(audit.eventId || '').trim();
      if (!auditId || !eventId || seenAuditIds.has(auditId)) continue;
      seenAuditIds.add(auditId);

      if (byEventId.has(eventId)) {
        ambiguousEventIds.add(eventId);
        continue;
      }
      byEventId.set(eventId, {
        ...audit,
        auditId,
      });
    }
  }
  return { audits: byEventId, ambiguousEventIds };
}

function adaptTimelineEvent(
  event: DomainEventEnvelope,
  audit: AuditRecord | undefined,
  encounterId: string,
  ambiguousAudit = false
): OpdTimelineEvent {
  const linked =
    !ambiguousAudit &&
    Boolean(audit) &&
    String(audit?.eventId || '') === event.eventId &&
    String(audit?.commandId || '') === String(event.commandId || '') &&
    String(audit?.tenantId || '') === String(event.tenantId || '') &&
    String(audit?.actorId || '') === String(event.actorId || '') &&
    String(audit?.actorRole || '') === String(event.actorRole || '') &&
    String(audit?.correlationId || '') ===
      String(event.correlationId || '');

  return {
    id: event.eventId,
    encounterId,
    patientId:
      typeof event.payload?.patientId === 'string'
        ? event.payload.patientId
        : undefined,
    eventType: String(event.eventType || 'DOMAIN_EVENT'),
    description:
      String(audit?.reason || '').trim() ||
      String(event.eventType || 'Domain event'),
    actor: String(event.actorId || ''),
    actorRole: String(event.actorRole || 'UNKNOWN'),
    timestamp: Number(event.occurredAt || event.recordedAt || 0),
    recordedAt: Number(event.recordedAt || 0),
    payload: sanitizePayload(event.payload),
    metadata: audit?.metadata
      ? (sanitizePayload(audit.metadata) as Record<string, unknown>)
      : undefined,
    auditId: audit?.auditId,
    commandId: event.commandId,
    correlationId: event.correlationId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    resourceType: audit?.resourceType,
    resourceId: audit?.resourceId,
    auditAction: audit?.action,
    integrityState: linked ? 'EVENT_AUDIT_LINKED' : 'EVENT_ONLY',
    integrityMode: 'SERVER_APPEND_ONLY',
  };
}

export async function GET(req: NextRequest) {
  try {
    const tenantId = String(
      req.nextUrl.searchParams.get('tenantId') ||
        req.headers.get('x-ghims-tenant-id') ||
        ''
    )
      .trim()
      .toLowerCase();
    const encounterId = String(
      req.nextUrl.searchParams.get('encounterId') || ''
    ).trim();

    if (!tenantId || !encounterId) {
      return NextResponse.json(
        {
          success: false,
          error: 'tenantId and encounterId are required.',
        },
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    const { context } = await deriveAuthoritativeContext(req, tenantId);

    const encounter =
      await DomainStateRepository.getById<Record<string, unknown>>(
        context.tenantId,
        'encounters',
        encounterId
      );
    if (!encounter) {
      return NextResponse.json(
        { success: false, error: 'ENCOUNTER_NOT_FOUND' },
        {
          status: 404,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    const patientId = String(encounter.patientId || '').trim();
    const patient = patientId
      ? await DomainStateRepository.getById<Record<string, unknown>>(
          context.tenantId,
          'patients',
          patientId
        )
      : null;

    if (!patient || String(patient.id || patient.patientId || '') !== patientId) {
      return NextResponse.json(
        { success: false, error: 'ENCOUNTER_PATIENT_MISMATCH' },
        {
          status: 409,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    assertPatient360PatientAccess(context, patient, encounter);

    const eventRead = await readEncounterEvents(
      context.tenantId,
      encounterId
    );
    const auditRead = await readLinkedAudits(
      context.tenantId,
      eventRead.events.map((event) => event.eventId),
      encounterId
    );
    const timeline = eventRead.events.map((event) =>
      adaptTimelineEvent(
        event,
        auditRead.audits.get(event.eventId),
        encounterId,
        auditRead.ambiguousEventIds.has(event.eventId)
      )
    );

    const unlinkedEventCount = timeline.filter(
      (event) => event.integrityState !== 'EVENT_AUDIT_LINKED'
    ).length;
    const ambiguousAuditCount = auditRead.ambiguousEventIds.size;

    return NextResponse.json(
      {
        success: true,
        tenantId: context.tenantId,
        patientId,
        encounterId,
        timeline,
        integrity: {
          mode: 'SERVER_APPEND_ONLY',
          eventCount: timeline.length,
          linkedAuditCount: timeline.length - unlinkedEventCount,
          unlinkedEventCount,
          ambiguousAuditCount,
          truncated: eventRead.truncated,
          fullyLinked:
            unlinkedEventCount === 0 &&
            ambiguousAuditCount === 0 &&
            !eventRead.truncated,
        },
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'OPD timeline read failed';
    const unauthorized = /AUTH|TENANT|SESSION|DEVICE|permission/i.test(message);
    const storeUnavailable = message.startsWith(
      'AUTHORITATIVE_TIMELINE_STORE_UNAVAILABLE'
    );
    const safeError = unauthorized
      ? 'OPD_TIMELINE_ACCESS_DENIED'
      : storeUnavailable
        ? 'AUTHORITATIVE_TIMELINE_STORE_UNAVAILABLE'
        : 'OPD_TIMELINE_READ_FAILED';

    return NextResponse.json(
      { success: false, error: safeError },
      {
        status: unauthorized ? 403 : 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
