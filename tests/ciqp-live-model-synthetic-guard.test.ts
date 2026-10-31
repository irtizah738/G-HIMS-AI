import { describe, expect, test } from 'bun:test';
import {
  assertCiqpLiveModelScope,
  CIQP_LIVE_MODEL_ACK,
} from '@/lib/clinical/intelligence/ciqp-live-model-synthetic-guard';

const SHA = 'a'.repeat(40);
function sandbox() {
  return {
    GHIMS_RUNTIME_MODE: 'TEST',
    NEXT_PUBLIC_GHIMS_RUNTIME_MODE: 'TEST',
    FIREBASE_PROJECT_ID: 'ghims-dev-sandbox-local',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'ghims-dev-sandbox-local',
    GHIMS_FIREBASE_PROJECT_ID_TEST: 'ghims-dev-sandbox-local',
    NEXT_PUBLIC_GHIMS_FIREBASE_PROJECT_ID_TEST: 'ghims-dev-sandbox-local',
    GHIMS_DEV_SANDBOX_TENANT_ID: 'dev-sandbox-hospital',
    GHIMS_DEV_SANDBOX_ACK: 'I_CONFIRM_DISPOSABLE_LOCAL_EMULATORS_ONLY',
    NEXT_PUBLIC_GHIMS_DEV_SANDBOX_EMULATORS: 'true',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FIRESTORE_DATABASE_ID: '(default)',
    NEXT_PUBLIC_FIRESTORE_DATABASE_ID: '(default)',
    CIQP_LIVE_MODEL_ACK,
    GHIMS_INTEGRATION_AI_STATE: 'LIVE',
    GHIMS_AI_PROVIDER: 'google-genai',
    GHIMS_AI_MODEL: 'pinned-model-example',
    GHIMS_AI_APPROVED_MODELS: 'pinned-model-example',
    GEMINI_API_KEY: 'synthetic-test-placeholder-do-not-use',
    CIQP_QUALIFIED_COMMIT_SHA: SHA,
  };
}

describe('CIQP real-model qualification operator scope', () => {
  test('accepts only a pinned, explicitly approved model and exact local emulator scope', () => {
    const result = assertCiqpLiveModelScope(sandbox());
    expect(result.model).toBe('pinned-model-example');
    expect(result.releaseSha).toBe(SHA);
    expect(result.projectId).toBe('ghims-dev-sandbox-local');
  });

  test('rejects hosted, demo, production and cross-tenant configurations', () => {
    const changes = [
      { GHIMS_RUNTIME_MODE: 'PRODUCTION' },
      { NEXT_PUBLIC_GHIMS_RUNTIME_MODE: 'DEMO' },
      { FIREBASE_PROJECT_ID: 'g-hims-ai' },
      { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'studio-1130431360-48a05' },
      { GHIMS_DEV_SANDBOX_TENANT_ID: 'foreign-tenant' },
      { FIRESTORE_EMULATOR_HOST: undefined },
      { FIREBASE_AUTH_EMULATOR_HOST: undefined },
      { FIRESTORE_DATABASE_ID: 'hosted-db' },
      { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/external.json' },
      { FIREBASE_PRIVATE_KEY: 'some-key' },
      { private_key: 'some-key' },
      { client_email: 'service-account@some-project.iam.gserviceaccount.com' },
      { FIREBASE_CLIENT_EMAIL: 'service-account@some-project.iam.gserviceaccount.com' },
      { GHIMS_DEMO_USE_VM_IDENTITY: 'true' },
      { VERCEL: '1' },
      { GHIMS_INTEGRATION_AI_STATE: 'DISABLED' },
      { CIQP_LIVE_MODEL_ACK: undefined },
      { GEMINI_API_KEY: undefined },
    ];
    for (const changed of changes) {
      expect(() => assertCiqpLiveModelScope({ ...sandbox(), ...changed }))
        .toThrow('CIQP_LIVE_MODEL_ENVIRONMENT_NOT_ISOLATED');
    }
  });

  test('rejects absent model freeze, model drift and inconsistent SHA', () => {
    for (const changed of [
      { GHIMS_AI_MODEL: undefined },
      { GHIMS_AI_MODEL: 'other-model' },
      { GHIMS_AI_APPROVED_MODELS: '' },
    ]) {
      expect(() => assertCiqpLiveModelScope({ ...sandbox(), ...changed }))
        .toThrow('CIQP_LIVE_MODEL_NOT_EXPLICITLY_APPROVED');
    }
    expect(() => assertCiqpLiveModelScope({
      ...sandbox(), CIQP_QUALIFIED_COMMIT_SHA: 'main',
    })).toThrow('CIQP_LIVE_MODEL_SHA_REQUIRED');
  });
});
