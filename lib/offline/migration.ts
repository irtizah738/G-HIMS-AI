'use client';

import { localDb } from '@/lib/offline/db';
import { encryptEdgeJson, isEncryptedEdgeEnvelope } from '@/lib/offline/crypto';

export interface LegacyEdgeMigrationContext {
  tenantId: string;
  actorId: string;
}

/**
 * One-way privacy migration for devices upgraded from pre-P6 builds.
 *
 * - governed pending commands with plaintext payloads are encrypted at rest;
 * - actorless legacy commands are encrypted under a quarantine key and remain
 *   unreplayable until explicitly reviewed;
 * - plaintext legacy read-model tables are purged;
 * - plaintext edge_entities are encrypted only when ownership is known,
 *   otherwise purged fail-closed.
 */
export async function migrateLegacyEdgeStorage(
  context: LegacyEdgeMigrationContext
): Promise<void> {
  const tenantId = String(context.tenantId || '').trim().toLowerCase();
  const activeActorId = String(context.actorId || '').trim();
  if (!tenantId || !activeActorId) return;

  await localDb.transaction(
    'rw',
    [
      localDb.mutations,
      localDb.offline_cache,
      localDb.clinical_patients,
      localDb.bed_occupancy,
      localDb.surgical_cases,
      localDb.edge_entities,
    ],
    async () => {
      const mutations = await localDb.mutations.where('tenantId').equals(tenantId).toArray();
      for (const mutation of mutations) {
        if (mutation.encryptedPayload && isEncryptedEdgeEnvelope(mutation.encryptedPayload)) {
          if (Object.keys(mutation.payload || {}).length > 0) {
            await localDb.mutations.update(mutation.id, { payload: {} });
          }
          continue;
        }

        const plaintextPayload = mutation.payload || {};
        if (Object.keys(plaintextPayload).length === 0) continue;

        const owner = String(mutation.actorId || '').trim();
        const encryptionActor = owner || 'legacy-unowned';
        const encryptedPayload = await encryptEdgeJson(
          tenantId,
          encryptionActor,
          plaintextPayload
        );

        await localDb.mutations.update(mutation.id, {
          encryptedPayload,
          payload: {},
          ...(owner
            ? {}
            : {
                status: 'failed',
                errorMessage:
                  'LEGACY_ACTOR_UNKNOWN: migrated encrypted command requires manual review and cannot auto-replay.',
              }),
        });
      }

      const edgeRows = await localDb.edge_entities
        .where('tenantId')
        .equals(tenantId)
        .toArray();

      for (const row of edgeRows) {
        if (row.encryptedData && isEncryptedEdgeEnvelope(row.encryptedData)) {
          if (Object.keys((row.data || {}) as Record<string, unknown>).length > 0) {
            await localDb.edge_entities.update(row.key, { data: {} });
          }
          continue;
        }

        const plaintext = (row.data || {}) as Record<string, unknown>;
        if (Object.keys(plaintext).length === 0) continue;

        // Unknown ownership on a shared workstation is not migrated into another
        // user's key domain. Purge it; the next authoritative hydration restores it.
        if (!row.actorId) {
          await localDb.edge_entities.delete(row.key);
          continue;
        }

        const encryptedData = await encryptEdgeJson(tenantId, row.actorId, plaintext);
        await localDb.edge_entities.update(row.key, {
          encryptedData,
          data: {},
        });
      }

      // Pre-P6 read-model tables were plaintext. They are projections, never the
      // authoritative write ledger, so purge them rather than retaining PHI.
      await localDb.offline_cache.where('tenantId').equals(tenantId).delete();
      await localDb.clinical_patients.where('tenantId').equals(tenantId).delete();
      await localDb.bed_occupancy.where('tenantId').equals(tenantId).delete();
      await localDb.surgical_cases.where('tenantId').equals(tenantId).delete();
    }
  );
}
