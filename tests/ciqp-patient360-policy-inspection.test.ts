import { describe, expect, test } from 'bun:test';
import { classifyPatient360PolicyInspection, patient360TimelineParity } from '@/lib/clinical/patient360/patient360-policy-inspection';
import { assertEmulatorInspectionScope } from '@/scripts/ops/ciqp-inspect-patient360-legacy';
import type { Patient360Projection } from '@/types/patient360-projection';

function projection(overrides: Partial<Patient360Projection> = {}): Patient360Projection {
  return {
    tenantId: 'tenant-emulator',
    patientId: 'patient-synthetic',
    revision: 4,
    sourceCheckpoint: '400:evt-clinical',
    contentHash: 'clinical-hash',
    sourceFingerprint: 'clinical-source-fingerprint',
    ...overrides,
  } as Patient360Projection;
}

describe('CIQP legacy projection inspection (read only)', () => {
  test('identical canonical data is current even if prior AI audit events exist', () => {
    expect(classifyPatient360PolicyInspection({
      stored: projection(),
      canonical: projection(),
      timelineMatches: true,
      rawEventTypes: [
        'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT_CREATED',
        'CLINICAL_DRAFT_SIGNED',
      ],
    })).toBe('CURRENT_POLICY_MATCH');
  });

  test('an older metadata-affected revision is a candidate, never authorized to overwrite', () => {
    expect(classifyPatient360PolicyInspection({
      stored: projection({ revision: 5, sourceCheckpoint: '500:evt-meta', contentHash: 'old-hash' }),
      canonical: projection(),
      rawEventTypes: ['CLINICAL_DRAFT_GENERATED', 'CLINICAL_DRAFT_SIGNED'],
    })).toBe('LEGACY_NONAUTHORITATIVE_EVENT_CANDIDATE');
  });

  test('missing event corroboration, cross-patient scope and older cursor fail to manual review', () => {
    expect(classifyPatient360PolicyInspection({
      stored: projection({ contentHash: 'other' }),
      canonical: projection(),
      rawEventTypes: ['VITALS_RECORDED'],
    })).toBe('MISMATCH_REQUIRES_CLINICAL_REVIEW');
    expect(classifyPatient360PolicyInspection({
      stored: projection({ patientId: 'different-patient' }),
      canonical: projection(),
      rawEventTypes: ['CLINICAL_DRAFT_GENERATED'],
    })).toBe('MISMATCH_REQUIRES_CLINICAL_REVIEW');
    expect(classifyPatient360PolicyInspection({
      stored: projection({ revision: 2, contentHash: 'other' }),
      canonical: projection(),
      rawEventTypes: ['CLINICAL_DRAFT_GENERATED'],
    })).toBe('MISMATCH_REQUIRES_CLINICAL_REVIEW');
  });

  test('an equal revision with a different source hash cannot be called a legacy contamination candidate', () => {
    expect(classifyPatient360PolicyInspection({
      stored: projection({ contentHash: 'unexplained-different-hash' }),
      canonical: projection(),
      rawEventTypes: ['CLINICAL_DRAFT_GENERATED'],
    })).toBe('MISMATCH_REQUIRES_CLINICAL_REVIEW');
  });

  test('read-only inspector uses every canonical patient-event query path, including excluded AI audit events', async () => {
    const [script, service] = await Promise.all([
      Bun.file('scripts/ops/ciqp-inspect-patient360-legacy.ts').text(),
      Bun.file('lib/clinical/patient360/patient360-projection-service.ts').text(),
    ]);
    expect(script).toContain('includeNonClinical: true');
    expect(script).toContain('patient360TimelineParity(publishedTimeline, canonical.timeline)');
    expect(script).toContain('loadPatientEvents(tenantId, doc.id');
    expect(script).not.toContain(".where('payload.patientId', '==', doc.id)");
    expect(service).toContain("queryEventsByField(eventsRef, 'payload.patientId', patientId)");
    expect(service).toContain("queryEventsByField(eventsRef, 'payload.primaryPatientId', patientId)");
    expect(service).toContain("queryEventsByField(eventsRef, 'payload.secondaryPatientId', patientId)");
    expect(service).toContain("queryEventsByField(eventsRef, 'aggregateId', patientId)");
  });

  test('source fingerprint and published timeline are mandatory for CURRENT_POLICY_MATCH', () => {
    expect(classifyPatient360PolicyInspection({
      stored: projection(), canonical: projection(), rawEventTypes: [],
    })).toBe('TIMELINE_UNVERIFIED');
    expect(classifyPatient360PolicyInspection({
      stored: projection(), canonical: projection(), rawEventTypes: [],
      timelineMatches: false,
    })).toBe('TIMELINE_PARITY_MISMATCH');
    expect(classifyPatient360PolicyInspection({
      stored: projection({ sourceFingerprint: 'old-sources' }),
      canonical: projection(), rawEventTypes: [], timelineMatches: true,
    })).toBe('MISMATCH_REQUIRES_CLINICAL_REVIEW');
  });

  test('timeline parity verifies every row and fact, not just event IDs', () => {
    const row = (eventId: string, summary: string) => ({
      tenantId: 'tenant-emulator', patientId: 'patient-synthetic',
      eventId, eventType: 'VITALS_RECORDED', occurredAt: 400,
      recordedAt: 401, summary,
    });
    const canonical = [row('evt1', 'signed clinical fact'), row('evt2', 'second fact')];
    expect(patient360TimelineParity([...canonical].reverse(), canonical)).toBe(true);
    expect(patient360TimelineParity([row('evt1', 'fabricated clinical fact'), canonical[1]], canonical))
      .toBe(false);
    expect(patient360TimelineParity(canonical.slice(0, 1), canonical)).toBe(false);
    expect(patient360TimelineParity([canonical[0], canonical[0]], canonical)).toBe(false);
  });

  test('unfinished publication and truncated event streams are never declared safe', () => {
    expect(classifyPatient360PolicyInspection({
      stored: projection({ timelineGeneration: 'gen', timelineReady: false }),
      canonical: projection(),
      rawEventTypes: [],
    })).toBe('INCOMPLETE_GENERATION');
    expect(classifyPatient360PolicyInspection({
      stored: projection(),
      canonical: projection(),
      rawEventTypes: [],
      exceededEventLimit: true,
    })).toBe('RAW_EVENT_LIMIT_EXCEEDED');
  });

  test('an emulator, explicit acknowledgement and tenant scope are mandatory', () => {
    const accepted = {
      GHIMS_RUNTIME_MODE: 'TEST',
      NODE_ENV: 'test',
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      GHIMS_CIQP_READ_ONLY_ACK: 'INSPECT_EMULATOR_NO_WRITES',
      GHIMS_CIQP_INSPECT_TENANT_ID: 'synthetic-tenant',
    };
    expect(assertEmulatorInspectionScope(accepted)).toBe('synthetic-tenant');
    expect(() => assertEmulatorInspectionScope({ ...accepted, FIRESTORE_EMULATOR_HOST: '' }))
      .toThrow('CIQP_INSPECTION_EMULATOR_ONLY');
    expect(() => assertEmulatorInspectionScope({ ...accepted, FIRESTORE_EMULATOR_HOST: 'remote.example:443' }))
      .toThrow('CIQP_INSPECTION_EMULATOR_ONLY');
    expect(() => assertEmulatorInspectionScope({ ...accepted, GHIMS_RUNTIME_MODE: 'PRODUCTION' }))
      .toThrow('CIQP_INSPECTION_EMULATOR_ONLY');
    expect(() => assertEmulatorInspectionScope({ ...accepted, NODE_ENV: 'production' }))
      .toThrow('CIQP_INSPECTION_EMULATOR_ONLY');
    expect(() => assertEmulatorInspectionScope({ ...accepted, GHIMS_CIQP_READ_ONLY_ACK: '' }))
      .toThrow('CIQP_INSPECTION_EMULATOR_ONLY');
    expect(() => assertEmulatorInspectionScope({ ...accepted, GHIMS_CIQP_INSPECT_TENANT_ID: '../x' }))
      .toThrow('CIQP_INSPECTION_TENANT_REQUIRED');
  });
});
