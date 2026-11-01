import { describe, expect, test } from 'bun:test';
import {
  assertFhirImportActor,
  assertFhirSource,
  classifyFhirVersion,
  fhirImportHeadId,
  fhirPatientLinkId,
  prepareFhirImport,
  type FhirImportActor,
  type FhirSourceRecord,
} from '@/lib/clinical/intelligence/external-fhir-import';

const actor: FhirImportActor = {
  actorId: 'operator-1',
  tenantId: 'hospital-a',
  permissions: ['FHIR_IMPORT'],
  roles: [],
  facilityIds: ['site-1'],
};
const source: FhirSourceRecord = {
  tenantId: 'hospital-a',
  sourceId: 'ehr-1',
  facilityId: 'site-1',
  baseUrl: 'https://ehr.example.test/fhir/R4',
  status: 'ACTIVE',
  securityReviewStatus: 'APPROVED',
  approvedResourceTypes: ['Patient', 'Observation', 'Encounter'],
};
const observation = {
  resourceType: 'Observation',
  id: 'creatinine-1',
  meta: { versionId: 'v-1', lastUpdated: '2026-10-20T14:00:00Z' },
  status: 'final',
  subject: { reference: 'Patient/external-p1' },
  code: { coding: [{ system: 'http://loinc.org', code: '2160-0', display: 'Creatinine' }] },
  valueQuantity: { value: 1.7, system: 'http://unitsofmeasure.org', code: 'mg/dL' },
};
describe('Helixis external FHIR R4 import — trust and provenance', () => {
  test('requires a verified actor/tenant/facility binding and registered source', () => {
    expect(() => assertFhirSource(source, 'hospital-a', 'ehr-1', actor, 'Observation', source.baseUrl)).not.toThrow();
    expect(() => assertFhirSource(source, 'hospital-b', 'ehr-1', actor, 'Observation')).toThrow();
    expect(() => assertFhirSource(source, 'hospital-a', 'ehr-2', actor, 'Observation')).toThrow();
    expect(() => assertFhirSource(source, 'hospital-a', 'ehr-1', actor, 'Condition')).toThrow();
    expect(() => assertFhirSource(source, 'hospital-a', 'ehr-1', actor, 'Observation', 'https://attacker.test')).toThrow();
    expect(() => assertFhirImportActor({ ...actor, facilityIds: [] }, 'hospital-a', 'site-1')).toThrow();
    expect(() => assertFhirImportActor({ ...actor, permissions: [] }, 'hospital-a', 'site-1')).toThrow();
    expect(() => assertFhirSource({ ...source, status: 'REVOKED' }, 'hospital-a', 'ehr-1', actor, 'Observation')).toThrow();
    expect(() => assertFhirSource({ ...source, securityReviewStatus: 'REVOKED' }, 'hospital-a', 'ehr-1', actor, 'Observation')).toThrow();
  });
  test('requires explicit relative patient references and source versions', () => {
    const prepared = prepareFhirImport('ehr-1', observation);
    expect(prepared.externalPatientId).toBe('external-p1');
    expect(prepared.summary.valueState).toBe('PRESENT');
    expect(prepared.sourceVersionId).toBe('v-1');
    expect(() => prepareFhirImport('ehr-1', { ...observation, subject: { reference: 'Patient/other/invalid' } })).toThrow();
    expect(() => prepareFhirImport('ehr-1', { ...observation, subject: { reference: 'https://other.test/Patient/external-p1' } })).toThrow();
    expect(() => prepareFhirImport('ehr-1', { ...observation, meta: {} })).toThrow();
    expect(() => prepareFhirImport('ehr-1', { ...observation, meta: { versionId: 'x' } })).toThrow();
    expect(() => prepareFhirImport('ehr-1', { ...observation, resourceType: 'MedicationRequest' })).toThrow();
    expect(() => prepareFhirImport('ehr-1', { ...observation, code: {} })).toThrow();
  });
  test('uses opaque source versions, deterministic hashes, and stable IDs', () => {
    const a = prepareFhirImport('ehr-1', observation);
    const b = prepareFhirImport('ehr-1', {
      ...observation,
      code: { coding: [{ display: 'Creatinine', code: '2160-0', system: 'http://loinc.org' }] },
    });
    const c = prepareFhirImport('ehr-2', observation);
    expect(a.resourceHash).toBe(b.resourceHash);
    expect(a.receiptId).toBe(b.receiptId);
    expect(a.receiptId).not.toBe(c.receiptId);
    expect(fhirPatientLinkId('ehr-1', 'p1')).not.toBe(fhirPatientLinkId('ehr-2', 'p1'));
    expect(fhirImportHeadId('ehr-1', 'Observation', 'obs')).not.toBe(fhirImportHeadId('ehr-1', 'Patient', 'obs'));
  });
  test('preserves unknown observation values and rejects contradictory values', () => {
    const { valueQuantity: _ignored, ...withoutValue } = observation;
    expect(prepareFhirImport('ehr-1', withoutValue).summary.valueState).toBe('UNKNOWN');
    expect(() => prepareFhirImport('ehr-1', { ...observation, valueString: 'other' })).toThrow();
  });
  test('out-of-order revisions never replace the current head', () => {
    const previous = { sourceVersionId: 'zeta', sourceLastUpdatedAt: 2000 };
    expect(classifyFhirVersion(null, previous)).toBe('CURRENT');
    expect(classifyFhirVersion(previous, { sourceVersionId: 'alpha', sourceLastUpdatedAt: 3000 })).toBe('CURRENT');
    expect(classifyFhirVersion(previous, { sourceVersionId: '9999', sourceLastUpdatedAt: 1000 })).toBe('HISTORICAL');
    expect(classifyFhirVersion(previous, { sourceVersionId: 'beta', sourceLastUpdatedAt: 2000 })).toBe('RECONCILIATION_REQUIRED');
  });
});
