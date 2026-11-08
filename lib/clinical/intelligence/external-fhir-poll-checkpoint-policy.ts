/**
 * G3 Stage D: pure fail-closed checkpoint assertions. Not a clinical authority.
 * These assertions run over documents read in ONE Firestore transaction by the
 * persisted synthetic checkpoint writer. They never use a worker clock.
 */
export type StageDCheckpointEvidence = Readonly<{
  expected: {
    tenantId: string; sourceId: string; facilityId: string;
    manifestId: string; sourceRevision: string; manifestRevision: string;
    epoch: number; workerId: string; claimId: string;
    operationSequence: number; sequence: number; previousSequence: number;
    workId: string; resourceType: string; resourceId: string;
    expectedVersionId: string; receiptId: string; headId: string;
  };
  sourceRevision: string | null;
  manifestRevision: string | null;
  source: Record<string, unknown> | null;
  manifest: Record<string, unknown> | null;
  lease: Record<string, unknown> | null;
  operation: Record<string, unknown> | null;
  receipt: Record<string, unknown> | null;
  head: Record<string, unknown> | null;
  importEvent: Record<string, unknown> | null;
  importAudit: Record<string, unknown> | null;
  importOutbox: Record<string, unknown> | null;
  availability: Record<string, unknown> | null;
  patientLink: Record<string, unknown> | null;
  patient: Record<string, unknown> | null;
  nowServerMs: number;
}>;

/** Throws rather than accepting a missing, stale or ambiguous evidence record. */
export function assertStageDCheckpointEvidence(e: StageDCheckpointEvidence): void {
  const x = e.expected;
  if (!e.source || !e.manifest || !e.lease || !e.operation || !e.receipt ||
      !e.head || !e.importEvent || !e.importAudit || !e.importOutbox ||
      !e.patientLink || !e.patient ||
      !Number.isSafeInteger(e.nowServerMs) || e.nowServerMs < 1 ||
      !Number.isSafeInteger(x.sequence) || x.sequence < 1 ||
      x.sequence !== x.previousSequence + 1 ||
      !Number.isSafeInteger(x.operationSequence) || x.operationSequence < 1) {
    throw new Error('FHIR_POLL_D_CHECKPOINT_EVIDENCE_MISSING');
  }
  const s = e.source;
  if (e.sourceRevision !== x.sourceRevision ||
      s.tenantId !== x.tenantId || s.sourceId !== x.sourceId ||
      s.facilityId !== x.facilityId || s.status !== 'ACTIVE' ||
      s.securityReviewStatus !== 'APPROVED' || s.syncMode !== 'FENCED' ||
      s.syntheticOnly !== true || !Array.isArray(s.approvedResourceTypes) ||
      !s.approvedResourceTypes.includes(x.resourceType)) {
    throw new Error('FHIR_POLL_D_SOURCE_REVOKED_OR_REVISED');
  }
  const m = e.manifest;
  if (e.manifestRevision !== x.manifestRevision ||
      m.manifestId !== x.manifestId || m.sourceId !== x.sourceId ||
      m.facilityId !== x.facilityId || m.tenantId !== x.tenantId ||
      m.sourceRevision !== x.sourceRevision || m.immutable !== true ||
      m.status !== 'SEALED' || m.clinicalAuthority !== false) {
    throw new Error('FHIR_POLL_D_MANIFEST_REVISED');
  }
  const l = e.lease;
  if (l.tenantId !== x.tenantId || l.sourceId !== x.sourceId ||
      l.facilityId !== x.facilityId || l.status !== 'ACTIVE' ||
      l.workerId !== x.workerId || l.claimId !== x.claimId ||
      l.epoch !== x.epoch ||
      typeof l.expiresAtMs !== 'number' || l.expiresAtMs <= e.nowServerMs ||
      l.checkpointSequence !== x.previousSequence ||
      typeof l.issuedSequence !== 'number' ||
      l.issuedSequence < x.operationSequence) {
    throw new Error('FHIR_POLL_D_LEASE_STALE_OR_CHECKPOINT_RACE');
  }
  const op = e.operation;
  if (op.eventType !== 'FHIR_SOURCE_POLL_RESERVED' || op.immutable !== true ||
      op.tenantId !== x.tenantId || op.sourceId !== x.sourceId ||
      op.epoch !== x.epoch || op.sequence !== x.operationSequence ||
      op.workId !== x.workId) {
    throw new Error('FHIR_POLL_D_RESERVATION_NOT_BOUND_TO_WORK');
  }
  const r = e.receipt;
  if (r.tenantId !== x.tenantId || r.sourceId !== x.sourceId ||
      r.resourceType !== x.resourceType || r.resourceId !== x.resourceId ||
      r.sourceVersionId !== x.expectedVersionId || r.receiptId !== x.receiptId ||
      r.status !== 'CURRENT' || r.immutable !== true ||
      r.projectionAuthority !== 'UNVERIFIED_EXTERNAL_EVIDENCE' ||
      typeof r.patientId !== 'string' || !r.patientId ||
      !r.provenance || typeof r.provenance !== 'object') {
    throw new Error('FHIR_POLL_D_IMPORTED_RECEIPT_INVALID');
  }
  if (e.head.receiptId !== x.receiptId ||
      e.head.sourceId !== x.sourceId || e.head.tenantId !== x.tenantId ||
      e.head.patientId !== r.patientId ||
      e.head.resourceType !== x.resourceType || e.head.resourceId !== x.resourceId ||
      e.head.sourceVersionId !== x.expectedVersionId) {
    throw new Error('FHIR_POLL_D_CURRENT_HEAD_CHANGED');
  }
  const provenance = r.provenance as Record<string, unknown>;
  const link = e.patientLink;
  if (!provenance.mappedByVerifiedLink ||
      link.sourceId !== x.sourceId || link.tenantId !== x.tenantId ||
      link.facilityId !== x.facilityId || link.patientId !== r.patientId ||
      link.matchStatus !== 'VERIFIED' || link.consentStatus !== 'GRANTED' ||
      e.patient.tenantId !== x.tenantId || e.patient.status !== 'ACTIVE' ||
      e.patient.mergedIntoPatientId) {
    throw new Error('FHIR_POLL_D_PATIENT_LINK_OR_CONSENT_REVOKED');
  }
  const event = e.importEvent;
  const audit = e.importAudit;
  const outbox = e.importOutbox;
  if (event.eventType !== 'EXTERNAL_FHIR_VERSION_IMPORTED' ||
      event.receiptId !== x.receiptId || event.resourceHash !== r.resourceHash ||
      event.patientId !== r.patientId ||
      audit.action !== 'EXTERNAL_FHIR_IMPORT' ||
      audit.targetId !== x.receiptId || audit.resourceHash !== r.resourceHash ||
      audit.immutable !== true || audit.result !== 'CURRENT' ||
      outbox.receiptId !== x.receiptId || outbox.resourceHash !== r.resourceHash ||
      outbox.status !== 'HELD' ||
      outbox.destination !== 'CI_EXTERNAL_CONTEXT_QUALIFICATION') {
    throw new Error('FHIR_POLL_D_IMMUTABLE_EVIDENCE_INCOMPLETE');
  }
  // First positive read may produce no availability document. That is only
  // acceptable after verified immutable import+head+audit+outbox evidence.
  // Any existing availability state must corroborate the exact current head.
  if (e.availability && (e.availability.status !== 'AVAILABLE_CONFIRMED' ||
      e.availability.sourceReceiptId !== x.receiptId ||
      e.availability.headId !== x.headId ||
      typeof e.availability.lastOperationSequence === 'number' &&
      e.availability.lastOperationSequence > x.operationSequence)) {
    throw new Error('FHIR_POLL_D_AVAILABILITY_FENCE_UNRESOLVED');
  }
}
