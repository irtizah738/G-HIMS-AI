import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import {
  assertScopedClinicalProjection,
  resolveClinicalContextSource,
  type ClinicalContextReader,
} from '@/lib/clinical/intelligence/clinical-context-port';

/**
 * Native HIS adapter. The only Clinical Intelligence read-side module that
 * imports the Health Platform's Patient 360 implementation directly.
 */
export const nativeClinicalContextReader: ClinicalContextReader = {
  source: 'NATIVE',
  async readClinicalContext(tenantId, patientId) {
    const { projection } = await Patient360ProjectionService
      .readOrRebuildClinicalView(tenantId, patientId);
    return { projection: assertScopedClinicalProjection(tenantId, patientId, projection) };
  },
  async loadPatientEvents(tenantId, patientId) {
    if (!tenantId.trim() || !patientId.trim()) {
      throw new Error('CI_STANDALONE_CLINICAL_CONTEXT_SCOPE_MISMATCH');
    }
    return Patient360ProjectionService.loadPatientEvents(tenantId, patientId);
  },
  async getProjection(tenantId, patientId) {
    const projection = await Patient360ProjectionService.getProjection(tenantId, patientId);
    return projection === null ? null :
      assertScopedClinicalProjection(tenantId, patientId, projection);
  },
  async getOrRebuildProjection(tenantId, patientId) {
    const projection = await Patient360ProjectionService.getOrRebuildProjection(tenantId, patientId);
    return projection === null ? null :
      assertScopedClinicalProjection(tenantId, patientId, projection);
  },
};

/**
 * No undocumented external-to-native fallback. Until an external adapter
 * passes authorization, provenance, timeline and replay qualification, a
 * tenant configured for third-party HIS mode must remain unavailable.
 */
export function getConfiguredClinicalContextReader(
  env: Record<string, string | undefined> = process.env
): ClinicalContextReader {
  const source = resolveClinicalContextSource(env);
  if (source === 'EXTERNAL') {
    throw new Error('CI_STANDALONE_EXTERNAL_CONTEXT_ADAPTER_NOT_CONFIGURED');
  }
  return nativeClinicalContextReader;
}
