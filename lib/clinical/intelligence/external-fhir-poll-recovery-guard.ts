/**
 * G3 Stage E — pure, fail-closed DR / migration rehearsal guards.
 * This is NOT a migration API, clinical release, or production recovery signer.
 * An anchor signed by this LOCAL TEST key does not survive a rollback of its
 * independent storage: production must use a different trust domain + KMS.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PollWorkManifest } from './external-fhir-poll-manifest-seal';

export type StageERecoveryAnchor = Readonly<{
  schemaVersion: 1;
  kind: 'SYNTHETIC_OFFLINE_EXPORTED_RECOVERY_ANCHOR';
  tenantId: string; sourceId: string; facilityId: string;
  manifestId: string; sourceRevision: string; manifestRevision: string;
  epoch: number; issuedSequence: number; checkpointSequence: number;
  checkpointDigest: string; checkpointWorkId: string;
  checkpointEventId: string; receiptId: string;
  macHex: string;
}>;
export type StageEApproval = Readonly<{
  reviewerId: string;
  role: 'SECURITY_REVIEWER' | 'CLINICAL_REVIEWER';
  disposition: 'APPROVE';
  anchorFingerprint: string;
}>;
export type StageERecoveryEvidence = Readonly<{
  anchor: StageERecoveryAnchor;
  manifest: PollWorkManifest;
  sourceRevision: string;
  manifestRevision: string;
  source: Record<string, unknown> | null;
  sealed: Record<string, unknown> | null;
  lease: Record<string, unknown> | null;
  checkpointEvent: Record<string, unknown> | null;
  checkpointAudit: Record<string, unknown> | null;
  checkpointOutbox: Record<string, unknown> | null;
  receipt: Record<string, unknown> | null;
  head: Record<string, unknown> | null;
  importEvent: Record<string, unknown> | null;
  importAudit: Record<string, unknown> | null;
  importOutbox: Record<string, unknown> | null;
  availability: Record<string, unknown> | null;
  link: Record<string, unknown> | null;
  patient: Record<string, unknown> | null;
  reviews: readonly StageEApproval[];
}>;

const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REVISION = /^[1-9][0-9]{0,11}\.[0-9]{9}$/;
function fail(reason: string): never { throw new Error('FHIR_POLL_E_' + reason); }
function validPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function validNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function assertStageEEmulatorOnly(): void {
  if (process.env.NODE_ENV !== 'test' ||
      process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED') {
    fail('EMULATOR_ONLY');
  }
}
function anchorPayload(anchor: StageERecoveryAnchor): unknown[] {
  return ['HELIXIS_STAGE_E_RECOVERY_ANCHOR_V1', anchor.schemaVersion,
    anchor.kind, anchor.tenantId, anchor.sourceId, anchor.facilityId,
    anchor.manifestId, anchor.sourceRevision, anchor.manifestRevision,
    anchor.epoch, anchor.issuedSequence, anchor.checkpointSequence,
    anchor.checkpointDigest, anchor.checkpointWorkId,
    anchor.checkpointEventId, anchor.receiptId];
}
function validAnchor(a: StageERecoveryAnchor): void {
  if (!a || a.schemaVersion !== 1 ||
      a.kind !== 'SYNTHETIC_OFFLINE_EXPORTED_RECOVERY_ANCHOR' ||
      ![a.tenantId, a.facilityId, a.sourceId].every(x => typeof x === 'string' && ID.test(x) && x !== '..') ||
      !UUID.test(a.manifestId) || !REVISION.test(a.sourceRevision) ||
      !REVISION.test(a.manifestRevision) || !validPositive(a.epoch) ||
      !validPositive(a.issuedSequence) || !validPositive(a.checkpointSequence) ||
      a.issuedSequence < a.checkpointSequence || !HEX.test(a.checkpointDigest) ||
      !UUID.test(a.checkpointWorkId) || !/^fse_[a-f0-9]{64}$/.test(a.checkpointEventId) ||
      !/^fir_[a-f0-9]{64}$/.test(a.receiptId)) {
    fail('ANCHOR_INVALID');
  }
}
/** Emulator-only signer. Never obtain its key from cloud KMS or service credentials. */
export class EmulatorOnlyStageERecoverySigner {
  private readonly key: Buffer;
  constructor(key: Uint8Array) {
    assertStageEEmulatorOnly();
    if (key.byteLength !== 32) fail('ANCHOR_KEY_INVALID');
    this.key = Buffer.from(key);
  }
  private digest(anchor: StageERecoveryAnchor): string {
    assertStageEEmulatorOnly();
    validAnchor(anchor);
    return createHmac('sha256', this.key).update(JSON.stringify(anchorPayload(anchor))).digest('hex');
  }
  sign(anchor: Omit<StageERecoveryAnchor, 'macHex'>): StageERecoveryAnchor {
    const candidate = { ...anchor, macHex: '' } as StageERecoveryAnchor;
    return { ...candidate, macHex: this.digest(candidate) };
  }
  verify(anchor: StageERecoveryAnchor): void {
    const expected = this.digest(anchor);
    if (typeof anchor.macHex !== 'string' || !HEX.test(anchor.macHex) ||
        !timingSafeEqual(Buffer.from(anchor.macHex, 'hex'), Buffer.from(expected, 'hex'))) {
      fail('ANCHOR_SIGNATURE_INVALID');
    }
  }
}
export function stageEAnchorFingerprint(anchor: StageERecoveryAnchor): string {
  validAnchor(anchor);
  return createHash('sha256').update(JSON.stringify(anchorPayload(anchor))).digest('hex');
}
/**
 * A successful inspection is an *immutable, non-authoritative* rehearsal only.
 * No source syncMode may ever be changed from this decision.
 */
export function assertStageERecoveryEvidence(e: StageERecoveryEvidence): void {
  const a = e.anchor;
  validAnchor(a);
  const m = e.manifest;
  if (!m || !Array.isArray(m.items) || m.items.length < 1 ||
      m.items.length > 12 || !validNonnegative(m.startCheckpointSequence) ||
      !m.items.every(item => item && UUID.test(item.workId) &&
        typeof item.resourceId === 'string' && ID.test(item.resourceId) &&
        typeof item.expectedVersionId === 'string' && ID.test(item.expectedVersionId) &&
        ['Patient', 'Encounter', 'Observation'].includes(item.resourceType))) {
    fail('MANIFEST_PAYLOAD_INVALID');
  }
  if (m.items.length !== 1) fail('MULTI_ITEM_RECONCILIATION_NOT_QUALIFIED');
  const scope = [a.tenantId, a.sourceId, a.facilityId, a.manifestId, a.sourceRevision];
  if (JSON.stringify(scope) !== JSON.stringify([m.tenantId, m.sourceId, m.facilityId, m.manifestId, m.sourceRevision])) {
    fail('SCOPE_MISMATCH');
  }
  if (e.sourceRevision !== a.sourceRevision || e.manifestRevision !== a.manifestRevision) {
    fail('RESTORE_OR_DOCUMENT_REVISION_CHANGED');
  }
  if (!e.source || !e.sealed || !e.lease) fail('REQUIRED_EVIDENCE_MISSING');
  const s = e.source, md = e.sealed, lease = e.lease;
  if (s.tenantId !== a.tenantId || s.facilityId !== a.facilityId ||
      s.sourceId !== a.sourceId || s.status !== 'ACTIVE' ||
      s.securityReviewStatus !== 'APPROVED' || s.syncMode !== 'FENCED' ||
      s.syntheticOnly !== true || !Array.isArray(s.approvedResourceTypes) ||
      !s.approvedResourceTypes.includes(m.items[0].resourceType)) fail('SOURCE_NOT_SYNTHETIC_OR_APPROVED');
  if (md.tenantId !== a.tenantId || md.sourceId !== a.sourceId ||
      md.facilityId !== a.facilityId || md.manifestId !== a.manifestId ||
      md.sourceRevision !== a.sourceRevision || md.status !== 'SEALED' ||
      md.immutable !== true || md.clinicalAuthority !== false) fail('MANIFEST_NOT_AUTHENTIC');
  if (lease.tenantId !== a.tenantId || lease.sourceId !== a.sourceId ||
      lease.facilityId !== a.facilityId ||
      lease.epoch !== a.epoch || lease.issuedSequence !== a.issuedSequence ||
      lease.checkpointSequence !== a.checkpointSequence ||
      lease.checkpointDigest !== a.checkpointDigest ||
      lease.checkpointWorkId !== a.checkpointWorkId) {
    fail('STALE_RESTORED_OR_ADVANCED_LEASE');
  }
  // Even expired ACTIVE leases require an explicit new epoch/recovery operation;
  // a migration rehearsal must not pretend in-flight work has completed.
  if (lease.status !== 'RELEASED' || lease.expiresAtMs !== 0) fail('IN_FLIGHT_LEASE_UNRESOLVED');
  if (a.issuedSequence !== a.checkpointSequence ||
      a.checkpointSequence !== m.startCheckpointSequence + m.items.length ||
      a.checkpointSequence < 1 ||
      m.items[m.items.length - 1]?.workId !== a.checkpointWorkId) {
    fail('PARTIAL_OR_GAPPED_WORK_MANIFEST');
  }
  const lastItem = m.items[m.items.length - 1];
  const hash = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const expectedDigest = hash(['CI_EXT12_CHECKPOINT_V1', m.tenantId, m.sourceId,
    m.manifestId, m.startCheckpointSequence, m.items.length,
    lastItem.workId, lastItem.resourceType, lastItem.resourceId, lastItem.expectedVersionId]);
  const expectedReceiptId = 'fir_' + hash([m.sourceId, lastItem.resourceType,
    lastItem.resourceId, lastItem.expectedVersionId]);
  const expectedCheckpointEventId = 'fse_' + hash([m.tenantId, m.sourceId,
    a.epoch, 'CHECKPOINTED', a.checkpointSequence]);
  if (a.checkpointDigest !== expectedDigest || a.receiptId !== expectedReceiptId ||
      a.checkpointEventId !== expectedCheckpointEventId) fail('ANCHOR_CONTENT_INCONSISTENT');
  const cp = e.checkpointEvent, ca = e.checkpointAudit, co = e.checkpointOutbox;
  if (!cp || !ca || !co || cp.immutable !== true ||
      cp.eventType !== 'FHIR_SOURCE_POLL_CHECKPOINTED' ||
      cp.tenantId !== a.tenantId || cp.sourceId !== a.sourceId ||
      cp.facilityId !== a.facilityId || cp.manifestId !== a.manifestId ||
      cp.manifestRevision !== a.manifestRevision || cp.manifestSourceRevision !== a.sourceRevision ||
      cp.epoch !== a.epoch || cp.sequence !== a.checkpointSequence ||
      cp.workId !== a.checkpointWorkId || cp.receiptId !== a.receiptId ||
      cp.checkpointDigest !== a.checkpointDigest ||
      cp.eventId !== a.checkpointEventId ||
      ca.eventId !== a.checkpointEventId || ca.tenantId !== a.tenantId ||
      ca.sourceId !== a.sourceId || ca.immutable !== true ||
      ca.action !== 'FHIR_SOURCE_POLL_CHECKPOINTED' ||
      co.eventId !== a.checkpointEventId || co.tenantId !== a.tenantId ||
      co.sourceId !== a.sourceId || co.status !== 'HELD' ||
      co.destination !== 'CI_EXTERNAL_CONTEXT_QUALIFICATION') {
    fail('CHECKPOINT_CHAIN_UNVERIFIED');
  }
  const r = e.receipt, h = e.head, ie = e.importEvent, ia = e.importAudit, io = e.importOutbox;
  const last = m.items[m.items.length - 1];
  if (!r || !h || !ie || !ia || !io ||
      r.tenantId !== a.tenantId || r.sourceId !== a.sourceId || r.receiptId !== a.receiptId ||
      r.resourceType !== last.resourceType || r.resourceId !== last.resourceId ||
      r.sourceVersionId !== last.expectedVersionId || r.status !== 'CURRENT' ||
      r.immutable !== true || r.projectionAuthority !== 'UNVERIFIED_EXTERNAL_EVIDENCE' ||
      h.receiptId !== a.receiptId || h.patientId !== r.patientId ||
      h.tenantId !== a.tenantId || h.sourceId !== a.sourceId ||
      ie.receiptId !== a.receiptId || ie.tenantId !== a.tenantId ||
      ie.sourceId !== a.sourceId || ie.eventType !== 'EXTERNAL_FHIR_VERSION_IMPORTED' ||
      ie.resourceHash !== r.resourceHash ||
      ia.targetId !== a.receiptId || ia.tenantId !== a.tenantId ||
      ia.sourceId !== a.sourceId || ia.action !== 'EXTERNAL_FHIR_IMPORT' ||
      ia.resourceHash !== r.resourceHash || ia.immutable !== true ||
      io.receiptId !== a.receiptId || io.tenantId !== a.tenantId ||
      io.sourceId !== a.sourceId || io.resourceHash !== r.resourceHash ||
      io.status !== 'HELD' || io.destination !== 'CI_EXTERNAL_CONTEXT_QUALIFICATION') {
    fail('IMPORT_CHAIN_UNVERIFIED');
  }
  const link = e.link, patient = e.patient;
  const provenance = r.provenance as Record<string, unknown> | undefined;
  if (!link || !patient || !provenance ||
      link.tenantId !== a.tenantId || link.sourceId !== a.sourceId ||
      link.facilityId !== a.facilityId || link.patientId !== r.patientId ||
      link.matchStatus !== 'VERIFIED' || link.consentStatus !== 'GRANTED' ||
      patient.tenantId !== a.tenantId || patient.status !== 'ACTIVE' ||
      patient.mergedIntoPatientId ||
      typeof provenance.mappedByVerifiedLink !== 'string' ||
      provenance.mappedByVerifiedLink !== link._documentId) {
    // Firestore link document ID is checked by the transaction wrapper.
    fail('CONSENT_OR_PATIENT_LINEAGE_REVOKED');
  }
  const expectedHeadId = 'fhd_' + hash([a.sourceId, lastItem.resourceType, lastItem.resourceId]);
  if (e.availability && (e.availability.status !== 'AVAILABLE_CONFIRMED' ||
      e.availability.headId !== expectedHeadId ||
      e.availability.sourceReceiptId !== a.receiptId ||
      typeof e.availability.lastOperationSequence === 'number' &&
      e.availability.lastOperationSequence > a.issuedSequence)) {
    fail('AVAILABILITY_RECONCILIATION_UNRESOLVED');
  }
  if (!Array.isArray(e.reviews) || e.reviews.length !== 2 ||
      new Set(e.reviews.map(x => x.reviewerId)).size !== 2 ||
      new Set(e.reviews.map(x => x.role)).size !== 2 ||
      !e.reviews.every(x => typeof x.reviewerId === 'string' && ID.test(x.reviewerId) &&
        x.disposition === 'APPROVE' && x.anchorFingerprint === stageEAnchorFingerprint(a)) ||
      !e.reviews.some(x => x.role === 'SECURITY_REVIEWER') ||
      !e.reviews.some(x => x.role === 'CLINICAL_REVIEWER')) {
    fail('DUAL_REVIEW_UNVERIFIED');
  }
}
