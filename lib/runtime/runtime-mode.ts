export type GhimsRuntimeMode = 'DEMO' | 'TEST' | 'STAGING' | 'PRODUCTION';

const VALID_MODES = new Set<GhimsRuntimeMode>(['DEMO', 'TEST', 'STAGING', 'PRODUCTION']);

export function getRuntimeMode(): GhimsRuntimeMode {
  const raw = (process.env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();

  if (VALID_MODES.has(raw as GhimsRuntimeMode)) {
    return raw as GhimsRuntimeMode;
  }

  if (process.env.NODE_ENV === 'test') {
    return 'TEST';
  }

  // Fail closed: an unspecified deployed runtime is treated as production.
  return 'PRODUCTION';
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
