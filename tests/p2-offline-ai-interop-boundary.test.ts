import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

describe('G-HIMS P2 offline / AI / interoperability safety boundaries',()=>{
  test('legacy offline worker cannot write Firestore or perform client LWW merges',async()=>{
    const worker=await source('lib/offline/sync-worker.ts');
    expect(worker).not.toContain('firebase/firestore');
    expect(worker).not.toContain('runTransaction');
    expect(worker).not.toContain('resolveVectorConflict');
    expect(worker).toContain('LEGACY_RAW_MUTATION_REJECTED');
    expect(worker).toContain('syncEngine.queueMutation');
  });

  test('offline state is based on application reachability, not navigator.onLine alone',async()=>{
    const connectivity=await source('lib/offline/connectivity.ts');
    const engine=await source('lib/offline/sync-engine.ts');
    const hook=await source('hooks/useOfflineStatus.ts');

    expect(connectivity).toContain('/api/health?connectivityProbe=');
    expect(connectivity).toContain("cache: 'no-store'");
    expect(connectivity).toContain('AbortController');

    expect(engine).toContain('probeApplicationConnectivity');
    expect(engine).not.toContain('navigator.onLine');
    expect(hook).toContain('refreshConnectivity');
    expect(hook).not.toContain('navigator.onLine');
  });

  test('sync status indicator is driven by real edge and replica telemetry',async()=>{
    const indicator=await source('components/navigation/sync-status-indicator.tsx');
    const hook=await source('hooks/useOfflineStatus.ts');
    const engine=await source('lib/offline/sync-engine.ts');
    const db=await source('lib/offline/db.ts');
    const statusRoute=await source('app/api/sync/status/route.ts');

    expect(indicator).toContain("useOfflineStatus");
    expect(indicator).toContain("activeTenant");
    expect(indicator).toContain("localStoreLatencyMs");
    expect(indicator).toContain("replicaLatencyMs");
    expect(indicator).toContain("replicaStoreLatencyMs");
    expect(indicator).toContain("vectorClock");
    expect(indicator).toContain("lastReplicationEvent");
    expect(indicator).toContain("setOfflineSimulation");
    expect(indicator).not.toContain("useHospital");
    expect(indicator).not.toContain("Latency: 1.2ms");
    expect(indicator).not.toContain("Status: 18ms");
    expect(indicator).not.toContain("241 +");
    expect(indicator).not.toContain("setTimeout(() =>");

    expect(hook).toContain("measureLocalStoreLatency");
    expect(hook).toContain("getPendingVectorClock");
    expect(hook).toContain("replicaReachable");
    expect(hook).toContain("lastReplicationEvent");

    expect(engine).toContain("refreshReplicaStatus");
    expect(engine).toContain("setOfflineSimulation");
    expect(engine).toContain("OFFLINE_SIMULATION_DISABLED_IN_PRODUCTION");
    expect(engine).toContain("lastReplicationEvent");
    expect(engine).toContain("/api/sync/status?tenantId=");

    expect(db).toContain("getPendingVectorClock");
    expect(db).toContain("measureLocalStoreLatency");

    expect(statusRoute).toContain("deriveAuthoritativeContext");
    expect(statusRoute).toContain("getAdminFirestore");
    expect(statusRoute).toContain("storeLatencyMs");
    expect(statusRoute).toContain("Cache-Control");
  });

  test('governed clinical commands use the real IndexedDB outbox on transport failure',async()=>{
    const client=await source('lib/api/command-client.ts');
    const engine=await source('lib/offline/sync-engine.ts');
    const hospital=await source('lib/context/hospital-context.tsx');
    const types=await source('lib/backend/types.ts');

    expect(client).toContain('queueGovernedOfflineCommand');
    expect(client).toContain('syncEngine.queueMutation');
    expect(client).toContain('offlineSimulationActive');
    expect(client).toContain('isTransientServerStatus');
    expect(client).toContain('status === 502 || status === 503 || status === 504');
    expect(client).toContain('mutationId: commandId');
    expect(client).not.toContain("response.status === 401");
    expect(client).not.toContain("response.status === 403");

    expect(engine).toContain('getPendingVectorClock');
    expect(engine).toContain('incrementClock');
    expect(engine).toContain('clockNodeId = cached.session.deviceId || cached.user.uid');
    expect(engine).toContain('id: params.mutationId');

    expect(types).toContain('queuedOffline?: boolean');

    expect(hospital).toContain("collection: 'clinical_notes'");
    expect(hospital).toContain("collection: 'clinical_orders'");
    expect(hospital).toContain("collection: 'vitals'");
    expect(hospital).toContain("collection: 'opd_queue'");
    expect(hospital).toContain("collection: 'beds'");
    expect(hospital).toContain('result.queuedOffline');
  });

  test('sync telemetry cannot extend session activity or strand in-flight mutations',async()=>{
    const statusRoute=await source('app/api/sync/status/route.ts');
    const sessionService=await source('server/auth/session-service.ts');
    const authoritative=await source('lib/backend/security/authoritative-context.ts');
    const engine=await source('lib/offline/sync-engine.ts');

    expect(statusRoute).toContain('touchSessionActivity: false');
    expect(authoritative).toContain('touchSessionActivity?: boolean');
    expect(authoritative).toContain('touchActivity: options.touchSessionActivity !== false');
    expect(sessionService).toContain('touchActivity?: boolean');

    const validateSessionSection=sessionService.slice(
      sessionService.indexOf('export async function validateSession('),
      sessionService.indexOf('export function validateSessionRecord(')
    );
    expect(validateSessionSection).toContain('if (options.touchActivity === false)');
    expect(validateSessionSection.indexOf('if (options.touchActivity === false)')).toBeLessThan(
      validateSessionSection.indexOf('await sessionDocRef.update')
    );

    expect(engine).toContain('processingMutationIds');
    expect(engine).toContain('SYNC_TRANSPORT_FAILURE');
    expect(engine).toContain('SYNC_RESPONSE_INCOMPLETE');
    expect(engine).toContain("updateMutationStatus(\n          mutationId,\n          'failed'");
    expect(engine).toContain('AbortController');
  });

  test('clinical sync conflicts are review-only in the browser',async()=>{
    const db=await source('lib/offline/db.ts');
    const banner=await source('components/offline/SyncStatusBanner.tsx');

    expect(db).toContain('SERVER_RECONCILIATION_REQUIRED');
    expect(db).not.toContain("await localDb.offline_cache.delete(key)");
    expect(banner).toContain('Server Review Required');
    expect(banner).toContain('server-authoritative reconciliation workflow');
    expect(banner).not.toContain('Accept Server (LWW)');
    expect(banner).not.toContain('Apply Client Overwrite');
  });

  test('P6A hospital read models are local-first and server-hydrated outside DEMO',async()=>{
    const db=await source('lib/offline/db.ts');
    const hydration=await source('lib/offline/hydration.ts');
    const adapter=await source('lib/offline/read-model-adapter.ts');
    const bootstrap=await source('app/api/offline/bootstrap/route.ts');
    const hospital=await source('lib/context/hospital-context.tsx');

    expect(db).toContain("edge_entities");
    expect(db).toContain("entity_map");
    expect(db).toContain("sync_metadata");
    expect(db).toContain("replaceTenantEdgeSnapshot");
    expect(db).toContain("listEdgeEntities");

    expect(hydration).toContain("loadLocalEdgeSnapshot");
    expect(hydration).toContain("hydrateEdgeSnapshot");
    expect(hydration).toContain("/api/offline/bootstrap?tenantId=");
    expect(hydration).toContain("replaceTenantEdgeSnapshot");
    expect(hydration).not.toContain("firebase/firestore");

    expect(bootstrap).toContain("deriveAuthoritativeContext");
    expect(bootstrap).toContain("getAdminFirestore");
    expect(bootstrap).toContain("Cache-Control");
    expect(bootstrap).toContain("no-store");
    expect(bootstrap).toContain("authorizedCollections");

    expect(adapter).toContain("adaptEdgeSnapshot");
    expect(adapter).toContain("encounterEvidence");
    expect(adapter).toContain("billingMismatches");

    expect(hospital).toContain("isDemoRuntime ? initialBeds : []");
    expect(hospital).toContain("loadLocalEdgeSnapshot");
    expect(hospital).toContain("hydrateEdgeSnapshot");
    expect(hospital).toContain("adaptEdgeSnapshot");
    expect(hospital).not.toContain("subscribeToPatients");
  });

  test('P6C offline registration remaps provisional identities before dependent replay',async()=>{
    const client=await source('lib/api/command-client.ts');
    const db=await source('lib/offline/db.ts');
    const engine=await source('lib/offline/sync-engine.ts');
    const reconciliation=await source('lib/backend/services/offline-reconciliation-domain-service.ts');

    expect(client).toContain('local_pat_');
    expect(client).toContain('local_enc_');
    expect(client).toContain('local_opd_');
    expect(client).toContain("RegisterPatientAndEncounterCommand");
    expect(client).toContain('putEntityMapping');
    expect(client).toContain('putEdgeEntity');

    expect(db).toContain('applyCanonicalEntityMappings');
    expect(db).toContain('replaceMappedIds');
    expect(db).toContain("status: 'MAPPED'");
    expect(db).toContain("localDb.mutations.update");

    expect(reconciliation).toContain("mutation.commandType === 'RegisterPatientAndEncounterCommand'");
    expect(reconciliation).toContain('registerPatientAndEncounter');
    expect(reconciliation).toContain('idMappings');
    expect(reconciliation).toContain("requiredRoles: ['RECEPTIONIST', 'REGISTRAR', 'SYSTEM_ADMIN', 'ADMINISTRATOR']");

    expect(engine).toContain("RegisterPatientAndEncounterCommand");
    expect(engine).toContain('applyCanonicalEntityMappings');
    expect(engine).toContain('needsFollowupReplay');
    expect(engine).toContain('queueMicrotask');
  });

  test('P6D offline replay is bound to authoritative versions and vector clocks',async()=>{
    const types=await source('lib/backend/types.ts');
    const client=await source('lib/api/command-client.ts');
    const engine=await source('lib/offline/sync-engine.ts');
    const tx=await source('lib/backend/transactions/transaction-manager.ts');
    const reconciliation=await source('lib/backend/services/offline-reconciliation-domain-service.ts');

    expect(types).toContain('baseEntityVersion?: number');
    expect(types).toContain('vectorClock?: Record<string, number>');
    expect(types).toContain('serverVectorClock?: Record<string, number>');

    expect(client).toContain('edgeRecord?.serverVersion');
    expect(client).toContain('edgeRecord?.data?._vectorClock');
    expect(engine).toContain('baseEntityVersion: mutation.baseEntityVersion');
    expect(engine).toContain('vectorClock: mutation.vectorClock');
    expect(engine).toContain('mergeClocks(params.baseVectorClock, currentClock)');

    expect(reconciliation).toContain('STALE_BASE_VERSION');
    expect(reconciliation).toContain('CAUSAL_CONFLICT');
    expect(reconciliation).toContain('STALE_VECTOR_CLOCK');
    expect(reconciliation).toContain('compareClocks');
    expect(reconciliation).toContain('offlineVectorClock: mutation.vectorClock');
    expect(reconciliation).toContain('serverVectorClock');

    expect(tx).toContain('_serverVersion');
    expect(tx).toContain('_vectorClock');
    expect(tx).toContain('toVersionedDocumentData');
    expect(tx).toContain("incrementClock(");
  });

  test('P6F clinical edge persistence encrypts PHI with non-extractable AES-GCM keys',async()=>{
    const cryptoSource=await source('lib/offline/crypto.ts');
    const db=await source('lib/offline/db.ts');
    const hydration=await source('lib/offline/hydration.ts');

    expect(cryptoSource).toContain("name: 'AES-GCM'");
    expect(cryptoSource).toContain('length: 256');
    expect(cryptoSource).toContain('false,');
    expect(cryptoSource).toContain("['encrypt', 'decrypt']");
    expect(cryptoSource).toContain("ghims_edge_key_vault_db");
    expect(cryptoSource).toContain('additionalData');
    expect(cryptoSource).toContain('EDGE_ENCRYPTION_SCOPE_MISMATCH');

    expect(db).toContain('encryptedPayload');
    expect(db).toContain('encryptedData');
    expect(db).toContain('encryptEdgeJson');
    expect(db).toContain('decryptEdgeJson');
    expect(db).toContain("payload: {}");
    expect(db).toContain("data: {}");
    expect(db).toContain('secureLegacyMutationsForCurrentUser');
    expect(db).toContain("this.version(3)");
    expect(db).toContain("transaction.table('edge_entities').clear()");
    expect(db).toContain("transaction.table('offline_cache').clear()");

    expect(hydration).toContain('secureLegacyMutationsForCurrentUser');
  });

  test('P6G offline durability survives quota pressure multi-tab replay and interrupted sync',async()=>{
    const durability=await source('lib/offline/durability.ts');
    const db=await source('lib/offline/db.ts');
    const engine=await source('lib/offline/sync-engine.ts');
    const types=await source('types/offline.ts');

    expect(durability).toContain('navigator.storage.persist');
    expect(durability).toContain('navigator.storage.estimate');
    expect(durability).toContain('HIGH_WATERMARK');
    expect(durability).toContain('pruneDisposableEdgeReadModels');
    expect(durability).not.toContain('localDb.mutations.bulkDelete');

    expect(types).toContain('nextRetryAt?: number');
    expect(types).toContain('statusUpdatedAt?: number');
    expect(db).toContain('recoverStuckSyncingMutations');
    expect(db).toContain('SYNC_RECOVERY_REQUEUED');
    expect(db).toContain('Math.pow(2');
    expect(db).toContain('nextRetryAt');

    expect(engine).toContain("BroadcastChannel('ghims-clinical-sync')");
    expect(engine).toContain("ghims-sync:");
    expect(engine).toContain('{ ifAvailable: true }');
    expect(engine).toContain('processSyncQueueUnlocked');
    expect(engine).toContain('initializeEdgeDurability');
    expect(engine).toContain('recoverStuckSyncingMutations');
  });

  test('clinical AI requires explicit activation and has no diagnostic fallback synthesis',async()=>{
    const gateway=await source('lib/ai/gateway.ts');
    const soap=await source('lib/ai/flows/soap-drafter.ts');
    const icd=await source('lib/ai/flows/icn10-crosswalk.ts');
    expect(gateway).toContain("getServerIntegrationState('AI')");
    expect(gateway).toContain('GHIMS_AI_PROVIDER');
    expect(gateway).toContain('<UNTRUSTED_SOURCE_DATA>');
    expect(soap).not.toContain('generateFallbackSoapNote');
    expect(icd).not.toContain('generateFallbackIcd10Crosswalk');
    expect(soap).toContain('AIGateway.generateJson');
    expect(icd).toContain('AIGateway.generateJson');
  });

  test('AI provenance is durable and acceptance is bound to signed evidence',async()=>{
    const drafts=await source('server/ai/ai-draft-repository.ts');
    const docs=await source('lib/backend/services/clinical-documentation-domain-service.ts');
    const tx=await source('lib/backend/transactions/transaction-manager.ts');
    expect(drafts).toContain('inputHash');
    expect(drafts).toContain('outputHash');
    expect(drafts).toContain('sourceEvidenceIds');
    expect(drafts).toContain('ACCEPTED_IN_SIGNED_NOTE');
    expect(docs).toContain('AI_DRAFT_PATIENT_MISMATCH');
    expect(docs).toContain('AI_DRAFT_ENCOUNTER_MISMATCH');
    expect(docs).toContain('AIDraftRepository.buildAcceptedState');
    expect(tx).toContain("AI_DRAFT: 'aiDrafts'");
  });

  test('DICOM, FHIR and telemetry never silently pretend external systems are live',async()=>{
    const dicom=await source('lib/interop/dicomweb-client.ts');
    const fhir=await source('lib/interop/fhir-r4-adapter.ts');
    const telemetry=await source('lib/interop/device-telemetry-adapter.ts');
    expect(dicom).not.toContain('getMockStudies');
    expect(dicom).toContain('DICOM_SIMULATION_PROVIDER_REQUIRED');
    expect(fhir).toContain('FHIR_INTEGRATION_NOT_LIVE');
    expect(telemetry).toContain('TELEMETRY_LIVE_VALIDATION_INCOMPLETE');
    expect(telemetry).toContain('SIMULATION_ONLY_NOT_COMMITTED');
    expect(telemetry).not.toContain('TransactionManager');
    expect(telemetry).not.toContain('stElevationDetected');
  });

  test('HL7 and EDI state their actual conformance boundary',async()=>{
    const hl7=await source('app/api/interop/hl7/receive/route.ts');
    const edi=await source('lib/interop/edi-837-generator.ts');
    expect(hl7).toContain("getServerIntegrationState('HL7')");
    expect(hl7).toContain("messageType !== 'ORU^R01'");
    expect(hl7).toContain('rawMessageSha256');
    expect(edi).toContain("level: 'STRUCTURAL_ONLY'");
    expect(edi).toContain('certifiedExternalConformance: false');
    expect(edi).not.toContain('fully compliant');
  });

  test('FHIR R4 adapter exposes standards-native primitives',async()=>{
    const fhir=await source('lib/interop/fhir-r4-adapter.ts');
    expect(fhir).toContain('readResource');
    expect(fhir).toContain('search<');
    expect(fhir).toContain('createResource');
    expect(fhir).toContain('updateResource');
    expect(fhir).toContain('application/fhir+json');
  });
});
