/**
 * Operator-only contract for real-provider synthetic Clinical Intelligence
 * qualification. Never enables production traffic or a substitute provider.
 */
export const CIQP_LIVE_MODEL_ACK = 'I_CONFIRM_REAL_MODEL_SYNTHETIC_EMULATOR_ONLY' as const;
export const CIQP_LIVE_MODEL_PROJECT = 'ghims-dev-sandbox-local' as const;
export const CIQP_LIVE_MODEL_TENANT = 'dev-sandbox-hospital' as const;

type Env = Record<string, string | undefined>;

export interface CiqpLiveModelScope {
  projectId: typeof CIQP_LIVE_MODEL_PROJECT;
  tenantId: typeof CIQP_LIVE_MODEL_TENANT;
  provider: 'google-genai';
  model: string;
  releaseSha: string;
}

function required(value: string | undefined): string {
  return String(value || '').trim();
}

export function assertCiqpLiveModelScope(env: Env): CiqpLiveModelScope {
  const scope = [
    env.GHIMS_RUNTIME_MODE === 'TEST',
    env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'TEST',
    env.FIREBASE_PROJECT_ID === CIQP_LIVE_MODEL_PROJECT,
    env.NEXT_PUBLIC_FIREBASE_PROJECT_ID === CIQP_LIVE_MODEL_PROJECT,
    env.GHIMS_FIREBASE_PROJECT_ID_TEST === CIQP_LIVE_MODEL_PROJECT,
    env.NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST === CIQP_LIVE_MODEL_PROJECT,
    env.GHIMS_DEV_SANDBOX_TENANT_ID === CIQP_LIVE_MODEL_TENANT,
    env.GHIMS_DEV_SANDBOX_ACK === 'I_CONFIRM_DISPOSABLE_LOCAL_EMULATORS_ONLY',
    env.NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS === 'true',
    env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080',
    env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099',
    env.FIRESTORE_DATABASE_ID === '(default)',
    env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID === '(default)',
    !env.GOOGLE_APPLICATION_CREDENTIALS,
    !env.FIREBASE_PRIVATE_KEY,
    !env.FIREBASE_SERVICE_ACCOUNT_KEY,
    !env.GHIMS_DEMO_USE_CLOUD_SHELL_CLI,
    !env.VERCEL,
    env.CIQP_LIVE_MODEL_ACK === CIQP_LIVE_MODEL_ACK,
    env.GHIMS_INTEGRATION_AI_STATE === 'LIVE',
    ['google', 'google-genai'].includes(required(env.GHIMS_AI_PROVIDER).toLowerCase()),
    required(env.GEMINI_API_KEY).length > 0,
  ];
  if (scope.some((ok) => !ok)) {
    throw new Error('CIQP_LIVE_MODEL_ENVIRONMENT_NOT_ISOLATED');
  }
  const model = required(env.GHIMS_AI_MODEL);
  const approvedModels = required(env.GHIMS_AI_APPROVED_MODELS)
    .split(',').map((item) => item.trim()).filter(Boolean);
  if (!model || !approvedModels.includes(model)) {
    throw new Error('CIQP_LIVE_MODEL_NOT_EXPLICITLY_APPROVED');
  }
  const releaseSha = required(env.CIQP_QUALIFIED_COMMIT_SHA);
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    throw new Error('CIQP_LIVE_MODEL_SHA_REQUIRED');
  }
  return {
    projectId: CIQP_LIVE_MODEL_PROJECT,
    tenantId: CIQP_LIVE_MODEL_TENANT,
    provider: 'google-genai',
    model,
    releaseSha,
  };
}
