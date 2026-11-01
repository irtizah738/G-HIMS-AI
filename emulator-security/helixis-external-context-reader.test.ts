import { test, expect } from 'bun:test';
import { getAdminFirestore } from '@/server/firebase/admin';
import {
  fhirPatientLinkId, ingestExternalFhirResource,
} from '@/lib/clinical/intelligence/external-fhir-import';
import { rebuildExternalPatient360 } from '@/lib/clinical/intelligence/external-patient360-projection';
import {
  EXTERNAL_EVIDENCE_MAX_AGE_MS,
  assertExternalEvidenceReadAuthority,
  readExternalClinicalEvidence,
} from '@/lib/clinical/intelligence/external-clinical-evidence-reader';

const fhirObservation = (versionId: string, updated: string, value: number) => ({
  resourceType: 'Observation', id: 'creatinine-ci-ext03',
  meta: { versionId, lastUpdated: updated },
  status: 'final', subject: { reference: 'Patient/external-ci-ext03' },
  code: { coding: [{ system: 'http://loinc.org', code: '2160-0' }] },
  valueQuantity: { value, code: 'mg/dL', system: 'http://unitsofmeasure.org' },
});

test('CI-EXT-03: source-authorized, freshly fenced external evidence remains review-only', async () => {
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci') {
    throw new Error('CI_EXT03_EMULATOR_ONLY');
  }
  const db = getAdminFirestore();
  if (!db) throw new Error('CI_EXT03_EMULATOR_ADMIN_UNAVAILABLE');
  const tenantId = 'ci-ext03-' + crypto.randomUUID().slice(0, 12);
  const patientId = 'synthetic-patient-1';
  const sourceId = 'synthetic-ehr';
  const root = db.collection('tenants').doc(tenantId);
  const link = root.collection('fhirPatientLinks')
    .doc(fhirPatientLinkId(sourceId, 'external-ci-ext03'));
  const source = root.collection('fhirSources').doc(sourceId);
  const importer = {
    tenantId, actorId: 'integrator', roles: [] as string[],
    permissions: ['FHIR_IMPORT'], facilityIds: ['facility-1'],
  };
  const reviewer = {
    tenantId, actorId: 'clinical-evidence-reviewer', roles: [] as string[],
    permissions: ['FHIR_EVIDENCE_REVIEW'], facilityIds: ['facility-1'],
  };
  try {
    await Promise.all([
      root.collection('patients').doc(patientId).set({
        patientId, tenantId, status: 'ACTIVE',
      }),
      link.set({
        tenantId, sourceId, patientId, externalPatientId: 'external-ci-ext03',
        facilityId: 'facility-1', matchStatus: 'VERIFIED',
        consentStatus: 'GRANTED', verifiedBy: 'synthetic-registrar',
      }),
      source.set({
        tenantId, sourceId, facilityId: 'facility-1',
        baseUrl: 'https://synthetic-his.example.test/fhir/R4',
        status: 'ACTIVE', securityReviewStatus: 'APPROVED',
        approvedResourceTypes: ['Patient', 'Encounter', 'Observation'],
      }),
    ]);
    await ingestExternalFhirResource({
      db, actor: importer, sourceId,
      resource: fhirObservation('v1', '2026-10-20T12:00:00Z', 1.2),
    });
    await rebuildExternalPatient360({ db, actor: importer, tenantId, patientId });
    expect(() => assertExternalEvidenceReadAuthority(
      { ...reviewer, permissions: [], roles: ['SYSTEM_ADMIN'] }, tenantId, patientId,
    )).toThrow('CI_EXT03_EVIDENCE_PERMISSION_DENIED');

    const first = await readExternalClinicalEvidence({
      db, actor: reviewer, tenantId, patientId,
    });
    expect(first.source).toBe('EXTERNAL_FHIR');
    expect(first.clinicalUseAuthorized).toBe(false);
    expect(first.historyCompleteness).toBe('UNVERIFIED');
    expect(first.facts.length).toBe(1);
    expect(first.facts[0].clinicalVerification).toBe('UNVERIFIED_EXTERNAL');
    expect(first.facts[0].sourceVersionId).toBe('v1');
    expect((await root.collection('externalContextAccessAudits').get()).size).toBe(1);

    // Evidence-only reader MUST NOT call the native Patient 360 codepath.
    expect((await root.collection('patient360Projections').get()).size).toBe(0);

    const projectionRef = root.collection('externalPatient360Projections').doc(patientId);
    const current = await projectionRef.get();
    const currentAt = Number(current.get('projectedAt'));
    await expect(readExternalClinicalEvidence({
      db, actor: reviewer, tenantId, patientId,
      now: () => currentAt + EXTERNAL_EVIDENCE_MAX_AGE_MS + 1,
    })).rejects.toThrow('CI_EXT03_PROJECTION_EXPIRED');

    // Import a newer source revision without rebuilding. The source head must
    // fence off the stale projection, despite its recent wall-clock timestamp.
    await ingestExternalFhirResource({
      db, actor: importer, sourceId,
      resource: fhirObservation('v2', '2026-10-21T12:00:00Z', 1.7),
    });
    await expect(readExternalClinicalEvidence({
      db, actor: reviewer, tenantId, patientId,
    })).rejects.toThrow('CI_EXT03_PROJECTION_FACT_LINEAGE_INVALID');
    expect((await root.collection('externalContextAccessAudits').get()).size).toBe(1);
    await rebuildExternalPatient360({ db, actor: importer, tenantId, patientId });
    const next = await readExternalClinicalEvidence({
      db, actor: reviewer, tenantId, patientId,
    });
    expect(next.facts[0].sourceVersionId).toBe('v2');
    expect(next.projectionRevision).toBe(2);
    expect(next.projectionContentHash).not.toBe(first.projectionContentHash);

    // A future signed-off source version collision must be reconciled before
    // exposing the existing head again.
    await ingestExternalFhirResource({
      db, actor: importer, sourceId,
      resource: fhirObservation('v2-tie', '2026-10-21T12:00:00Z', 5.0),
    });
    await expect(readExternalClinicalEvidence({
      db, actor: reviewer, tenantId, patientId,
    })).rejects.toThrow('CI_EXT03_UNRESOLVED_RECONCILIATION');

    await link.update({ consentStatus: 'WITHDRAWN' });
    await expect(readExternalClinicalEvidence({
      db, actor: reviewer, tenantId, patientId,
    })).rejects.toThrow('CI_EXT03_UNRESOLVED_RECONCILIATION');
    await link.update({ consentStatus: 'GRANTED' });

    await expect(readExternalClinicalEvidence({
      db, actor: { ...reviewer, facilityIds: [] }, tenantId, patientId,
    })).rejects.toThrow('CI_EXT03_FACILITY_ACCESS_DENIED');
    await expect(readExternalClinicalEvidence({
      db, actor: { ...reviewer, tenantId: 'another-tenant' }, tenantId, patientId,
    })).rejects.toThrow('CI_EXT03_TENANT_ACCESS_DENIED');

    // A tampered projection content hash is independently rejected.
    await projectionRef.update({ contentHash: 'f'.repeat(64) });
    await expect(readExternalClinicalEvidence({
      db, actor: reviewer, tenantId, patientId,
    })).rejects.toThrow('CI_EXT03_PROJECTION_CONTENT_HASH_INVALID');
    expect((await root.collection('externalContextAccessAudits').get()).size).toBe(2);
  } finally {
    await db.recursiveDelete(root);
  }
}, 45000);
