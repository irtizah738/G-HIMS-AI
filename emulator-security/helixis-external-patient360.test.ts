/**
 * Synthetic integration qualification for external Patient 360 and FHIR
 * reconciliation. Refuses to run without a Firestore emulator.
 */
import { test, expect } from 'bun:test';
import { getAdminFirestore } from '@/server/firebase/admin';
import { fhirPatientLinkId, fhirImportHeadId, ingestExternalFhirResource } from '@/lib/clinical/intelligence/external-fhir-import';
import { rebuildExternalPatient360 } from '@/lib/clinical/intelligence/external-patient360-projection';
import { approveFhirReconciliation } from '@/lib/clinical/intelligence/external-fhir-reconciliation';

function obs(versionId: string, lastUpdated: string, value: number) {
  return {
    resourceType: 'Observation', id: 'creatinine-1',
    meta: { versionId, lastUpdated }, subject: { reference: 'Patient/ext-p1' },
    status: 'final',
    code: { coding: [{ system: 'http://loinc.org', code: '2160-0', display: 'Creatinine' }] },
    valueQuantity: { value, unit: 'mg/dL', code: 'mg/dL', system: 'http://unitsofmeasure.org' },
    effectiveDateTime: '2026-10-20T09:00:00Z',
  };
}
test('external Patient 360: immutable revisions, source fencing, dual review and consent replay', async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FHIR_EMULATOR_REQUIRED');
  if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci') {
    throw new Error('FHIR_EMULATOR_ISOLATION_MISMATCH');
  }
  const db = getAdminFirestore();
  if (!db) throw new Error('FHIR_EMULATOR_ADMIN_UNAVAILABLE');
  console.info('FHIR360_EMULATOR_ADMIN_READY');
  const tenantId = 'fhir360-' + crypto.randomUUID().slice(0, 10);
  const patientId = 'helixis-p1';
  const sourceId = 'his-a';
  const baseUrl = 'https://synthetic-his.example.test/fhir/R4';
  const actor = { actorId: 'operator-a', tenantId, roles: [] as string[],
    permissions: ['FHIR_IMPORT', 'FHIR_RECONCILE'], facilityIds: ['site-1'] };
  const root = db.collection('tenants').doc(tenantId);
  const sourceRef = root.collection('fhirSources').doc(sourceId);
  const linkRef = root.collection('fhirPatientLinks').doc(fhirPatientLinkId(sourceId, 'ext-p1'));
  const headRef = root.collection('fhirResourceHeads').doc(fhirImportHeadId(sourceId, 'Observation', 'creatinine-1'));
  try {
    console.info('FHIR360_BEFORE_SYNTHETIC_SEED');
    await Promise.all([
      root.collection('patients').doc(patientId).set({ tenantId, status: 'ACTIVE' }),
      sourceRef.set({ tenantId, sourceId, facilityId: 'site-1', baseUrl,
        status: 'ACTIVE', securityReviewStatus: 'APPROVED',
        approvedResourceTypes: ['Patient', 'Encounter', 'Observation'] }),
      linkRef.set({ tenantId, sourceId, facilityId: 'site-1',
        externalPatientId: 'ext-p1', patientId,
        matchStatus: 'VERIFIED', consentStatus: 'GRANTED', verifiedBy: 'clinical-reviewer' }),
    ]);
    console.info('FHIR360_SYNTHETIC_SEED_COMMITTED');
    const imported1 = await ingestExternalFhirResource({
      db, actor, sourceId, expectedBaseUrl: baseUrl,
      resource: obs('v1', '2026-10-20T09:00:00Z', 1.2),
    });
    expect(imported1.status).toBe('CURRENT');
    const built1 = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(built1.unchanged).toBe(false);
    expect(built1.projection.revision).toBe(1);
    expect(built1.projection.status).toBe('EVIDENCE_ONLY');
    expect(built1.projection.facts.length).toBe(1);
    expect(built1.projection.facts[0].summary.valueState).toBe('PRESENT_UNVERIFIED');
    expect(built1.projection.dataQuality.allergyKnowledge).toBe('UNKNOWN');
    expect(built1.projection.dataQuality.externalEvidenceVerifiedByClinician).toBe(false);
    expect((await rebuildExternalPatient360({ db, actor, tenantId, patientId })).unchanged).toBe(true);
    expect((await root.collection('externalPatient360Revisions').get()).size).toBe(1);

    await ingestExternalFhirResource({
      db, actor, sourceId, resource: obs('v2', '2026-10-21T09:00:00Z', 1.8),
    });
    const built2 = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(built2.projection.revision).toBe(2);
    expect(built2.projection.facts[0].sourceVersionId).toBe('v2');
    expect(built2.projection.facts[0].summary.value).toEqual({
      type: 'QUANTITY', value: 1.8, system: 'http://unitsofmeasure.org', code: 'mg/dL',
    });
    await ingestExternalFhirResource({
      db, actor, sourceId, resource: obs('old', '2026-10-19T09:00:00Z', 0.9),
    });
    expect((await rebuildExternalPatient360({ db, actor, tenantId, patientId })).unchanged).toBe(true);
    expect((await headRef.get()).get('sourceVersionId')).toBe('v2');

    const tied = await ingestExternalFhirResource({
      db, actor, sourceId, resource: obs('tie', '2026-10-21T09:00:00Z', 4.0),
    });
    expect(tied.status).toBe('RECONCILIATION_REQUIRED');
    const caseId = 'frc_' + tied.receiptId.slice(4);
    expect((await root.collection('fhirReconciliationCases').doc(caseId).get()).get('status')).toBe('OPEN');
    const blocked = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(blocked.projection.revision).toBe(3);
    expect(blocked.projection.status).toBe('RECONCILIATION_REQUIRED');
    expect(blocked.projection.reconciliationIssues).toContain('OPEN_RECONCILIATION:' + caseId);
    const first = await approveFhirReconciliation({
      db, actor, caseId, decision: 'SUPPRESS_CONFLICTING_VERSION',
      rationale: 'Confirmed prior source head remains the hospital current revision.',
    });
    expect(first.status).toBe('OPEN');
    expect(first.approvalCount).toBe(1);
    expect((await approveFhirReconciliation({
      db, actor, caseId, decision: 'SUPPRESS_CONFLICTING_VERSION',
      rationale: 'Confirmed prior source head remains the hospital current revision.',
    })).replay).toBe(true);
    await expect(approveFhirReconciliation({
      db, actor: { ...actor, actorId: 'other', permissions: [] }, caseId,
      decision: 'SUPPRESS_CONFLICTING_VERSION',
      rationale: 'Unauthorised second approval must be denied on server.',
    })).rejects.toThrow('FHIR_RECONCILIATION_PERMISSION_DENIED');
    const second = await approveFhirReconciliation({
      db, actor: { ...actor, actorId: 'operator-b' }, caseId,
      decision: 'SUPPRESS_CONFLICTING_VERSION',
      rationale: 'Independently verified the conflicting source version and quarantine.',
    });
    expect(second.status).toBe('RESOLVED');
    expect(second.approvalCount).toBe(2);
    expect((await root.collection('fhirReconciliationDecisions').get()).size).toBe(2);
    const recovered = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(recovered.projection.revision).toBe(4);
    expect(recovered.projection.status).toBe('EVIDENCE_ONLY');
    expect(recovered.projection.facts[0].sourceVersionId).toBe('v2');
    expect((await headRef.get()).get('sourceVersionId')).toBe('v2');

    await linkRef.update({ consentStatus: 'WITHDRAWN' });
    const revoked = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(revoked.projection.status).toBe('RECONCILIATION_REQUIRED');
    expect(revoked.projection.facts).toEqual([]);
    expect(revoked.projection.reconciliationIssues.some(x => x.startsWith('PATIENT_LINK_OR_CONSENT_INVALID'))).toBe(true);
    await linkRef.update({ consentStatus: 'GRANTED' });
    const reauthorized = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(reauthorized.projection.facts.length).toBe(1);
    await sourceRef.update({ status: 'REVOKED' });
    const disabled = await rebuildExternalPatient360({ db, actor, tenantId, patientId });
    expect(disabled.projection.status).toBe('RECONCILIATION_REQUIRED');
    expect(disabled.projection.facts).toEqual([]);
    await expect(rebuildExternalPatient360({
      db, actor: { ...actor, tenantId: 'other-tenant' }, tenantId, patientId,
    })).rejects.toThrow('FHIR_CONTEXT_TENANT_DENIED');
    await expect(rebuildExternalPatient360({
      db, actor: { ...actor, facilityIds: [] }, tenantId, patientId,
    })).rejects.toThrow('FHIR_CONTEXT_FACILITY_DENIED');
    expect((await root.collection('externalPatient360Projections').doc(patientId).get()).get('status'))
      .toBe('RECONCILIATION_REQUIRED');
    expect((await root.collection('externalPatient360Revisions').get()).size).toBe(7);
  } finally {
    await db.recursiveDelete(root);
    console.info('FHIR_EMULATOR_CLEANUP_COMPLETE');
  }
}, 30000);
