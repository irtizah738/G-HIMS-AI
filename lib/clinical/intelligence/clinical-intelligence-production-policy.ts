import { getRuntimeMode, type GhimsRuntimeMode } from '@/lib/runtime/runtime-mode';
import { parseIntegrationState } from '@/lib/interop/integration-state';
import {
  CI10I_PRODUCTION_POLICY_VERSION,
  type ClinicalIntelligenceProductionStatus,
} from '@/types/clinical-intelligence-production';

const DEFAULT_NON_PRODUCTION_TIMEOUT_MS = 45_000;
const MIN_AI_TIMEOUT_MS = 5_000;
const MAX_AI_TIMEOUT_MS = 90_000;

type EnvLike = Record<string, string | undefined>;

function normalize(value: unknown): string {
  return String(value || '').trim();
}

function approvedModels(env: EnvLike): Set<string> {
  return new Set(
    normalize(env.GHIMS_AI_APPROVED_MODELS)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

export function resolveClinicalAITimeoutMs(
  env: EnvLike = process.env,
  runtime: GhimsRuntimeMode = getRuntimeMode()
): number {
  const raw = normalize(env.GHIMS_AI_TIMEOUT_MS);
  if (!raw) {
    if (runtime === 'PRODUCTION') {
      throw new Error('CI10I_AI_TIMEOUT_REQUIRED_IN_PRODUCTION');
    }
    return DEFAULT_NON_PRODUCTION_TIMEOUT_MS;
  }

  const parsed = Number(raw);
  if (
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < MIN_AI_TIMEOUT_MS ||
    parsed > MAX_AI_TIMEOUT_MS
  ) {
    throw new Error(
      `CI10I_AI_TIMEOUT_INVALID:${raw}:expected_${MIN_AI_TIMEOUT_MS}_to_${MAX_AI_TIMEOUT_MS}`
    );
  }
  return parsed;
}

export function evaluateClinicalIntelligenceProductionConfig(
  env: EnvLike = process.env,
  runtime: GhimsRuntimeMode = getRuntimeMode()
): ClinicalIntelligenceProductionStatus {
  const blockers: string[] = [];
  const state = parseIntegrationState(env.GHIMS_INTEGRATION_AI_STATE, 'DISABLED');
  const provider = normalize(env.GHIMS_AI_PROVIDER).toLowerCase();
  const model = normalize(env.GHIMS_AI_MODEL);
  const apiKey = normalize(env.GEMINI_API_KEY);
  const approved = approvedModels(env);

  let timeoutMs: number | undefined;
  try {
    timeoutMs = resolveClinicalAITimeoutMs(env, runtime);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : 'CI10I_AI_TIMEOUT_INVALID');
  }

  const providerApproved = provider === 'google' || provider === 'google-genai';
  const modelApproved =
    runtime !== 'PRODUCTION'
      ? Boolean(model || 'gemini-3.6-flash')
      : Boolean(model) && approved.has(model);
  const credentialsConfigured = Boolean(apiKey);

  if (runtime === 'PRODUCTION') {
    if (state !== 'LIVE') blockers.push('CI10I_AI_INTEGRATION_MUST_BE_LIVE');
    if (!provider) blockers.push('CI10I_AI_PROVIDER_REQUIRED');
    else if (!providerApproved) blockers.push('CI10I_AI_PROVIDER_NOT_APPROVED');
    if (!model) blockers.push('CI10I_AI_MODEL_REQUIRED');
    if (approved.size === 0) blockers.push('CI10I_AI_APPROVED_MODELS_REQUIRED');
    else if (model && !approved.has(model)) blockers.push('CI10I_AI_MODEL_NOT_APPROVED');
    if (!credentialsConfigured) blockers.push('CI10I_AI_CREDENTIALS_REQUIRED');
  } else if (state === 'LIVE') {
    if (!providerApproved) blockers.push('CI10I_AI_PROVIDER_NOT_APPROVED');
    if (!credentialsConfigured) blockers.push('CI10I_AI_CREDENTIALS_REQUIRED');
  }

  return {
    policyVersion: CI10I_PRODUCTION_POLICY_VERSION,
    runtime,
    ready: blockers.length === 0,
    blockers,
    ai: {
      state,
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      providerApproved,
      modelApproved,
      credentialsConfigured,
    },
  };
}

export function assertClinicalIntelligenceProductionReady(
  env: EnvLike = process.env,
  runtime: GhimsRuntimeMode = getRuntimeMode()
): ClinicalIntelligenceProductionStatus {
  const status = evaluateClinicalIntelligenceProductionConfig(env, runtime);
  if (!status.ready) {
    throw new Error(
      `CI10I_PRODUCTION_NOT_READY:${status.blockers.join(',')}`
    );
  }
  return status;
}
