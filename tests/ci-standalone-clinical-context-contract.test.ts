import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertScopedClinicalProjection,
  resolveClinicalContextSource,
  type ClinicalContextReader,
} from '@/lib/clinical/intelligence/clinical-context-port';
import {
  getConfiguredClinicalContextReader,
  nativeClinicalContextReader,
} from '@/lib/clinical/intelligence/native-clinical-context-adapter';
import type { Patient360Projection } from '@/types/patient360-projection';

const fakeProjection = (): Patient360Projection => ({
  tenantId: 'synthetic-hospital',
  patientId: 'synthetic-patient',
  revision: 2,
  sourceCheckpoint: 'synthetic:evt2',
  contentHash: 'sha256-synthetic-contract-fixture',
  projectionVersion: 1,
  timelineGeneration: 'synthetic-gen2',
  timelineReady: true,
} as Patient360Projection);

describe('Clinical Intelligence standalone context boundary', () => {
  test('native adapter remains default with explicitly scoped source', () => {
    expect(resolveClinicalContextSource({})).toBe('NATIVE');
    expect(getConfiguredClinicalContextReader({}).source).toBe('NATIVE');
    expect(nativeClinicalContextReader.source).toBe('NATIVE');
  });

  test('unqualified external connector never falls back to native HIS silently', () => {
    expect(resolveClinicalContextSource({ GHIMS_CI_CONTEXT_SOURCE: 'EXTERNAL' }))
      .toBe('EXTERNAL');
    expect(() => getConfiguredClinicalContextReader({
      GHIMS_CI_CONTEXT_SOURCE: 'EXTERNAL',
    })).toThrow('CI_STANDALONE_EXTERNAL_CONTEXT_ADAPTER_NOT_CONFIGURED');
    expect(() => getConfiguredClinicalContextReader({
      GHIMS_CI_CONTEXT_SOURCE: 'unexpected',
    })).toThrow('CI_STANDALONE_CLINICAL_CONTEXT_SOURCE_INVALID');
  });

  test('rejects cross-tenant and cross-patient projection replacement', () => {
    const projection = fakeProjection();
    expect(assertScopedClinicalProjection('synthetic-hospital', 'synthetic-patient', projection))
      .toBe(projection);
    expect(() => assertScopedClinicalProjection('another-hospital', 'synthetic-patient', projection))
      .toThrow('CI_STANDALONE_CLINICAL_CONTEXT_SCOPE_MISMATCH');
    expect(() => assertScopedClinicalProjection('synthetic-hospital', 'another-patient', projection))
      .toThrow('CI_STANDALONE_CLINICAL_CONTEXT_SCOPE_MISMATCH');
    expect(() => assertScopedClinicalProjection('synthetic-hospital', 'synthetic-patient', null))
      .toThrow('CI_STANDALONE_CLINICAL_CONTEXT_SCOPE_MISMATCH');
  });

  test('never treats a partial event projection as current authoritative context', () => {
    const p = fakeProjection();
    p.timelineReady = false;
    expect(() => assertScopedClinicalProjection(p.tenantId, p.patientId, p))
      .toThrow('CI_STANDALONE_CLINICAL_CONTEXT_NOT_AUTHORITATIVE');
    p.timelineReady = true;
    p.sourceCheckpoint = '';
    expect(() => assertScopedClinicalProjection(p.tenantId, p.patientId, p))
      .toThrow('CI_STANDALONE_CLINICAL_CONTEXT_NOT_AUTHORITATIVE');
    p.sourceCheckpoint = 'synthetic:evt2';
    p.revision = Number.NaN;
    expect(() => assertScopedClinicalProjection(p.tenantId, p.patientId, p))
      .toThrow('CI_STANDALONE_CLINICAL_CONTEXT_NOT_AUTHORITATIVE');
  });

  test('the standalone port exposes only canonical scope and event-provenance reads', () => {
    const fake: ClinicalContextReader = {
      source: 'EXTERNAL',
      async readClinicalContext(tenantId, patientId) {
        return { projection: assertScopedClinicalProjection(tenantId, patientId, fakeProjection()) };
      },
      async getProjection() { return fakeProjection(); },
      async getOrRebuildProjection() { return fakeProjection(); },
      async loadPatientEvents() {
        return [{
          eventId: 'synthetic-event-1', eventType: 'PATIENT_REGISTERED',
          aggregateType: 'PATIENT', aggregateId: 'synthetic-patient',
          payload: { patientId: 'synthetic-patient' },
          recordedAt: 100, occurredAt: 100,
        }];
      },
    };
    expect(fake.source).toBe('EXTERNAL');
    expect(fake.loadPatientEvents('synthetic-hospital', 'synthetic-patient'))
      .resolves.toHaveLength(1);
    expect(fake.readClinicalContext('synthetic-hospital', 'synthetic-patient'))
      .resolves.toMatchObject({ projection: { revision: 2 } });
    expect(fake.readClinicalContext('foreign-hospital', 'synthetic-patient'))
      .rejects.toThrow('CI_STANDALONE_CLINICAL_CONTEXT_SCOPE_MISMATCH');
  });

  test('CI generation and evidence code no longer import native Patient 360 service directly', async () => {
    const paths = [
      'lib/clinical/intelligence/clinical-evidence-service.ts',
      'lib/clinical/intelligence/clinical-draft-service.ts',
    ];
    for (const path of paths) {
      const content = await readFile(resolve(process.cwd(), path), 'utf8');
      expect(content).not.toContain("from '@/lib/clinical/patient360/patient360-projection-service'");
      expect(content).toContain('ClinicalContextReader');
      expect(content).toContain('assertScopedClinicalProjection');
    }
    const adapter = await readFile(
      resolve(process.cwd(), 'lib/clinical/intelligence/native-clinical-context-adapter.ts'),
      'utf8'
    );
    expect(adapter).toContain('.readOrRebuildClinicalView(tenantId, patientId)');
    expect(adapter).toContain('Patient360ProjectionService.loadPatientEvents');
    expect(adapter).toContain('Patient360ProjectionService.getProjection');
  });
});
