import { ProjectionRecoveryService } from '@/lib/backend/recovery/projection-recovery-service';
import { getRuntimeMode } from '@/lib/runtime/runtime-mode';

const mode = getRuntimeMode();
if (mode === 'PRODUCTION') {
  throw new Error('WAVE5_FAILURE_INJECTION_FORBIDDEN_IN_PRODUCTION');
}
if (!['TEST', 'STAGING'].includes(mode)) {
  throw new Error('WAVE5_FAILURE_INJECTION_ISOLATED_RUNTIME_REQUIRED');
}

const tenantId = String(process.env.GHIMS_PROJECTION_REBUILD_TENANT || '').trim();
const confirmed = String(
  process.env.GHIMS_PROJECTION_REBUILD_CONFIRM_TENANT || ''
).trim();

if (!tenantId || tenantId !== confirmed) {
  throw new Error('WAVE5_FAILURE_INJECTION_TENANT_CONFIRMATION_REQUIRED');
}
if (process.env.GHIMS_ALLOW_DESTRUCTIVE_PROJECTION_REBUILD !== 'true') {
  throw new Error('WAVE5_FAILURE_INJECTION_DESTRUCTIVE_CONFIRMATION_REQUIRED');
}

process.env.GHIMS_PROJECTION_REBUILD_INJECT_FAILURE = 'AFTER_PROJECTION_WORKER';

let observedFailure = '';
try {
  await ProjectionRecoveryService.rebuildTenantInIsolatedEnvironment(tenantId);
  throw new Error('WAVE5_FAILURE_INJECTION_DID_NOT_FAIL');
} catch (error) {
  observedFailure = error instanceof Error ? error.message : String(error);
  if (!observedFailure.includes('PROJECTION_REBUILD_INJECTED_FAILURE')) {
    throw error;
  }
} finally {
  delete process.env.GHIMS_PROJECTION_REBUILD_INJECT_FAILURE;
}

process.stdout.write(
  JSON.stringify(
    {
      success: true,
      runtime: mode,
      tenantId,
      injectedAt: 'AFTER_PROJECTION_WORKER',
      observedFailureCode: 'PROJECTION_REBUILD_INJECTED_FAILURE',
      nextAction:
        'Run a clean projection rebuild against the same isolated restored event stream and verify deterministic fingerprints.',
      checkedAt: new Date().toISOString(),
    },
    null,
    2
  ) + '\n'
);
