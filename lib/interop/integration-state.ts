/**
 * Canonical integration activation state.
 *
 * LIVE              = real external traffic may be exchanged.
 * INTEGRATION_READY = implementation exists, but real traffic is intentionally blocked.
 * SIMULATION        = synthetic/demo traffic only; never a production fallback.
 * DISABLED          = integration surface unavailable.
 */
export type IntegrationState = 'LIVE' | 'INTEGRATION_READY' | 'SIMULATION' | 'DISABLED';

export type IntegrationName =
  | 'AI'
  | 'HL7'
  | 'FHIR_R4'
  | 'DICOMWEB'
  | 'DEVICE_TELEMETRY'
  | 'EDI_X12';

const VALID_STATES = new Set<IntegrationState>([
  'LIVE',
  'INTEGRATION_READY',
  'SIMULATION',
  'DISABLED',
]);

export function parseIntegrationState(
  value: unknown,
  fallback: IntegrationState = 'DISABLED'
): IntegrationState {
  const normalized = String(value || '').trim().toUpperCase() as IntegrationState;
  return VALID_STATES.has(normalized) ? normalized : fallback;
}

export function getServerIntegrationState(name: IntegrationName): IntegrationState {
  const key = 'GHIMS_INTEGRATION_' + name + '_STATE';
  return parseIntegrationState(process.env[key], 'DISABLED');
}

export function assertIntegrationLive(name: IntegrationName): IntegrationState {
  const state = getServerIntegrationState(name);
  if (state !== 'LIVE') {
    throw new Error(
      'INTEGRATION_NOT_LIVE: ' + name + ' is ' + state + '; real external traffic is blocked.'
    );
  }
  return state;
}

export function assertSimulationAllowed(name: IntegrationName): IntegrationState {
  const state = getServerIntegrationState(name);
  const runtime = String(process.env.GHIMS_RUNTIME_MODE || '').trim().toUpperCase();

  if (state !== 'SIMULATION') {
    throw new Error(
      'INTEGRATION_NOT_SIMULATION: ' + name + ' is ' + state + '; simulation traffic is blocked.'
    );
  }

  if (runtime === 'PRODUCTION') {
    throw new Error(
      'SIMULATION_FORBIDDEN_IN_PRODUCTION: ' + name + ' simulation cannot run in production.'
    );
  }

  return state;
}
