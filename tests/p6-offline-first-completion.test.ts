import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compareClocks, mergeClocks } from '@/lib/offline/vector-clock';

const source = async (file: string): Promise<string> =>
  (await readFile(path.join(process.cwd(), file), 'utf8')).replace(/\r\n/g, '\n');

describe('G-HIMS P6 full offline-first completion', () => {
  test('edge PHI uses non-extractable AES-GCM envelopes', async () => {
    const crypto = await source('lib/offline/crypto.ts');
    const secure = await source('lib/offline/secure-store.ts');
    const engine = await source('lib/offline/sync-engine.ts');

    expect(crypto).toContain("name: 'AES-GCM'");
    expect(crypto).toContain('length: 256');
    expect(crypto).toContain("false,\n      ['encrypt', 'decrypt']");
    expect(crypto).toContain('additionalData: aad');
    expect(crypto).toContain('ghims_edge_crypto_db');

    expect(secure).toContain('encryptedPayload');
    expect(secure).toContain('encryptedData');
    expect(secure).toContain('payload: {}');
    expect(secure).toContain('data: {}');
    expect(engine).toContain('putSecureMutation');
    expect(engine).toContain('putSecureEdgeEntities');
    expect(engine).toContain('recordSecureConflict');
    expect(engine).not.toContain('saveToOfflineCache(');
  });

  test('encrypted pending commands are actor-scoped before decryption on shared workstations', async () => {
    const secure = await source('lib/offline/secure-store.ts');
    const engine = await source('lib/offline/sync-engine.ts');
    const hook = await source('hooks/useOfflineStatus.ts');

    expect(secure).toContain('item.actorId === normalizedActorId');
    expect(secure.indexOf('item.actorId === normalizedActorId')).toBeLessThan(
      secure.indexOf('return Promise.all(rows.map(decryptMutation))')
    );
    expect(secure).toContain('getSecurePendingVectorClock');
    expect(engine).toContain('getSecurePendingMutations(activeTenantId, cached.user.uid)');
    expect(engine).toContain('getSecurePendingVectorClock(params.tenantId, actorId)');
    expect(engine).toContain('const clockNodeId = deviceId || actorId');
    expect(hook).toContain('getSecurePendingMutations(tenantId, cached.user.uid)');
    expect(hook).toContain('getSecurePendingVectorClock(tenantId, cached.user.uid)');
  });

  test('legacy plaintext edge data is migrated or purged at authenticated boundaries', async () => {
    const migration = await source('lib/offline/migration.ts');
    const auth = await source('lib/auth/auth-client.ts');

    expect(migration).toContain('migrateLegacyEdgeStorage');
    expect(migration).toContain('encryptedPayload');
    expect(migration).toContain('payload: {}');
    expect(migration).toContain("status: 'failed'");
    expect(migration).toContain('LEGACY_ACTOR_UNKNOWN');
    expect(migration).toContain('await encryptEdgeJson');
    expect(migration).toContain('Generation-1 plaintext read-model stores are deleted by the Dexie v3');
    expect(migration).not.toContain('localDb.offline_cache.where');
    expect(migration).not.toContain("localDb.transaction(\n    'rw'");

    expect(auth).toContain('migrateLegacyEdgeStorage');
    expect(auth).toContain('tenantId: authUser.tenantId');
    expect(auth).toContain('actorId: authUser.uid');
  });

  test('hospital read models are encrypted local-first and role-scoped', async () => {
    const hydration = await source('lib/offline/hydration.ts');
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');
    const hospital = await source('lib/context/hospital-context.tsx');

    expect(hydration).toContain('loadLocalEdgeSnapshot');
    expect(hydration).toContain('listSecureEdgeEntities');
    expect(hydration).toContain('replaceSecureTenantEdgeSnapshot');
    expect(hydration).toContain('enforceEdgeStorageBudget');
    expect(bootstrap).toContain('authorizedCollections');
    expect(bootstrap).toContain('readCollectionSnapshot');
    expect(bootstrap).toContain('EDGE_PAGE_SIZE');
    expect(bootstrap).toContain('EDGE_COLLECTION_MAX');
    expect(bootstrap).not.toContain('.limit(1000)');
    expect(hospital).toContain("void loadLocalEdgeSnapshot(tenantId, 'HOSPITAL_SHELL')");
    expect(hospital).toContain("void hydrateEdgeSnapshot(tenantId, { surface: 'HOSPITAL_SHELL' })");
    expect(hospital).toContain("window.addEventListener('ghims:edge-sync-complete'");
  });

  test('offline registration creates local identities and server canonical mappings', async () => {
    const client = await source('lib/api/command-client.ts');
    const reconcile = await source('lib/backend/services/offline-reconciliation-domain-service.ts');
    const secure = await source('lib/offline/secure-store.ts');

    expect(client).toContain('queueOfflineRegistration');
    expect(client).toContain('local-patient-');
    expect(client).toContain('local-encounter-');
    expect(client).toContain('local-opd-');
    expect(client).toContain("'RegisterPatientAndEncounterCommand'");
    expect(client).toContain('putLocalEntityMappings');
    expect(client).toContain('putSecureEdgeEntities');

    expect(reconcile).toContain('processOfflineRegistration');
    expect(reconcile).toContain('registerPatientAndEncounter');
    expect(reconcile).toContain('entityMappings');
    expect(reconcile).toContain('canonicalMappings');
    expect(reconcile).toContain('rewriteMappedReferences');

    expect(secure).toContain('putEntityMappings');
    expect(secure).toContain('resolveMappedReferences');
    expect(secure).toContain('remapEdgeEntityIds');
    expect(secure).toContain('encryptedData = await encryptEdgeJson');
  });

  test('causal metadata reaches authoritative reconciliation and never uses generic client LWW', async () => {
    const types = await source('lib/backend/types.ts');
    const engine = await source('lib/offline/sync-engine.ts');
    const reconcile = await source('lib/backend/services/offline-reconciliation-domain-service.ts');
    const versions = await source('server/repositories/edge-version-repository.ts');

    expect(types).toContain('baseEntityVersion?: number');
    expect(types).toContain('baseVectorClock?: Record<string, number>');
    expect(types).toContain('vectorClock?: Record<string, number>');
    expect(engine).toContain('baseEntityVersion: mutation.baseEntityVersion');
    expect(engine).toContain('vectorClock: mutation.vectorClock');
    expect(engine).toContain('baseVectorClock: mutation.baseVectorClock');

    expect(versions).toContain('serverVersion');
    expect(versions).toContain('compareClocks');
    expect(versions).toContain("'CONCURRENT'");
    expect(versions).toContain("'STALE'");
    expect(reconcile).toContain('STALE_BASE_VERSION');
    expect(reconcile).toContain('CAUSAL_CONFLICT');
    expect(reconcile).toContain('acceptedEntityClocks');
    expect(reconcile).toContain("chainRelation === 'LESS' || chainRelation === 'EQUAL'");
    expect(reconcile).not.toContain('resolveVectorConflict');
  });

  test('online and offline writes share the same authoritative entity version', async () => {
    const tx = await source('lib/backend/transactions/transaction-manager.ts');
    const secure = await source('lib/offline/secure-store.ts');
    const engine = await source('lib/offline/sync-engine.ts');
    const reconcile = await source('lib/backend/services/offline-reconciliation-domain-service.ts');
    const versions = await source('server/repositories/edge-version-repository.ts');

    expect(tx).toContain('_serverVersion: currentVersion + 1');
    expect(tx).toContain('await transaction.get(stateRef)');
    expect(tx).toContain('toVersionedDocumentData');
    expect(secure).toContain('(entity as any)._serverVersion');
    expect(secure).toContain('getSecureEdgeEntityMetadata');
    expect(engine).toContain('entityMetadata?.serverVersion');
    expect(engine).toContain('baseVectorClock');
    expect(reconcile).toContain('getAuthoritativeEntityVersion');
    expect(reconcile).toContain('compareAuthoritativeEntityVersion');
    expect(reconcile).not.toContain('EdgeVersionRepository.recordAccepted');
    expect(versions).toContain("collection(collection)");
    expect(versions).toContain('data._serverVersion');
  });

  test('SCM shares the same encrypted edge store and governed CommandBus', async () => {
    const offlineStore = await source('lib/supply-chain/scm-offline-store.ts');
    const edge = await source('lib/supply-chain/scm-edge-adapter.ts');
    const bus = await source('lib/backend/commands/command-bus.ts');
    const service = await source('lib/backend/services/scm-offline-domain-service.ts');
    const view = await source('components/views/supply-chain-scm-view.tsx');

    expect(offlineStore).not.toContain('GHIMS_SCM_OFFLINE_DB');
    expect(offlineStore).toContain('syncEngine.queueMutation');
    expect(offlineStore).toContain('getSecurePendingMutations');
    expect(edge).toContain('loadLocalScmEdgeData');
    expect(edge).toContain('hydrateScmEdgeData');
    expect(edge).toContain("'RecordStockTransactionCommand'");
    expect(edge).toContain("'SubmitPurchaseRequisitionCommand'");

    expect(bus).toContain("'RecordStockTransactionCommand'");
    expect(bus).toContain("'RecordPatientConsumptionCommand'");
    expect(bus).toContain("'SubmitPurchaseRequisitionCommand'");
    expect(service).toContain('TransactionManager.executeAtomicReadModifyMutation');
    expect(service).toContain('TransactionManager.executeAtomicWrite');

    expect(view).toContain('loadLocalScmEdgeData');
    expect(view).toContain('hydrateScmEdgeData');
    expect(view).not.toContain('getInventoryBalances(');
    expect(view).not.toContain('recordStockTransaction(');
  });

  test('edge storage is persistent, bounded and outbox-safe', async () => {
    const storage = await source('lib/offline/storage-manager.ts');
    const leader = await source('lib/offline/sync-leader.ts');
    const engine = await source('lib/offline/sync-engine.ts');
    const db = await source('lib/offline/db.ts');

    expect(storage).toContain('navigator.storage.persist');
    expect(storage).toContain('navigator.storage.estimate');
    expect(storage).toContain('edgeStoragePressure');
    expect(storage).toContain('PRUNABLE_COLLECTIONS');
    expect(storage).not.toContain('localDb.mutations.bulkDelete');
    expect(storage).not.toContain('localDb.mutations.clear');

    expect(leader).toContain('ghims-edge-sync-leader');
    expect(leader).toContain("ifAvailable: true");
    expect(engine).toContain('withEdgeSyncLeadership');

    expect(db).toContain('localDb.edge_entities.where');
    expect(db).toContain('Do not delete encrypted pending mutations or entity_map');
  });

  test('PHI-free shell can restart offline while clinical HTML remains uncached', async () => {
    const sw = await source('public/sw.js');
    const home = await source('app/page.tsx');

    expect(sw).toContain("const CACHE_NAME = 'ghims-clinical-shell-v2'");
    expect(sw).toContain("url.pathname === '/' || url.pathname === '/login'");
    expect(sw).toContain('Never cache rendered clinical/deep-link HTML');
    expect(sw).toContain("caches.match('/')");
    expect(home).toContain("'use client'");
    expect(home).toContain('<AuthGuard>');
  });

  test('offline session restoration uses verified application reachability', async () => {
    const auth = await source('lib/auth/auth-client.ts');
    expect(auth).toContain('probeApplicationConnectivity');
    expect(auth).not.toContain('!navigator.onLine');
    expect(auth).toContain('getCachedAuthSession');
  });

  test('vector clocks distinguish ordered and concurrent histories', () => {
    expect(compareClocks({ deviceA: 1 }, { deviceA: 1 })).toBe('EQUAL');
    expect(compareClocks({ deviceA: 2 }, { deviceA: 1 })).toBe('GREATER');
    expect(compareClocks({ deviceA: 1 }, { deviceA: 2 })).toBe('LESS');
    expect(compareClocks({ deviceA: 2, deviceB: 1 }, { deviceA: 1, deviceB: 2 })).toBe('CONCURRENT');
    expect(mergeClocks({ deviceA: 2 }, { deviceA: 1, deviceB: 3 })).toEqual({
      deviceA: 2,
      deviceB: 3,
    });
  });

  test('browser conflict handling remains review-only', async () => {
    const db = await source('lib/offline/db.ts');
    const secure = await source('lib/offline/secure-store.ts');
    const banner = await source('components/offline/SyncStatusBanner.tsx');

    expect(db).toContain('SERVER_RECONCILIATION_REQUIRED');
    expect(secure).toContain('recordSecureConflict');
    expect(secure).toContain('getSecureConflicts');
    expect(banner).toContain('Server Review Required');
    expect(banner).not.toContain('Apply Client Overwrite');
    expect(banner).not.toContain('Accept Server (LWW)');
  });
});
