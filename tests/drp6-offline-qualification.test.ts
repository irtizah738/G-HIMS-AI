import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) =>
  readFile(path.join(process.cwd(), file), 'utf8');

describe('DRP-6 offline qualification contracts', () => {
  test('offline capture requires an active session or a bounded server-issued outage lease', async () => {
    const sync = await source('lib/offline/sync-engine.ts');
    expect(sync).toContain('AUTHENTICATION_REQUIRED: offline commands require an authenticated originating user.');
    expect(sync).toContain('TENANT_MISMATCH: offline command tenant must match the active session or capture lease.');
    expect(sync).toContain('getCachedOfflineCapabilityLease');
    expect(sync).toContain('OFFLINE_CAPABILITY_REQUIRED');
    expect(sync).toContain('OFFLINE_CAPABILITY_COMMAND_DENIED');
    expect(sync).toContain('online command capture requires renewed authoritative authentication');
  });

  test('replay re-authenticates and replaces client actor/device claims with authoritative context', async () => {
    const route = await source('app/api/sync/batch/route.ts');
    expect(route).toContain('deriveAuthoritativeContext');
    expect(route).toContain('tenantId: context.tenantId');
    expect(route).toContain('actorId: context.actorId');
    expect(route).toContain('deviceId: context.deviceId || batch.deviceId');
  });

  test('raw legacy mutations cannot replay and every mutation returns an explicit reconciliation result', async () => {
    const sync = await source('lib/offline/sync-engine.ts');
    expect(sync).toContain('LEGACY_RAW_MUTATION_REJECTED');
    expect(sync).toContain('SYNC_RESPONSE_INCOMPLETE');
    expect(sync).toContain('commandType: mutation.commandType');
    expect(sync).toContain('idempotencyKey: mutation.idempotencyKey');
  });

  test('server compares authoritative version/vector clocks before non-append replay', async () => {
    const reconciliation = await source(
      'lib/backend/services/offline-reconciliation-domain-service.ts'
    );
    expect(reconciliation).toContain('compareAuthoritativeEntityVersion');
    expect(reconciliation).toContain("category !== 'SAFE_APPEND'");
    expect(reconciliation).toContain("status: 'requires_review'");
    expect(reconciliation).toContain('STALE_BASE_VERSION');
    expect(reconciliation).toContain('CAUSAL_CONFLICT');
    expect(reconciliation).toContain('CommandBus.dispatch');
  });

  test('offline cache is encrypted and actor/tenant scoped', async () => {
    const [authStorage, secureStore, crypto] = await Promise.all([
      source('lib/offline/auth-storage.ts'),
      source('lib/offline/secure-store.ts'),
      source('lib/offline/crypto.ts'),
    ]);

    expect(authStorage).toContain('encryptEdgeJson');
    expect(authStorage).toContain('decryptEdgeJson');
    expect(authStorage).toContain('tenantId: user.tenantId');
    expect(authStorage).toContain('actorId: user.uid');

    expect(secureStore).toContain('encryptEdgeJson');
    expect(secureStore).toContain('decryptEdgeJson');
    expect(crypto).toContain('AES-GCM');
    expect(crypto).toContain("{ name: 'AES-GCM', length: 256 }");
    expect(crypto).toMatch(/generateKey\([\s\S]*?false,[\s\S]*?\['encrypt', 'decrypt'\]/);
  });

  test('logout privacy cleanup removes session/membership state and tenant read models', async () => {
    const authStorage = await source('lib/offline/auth-storage.ts');
    expect(authStorage).toContain('clearOfflineReadModelsForTenant');
    expect(authStorage).toContain("localStorage.removeItem('ghims_active_tenant')");
    expect(authStorage).toContain('STORE_SESSION');
    expect(authStorage).toContain('STORE_MEMBERSHIPS');
  });

  test('safety-critical bed and inventory availability are never optimistic offline truth', async () => {
    const [facilities, scm] = await Promise.all([
      source('lib/facilities/facilities-edge-adapter.ts'),
      source('lib/supply-chain/scm-edge-adapter.ts'),
    ]);

    const bedStart = facilities.indexOf('export const updateBedOperationalStatusEdge');
    const bedEnd = facilities.indexOf('export const recordCalibrationEdge', bedStart);
    const bedBlock = facilities.slice(bedStart, bedEnd);
    expect(bedBlock).toContain("'UpdateBedStatusCommand'");
    expect(facilities).not.toContain('offlineQueue');

    expect(scm).toContain("'RecordStockTransactionCommand'");
    expect(scm).toContain('optimisticCache: false');
  });

  test('background sync transport failure preserves queued commands instead of silently deleting them', async () => {
    const sync = await source('lib/offline/sync-engine.ts');
    expect(sync).toContain('SYNC_TRANSPORT_FAILURE');
    expect(sync).toContain("updateMutationStatus(");
    expect(sync).toContain("'failed'");
    expect(sync).toContain('deleteMutation(mutation.id)');
    const deleteIndex = sync.indexOf('deleteMutation(mutation.id)');
    const acceptedIndex = sync.lastIndexOf("if (result.status === 'accepted')", deleteIndex);
    expect(acceptedIndex).toBeGreaterThan(-1);
  });
  test('legacy plaintext offline authority APIs are retired and read snapshots are minimum-necessary', async () => {
    const [db, bootstrap, secureStore] = await Promise.all([
      source('lib/offline/db.ts'),
      source('app/api/offline/bootstrap/route.ts'),
      source('lib/offline/secure-store.ts'),
    ]);

    expect(db).toContain('LEGACY_RAW_MUTATION_RETIRED');
    expect(db).toContain('LEGACY_PLAINTEXT_EDGE_API_RETIRED');
    expect(db).toContain("offline_cache: null");
    expect(db).toContain("clinical_patients: null");
    expect(bootstrap).toContain("requestedSurface === 'FACILITIES'");
    expect(bootstrap).toContain("requestedSurface === 'HOSPITAL_SHELL'");
    expect(bootstrap).toContain('requireEdgeHydrationSurface');
    expect(bootstrap).toContain('There is no generic tenant cache fallback');
    expect(bootstrap).not.toContain("'GENERIC'");
    expect(secureStore).toContain('changedAuthority ||');
    expect(secureStore).toContain('requestedCollections.has(row.collection)');
    expect(secureStore).toContain("scope: 'edge-authority'");
    expect(secureStore).toContain('.primaryKeys()');
  });

  test('encrypted auth storage no longer accepts legacy plaintext session or membership records', async () => {
    const authStorage = await source('lib/offline/auth-storage.ts');
    expect(authStorage).not.toContain('record.user && record.session');
    expect(authStorage).not.toContain('Legacy plaintext record');
    expect(authStorage).toContain('STORE_OFFLINE_CAPABILITY');
    expect(authStorage).toContain('saveCachedOfflineCapabilityLease');
    expect(authStorage).toContain('getCachedOfflineCapabilityLease');
  });

});
