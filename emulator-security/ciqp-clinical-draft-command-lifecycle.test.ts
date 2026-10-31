import { describe, expect, test } from 'bun:test';
import { getAdminFirestore } from '@/server/firebase/admin';
import { CommandBus } from '@/lib/backend/commands/command-bus';
import { registerPatientAndEncounter } from '@/server/runtime/registration-orchestrator';
import { Patient360ProjectionService } from '@/lib/clinical/patient360/patient360-projection-service';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { clinicalDraftContentHash } from '@/lib/clinical/intelligence/clinical-draft-lifecycle';
import { CLINICAL_SAFETY_POLICY_VERSION } from '@/types/clinical-intelligence-safety';
import type { CommandContext, BaseCommand } from '@/lib/backend/types';
import type { GovernedClinicalDraft, ClinicalDraftRevision } from '@/types/clinical-draft';

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

describe('CI-10F governed draft persistence (isolated Firestore emulator)', () => {
  test('clinician command bus durably records review, approval, signature, provenance and idempotent replay', async () => {
    if (
      process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS
    ) {
      throw new Error('CI_DRAFT_TEST_REQUIRES_ISOLATED_LOCAL_EMULATOR');
    }
    const db = getAdminFirestore();
    if (!db) throw new Error('CI_DRAFT_EMULATOR_UNAVAILABLE');

    const tenantId = id('ci_draft_tenant');
    const patientId = id('ci_draft_patient');
    const registered = await registerPatientAndEncounter({
      tenantId, patientId, commandId: id('register'), idempotencyKey: id('registration_key'),
      fullName: 'Synthetic Draft Workflow Patient', gender: 'other',
      dateOfBirth: '1985-01-01',
      identifiers: [{ type: 'CNIC', value: String(Date.now()).slice(-11) }],
      contactPhone: '+920000000000', address: 'Synthetic emulator only',
      encounterType: 'OPD', facilityId: 'synthetic-facility',
      departmentId: 'general-medicine', actorId: 'synthetic-reception',
      actorRole: 'RECEPTIONIST', actorName: 'Synthetic Reception',
    });
    const encounterId = registered.encounter.id;
    const projection = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
    expect(projection.timelineReady).toBe(true);

    const context: CommandContext = {
      tenantId, actorId: 'synthetic-doctor', roles: ['DOCTOR'],
      permissions: ['PATIENT360:READ'],
      clinicalPrivileges: ['SIGN_CLINICAL_NOTES'],
      facilityIds: ['synthetic-facility'], departmentIds: ['general-medicine'],
      correlationId: id('corr'), requestId: id('request'),
    };
    const snapshot = await ClinicalEvidenceService.createAuthoritativeSnapshot(
      context, patientId, 'CLINICAL_DRAFT', { encounterId, careSetting: 'OPD' }
    );
    expect(snapshot.patient360ContentHash).toBe(projection.contentHash);
    expect(snapshot.patient360Revision).toBe(projection.revision);
    expect(snapshot.patient360SourceCheckpoint).toBe(projection.sourceCheckpoint);

    // This fixture deliberately represents the output of an already qualified generator.
    // No AI provider is called and this test NEVER claims safety-evaluator qualification.
    const draftId = id('synthetic_draft');
    const revisionId = `${draftId}_r1`;
    const generatedAt = Date.now();
    const title = 'Synthetic SOAP draft';
    const generated = 'Synthetic source evidence; clinician must verify before signing.';
    const generatedHash = clinicalDraftContentHash(title, generated);
    const base: GovernedClinicalDraft = {
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
      safetyEvaluationId: id('synthetic_safety_fixture'),
      safetyPolicyVersion: CLINICAL_SAFETY_POLICY_VERSION,
      safetyGateStatus: 'PASSED',
      generatedBy: 'synthetic-fixture', generatedAt,
      currentRevisionId: revisionId, currentRevisionNumber: 1,
      currentTitle: title, currentContent: generated,
      currentContentHash: generatedHash, generatedContentHash: generatedHash,
      warnings: ['SYNTHETIC_EMULATOR_FIXTURE_NOT_CLINICALLY_EVALUATED'],
      claimCount: 0, createdAt: generatedAt, updatedAt: generatedAt,
      safety: {
        nonAuthoritativeUntilSigned: true, qualifiedClinicianReviewRequired: true,
        clinicianEditRequiredBeforeApproval: true, explicitApprovalRequired: true,
        signatureRequiredForAuthority: true, directClinicalMutationAllowed: false,
      },
    };
    const initialRevision: ClinicalDraftRevision = {
      revisionId, draftId, tenantId, patientId, encounterId,
      revisionNumber: 1, source: 'AI_GENERATED', title, content: generated,
      contentHash: generatedHash, claims: [], createdBy: 'synthetic-fixture',
      createdAt: generatedAt, immutable: true,
      evidenceSnapshotId: snapshot.snapshotId, evidenceSnapshotHash: snapshot.snapshotHash,
      patient360Revision: snapshot.patient360Revision,
      patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
    };
    const tenant = db.collection('tenants').doc(tenantId);
    const batch = db.batch();
    batch.create(tenant.collection('clinicalDrafts').doc(draftId), base);
    batch.create(tenant.collection('clinicalDraftRevisions').doc(revisionId), initialRevision);
    await batch.commit();

    const issue = async (
      type: string, payload: Record<string, unknown>, commandId = id('command'),
      ctx: CommandContext = context, idempotencyKey = id('key')
    ) => CommandBus.dispatch(ctx, {
      commandType: type, commandId, idempotencyKey,
      tenantId: ctx.tenantId, schemaVersion: 1, payload,
    } satisfies BaseCommand);

    const denied = await issue('ReviewClinicalDraftCommand', {
      draftId, expectedRevisionNumber: 1, content: 'Unauthorized text',
    }, id('denied'), { ...context, clinicalPrivileges: [] });
    expect(denied.success).toBe(false);
    expect(denied.error?.code).toBe('CLINICAL_PRIVILEGE_DENIED');

    const noEdit = await issue('ReviewClinicalDraftCommand', {
      draftId, expectedRevisionNumber: 1, content: generated,
    });
    expect(noEdit.success).toBe(false);
    expect(noEdit.error?.code).toBe('CI10F_CLINICIAN_EDIT_REQUIRED');

    const reviewed = await issue('ReviewClinicalDraftCommand', {
      draftId, expectedRevisionNumber: 1,
      content: 'Clinician reviewed synthetic source and edited the note.',
      reviewNote: 'Synthetic clinician validation only.',
    });
    expect(reviewed.success).toBe(true);
    expect(reviewed.eventId).toBeTruthy();
    expect(reviewed.auditId).toBeTruthy();
    expect(reviewed.outboxId).toBeTruthy();

    const currentRevision = await tenant.collection('clinicalDraftRevisions')
      .doc(`${draftId}_r2`).get();
    expect(currentRevision.exists).toBe(true);
    expect(currentRevision.data()?.source).toBe('CLINICIAN_EDITED');
    expect(currentRevision.data()?.immutable).toBe(true);
    expect((await tenant.collection('clinicalDraftRevisions').doc(revisionId).get()).data()?.content)
      .toBe(generated);
    expect((await tenant.collection('clinicalDocuments').get()).empty).toBe(true);

    const approval = await issue('ApproveClinicalDraftCommand', {
      draftId, expectedRevisionNumber: 2, approvalAttestation: true,
    });
    expect(approval.success).toBe(true);

    // Fault injection in the disposable emulator: even if an approved draft's
    // persisted metadata becomes invalid, the server must never sign it.
    const draftRef = tenant.collection('clinicalDrafts').doc(draftId);
    await draftRef.update({ evidenceSnapshotHash: 'tampered-evidence-hash' });
    const invalidSnapshot = await issue('SignClinicalDraftCommand', {
      draftId, expectedRevisionNumber: 2, signatureAttestation: true,
    });
    expect(invalidSnapshot.success).toBe(false);
    expect(invalidSnapshot.error?.code).toBe('CI10F_EVIDENCE_SNAPSHOT_INTEGRITY_FAILURE');
    expect((await tenant.collection('clinicalDocuments').get()).empty).toBe(true);
    await draftRef.update({ evidenceSnapshotHash: snapshot.snapshotHash });

    await draftRef.update({ safetyGateStatus: 'BLOCKED' });
    const safetyBlocked = await issue('SignClinicalDraftCommand', {
      draftId, expectedRevisionNumber: 2, signatureAttestation: true,
    });
    expect(safetyBlocked.success).toBe(false);
    expect(safetyBlocked.error?.code).toBe('CI10H_SAFETY_EVALUATION_REQUIRED');
    expect((await tenant.collection('clinicalDocuments').get()).empty).toBe(true);
    await draftRef.update({ safetyGateStatus: 'PASSED' });

    await draftRef.update({ safetyPolicyVersion: 'obsolete-synthetic-policy' });
    const obsoleteSafetyPolicy = await issue('SignClinicalDraftCommand', {
      draftId, expectedRevisionNumber: 2, signatureAttestation: true,
    });
    expect(obsoleteSafetyPolicy.success).toBe(false);
    expect(obsoleteSafetyPolicy.error?.code).toBe('CI10H_SAFETY_EVALUATION_REQUIRED');
    expect((await tenant.collection('clinicalDocuments').get()).empty).toBe(true);
    await draftRef.update({ safetyPolicyVersion: CLINICAL_SAFETY_POLICY_VERSION });

    const staleSign = await issue('SignClinicalDraftCommand', {
      draftId, expectedRevisionNumber: 1, signatureAttestation: true,
    });
    expect(staleSign.success).toBe(false);
    expect(staleSign.error?.code).toBe('CI10F_STALE_DRAFT_REVISION');
    expect((await tenant.collection('clinicalDocuments').get()).empty).toBe(true);

    const signCommandId = id('sign');
    const signKey = id('sign_key');
    const signPayload = { draftId, expectedRevisionNumber: 2, signatureAttestation: true };
    const signed = await issue('SignClinicalDraftCommand', signPayload, signCommandId, context, signKey);
    expect(signed.success).toBe(true);
    expect(signed.eventId).toBeTruthy();
    expect(signed.auditId).toBeTruthy();
    expect(signed.outboxId).toBeTruthy();

    const persisted = (await tenant.collection('clinicalDrafts').doc(draftId).get()).data();
    expect(persisted?.status).toBe('SIGNED');
    expect(persisted?.approvedRevisionNumber).toBe(2);
    expect(persisted?.approvedContentHash).toBe(currentRevision.data()?.contentHash);
    const documentId = persisted?.signedClinicalDocumentId as string;
    const evidenceId = persisted?.signedEvidenceId as string;
    expect(documentId).toBeTruthy();
    expect(evidenceId).toBeTruthy();
    const document = (await tenant.collection('clinicalDocuments').doc(documentId).get()).data();
    const evidence = (await tenant.collection('encounterEvidence').doc(evidenceId).get()).data();
    expect(document?.patientId).toBe(patientId);
    expect(evidence?.status).toBe('FINAL');
    expect(evidence?.sourceDraftContentHash).toBe(currentRevision.data()?.contentHash);
    expect(evidence?.evidenceSnapshotHash).toBe(snapshot.snapshotHash);

    const event = (await tenant.collection('events').doc(signed.eventId!).get()).data();
    const audit = (await tenant.collection('audit_logs').doc(signed.auditId!).get()).data();
    const outbox = (await tenant.collection('outbox').doc(signed.outboxId!).get()).data();
    expect(event?.eventType).toBe('CLINICAL_DRAFT_SIGNED');
    expect(event?.payload?.clinicalDocumentId).toBe(documentId);
    expect(audit?.eventId).toBe(signed.eventId);
    expect(outbox?.eventId).toBe(signed.eventId);

    const same = await issue('SignClinicalDraftCommand', signPayload, signCommandId, context, signKey);
    expect(same.success).toBe(true);
    expect(same.replayedFromCache).toBe(true);
    expect(same.eventId).toBe(signed.eventId);
    expect((await tenant.collection('events')
      .where('eventType', '==', 'CLINICAL_DRAFT_SIGNED').get()).size).toBe(1);

    const secondSign = await issue('SignClinicalDraftCommand', signPayload);
    expect(secondSign.success).toBe(false);
    expect(secondSign.error?.code).toBe('CI10F_SIGNED_DRAFT_IMMUTABLE');

    // Construct a second approved *synthetic fixture* against the older chart.
    // After the first signature changes Patient 360, a sign attempt on this
    // still-approved but stale draft must fail transactionally.
    const staleDraftId = id('stale_chart_draft');
    const staleRevisionId = `${staleDraftId}_r1`;
    const staleApprovedDraft: GovernedClinicalDraft = {
      ...base,
      draftId: staleDraftId,
      status: 'APPROVED_FOR_SIGNATURE',
      currentRevisionId: staleRevisionId,
      reviewedBy: context.actorId,
      reviewedAt: generatedAt,
      approvedBy: context.actorId,
      approvedAt: generatedAt,
      approvedRevisionNumber: 1,
      approvedContentHash: generatedHash,
    };
    const staleRevision: ClinicalDraftRevision = {
      ...initialRevision,
      draftId: staleDraftId,
      revisionId: staleRevisionId,
    };
    const staleBatch = db.batch();
    staleBatch.create(tenant.collection('clinicalDrafts').doc(staleDraftId), staleApprovedDraft);
    staleBatch.create(tenant.collection('clinicalDraftRevisions').doc(staleRevisionId), staleRevision);
    await staleBatch.commit();

    const afterSign = await Patient360ProjectionService.rebuildPatient(tenantId, patientId);
    expect(afterSign.contentHash).not.toBe(projection.contentHash);
    const timeline = await Patient360ProjectionService.getTimeline(tenantId, patientId);
    expect(timeline.some((row) => row.eventId === signed.eventId)).toBe(true);

    const staleClinicalEvidence = await issue('SignClinicalDraftCommand', {
      draftId: staleDraftId, expectedRevisionNumber: 1, signatureAttestation: true,
    });
    expect(staleClinicalEvidence.success).toBe(false);
    expect(staleClinicalEvidence.error?.code).toBe('CI10H_STALE_DRAFT_EVIDENCE');
    expect((await tenant.collection('clinicalDrafts').doc(staleDraftId).get()).data()?.status)
      .toBe('APPROVED_FOR_SIGNATURE');
    expect((await tenant.collection('clinicalDocuments').get()).size).toBe(1);
    expect((await tenant.collection('events')
      .where('eventType', '==', 'CLINICAL_DRAFT_SIGNED').get()).size).toBe(1);

    expect((await db.collection('tenants').doc(id('foreign'))
      .collection('clinicalDocuments').doc(documentId).get()).exists).toBe(false);
  });
});
