/**
 * CI read-side contract. Clinical Intelligence consumes a validated canonical
 * clinical context regardless of whether the upstream HIS is Helixis or an
 * explicitly qualified external adapter.
 *
 * This does NOT grant authorization or perform data ingestion: callers must
 * already have a server-authoritative tenant/patient scope. External adapters
 * must preserve event lineage, checkpoint and evidence hashes.
 */
import type { Patient360Projection } from '@/types/patient360-projection';

export type ClinicalContextSource = 'NATIVE' | 'EXTERNAL';

export interface ClinicalContextEvent {
  eventId: string;
  eventType: string;
  aggregateType?: string;
  aggregateId?: string;
  payload: Record<string, unknown>;
  occurredAt?: number;
  recordedAt?: number;
}

export interface ClinicalContextReader {
  readonly source: ClinicalContextSource;
  readClinicalContext(tenantId: string, patientId: string): Promise<{
    projection: Patient360Projection;
  }>;
  loadPatientEvents(tenantId: string, patientId: string): Promise<ClinicalContextEvent[]>;
  getProjection(tenantId: string, patientId: string): Promise<Patient360Projection | null>;
  getOrRebuildProjection(tenantId: string, patientId: string): Promise<Patient360Projection | null>;
}

/**
 * Guard against an adapter returning another tenant's chart, an incomplete
 * projection generation, or a projection with no verifiable source revision.
 * No fallback to an unscoped/default patient is permitted.
 */
export function assertScopedClinicalProjection(
  tenantId: string,
  patientId: string,
  projection: Patient360Projection | null
): Patient360Projection {
  if (!tenantId.trim() || !patientId.trim() ||
      !projection || projection.tenantId !== tenantId ||
      projection.patientId !== patientId) {
    throw new Error('CI_STANDALONE_CLINICAL_CONTEXT_SCOPE_MISMATCH');
  }
  if (!Number.isSafeInteger(projection.revision) || projection.revision < 0 ||
      !projection.contentHash || !projection.sourceCheckpoint ||
      (projection.timelineGeneration && !projection.timelineReady)) {
    throw new Error('CI_STANDALONE_CLINICAL_CONTEXT_NOT_AUTHORITATIVE');
  }
  return projection;
}

export function resolveClinicalContextSource(
  env: Record<string, string | undefined> = process.env
): ClinicalContextSource {
  const value = String(env.GHIMS_CI_CONTEXT_SOURCE || 'NATIVE').trim().toUpperCase();
  if (value !== 'NATIVE' && value !== 'EXTERNAL') {
    throw new Error('CI_STANDALONE_CLINICAL_CONTEXT_SOURCE_INVALID');
  }
  return value;
}
