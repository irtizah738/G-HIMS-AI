/**
 * Stage E — a non-mutating SYNTHETIC FENCED migration + recovery rehearsal.
 * The only writes are append-only rehearsal evidence, audit and HELD outbox.
 * No FHIR source registration, lease, checkpoint, manifest or patient is mutated.
 * This is not a production recovery, migration, key manager or clinical release.
 */
import { createHash } from 'node:crypto';
import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';
import { openPollWorkManifest, type ManifestCipher, type SealedPollManifest } from './external-fhir-poll-manifest-seal';
import { assertStageEEmulatorOnly, assertStageERecoveryEvidence,
  stageEAnchorFingerprint, type StageERecoveryAnchor, type StageEApproval,
  type EmulatorOnlyStageERecoverySigner } from './external-fhir-poll-recovery-guard';
import { fhirImportHeadId, fhirPatientLinkId } from './external-fhir-import';
import type { FhirImportActor } from './external-fhir-import';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
function sha(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function rev(snap: DocumentSnapshot): string {
  if (!snap.exists || !snap.updateTime || !Number.isSafeInteger(snap.updateTime.seconds) ||
      !Number.isSafeInteger(snap.updateTime.nanoseconds)) throw new Error('FHIR_POLL_E_REVISION_UNAVAILABLE');
  return `${snap.updateTime.seconds}.${String(snap.updateTime.nanoseconds).padStart(9,'0')}`;
}
export async function rehearseSyntheticFencedMigration(args: {
  db: Firestore;
  actor: FhirImportActor;
  sourceId: string;
  manifestId: string;
  rehearsalId: string;
  cipher: ManifestCipher;
  recoverySigner: EmulatorOnlyStageERecoverySigner;
  anchor: StageERecoveryAnchor;
  reviews: readonly StageEApproval[];
  /** Synthetic crash injection, aborts whole Firestore transaction before any write. */
  afterValidationBeforeCommit?: () => Promise<void>;
}): Promise<{status: 'REHEARSAL_ONLY'; evidenceFingerprint: string; replay: boolean}> {
  assertStageEEmulatorOnly();
  const {actor, anchor: a} = args;
  if (!actor || !ID.test(actor.tenantId) || !ID.test(actor.actorId) ||
      !actor.permissions.includes('FHIR_IMPORT') ||
      !actor.permissions.includes('FHIR_POLL_COORDINATE') ||
      !actor.permissions.includes('FHIR_MIGRATION_REHEARSE') ||
      !actor.facilityIds.includes(a.facilityId) ||
      args.sourceId !== a.sourceId || args.manifestId !== a.manifestId ||
      a.tenantId !== actor.tenantId || !UUID.test(args.rehearsalId) ||
      !Array.isArray(args.reviews) || args.reviews.some(r => r.reviewerId === actor.actorId)) {
    throw new Error('FHIR_POLL_E_ACTOR_OR_SCOPE_DENIED');
  }
  args.recoverySigner.verify(a);
  // This is only a *synthetic* two-reviewer shape check, NOT real IAM or MFA.
  const anchorFingerprint = stageEAnchorFingerprint(a);
  const normalizedReviews = [...args.reviews].sort((x,y)=>x.role.localeCompare(y.role));
  const evidenceFingerprint = sha(['STAGE_E_REHEARSAL_V1', anchorFingerprint,
    args.rehearsalId, actor.actorId, normalizedReviews]);
  const root = args.db.collection('tenants').doc(a.tenantId);
  const r = {
    source: root.collection('fhirSources').doc(a.sourceId),
    sealed: root.collection('fhirPollWorkManifests').doc(a.manifestId),
    lease: root.collection('fhirSourcePollLeases').doc(a.sourceId),
    cp: root.collection('fhirSourcePollEvents').doc(a.checkpointEventId),
    cpAudit: root.collection('auditLogs').doc('fau_' + a.checkpointEventId),
    cpOutbox: root.collection('fhirSourcePollOutbox').doc('fso_' + a.checkpointEventId),
    receipt: root.collection('fhirImportedVersions').doc(a.receiptId),
    importEvent: root.collection('fhirImportEvents').doc('fev_' + a.receiptId.slice(4)),
    importAudit: root.collection('auditLogs').doc('fau_' + a.receiptId.slice(4)),
    importOutbox: root.collection('fhirImportOutbox').doc('fob_' + a.receiptId.slice(4)),
    rehearsal: root.collection('fhirPollMigrationRehearsals').doc(args.rehearsalId),
  };
  const eventId = 'fme_' + sha([a.tenantId, a.sourceId, args.rehearsalId]);
  const eventRef = root.collection('fhirPollMigrationEvents').doc(eventId);
  const auditRef = root.collection('auditLogs').doc('fau_' + eventId);
  const outboxRef = root.collection('fhirPollMigrationOutbox').doc('fmo_' + eventId);
  return args.db.runTransaction(async tx => {
    const [source, sealed, lease, cp, cpAudit, cpOutbox,
      receipt, importEvent, importAudit, importOutbox,
      rehearsal, existingEvent, existingAudit, existingOutbox] = await tx.getAll(
      r.source, r.sealed, r.lease, r.cp, r.cpAudit, r.cpOutbox,
      r.receipt, r.importEvent, r.importAudit, r.importOutbox,
      r.rehearsal, eventRef, auditRef, outboxRef,
    );
    if (!source.exists || !sealed.exists || !lease.exists || !receipt.exists) {
      throw new Error('FHIR_POLL_E_REQUIRED_SNAPSHOT_MISSING');
    }
    const manifest = openPollWorkManifest(sealed.data() as SealedPollManifest,
      args.cipher, a);
    if (manifest.items.length !== 1) {
      throw new Error('FHIR_POLL_E_MULTI_ITEM_RECONCILIATION_NOT_QUALIFIED');
    }
    const item = manifest.items[0];
    const headId = fhirImportHeadId(a.sourceId, item.resourceType, item.resourceId);
    const [head, availability] = await tx.getAll(
      root.collection('fhirResourceHeads').doc(headId),
      root.collection('fhirAvailabilityStates').doc(headId),
    );
    const linkId = (receipt.get('provenance') as {mappedByVerifiedLink?: string} | undefined)?.mappedByVerifiedLink;
    const patientId = receipt.get('patientId');
    if (typeof linkId !== 'string' || !/^fpl_[a-f0-9]{64}$/.test(linkId) ||
        typeof patientId !== 'string' || !ID.test(patientId)) {
      throw new Error('FHIR_POLL_E_PATIENT_LINK_UNKNOWN');
    }
    const [link, patient] = await tx.getAll(
      root.collection('fhirPatientLinks').doc(linkId),
      root.collection('patients').doc(patientId),
    );
    if (!link.exists || typeof link.get('externalPatientId') !== 'string' ||
        fhirPatientLinkId(a.sourceId, link.get('externalPatientId')) !== linkId) {
      throw new Error('FHIR_POLL_E_PATIENT_LINK_DERIVATION_INVALID');
    }
    // The pure validator never treats an HTTP status or caller-provided PASS
    // label as sufficient evidence of a recoverable checkpoint.
    assertStageERecoveryEvidence({
      anchor: a, manifest, sourceRevision: rev(source), manifestRevision: rev(sealed),
      source: source.data() || null, sealed: sealed.data() || null,
      lease: lease.data() || null,
      checkpointEvent: cp.data() || null,
      checkpointAudit: cpAudit.data() || null,
      checkpointOutbox: cpOutbox.data() || null,
      receipt: receipt.data() || null, head: head.data() || null,
      importEvent: importEvent.data() || null,
      importAudit: importAudit.data() || null,
      importOutbox: importOutbox.data() || null,
      availability: availability.data() || null,
      link: link.exists ? { ...link.data(), _documentId: link.id } : null,
      patient: patient.data() || null, reviews: normalizedReviews,
    });
    await args.afterValidationBeforeCommit?.();
    if (rehearsal.exists || existingEvent.exists || existingAudit.exists || existingOutbox.exists) {
      if (!rehearsal.exists || !existingEvent.exists || !existingAudit.exists || !existingOutbox.exists ||
          rehearsal.get('evidenceFingerprint') !== evidenceFingerprint ||
          existingEvent.get('evidenceFingerprint') !== evidenceFingerprint ||
          existingAudit.get('evidenceFingerprint') !== evidenceFingerprint ||
          existingOutbox.get('evidenceFingerprint') !== evidenceFingerprint ||
          existingOutbox.get('status') !== 'HELD') {
        throw new Error('FHIR_POLL_E_REHEARSAL_REPLAY_CONFLICT');
      }
      return {status: 'REHEARSAL_ONLY' as const, evidenceFingerprint, replay: true};
    }
    const common = {
      schemaVersion: 1, tenantId: a.tenantId, sourceId: a.sourceId,
      facilityId: a.facilityId, manifestId: a.manifestId,
      rehearsalId: args.rehearsalId,
      anchorFingerprint, evidenceFingerprint,
      checkpointSequence: a.checkpointSequence, epoch: a.epoch,
      sourceRevision: a.sourceRevision, manifestRevision: a.manifestRevision,
      clinicalAuthority: false, immutable: true,
      dryRunOnly: true, productionAuthorization: 'NO_GO',
    };
    tx.create(r.rehearsal, {
      ...common, status: 'RECORDED_REHEARSAL_ONLY',
      reviewerIds: normalizedReviews.map(review => review.reviewerId),
    });
    tx.create(eventRef, {
      ...common, eventId, eventType: 'FHIR_SYNTHETIC_MIGRATION_REHEARSED',
    });
    tx.create(auditRef, {
      ...common, eventId, actorId: actor.actorId,
      action: 'FHIR_SYNTHETIC_MIGRATION_REHEARSED',
    });
    tx.create(outboxRef, {
      ...common, eventId, status: 'HELD',
      destination: 'CI_EXTERNAL_CONTEXT_QUALIFICATION',
    });
    return {status: 'REHEARSAL_ONLY' as const, evidenceFingerprint, replay: false};
  });
}
