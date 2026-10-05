import {
  emitOperationalEvent,
  operationalTimer,
} from '@/lib/observability/server-telemetry';
import type { ClinicalIntelligencePurpose } from '@/types/clinical-intelligence-evidence';

function errorCode(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : String(error || 'CLINICAL_INTELLIGENCE_FAILURE');
  return (message.split(':')[0] || 'CLINICAL_INTELLIGENCE_FAILURE').slice(
    0,
    96
  );
}

export async function observeClinicalIntelligenceOperation<T>(
  input: {
    operation: string;
    purpose: ClinicalIntelligencePurpose;
    tenantId: string;
    correlationId?: string;
  },
  execute: () => Promise<T>
): Promise<T> {
  const elapsed = operationalTimer();
  try {
    const result = await execute();
    emitOperationalEvent({
      event: 'clinical_intelligence_operation',
      outcome: 'SUCCESS',
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      durationMs: elapsed(),
      attributes: {
        operation: input.operation,
        purpose: input.purpose,
      },
    });
    return result;
  } catch (error) {
    emitOperationalEvent({
      event: 'clinical_intelligence_operation',
      outcome: 'FAILURE',
      tenantId: input.tenantId,
      correlationId: input.correlationId,
      durationMs: elapsed(),
      errorCode: errorCode(error),
      attributes: {
        operation: input.operation,
        purpose: input.purpose,
      },
    });
    throw error;
  }
}
