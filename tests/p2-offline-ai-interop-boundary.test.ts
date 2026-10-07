import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const source = (file: string) => readFile(path.join(process.cwd(), file), 'utf8');

describe('G-HIMS P2 offline / AI / interoperability safety boundaries', () => {
  test('legacy offline worker cannot write Firestore or perform client LWW merges', async () => {
    const worker = await source('lib/offline/sync-worker.ts');
    expect(worker).not.toContain('firebase/firestore');
    expect(worker).not.toContain('runTransaction');
    expect(worker).not.toContain('resolveVectorConflict');
    expect(worker).toContain('LEGACY_RAW_MUTATION_REJECTED');
    expect(worker).toContain('syncEngine.queueMutation');
  });

  test('offline state is based on application reachability, not navigator.onLine alone', async () => {
    const connectivity = await source('lib/offline/connectivity.ts');
    const engine = await source('lib/offline/sync-engine.ts');
    const hook = await source('hooks/useOfflineStatus.ts');

    expect(connectivity).toContain('/api/health?connectivityProbe=');
    expect(connectivity).toContain("cache: 'no-store'");
    expect(connectivity).toContain('AbortController');

    expect(engine).toContain('probeApplicationConnectivity');
    expect(engine).not.toContain('navigator.onLine');
    expect(hook).toContain('refreshConnectivity');
    expect(hook).not.toContain('navigator.onLine');
  });

  test('sync status indicator is driven by real edge and replica telemetry', async () => {
    const indicator = await source('components/navigation/sync-status-indicator.tsx');
    const hook = await source('hooks/useOfflineStatus.ts');
    const engine = await source('lib/offline/sync-engine.ts');
    const db = await source('lib/offline/db.ts');
    const statusRoute = await source('app/api/sync/status/route.ts');

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
    expect(hook).toContain("getSecurePendingVectorClock");
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

  test('governed clinical commands use the real IndexedDB outbox on transport failure', async () => {
    const client = await source('lib/api/command-client.ts');
    const engine = await source('lib/offline/sync-engine.ts');
    const hospital = await source('lib/context/hospital-context.tsx');
    const types = await source('lib/backend/types.ts');

    expect(client).toContain('queueGovernedOfflineCommand');
    expect(client).toContain('syncEngine.queueMutation');
    expect(client).toContain('offlineSimulationActive');
    expect(client).toContain('isTransientServerStatus');
    expect(client).toContain('status === 502 || status === 503 || status === 504');
    expect(client).toContain('mutationId: commandId');
    expect(client).not.toContain("response.status === 401");
    expect(client).not.toContain("response.status === 403");

    expect(engine).toContain('getSecurePendingVectorClock');
    expect(engine).toContain('incrementClock');
    expect(engine).toContain('clockNodeId = deviceId || actorId');
    expect(engine).toContain('getCachedOfflineCapabilityLease');
    expect(engine).toContain('id: params.mutationId');

    expect(types).toContain('queuedOffline?: boolean');

    expect(hospital).toContain("collection: 'clinical_notes'");
    expect(hospital).toContain("collection: 'clinical_orders'");
    expect(hospital).toContain("collection: 'vitals'");
    expect(hospital).toContain("collection: 'opd_queue'");
    expect(hospital).toContain("collection: 'beds'");
    expect(hospital).toContain('result.queuedOffline');
  });

  test('sync telemetry cannot extend session activity or strand in-flight mutations', async () => {
    const statusRoute = await source('app/api/sync/status/route.ts');
    const sessionService = await source('server/auth/session-service.ts');
    const authoritative = await source('lib/backend/security/authoritative-context.ts');
    const engine = await source('lib/offline/sync-engine.ts');

    expect(statusRoute).toContain('touchSessionActivity: false');
    expect(authoritative).toContain('touchSessionActivity?: boolean');
    expect(authoritative).toContain('touchActivity: options.touchSessionActivity !== false');
    expect(sessionService).toContain('touchActivity?: boolean');

    const validateSessionSection = sessionService.slice(
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

  test('clinical sync conflicts are review-only in the browser', async () => {
    const db = await source('lib/offline/db.ts');
    const banner = await source('components/offline/SyncStatusBanner.tsx');

    expect(db).toContain('SERVER_RECONCILIATION_REQUIRED');
    expect(db).not.toContain("await localDb.offline_cache.delete(key)");
    expect(banner).toContain('Server Review Required');
    expect(banner).toContain('server-authoritative reconciliation workflow');
    expect(banner).not.toContain('Accept Server (LWW)');
    expect(banner).not.toContain('Apply Client Overwrite');
  });

  test('P6A hospital read models are local-first and server-hydrated outside DEMO', async () => {
    const db = await source('lib/offline/db.ts');
    const hydration = await source('lib/offline/hydration.ts');
    const adapter = await source('lib/offline/read-model-adapter.ts');
    const bootstrap = await source('app/api/offline/bootstrap/route.ts');
    const hospital = await source('lib/context/hospital-context.tsx');

    expect(db).toContain("edge_entities");
    expect(db).toContain("entity_map");
    expect(db).toContain("sync_metadata");
    expect(db).toContain("edge_entities");
    expect(db).toContain("entity_map");

    expect(hydration).toContain("loadLocalEdgeSnapshot");
    expect(hydration).toContain("hydrateEdgeSnapshot");
    expect(hydration).toContain("/api/offline/bootstrap?tenantId=");
    expect(hydration).toContain("replaceSecureTenantEdgeSnapshot");
    expect(hydration).toContain("listSecureEdgeEntities");
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

  test('clinical AI requires explicit activation and has no diagnostic fallback synthesis', async () => {
    const gateway = await source('lib/ai/gateway.ts');
    const soap = await source('lib/ai/flows/soap-drafter.ts');
    const icd = await source('lib/ai/flows/icn10-crosswalk.ts');
    expect(gateway).toContain("getServerIntegrationState('AI')");
    expect(gateway).toContain('GHIMS_AI_PROVIDER');
    expect(gateway).toContain('<UNTRUSTED_SOURCE_DATA>');
    expect(soap).not.toContain('generateFallbackSoapNote');
    expect(icd).not.toContain('generateFallbackIcd10Crosswalk');
    expect(soap).toContain('AIGateway.generateJson');
    expect(icd).toContain('AIGateway.generateJson');
  });

  test('AI provenance is durable and governed clinical acceptance is bound to reviewed signed evidence', async () => {
    const drafts = await source('server/ai/ai-draft-repository.ts');
    const docs = await source('lib/backend/services/clinical-documentation-domain-service.ts');
    const governed = await source('lib/backend/services/clinical-draft-domain-service.ts');
    const tx = await source('lib/backend/transactions/transaction-manager.ts');
    expect(drafts).toContain('inputHash');
    expect(drafts).toContain('outputHash');
    expect(drafts).toContain('sourceEvidenceIds');
    expect(docs).toContain('CI10F_LEGACY_AI_DRAFT_SIGNING_DISABLED');
    expect(docs).not.toContain('AIDraftRepository.buildAcceptedState');
    expect(governed).toContain('CI10F_DRAFT_INTEGRITY_FAILURE');
    expect(governed).toContain('approvedContentHash');
    expect(governed).toContain('evidenceSnapshotHash');
    expect(governed).toContain('CLINICAL_DRAFT_REVISION');
    expect(governed).toContain('CLINICAL_DOCUMENT');
    expect(governed).toContain('ENCOUNTER_EVIDENCE');
    expect(tx).toContain("AI_DRAFT: 'aiDrafts'");
    expect(tx).toContain("CLINICAL_DRAFT: 'clinicalDrafts'");
    expect(tx).toContain("CLINICAL_DRAFT_REVISION: 'clinicalDraftRevisions'");
  });

  test('DICOM, FHIR and telemetry never silently pretend external systems are live', async () => {
    const dicom = await source('lib/interop/dicomweb-client.ts');
    const fhir = await source('lib/interop/fhir-r4-adapter.ts');
    const telemetry = await source('lib/interop/device-telemetry-adapter.ts');
    expect(dicom).not.toContain('getMockStudies');
    expect(dicom).toContain('DICOM_SIMULATION_PROVIDER_REQUIRED');
    expect(fhir).toContain('FHIR_INTEGRATION_NOT_LIVE');
    expect(telemetry).toContain('TELEMETRY_INTEGRATION_NOT_LIVE');
    expect(telemetry).toContain('SIMULATION_ONLY_NOT_COMMITTED');
    expect(telemetry).toContain('ELIGIBLE_FOR_AUTHORITATIVE_COMMIT');
    expect(telemetry).not.toContain('TransactionManager');
    expect(telemetry).not.toContain('stElevationDetected');
  });

  test('HL7 and EDI state their actual conformance boundary', async () => {
    const hl7 = await source('app/api/interop/hl7/receive/route.ts');
    const edi = await source('lib/interop/edi-837-generator.ts');
    expect(hl7).toContain("getServerIntegrationState('HL7')");
    expect(hl7).toContain("messageType !== 'ORU^R01'");
    expect(hl7).toContain('rawMessageSha256');
    expect(edi).toContain("level: 'STRUCTURAL_ONLY'");
    expect(edi).toContain('certifiedExternalConformance: false');
    expect(edi).not.toContain('fully compliant');
  });

  test('FHIR R4 adapter exposes standards-native primitives', async () => {
    const fhir = await source('lib/interop/fhir-r4-adapter.ts');
    expect(fhir).toContain('readResource');
    expect(fhir).toContain('search<');
    expect(fhir).toContain('createResource');
    expect(fhir).toContain('updateResource');
    expect(fhir).toContain('application/fhir+json');
  });
});
