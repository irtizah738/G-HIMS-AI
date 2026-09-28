export type GhimsRuntimeMode = 'DEMO' | 'TEST' | 'STAGING' | 'PRODUCTION';

const VALID_MODES = new Set<GhimsRuntimeMode>(['DEMO', 'TEST', 'STAGING', 'PRODUCTION']);

/**
 * Infer the safest implicit runtime from Node's execution mode.
 *
 * Development/test workspaces are non-production sandboxes and default to TEST
 * so a fresh clone can boot without being misclassified as PRODUCTION.
 * Any non-development deployment remains fail-closed as PRODUCTION unless
 * GHIMS_RUNTIME_MODE is set explicitly.
 */
export function inferRuntimeModeFromNodeEnv(
  nodeEnv: string | undefined
): GhimsRuntimeMode {
  const normalized = String(nodeEnv || '').trim().toLowerCase();
  if (normalized === 'development' || normalized === 'test') {
    return 'TEST';
  }
  return 'PRODUCTION';
}

export function getRuntimeMode(): GhimsRuntimeMode {
  const raw = (process.env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();

  if (VALID_MODES.has(raw as GhimsRuntimeMode)) {
    return raw as GhimsRuntimeMode;
  }

  return inferRuntimeModeFromNodeEnv(process.env.NODE_ENV);
}

export function isDemoRuntime(): boolean {
  return getRuntimeMode() === 'DEMO';
}

export function isProductionLikeRuntime(): boolean {
  const mode = getRuntimeMode();
  return mode === 'STAGING' || mode === 'PRODUCTION';
}

export function assertDemoRuntime(feature: string): void {
  if (!isDemoRuntime()) {
    throw new Error(`${feature} is available only when GHIMS_RUNTIME_MODE=DEMO`);
  }
}
