/**
 * Assert that the browser operation persisted exactly one authoritative
 * signature and retained the original immutable generation revision.
 * Run only inside the marked disposable Firebase emulator tenant.
 */
import { validateDevelopmentSandbox, SANDBOX_ACK, SANDBOX_PROJECT_ID } from '@/lib/dev-sandbox/safety';
import { getAdminFirestore } from '@/server/firebase/admin';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';

const { tenantId } = validateDevelopmentSandbox(process.env);
const db = getAdminFirestore();
if (!db) throw new Error('CIQP_SIGN_VERIFY_EMULATOR_REQUIRED');
const tenant = db.collection('tenants').doc(tenantId);
const marker = (await tenant.get()).data();
if (marker?.projectId !== SANDBOX_PROJECT_ID || marker?.sandboxMarker !== SANDBOX_ACK ||
  marker?.environment !== 'TEST' || marker?.syntheticOnly !== true
) throw new Error('CIQP_SIGN_VERIFY_TENANT_NOT_DISPOSABLE');

const draftId = 'ciqp_browser_governed_draft';
const patientId = 'ciqp_browser_patient';
const draft = (await tenant.collection('clinicalDrafts').doc(draftId).get()).data();
if (
  draft?.tenantId !== tenantId ||
  draft?.patientId !== patientId ||
  draft?.status !== 'SIGNED' ||
  draft?.currentRevisionNumber !== 2 ||
  draft?.approvedRevisionNumber !== 2 ||
  draft?.signedBy !== 'dev-sandbox-doctor' ||
  !draft?.signedClinicalDocumentId ||
  !draft?.signedEvidenceId
) throw new Error('CIQP_SIGN_VERIFY_DRAFT_NOT_SIGNED_BY_SYNTHETIC_DOCTOR');

const initial = (await tenant.collection('clinicalDraftRevisions').doc(`${draftId}_r1`).get()).data();
const revised = (await tenant.collection('clinicalDraftRevisions').doc(`${draftId}_r2`).get()).data();
if (
  initial?.source !== 'AI_GENERATED' ||
  initial?.immutable !== true ||
  initial?.content !== 'Synthetic test-only assessment. Clinical facts and decisions must be independently verified.' ||
  revised?.source !== 'CLINICIAN_EDITED' ||
  revised?.immutable !== true ||
  revised?.revisionNumber !== 2 ||
  draft.approvedContentHash !== revised.contentHash ||
  draft.currentContentHash !== revised.contentHash
) throw new Error('CIQP_SIGN_VERIFY_REVISION_INTEGRITY_FAILURE');

const document = (await tenant.collection('clinicalDocuments').doc(draft.signedClinicalDocumentId).get()).data();
const evidence = (await tenant.collection('encounterEvidence').doc(draft.signedEvidenceId).get()).data();
if (
  document?.patientId !== patientId ||
  evidence?.status !== 'FINAL' ||
  evidence?.sourceDraftContentHash !== revised.contentHash ||
  evidence?.evidenceSnapshotHash !== draft.evidenceSnapshotHash
) throw new Error('CIQP_SIGN_VERIFY_AUTHORITATIVE_DOCUMENT_MISSING');

const events = await tenant.collection('events').where('eventType', '==', 'CLINICAL_DRAFT_SIGNED').get();
const signedEvents = events.docs.filter((entry) => entry.data().aggregateId === draftId);
if (signedEvents.length !== 1) throw new Error('CIQP_SIGN_VERIFY_DUPLICATE_OR_MISSING_EVENT');
const signedEvent = signedEvents[0].data();
const audits = await tenant.collection('audit_logs').where('eventId', '==', signedEvent.eventId).get();
const outboxes = await tenant.collection('outbox').where('eventId', '==', signedEvent.eventId).get();
if (audits.size !== 1 || outboxes.size !== 1) {
  throw new Error('CIQP_SIGN_VERIFY_AUDIT_OUTBOX_MISSING');
}
const projection = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
const timeline = await Patient360ProjectionService.getTimeline(tenantId, patientId);
if (!projection.timelineReady || !timeline.some((item) => item.eventId === signedEvent.eventId)) {
  throw new Error('CIQP_SIGN_VERIFY_PATIENT360_EVENT_MISSING');
}
process.stdout.write('CIQP_AUTHENTICATED_BROWSER_GOVERNED_SIGNING=PASS\n');
