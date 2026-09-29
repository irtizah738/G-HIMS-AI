import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';
import { TransactionManager } from '@/lib/backend/transactions/transaction-manager';
import {
  ProjectionWorkers,
  type ConsumableEvent,
} from '@/lib/backend/projections/projection-workers';

export interface ProjectionRecoveryManifest {
  runId: string;
  tenantId: string;
  runtimeMode: string;
  status: 'SUCCESS';
  eventCount: number;
  checkpointCount: number;
  patient360CheckpointCount: number;
  patient360ProjectionCount: number;
  patient360TimelineCount: number;
  eventTypeCounts: Record<string, number>;
  eventStreamSha256: string;
  projectionSha256: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
}

const VOLATILE_PROJECTION_FIELDS = new Set([
  'projectedAt',
  'updatedAt',
  'processedAt',
]);

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !VOLATILE_PROJECTION_FIELDS.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, stableNormalize(nested)])
  );
}

function sha256(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(stableNormalize(value)))
    .digest('hex');
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(':', 1)[0].slice(0, 120) || 'PROJECTION_REBUILD_FAILED';
}

async function projectionFingerprint(tenantId: string): Promise<string> {
  const db = getAdminFirestore();
  if (!db) throw new Error('PROJECTION_STORE_UNAVAILABLE: Firebase Admin Firestore is required.');

  const tenantRef = db.collection('tenants').doc(tenantId);
  const collections = [
    'timelineProjections',
    'clinicalQueues',
    'generalLedgerProjections',
    'patient360Projections',
    'patient360Timeline',
  ];

  const snapshot: Record<string, unknown[]> = {};
  for (const collectionName of collections) {
    const docs = await tenantRef.collection(collectionName).get();
    snapshot[collectionName] = docs.docs
      .map((document) => ({
        id: document.id,
        data: stableNormalize(document.data()),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  return sha256(snapshot);
}

export class ProjectionRecoveryService {
  /**
   * Rebuilds disposable read models only in an explicitly confirmed, isolated
   * non-production recovery environment.
   *
   * This method never permits an in-place production rebuild.
   */
  public static async rebuildTenantInIsolatedEnvironment(
    tenantIdInput: string
  ): Promise<ProjectionRecoveryManifest> {
    const tenantId = String(tenantIdInput || '').trim();
    if (!tenantId) {
      throw new Error('PROJECTION_REBUILD_TENANT_REQUIRED');
    }

    const mode = getRuntimeMode();
    if (mode === 'PRODUCTION') {
      throw new Error(
        'PROJECTION_REBUILD_FORBIDDEN_IN_PRODUCTION: restore into an isolated recovery project first.'
      );
    }

    if (process.env.GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD !== 'true') {
      throw new Error(
        'PROJECTION_REBUILD_CONFIRMATION_REQUIRED: GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD=true is required.'
      );
    }

    if (process.env.GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT !== tenantId) {
      throw new Error(
        'PROJECTION_REBUILD_TENANT_CONFIRMATION_MISMATCH: confirmed tenant must exactly match the requested tenant.'
      );
    }

    const db = getAdminFirestore();
    if (!db) {
      throw new Error(
        'PROJECTION_STORE_UNAVAILABLE: isolated recovery requires Firebase Admin Firestore.'
      );
    }

    const runId = `prjrb_${crypto.randomUUID()}`;
    const startedAt = Date.now();
    const runRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('projectionRecoveryRuns')
      .doc(runId);

    await runRef.create({
      runId,
      tenantId,
      runtimeMode: mode,
      status: 'RUNNING',
      startedAt,
    });

    try {
      const authoritativeEvents = await TransactionManager.getEvents(tenantId);
      if (authoritativeEvents.length === 0) {
        throw new Error(
          'PROJECTION_REBUILD_EMPTY_STREAM: no authoritative tenant events were found.'
        );
      }

      const eventIds = new Set<string>();
      const eventTypeCounts: Record<string, number> = {};
      const normalizedForHash = authoritativeEvents.map((event) => {
        if (event.tenantId !== tenantId) {
          throw new Error(
            'PROJECTION_REBUILD_TENANT_SCOPE_INVALID: authoritative stream contains another tenant.'
          );
        }
        if (!event.eventId || eventIds.has(event.eventId)) {
          throw new Error(
            `PROJECTION_REBUILD_DUPLICATE_EVENT: ${event.eventId || 'missing-event-id'}`
          );
        }
        eventIds.add(event.eventId);
        eventTypeCounts[event.eventType] =
          (eventTypeCounts[event.eventType] || 0) + 1;

        return {
          eventId: event.eventId,
          tenantId: event.tenantId,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          eventType: event.eventType,
          eventVersion: event.eventVersion,
          payload: event.payload,
          occurredAt: event.occurredAt,
          recordedAt: event.recordedAt,
          commandId: event.commandId,
          idempotencyKey: event.idempotencyKey,
          schemaVersion: event.schemaVersion,
        };
      });

      const eventStreamSha256 = sha256(normalizedForHash);

      const consumableEvents: ConsumableEvent[] = authoritativeEvents.map(
        (event) => ({
          eventId: event.eventId,
          tenantId: event.tenantId,
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event.payload,
          occurredAt: event.occurredAt,
          recordedAt: event.recordedAt,
        })
      );

      const rebuilt = await ProjectionWorkers.rebuildProjections(
        consumableEvents,
        {
          expectedTenantId: tenantId,
          allowDestructive: true,
        }
      );

      const tenantRef = db.collection('tenants').doc(tenantId);
      const [
        checkpointSnapshot,
        patient360CheckpointSnapshot,
        patient360ProjectionSnapshot,
        patient360TimelineSnapshot,
      ] = await Promise.all([
        tenantRef.collection('projectionCheckpoints').get(),
        tenantRef.collection('patient360ProjectionCheckpoints').get(),
        tenantRef.collection('patient360Projections').get(),
        tenantRef.collection('patient360Timeline').get(),
      ]);

      const checkpointCount = checkpointSnapshot.size;
      const patient360CheckpointCount = patient360CheckpointSnapshot.size;
      const patient360ProjectionCount = patient360ProjectionSnapshot.size;
      const patient360TimelineCount = patient360TimelineSnapshot.size;

      if (
        rebuilt.rebuiltCount !== authoritativeEvents.length ||
        checkpointCount !== authoritativeEvents.length ||
        patient360CheckpointCount !== authoritativeEvents.length
      ) {
        throw new Error(
          `PROJECTION_REBUILD_INCOMPLETE: events=${authoritativeEvents.length} rebuilt=${rebuilt.rebuiltCount} checkpoints=${checkpointCount} patient360Checkpoints=${patient360CheckpointCount}`
        );
      }

      const projectionSha256 = await projectionFingerprint(tenantId);
      const completedAt = Date.now();

      const manifest: ProjectionRecoveryManifest = {
        runId,
        tenantId,
        runtimeMode: mode,
        status: 'SUCCESS',
        eventCount: authoritativeEvents.length,
        checkpointCount,
        patient360CheckpointCount,
        patient360ProjectionCount,
        patient360TimelineCount,
        eventTypeCounts,
        eventStreamSha256,
        projectionSha256,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
      };

      await runRef.set(manifest, { merge: true });
      return manifest;
    } catch (error) {
      await runRef.set(
        {
          status: 'FAILED',
          completedAt: Date.now(),
          errorCode: errorCode(error),
        },
        { merge: true }
      );
      throw error;
    }
  }
}
