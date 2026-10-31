/**
 * Operator-run, real-provider synthetic draft qualification.
 *
 * CI does NOT invoke this script. It requires a deliberately enabled provider,
 * a frozen source commit, local Firebase emulators and a disposable tenant.
 * A passed structural safety gate is NOT a passed clinical evaluation.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { assertCiqpLiveModelScope } from '@/lib/clinical/intelligence/ciqp-live-model-synthetic-guard';
import { validateDevelopmentSandbox, SANDBOX_ACK } from '@/lib/dev-sandbox/safety';
import { SANDBOX_FACILITY_ID } from '@/lib/dev-sandbox/scenarios';
import { getAdminFirestore } from '@/server/firebase/admin';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { ClinicalDraftService } from '@/lib/clinical/intelligence/clinical-draft-service';
import { CLINICAL_SAFETY_POLICY_VERSION } from '@/types/clinical-intelligence-safety';
import type { CommandContext } from '@/lib/backend/types';

const scope = assertCiqpLiveModelScope(process.env);
validateDevelopmentSandbox(process.env);
if (process.env.CI) throw new Error('CIQP_LIVE_MODEL_FORBIDDEN_IN_AUTOMATED_CI');

const actualSha = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8', timeout: 5_000,
}).trim();
if (actualSha !== scope.releaseSha) throw new Error('CIQP_LIVE_MODEL_COMMIT_DRIFT');

const output = String(process.env.CIQP_SYNTHETIC_REPORT_PATH || '').trim();
const target = resolve(output);
const localTmp = resolve(tmpdir());
const fromTemp = relative(localTmp, target);
if (!output || target === localTmp || fromTemp.startsWith('..' + sep) ||
    fromTemp === '..' || isAbsolute(fromTemp)) {
  throw new Error('CIQP_LIVE_MODEL_REPORT_MUST_BE_IN_SYSTEM_TMPDIR');
}

const db = getAdminFirestore();
if (!db) throw new Error('CIQP_LIVE_MODEL_FIRESTORE_EMULATOR_UNAVAILABLE');
const tenant = db.collection('tenants').doc(scope.tenantId);
const marker = (await tenant.get()).data();
if (marker?.sandboxMarker !== SANDBOX_ACK ||
    marker?.syntheticOnly !== true ||
    marker?.environment !== 'TEST' ||
    marker?.projectId !== scope.projectId) {
  throw new Error('CIQP_LIVE_MODEL_DISPOSABLE_TENANT_NOT_VERIFIED');
}

const patientId = 'ciqp_browser_patient';
const patient = (await tenant.collection('patients').doc(patientId).get()).data();
if (!patient || patient.tenantId !== scope.tenantId) {
  throw new Error('CIQP_LIVE_MODEL_CANONICAL_SYNTHETIC_PATIENT_REQUIRED');
}
const encounters = await tenant.collection('encounters')
  .where('patientId', '==', patientId).get();
if (encounters.size !== 1 ||
    encounters.docs[0].data()?.facilityId !== SANDBOX_FACILITY_ID) {
  throw new Error('CIQP_LIVE_MODEL_SYNTHETIC_ENCOUNTER_NOT_UNIQUE');
}
const encounterId = encounters.docs[0].id;
const context: CommandContext = {
  tenantId: scope.tenantId,
  actorId: 'dev-sandbox-doctor',
  roles: ['DOCTOR'],
  permissions: ['PATIENT360:READ'],
  clinicalPrivileges: ['SIGN_CLINICAL_NOTES'],
  facilityIds: [SANDBOX_FACILITY_ID],
  departmentIds: ['GENERAL_MEDICINE'],
  correlationId: 'ciqp-live-model-' + crypto.randomUUID(),
  requestId: 'ciqp-live-model-' + crypto.randomUUID(),
};

const projection = await Patient360ProjectionService.rebuildPatient(scope.tenantId, patientId);
if (!projection.timelineReady) throw new Error('CIQP_LIVE_MODEL_PATIENT360_NOT_READY');
const snapshot = await ClinicalEvidenceService.createAuthoritativeSnapshot(
  context, patientId, 'CLINICAL_DRAFT', { encounterId, careSetting: 'OPD' }
);
if (snapshot.patient360ContentHash !== projection.contentHash ||
    snapshot.patient360Revision !== projection.revision ||
    snapshot.patient360SourceCheckpoint !== projection.sourceCheckpoint ||
    snapshot.evidenceRefs.length === 0) {
  throw new Error('CIQP_LIVE_MODEL_FROZEN_EVIDENCE_MISMATCH');
}

const key = 'ciqp-live-model:' + crypto.randomUUID();
const draftId = 'cdraft_' + crypto.createHash('sha256')
  .update([scope.tenantId, context.actorId, key].join('|'))
  .digest('hex').slice(0, 32);
const base = {
  schema: 'ciqp-real-provider-synthetic-receipt-v1',
  evidenceClass: 'OBSERVED_MODEL_OUTPUT_NOT_CLINICALLY_ADJUDICATED',
  environment: 'DISPOSABLE_FIREBASE_EMULATORS_ONLY',
  cohort: 'SYNTHETIC',
  commitSha: actualSha,
  provider: scope.provider,
  model: scope.model,
  safetyPolicyVersion: CLINICAL_SAFETY_POLICY_VERSION,
  snapshotId: snapshot.snapshotId,
  snapshotHash: snapshot.snapshotHash,
  patient360Revision: snapshot.patient360Revision,
  patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
  draftType: 'SOAP',
  caseId: 'ciqp_browser_patient',
  evaluationStatus: 'PENDING_INDEPENDENT_CLINICIAN_REVIEW',
  signedClinicalAuthority: false,
  clinicallyValidated: false,
};

let receipt: Record<string, unknown>;
let succeeded = false;
const beganAt = Date.now();
try {
  const generated = await ClinicalDraftService.generateAuthoritatively(
    context, patientId, encounterId, 'OPD', 'SOAP', key
  );
  if (generated.draft.status !== 'GENERATED_REQUIRES_REVIEW' ||
      generated.draft.draftId !== draftId ||
      generated.draft.evidenceSnapshotHash !== snapshot.snapshotHash ||
      generated.draft.patient360Revision !== snapshot.patient360Revision ||
      !generated.draft.safetyEvaluationId ||
      generated.revision.immutable !== true) {
    throw new Error('CIQP_LIVE_MODEL_GENERATED_DRAFT_INTEGRITY_FAILURE');
  }

  const evaluation = (await tenant.collection('clinicalIntelligenceSafetyEvaluations')
    .doc(generated.draft.safetyEvaluationId).get()).data();
  if (evaluation?.status !== 'PASSED' ||
      evaluation?.blockerCount !== 0 ||
      evaluation?.evidenceSnapshotHash !== snapshot.snapshotHash ||
      evaluation?.policyVersion !== CLINICAL_SAFETY_POLICY_VERSION) {
    throw new Error('CIQP_LIVE_MODEL_PERSISTED_SAFETY_RECORD_INVALID');
  }

  const replay = await ClinicalDraftService.generateAuthoritatively(
    context, patientId, encounterId, 'OPD', 'SOAP', key
  );
  if (replay.draft.draftId !== draftId ||
      replay.revision.contentHash !== generated.revision.contentHash) {
    throw new Error('CIQP_LIVE_MODEL_REPLAY_CREATED_DUPLICATE_DRAFT');
  }

  const after = await Patient360ProjectionService.rebuildPatient(scope.tenantId, patientId);
  if (after.contentHash !== projection.contentHash ||
      after.revision !== projection.revision ||
      after.sourceCheckpoint !== projection.sourceCheckpoint) {
    throw new Error('CIQP_LIVE_MODEL_UNSIGNED_DRAFT_ADVANCED_CLINICAL_CHART');
  }

  // The full synthetic draft is a local-only review artifact. Never emit text
  // to standard logs, upload it to GitHub Actions, or call it adjudicated.
  receipt = {
    ...base,
    outcome: 'STRUCTURAL_SAFETY_PASSED_REQUIRES_CLINICIAN_ADJUDICATION',
    durationMs: Date.now() - beganAt,
    draftId,
    generatedContentHash: generated.revision.contentHash,
    generationProvenance: generated.draft.generationProvenance,
    safetyEvaluation: {
      status: evaluation.status,
      policyVersion: evaluation.policyVersion,
      blockerCount: evaluation.blockerCount,
      warningCount: evaluation.warningCount,
      findingCodes: (evaluation.findings || []).map((f: { code: string }) => f.code),
    },
    frozenEvidence: snapshot,
    generatedDraft: {
      title: generated.revision.title,
      content: generated.revision.content,
      sections: generated.revision.sections || [],
      claims: generated.revision.claims,
    },
  };
  succeeded = true;
} catch (error) {
  const code = String(error instanceof Error ? error.message : error)
    .split(':')[0].replace(/[^A-Z0-9_]/gi, '').slice(0, 96);
  if (await ClinicalDraftService.get(scope.tenantId, draftId)) {
    // Fail closed: an unsuccessful request must not silently leave a draft.
    throw new Error('CIQP_LIVE_MODEL_PARTIAL_DRAFT_PERSISTENCE_REQUIRES_INVESTIGATION');
  }
  receipt = {
    ...base,
    outcome: 'MODEL_FAILED_OR_SAFETY_BLOCKED',
    durationMs: Date.now() - beganAt,
    errorCode: code || 'CIQP_LIVE_MODEL_UNKNOWN_FAILURE',
    safetyDecision: 'NOT_CLEARED',
  };
}

await writeFile(target, JSON.stringify(receipt, null, 2) + '\n', {
  flag: 'wx', mode: 0o600, encoding: 'utf8',
});
// stdout contains no patient facts, generated claims, prompts or credentials.
process.stdout.write(JSON.stringify({
  schema: base.schema,
  outcome: receipt.outcome,
  model: scope.model,
  commitSha: scope.releaseSha,
  reportLocation: 'OPERATOR_LOCAL_TMPDIR_ONLY',
  clinicalEvaluation: 'NOT_PERFORMED',
  result: succeeded ? 'STRUCTURAL_ONLY' : 'NOT_CLEARED',
}) + '\n');
if (!succeeded) process.exitCode = 1;
