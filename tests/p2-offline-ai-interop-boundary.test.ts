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
