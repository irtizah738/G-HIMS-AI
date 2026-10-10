import { validateDevelopmentSandbox, type SandboxEnvironment } from './safety';

/**
 * Pure boundary adapter for external dependencies unavailable during workflow
 * development. These are status simulations only: no claim of video connection,
 * laboratory result, money movement, HL7 ACK or real clinical completion.
 */
export type SimulatedExternalSystem =
  | 'WEBRTC_MEDIA' | 'TURN_RELAY' | 'HL7_GATEWAY' | 'DICOM_PACS'
  | 'LAB_ANALYSER' | 'EXTERNAL_PAYMENT_GATEWAY';

export function simulateSandboxExternalSystem(
  env: SandboxEnvironment,
  system: SimulatedExternalSystem,
  condition: 'AVAILABLE' | 'TIMEOUT' | 'REJECTED'
) {
  const { tenantId, projectId } = validateDevelopmentSandbox(env);
  const systems: readonly SimulatedExternalSystem[] = [
    'WEBRTC_MEDIA', 'TURN_RELAY', 'HL7_GATEWAY', 'DICOM_PACS',
    'LAB_ANALYSER', 'EXTERNAL_PAYMENT_GATEWAY',
  ];
  if (!systems.includes(system) || !['AVAILABLE', 'TIMEOUT', 'REJECTED'].includes(condition)) {
    throw new Error('DEV_SANDBOX_SIMULATION_CASE_INVALID');
  }
  return {
    simulated: true as const,
    tenantId,
    projectId,
    system,
    condition,
    externalActivityExecuted: false as const,
    clinicalOrFinancialAuthorityChanged: false as const,
    traceLabel: `SYNTHETIC_ONLY:${system}:${condition}`,
  };
}
