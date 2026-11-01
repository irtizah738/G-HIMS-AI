import { describe, expect, test } from 'bun:test';
import {
  assertExternalEvidenceReadAuthority,
  assertExternalEvidenceFreshness,
  EXTERNAL_EVIDENCE_MAX_AGE_MS,
} from '@/lib/clinical/intelligence/external-clinical-evidence-reader';
import { getConfiguredClinicalContextReader } from '@/lib/clinical/intelligence/native-clinical-context-adapter';
import type { ExternalPatient360Projection } from '@/lib/clinical/intelligence/external-patient360-projection';

const now = 1_800_000_000_000;
const reviewer = {
  actorId: 'reviewer', tenantId: 'hospital-a', roles: ['SYSTEM_ADMIN'],
  permissions: ['FHIR_EVIDENCE_REVIEW'], facilityIds: ['facility-a'],
};
const projection = {
  tenantId: 'hospital-a', patientId: 'patient-1',
  projectionVersion: 1 as const, revision: 1, status: 'EVIDENCE_ONLY' as const,
  sourceFingerprint: 'source', sourceCheckpoint: 'source',
  projectedAt: now, contentHash: 'invalid-hash',
  sourceRefs: [{ sourceId: 'his-a', facilityId: 'facility-a' }],
  facts: [{
    type: 'Observation' as const, id: 'h1', resourceId: 'o1', sourceId: 'his-a',
    sourceVersionId: 'v1', sourceLastUpdatedAt: 100,
    evidenceReceiptId: 'receipt', sourceEventId: 'event',
    resourceHash: 'abc', summary: { kind: 'OBSERVATION' },
    clinicalVerification: 'UNVERIFIED_EXTERNAL' as const,
  }],
  reconciliationIssues: [],
  dataQuality: {
    allergyKnowledge: 'UNKNOWN' as const,
    medicationKnowledge: 'UNKNOWN' as const,
    problemListKnowledge: 'UNKNOWN' as const,
    externalEvidenceVerifiedByClinician: false as const,
    historyCompleteness: 'UNVERIFIED' as const,
  },
} satisfies ExternalPatient360Projection;
describe('CI-EXT-03 external evidence reader fail-closed contract', () => {
  test('requires explicit evidence-review grant even for system administrators', () => {
    expect(() => assertExternalEvidenceReadAuthority(
      reviewer, 'hospital-a', 'patient-1'
    )).not.toThrow();
    expect(() => assertExternalEvidenceReadAuthority(
      { ...reviewer, permissions: ['FHIR_IMPORT'] }, 'hospital-a', 'patient-1'
    )).toThrow('CI_EXT03_EVIDENCE_PERMISSION_DENIED');
    expect(() => assertExternalEvidenceReadAuthority(
      { ...reviewer, tenantId: 'hospital-b' }, 'hospital-a', 'patient-1'
    )).toThrow('CI_EXT03_TENANT_ACCESS_DENIED');
    expect(() => assertExternalEvidenceReadAuthority(
      { ...reviewer, facilityIds: [] }, 'hospital-a', 'patient-1'
    )).toThrow('CI_EXT03_FACILITY_ACCESS_DENIED');
  });
  test('projections with stale time, ambiguous policy or bad content hash are denied', () => {
    expect(() => assertExternalEvidenceFreshness(
      projection, 'hospital-a', 'patient-1', now
    )).toThrow('CI_EXT03_PROJECTION_CONTENT_HASH_INVALID');
    expect(() => assertExternalEvidenceFreshness(
      projection, 'hospital-a', 'patient-1', now + EXTERNAL_EVIDENCE_MAX_AGE_MS + 1
    )).toThrow('CI_EXT03_PROJECTION_EXPIRED');
    expect(() => assertExternalEvidenceFreshness(
      { ...projection, status: 'RECONCILIATION_REQUIRED' },
      'hospital-a', 'patient-1', now
    )).toThrow('CI_EXT03_RECONCILIATION_OR_POLICY_BLOCK');
    expect(() => assertExternalEvidenceFreshness(
      projection, 'hospital-b', 'patient-1', now
    )).toThrow('CI_EXT03_PROJECTION_SCOPE_OR_VERSION_INVALID');
  });
  test('native Clinical Intelligence context factory still refuses EXTERNAL mode', () => {
    expect(() => getConfiguredClinicalContextReader({
      GHIMS_CI_CONTEXT_SOURCE: 'EXTERNAL'
    })).toThrow('CI_STANDALONE_EXTERNAL_CONTEXT_ADAPTER_NOT_CONFIGURED');
  });
});
