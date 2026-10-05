import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  evaluateClinicalIntelligenceProductionConfig,
  resolveClinicalAITimeoutMs,
} from '@/lib/clinical/intelligence/clinical-intelligence-production-policy';
import { CI10I_PRODUCTION_POLICY_VERSION } from '@/types/clinical-intelligence-production';
import { CLINICAL_SAFETY_POLICY_VERSION } from '@/types/clinical-intelligence-safety';

const source = (path: string) => readFile(join(process.cwd(), path), 'utf8');

describe('CI-10I offline and production qualification', () => {
  test('production Clinical Intelligence requires explicit live, approved and bounded AI configuration', () => {
    const env = {
      GHIMS_INTEGRATION_AI_STATE: 'LIVE',
      GHIMS_AI_PROVIDER: 'google-genai',
      GHIMS_AI_MODEL: 'gemini-3.6-flash',
      GHIMS_AI_APPROVED_MODELS: 'gemini-3.6-flash,gemini-3.6-pro',
      GEMINI_API_KEY: 'synthetic-ci10i-key',
      GHIMS_AI_TIMEOUT_MS: '45000',
    };

    const status = evaluateClinicalIntelligenceProductionConfig(
      env,
      'PRODUCTION'
    );

    expect(status.policyVersion).toBe(CI10I_PRODUCTION_POLICY_VERSION);
    expect(status.ready).toBe(true);
    expect(status.blockers).toEqual([]);
    expect(status.ai.state).toBe('LIVE');
    expect(status.ai.providerApproved).toBe(true);
    expect(status.ai.modelApproved).toBe(true);
    expect(status.ai.credentialsConfigured).toBe(true);
    expect(status.ai.timeoutMs).toBe(45000);
  });

  test('production policy fails closed for disabled AI, missing pinning, credentials or timeout', () => {
    const status = evaluateClinicalIntelligenceProductionConfig(
      {
        GHIMS_INTEGRATION_AI_STATE: 'DISABLED',
        GHIMS_AI_PROVIDER: '',
        GHIMS_AI_MODEL: '',
        GHIMS_AI_APPROVED_MODELS: '',
        GEMINI_API_KEY: '',
        GHIMS_AI_TIMEOUT_MS: '',
      },
      'PRODUCTION'
    );

    expect(status.ready).toBe(false);
    expect(status.blockers).toContain('CI10I_AI_INTEGRATION_MUST_BE_LIVE');
    expect(status.blockers).toContain('CI10I_AI_PROVIDER_REQUIRED');
    expect(status.blockers).toContain('CI10I_AI_MODEL_REQUIRED');
    expect(status.blockers).toContain('CI10I_AI_APPROVED_MODELS_REQUIRED');
    expect(status.blockers).toContain('CI10I_AI_CREDENTIALS_REQUIRED');
    expect(status.blockers).toContain(
      'CI10I_AI_TIMEOUT_REQUIRED_IN_PRODUCTION'
    );
  });

  test('production model must be explicitly allow-listed', () => {
    const status = evaluateClinicalIntelligenceProductionConfig(
      {
        GHIMS_INTEGRATION_AI_STATE: 'LIVE',
        GHIMS_AI_PROVIDER: 'google-genai',
        GHIMS_AI_MODEL: 'unreviewed-model',
        GHIMS_AI_APPROVED_MODELS: 'approved-model',
        GEMINI_API_KEY: 'synthetic-ci10i-key',
        GHIMS_AI_TIMEOUT_MS: '30000',
      },
      'PRODUCTION'
    );

    expect(status.ready).toBe(false);
    expect(status.blockers).toContain('CI10I_AI_MODEL_NOT_APPROVED');
    expect(status.ai.modelApproved).toBe(false);
  });

  test('provider timeout is bounded and production has no implicit timeout', () => {
    expect(resolveClinicalAITimeoutMs({}, 'TEST')).toBe(45000);
    expect(() => resolveClinicalAITimeoutMs({}, 'PRODUCTION')).toThrow(
      'CI10I_AI_TIMEOUT_REQUIRED_IN_PRODUCTION'
    );
    expect(() =>
      resolveClinicalAITimeoutMs(
        { GHIMS_AI_TIMEOUT_MS: '4999' },
        'PRODUCTION'
      )
    ).toThrow('CI10I_AI_TIMEOUT_INVALID');
    expect(() =>
      resolveClinicalAITimeoutMs(
        { GHIMS_AI_TIMEOUT_MS: '90001' },
        'PRODUCTION'
      )
    ).toThrow('CI10I_AI_TIMEOUT_INVALID');
    expect(() =>
      resolveClinicalAITimeoutMs(
        { GHIMS_AI_TIMEOUT_MS: 'not-a-number' },
        'PRODUCTION'
      )
    ).toThrow('CI10I_AI_TIMEOUT_INVALID');
  });

  test('AI gateway has bounded fail-closed provider execution and PHI-safe telemetry', async () => {
    const gateway = await source('lib/ai/gateway.ts');

    expect(gateway).toContain('withProviderTimeout');
    expect(gateway).toContain('AI_PROVIDER_TIMEOUT');
    expect(gateway).toContain('assertClinicalIntelligenceProductionReady');
    expect(gateway).toContain("event: 'clinical_ai_generation'");
    expect(gateway).toContain('operationalTimer');
    expect(gateway).toContain('AI_PROVIDER_FAILURE_NO_SAFE_FALLBACK');
    expect(gateway).toContain('correlationId: request.correlationId');
    expect(gateway).toContain('tenantId: request.tenantId');

    const telemetryBlock = gateway.slice(
      gateway.indexOf("event: 'clinical_ai_generation'"),
      gateway.lastIndexOf('throw error;') + 'throw error;'.length
    );
    expect(telemetryBlock).not.toContain('sourceData:');
    expect(telemetryBlock).not.toContain('systemInstruction:');
    expect(telemetryBlock).not.toContain('response.text');
  });

  test('all Clinical Intelligence generation routes emit bounded PHI-safe operational telemetry', async () => {
    const routes = [
      'app/api/clinical/intelligence/longitudinal-summary/route.ts',
      'app/api/clinical/intelligence/encounter-preparation/route.ts',
      'app/api/clinical/intelligence/trends/route.ts',
      'app/api/clinical/intelligence/medication-reconciliation/route.ts',
      'app/api/clinical/intelligence/drafts/route.ts',
    ];

    for (const path of routes) {
      const route = await source(path);
      expect(route).toContain('observeClinicalIntelligenceOperation');
      expect(route).toContain('correlationId: context.correlationId');
      expect(route).toContain('tenantId: context.tenantId');
      expect(route).toMatch(/['"]Cache-Control['"]\s*:\s*['"]no-store['"]/);
    }

    const observability = await source(
      'lib/clinical/intelligence/clinical-intelligence-observability.ts'
    );
    expect(observability).toContain(
      "event: 'clinical_intelligence_operation'"
    );
    expect(observability).not.toContain('patientId');
    expect(observability).not.toContain('payload');
    expect(observability).not.toContain('content');
  });

  test('Clinical Intelligence generation and draft authority require verified application connectivity', async () => {
    const client = await source(
      'lib/clinical/patient360/patient360-client.ts'
    );

    expect(client).toContain('probeApplicationConnectivity(4_000)');
    expect(client).toContain('CI10I_ONLINE_AUTHORITY_REQUIRED');
    expect(client).toContain('AbortController');
    expect(client).toContain('CI10I_CLIENT_REQUEST_TIMEOUT');
    expect(client).toContain('CI10I_CLIENT_REQUEST_TIMEOUT_MS = 95_000');

    for (const operation of [
      'generateLongitudinalClinicalSummary',
      'generateEncounterPreparationBrief',
      'generateClinicalTrendIntelligence',
      'generateMedicationReconciliationCopilot',
      'generateGovernedClinicalDraft',
      'reviewGovernedClinicalDraft',
      'approveGovernedClinicalDraft',
      'signGovernedClinicalDraft',
      'rejectGovernedClinicalDraft',
    ]) {
      expect(client).toContain(operation);
    }

    const lifecycle = client.slice(
      client.indexOf('export async function reviewGovernedClinicalDraft')
    );
    expect(lifecycle).toContain(
      'await assertClinicalIntelligenceOnlineAuthority()'
    );
    expect(lifecycle).not.toContain('offlineQueue');
  });

  test('interrupted governed draft generation reuses its idempotency key until success', async () => {
    const panel = await source(
      'components/patient360/GovernedClinicalDraftPanel.tsx'
    );
    const service = await source(
      'lib/clinical/intelligence/clinical-draft-service.ts'
    );

    const generateStart = panel.indexOf('const generate = async () =>');
    const reviewStart = panel.indexOf('const saveReview = async () =>');
    const generateBlock = panel.slice(generateStart, reviewStart);

    expect(generateBlock).toContain(
      'generationKey.current =\n        generationKey.current ||'
    );
    expect(generateBlock).toContain('await generateGovernedClinicalDraft');
    expect(generateBlock).toContain('generationKey.current = null');

    expect(
      generateBlock.indexOf('generationKey.current = null')
    ).toBeGreaterThan(
      generateBlock.indexOf('await generateGovernedClinicalDraft')
    );
    expect(
      generateBlock.slice(generateBlock.indexOf('catch (caught)'))
    ).not.toContain('generationKey.current = null');

    expect(service).toContain('CI10F_IDEMPOTENCY_SCOPE_CONFLICT');
    expect(service).toContain('CI10F_IDEMPOTENT_REPLAY_INTEGRITY_FAILURE');
    expect(service).toContain(
      "ClinicalEvidenceService.getSnapshot(context.tenantId, existing.evidenceSnapshotId)"
    );
  });

  test('authoritative B-E intelligence is encrypted actor-scoped read-only edge continuity', async () => {
    const cache = await source(
      'lib/clinical/intelligence/clinical-intelligence-edge-cache.ts'
    );
    const secure = await source('lib/offline/secure-store.ts');
    const authStorage = await source('lib/offline/auth-storage.ts');
    const storage = await source('lib/offline/storage-manager.ts');

    expect(cache).toContain("CLINICAL_INTELLIGENCE_EDGE_COLLECTION =");
    expect(cache).toContain("'clinicalIntelligenceArtifacts'");
    expect(cache).toContain('putSecureEdgeEntities');
    expect(cache).toContain('listSecureEdgeEntities');
    expect(cache).toContain('cached.user.uid');
    expect(cache).toContain("source: 'AUTHORITATIVE_SERVER'");
    expect(cache).toContain('draft: null');

    expect(secure).toContain('row.actorId && row.actorId !== actorId');
    expect(secure).toContain('EDGE_CACHE_ACTOR_MISMATCH');
    expect(authStorage).toContain('clearOfflineReadModelsForTenant(tenantId)');
    expect(storage).toContain("'clinicalIntelligenceArtifacts'");
  });

  test('workspace never labels offline cache as current server authority', async () => {
    const workspace = await source(
      'components/patient360/ClinicalCopilotWorkspace.tsx'
    );
    const types = await source('types/clinical-copilot-workspace.ts');

    expect(types).toContain("'OFFLINE_CACHED'");
    expect(workspace).toContain('loadCachedClinicalIntelligence');
    expect(workspace).toContain(
      "return offline ? 'OFFLINE_CACHED' : 'CURRENT'"
    );
    expect(workspace).toContain(
      'Cached intelligence is read-only and is never treated as'
    );
    expect(workspace).toContain(
      'New intelligence, governed'
    );
    expect(workspace).toContain('disabled={offline || refreshingAll}');
  });

  test('governed drafts are never stored in the offline intelligence cache', async () => {
    const cache = await source(
      'lib/clinical/intelligence/clinical-intelligence-edge-cache.ts'
    );

    const mapStart = cache.indexOf('type CacheableArtifactMap');
    const cacheFunction = cache.indexOf(
      'export async function cacheAuthoritativeClinicalIntelligence'
    );
    const cacheableContract = cache.slice(mapStart, cacheFunction);

    expect(cacheableContract).toContain('LONGITUDINAL');
    expect(cacheableContract).toContain('ENCOUNTER_PREP');
    expect(cacheableContract).toContain('TRENDS');
    expect(cacheableContract).toContain('MEDICATIONS');
    expect(cacheableContract).not.toContain('DRAFT:');
    expect(cache).toContain(
      'Governed drafts deliberately remain online-only'
    );
  });

  test('CI-10H safety and current-chart signature checks remain mandatory', async () => {
    const domain = await source(
      'lib/backend/services/clinical-draft-domain-service.ts'
    );
    const safety = await source(
      'lib/clinical/intelligence/clinical-intelligence-safety-evaluator.ts'
    );

    expect(domain).toContain('CI10H_SAFETY_EVALUATION_REQUIRED');
    expect(domain).toContain("draft.safetyGateStatus !== 'PASSED'");
    expect(domain).toContain('CI10H_STALE_DRAFT_EVIDENCE');
    expect(domain).toContain("entityType: 'PATIENT360_PROJECTION'");
    expect(safety).toContain('PROMPT_INJECTION_LEAKAGE');
    expect(safety).toContain('CRITICAL_EVIDENCE_OMITTED');
    expect(safety).toContain('AI_PROVENANCE_UNAPPROVED');
  });

  test('CI-10I readiness, production preflight and live provider smoke are explicit', async () => {
    const readiness = await source(
      'app/api/health/clinical-intelligence/route.ts'
    );
    const preflight = await source(
      'scripts/ops/ci10i-production-preflight.ts'
    );
    const smoke = await source('scripts/ops/ci10i-live-ai-smoke.ts');

    expect(readiness).toContain('g-hims-clinical-intelligence');
    expect(readiness).toContain('CI10I_PRODUCTION_POLICY_VERSION');
    expect(readiness).toContain('CLINICAL_SAFETY_POLICY_VERSION');
    expect(readiness).toContain("'Cache-Control': 'no-store'");
    expect(readiness).not.toContain('GEMINI_API_KEY');

    expect(preflight).toContain('CI10I_PRODUCTION_RUNTIME_REQUIRED');
    expect(preflight).toContain('CI10I_PRODUCTION_PROJECT_MISMATCH');
    expect(preflight).toContain('CI10I_EMULATOR_FORBIDDEN_IN_PRODUCTION');
    expect(preflight).toContain(
      'evaluateClinicalIntelligenceProductionConfig'
    );

    expect(smoke).toContain('CI10I_SYNTHETIC_PROVIDER_SMOKE');
    expect(smoke).toContain('AIGateway.generateJson');
    expect(smoke).toContain('CLINICAL_AI_BOUNDARY_VERSION');
    expect(smoke).not.toContain('patientId');
    expect(smoke).not.toContain('encounterId');
  });

  test('CI-10I does not falsely close broader hospital production blockers', async () => {
    const blockers = await source('G-HIMS_PRODUCTION_BLOCKERS.md');

    expect(blockers).toContain('P3-DR-01');
    expect(blockers).toContain('P3-OBS-01');
    expect(blockers).toContain('EXT-GOV-01');
    expect(blockers).toContain('EXT-SEC-01');
    expect(blockers).toContain('EXT-DICOM-01');
    expect(blockers).toContain('EXT-HL7-01');
  });
});
