/**
 * A pre-generated, TEST-ONLY synthetic draft lets the clinician *browser*
 * exercise the real review/approval/signature command path without calling
 * an AI provider or spoofing a live safety adjudication.
 */
import { validateDevelopmentSandbox, SANDBOX_ACK, SANDBOX_PROJECT_ID } from '@/lib/dev-sandbox/safety';
import { getAdminFirestore } from '@/server/firebase/admin';
import { SANDBOX_FACILITY_ID } from '@/lib/dev-sandbox/scenarios';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { ClinicalIntelligenceSafetyEvaluator } from '@/lib/clinical/intelligence/clinical-intelligence-safety-evaluator';
import { clinicalDraftContentHash } from '@/lib/clinical/intelligence/clinical-draft-lifecycle';
import { CLINICAL_AI_BOUNDARY_VERSION, CLINICAL_SAFETY_POLICY_VERSION } from '@/types/clinical-intelligence-safety';
import type { CommandContext } from '@/lib/backend/types';
import type { ClinicalDraftRevision, GovernedClinicalDraft } from '@/types/clinical-draft';

const { tenantId } = validateDevelopmentSandbox(process.env);
const db = getAdminFirestore();
if (!db) throw new Error('CIQP_BROWSER_DRAFT_REQUIRES_FIRESTORE_EMULATOR');
const tenant = db.collection('tenants').doc(tenantId);
const tenantData = (await tenant.get()).data();
if (
  tenantData?.sandboxMarker !== SANDBOX_ACK ||
  tenantData?.environment !== 'TEST' ||
  tenantData?.syntheticOnly !== true ||
  tenantData?.projectId !== SANDBOX_PROJECT_ID
) throw new Error('CIQP_BROWSER_DRAFT_REQUIRES_MARKED_SYNTHETIC_TENANT');

const patientId = 'ciqp_browser_patient';
const draftId = 'ciqp_browser_governed_draft';
const revisionId = `${draftId}_r1`;
if ((await tenant.collection('clinicalDrafts').doc(draftId).get()).exists) {
  throw new Error('CIQP_BROWSER_DRAFT_ALREADY_EXISTS');
}
const patient = (await tenant.collection('patients').doc(patientId).get()).data();
if (!patient || patient.tenantId !== tenantId) {
  throw new Error('CIQP_BROWSER_DRAFT_PATIENT_NOT_FOUND');
}
const encounterDocs = await tenant.collection('encounters').where('patientId', '==', patientId).get();
if (encounterDocs.size !== 1) throw new Error('CIQP_BROWSER_DRAFT_ENCOUNTER_NOT_UNIQUE');
const encounterId = encounterDocs.docs[0].id;
if (encounterDocs.docs[0].data()?.facilityId !== SANDBOX_FACILITY_ID) {
  throw new Error('CIQP_BROWSER_DRAFT_FACILITY_MISMATCH');
}
const projection = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
if (!projection.timelineReady) throw new Error('CIQP_BROWSER_DRAFT_PATIENT360_NOT_READY');

const generatedAt = Date.now();
const context: CommandContext = {
  tenantId, actorId: 'dev-sandbox-doctor', roles: ['DOCTOR'],
  permissions: ['PATIENT360:READ'], clinicalPrivileges: ['SIGN_CLINICAL_NOTES'],
  facilityIds: [SANDBOX_FACILITY_ID], departmentIds: ['GENERAL_MEDICINE'],
  correlationId: 'ciqp_browser_draft_evidence',
  requestId: 'ciqp_browser_draft_seed',
};
const snapshot = await ClinicalEvidenceService.createAuthoritativeSnapshot(
  context, patientId, 'CLINICAL_DRAFT', { encounterId, careSetting: 'OPD' }
);
if (
  snapshot.patient360ContentHash !== projection.contentHash ||
  snapshot.patient360Revision !== projection.revision ||
  snapshot.patient360SourceCheckpoint !== projection.sourceCheckpoint
) throw new Error('CIQP_BROWSER_DRAFT_SNAPSHOT_FENCE_FAILED');

const title = 'Synthetic SOAP draft — not clinically evaluated';
const content = 'Synthetic test-only assessment. Clinical facts and decisions must be independently verified.';
const generatedHash = clinicalDraftContentHash(title, content);
const safety = ClinicalIntelligenceSafetyEvaluator.evaluate({
  tenantId, patientId, purpose: 'CLINICAL_DRAFT', snapshot,
  claims: [], renderedText: [title, content],
  currentPatient360Revision: projection.revision,
  currentPatient360SourceCheckpoint: projection.sourceCheckpoint,
  generationProvenance: {
    provider: 'synthetic-emulator-fixture', model: 'no-model-invoked',
    purpose: 'CLINICAL_GOVERNED_DRAFT', generatedAt,
    safetyBoundaryVersion: CLINICAL_AI_BOUNDARY_VERSION,
  },
  // Only the *local emulator fixture* can approve this synthetic provider;
  // no production provider registry or runtime policy is modified.
  approvedClinicalAIProviders: ['synthetic-emulator-fixture'],
});
if (safety.status !== 'PASSED') throw new Error('CIQP_BROWSER_DRAFT_FIXTURE_SAFETY_REJECTED');

const draft: GovernedClinicalDraft = {
  draftId, tenantId, patientId, encounterId, careSetting: 'OPD',
  draftType: 'SOAP', status: 'GENERATED_REQUIRES_REVIEW',
  evidenceSnapshotId: snapshot.snapshotId,
  evidenceSnapshotHash: snapshot.snapshotHash,
  patient360Revision: snapshot.patient360Revision,
  patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
  generationPolicyVersion: 'ci10f-clinical-drafting-v1',
  generationProvenance: {
    provider: 'synthetic-emulator-fixture', model: 'no-model-invoked',
    purpose: 'CLINICAL_GOVERNED_DRAFT', generatedAt,
  },
  safetyEvaluationId: safety.evaluationId,
  safetyPolicyVersion: CLINICAL_SAFETY_POLICY_VERSION,
  safetyGateStatus: 'PASSED',
  generatedBy: 'synthetic-emulator-fixture', generatedAt,
  currentRevisionId: revisionId, currentRevisionNumber: 1,
  currentTitle: title, currentContent: content,
  currentContentHash: generatedHash, generatedContentHash: generatedHash,
  warnings: ['SYNTHETIC_BROWSER_FIXTURE_NOT_CLINICALLY_EVALUATED'],
  claimCount: 0, createdAt: generatedAt, updatedAt: generatedAt,
  safety: {
    nonAuthoritativeUntilSigned: true, qualifiedClinicianReviewRequired: true,
    clinicianEditRequiredBeforeApproval: true, explicitApprovalRequired: true,
    signatureRequiredForAuthority: true, directClinicalMutationAllowed: false,
  },
};
const revision: ClinicalDraftRevision = {
  revisionId, draftId, tenantId, patientId, encounterId,
  revisionNumber: 1, source: 'AI_GENERATED', title, content,
  contentHash: generatedHash, claims: [], createdBy: 'synthetic-emulator-fixture',
  createdAt: generatedAt, immutable: true,
  evidenceSnapshotId: snapshot.snapshotId,
  evidenceSnapshotHash: snapshot.snapshotHash,
  patient360Revision: snapshot.patient360Revision,
  patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
};
const batch = db.batch();
batch.create(tenant.collection('clinicalDrafts').doc(draftId), draft);
batch.create(tenant.collection('clinicalDraftRevisions').doc(revisionId), revision);
batch.create(tenant.collection('clinicalIntelligenceSafetyEvaluations').doc(safety.evaluationId), safety);
await batch.commit();
process.stdout.write('CIQP_BROWSER_SYNTHETIC_DRAFT_WITH_FROZEN_EVIDENCE=PASS\n');
