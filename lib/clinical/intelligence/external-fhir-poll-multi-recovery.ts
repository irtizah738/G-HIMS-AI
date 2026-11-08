/**
 * G3 Stage F: bounded multi-page synthetic evidence recovery contract.
 * Fail closed. This is a local/emulator-only rehearsal, NOT hosted DR,
 * clinical release, source migration, or an externally hosted anchor service.
 * An HMAC held outside a *test* database detects rollback only while that
 * outside copy and key are retained independently. No PHI or vendor cursor
 * content is embedded in the signed anchor.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PollWorkManifest } from './external-fhir-poll-manifest-seal';

const REAL_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REV = /^[1-9][0-9]{0,11}\.[0-9]{9}$/;
const HEX = /^[a-f0-9]{64}$/;
const FSE = /^fse_[a-f0-9]{64}$/;
const FIR = /^fir_[a-f0-9]{64}$/;
export function assertStageFEmulatorOnly(): void {
  if (process.env.NODE_ENV !== 'test' || process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED') fail('EMULATOR_ONLY');
}
function sha(v: unknown): string { return createHash('sha256').update(JSON.stringify(v)).digest('hex'); }
function fail(s: string): never { throw new Error('FHIR_POLL_F_' + s); }
function pos(n: unknown): n is number { return Number.isSafeInteger(n) && (n as number) > 0; }
function nn(n: unknown): n is number { return Number.isSafeInteger(n) && (n as number) >= 0; }
function validManifest(m: PollWorkManifest): void {
  if (!m || !REAL_UUID.test(m.manifestId) || !nn(m.startCheckpointSequence) ||
      !Array.isArray(m.items) || !m.items.length || m.items.length>12 ||
      (m.vendorCursor!==null && (typeof m.vendorCursor!=='string' ||
        !m.vendorCursor || Buffer.byteLength(m.vendorCursor,'utf8')>4096)) ||
      m.items.some(w=>!w || !REAL_UUID.test(w.workId) || !ID.test(w.resourceId) ||
        !ID.test(w.expectedVersionId) ||
        !['Patient','Encounter','Observation'].includes(w.resourceType))) fail('MANIFEST_INVALID');
  if (new Set(m.items.map(w=>w.workId)).size!==m.items.length) fail('MANIFEST_WORK_DUPLICATE');
}
function rec(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export type StageFPageAnchor = Readonly<{
  manifestId: string; manifestRevision: string; startCheckpointSequence: number;
  itemCount: number;
}>;
export type StageFStepAnchor = Readonly<{
  manifestId: string; sequence: number; index: number; epoch: number;
  operationSequence: number; workId: string;
  reservationEventId: string; checkpointEventId: string;
  receiptId: string; checkpointDigest: string;
}>;
export type StageFAbandonedReservation = Readonly<{
  epoch: number; operationSequence: number; workId: string; reservationEventId: string;
}>;
export type StageFMultiAnchor = Readonly<{
  schemaVersion: 1;
  kind: 'SYNTHETIC_OFFLINE_EXPORTED_MULTI_PAGE_ANCHOR';
  tenantId: string; sourceId: string; facilityId: string; sourceRevision: string;
  startCheckpointSequence: number; endCheckpointSequence: number;
  issuedSequence: number; finalEpoch: number;
  pages: readonly StageFPageAnchor[];
  steps: readonly StageFStepAnchor[];
  abandonedReservations: readonly StageFAbandonedReservation[];
  macHex: string;
}>;
export type StageFReview = Readonly<{
  reviewerId: string;
  role: 'SECURITY_REVIEWER' | 'CLINICAL_REVIEWER';
  disposition: 'APPROVE';
  anchorFingerprint: string;
}>;
export type StageFStepEvidence = Readonly<{
  reservation: Record<string, unknown> | null;
  checkpoint: Record<string, unknown> | null;
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
}>;
export type StageFPageEvidence = Readonly<{
  manifest: PollWorkManifest;
  manifestRevision: string;
  sealed: Record<string, unknown> | null;
  manifestEvent: Record<string, unknown> | null;
  manifestAudit: Record<string, unknown> | null;
  manifestOutbox: Record<string, unknown> | null;
}>;
export type StageFMultiEvidence = Readonly<{
  anchor: StageFMultiAnchor;
  sourceRevision: string;
  source: Record<string, unknown> | null;
  lease: Record<string, unknown> | null;
  pages: readonly StageFPageEvidence[];
  steps: readonly StageFStepEvidence[];
  abandonedReservations: readonly (Record<string, unknown> | null)[];
  reviews: readonly StageFReview[];
}>;

/** Canonical JSON: deterministic across property insertion order. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',') + '}';
}
function anchorContent(a: StageFMultiAnchor): unknown {
  // Every signed field is explicitly listed, to eliminate accidental JSON
  // spread/undefined semantics when records evolve.
  return ['HELIXIS_STAGE_F_MULTI_RECOVERY_V1', a.schemaVersion, a.kind,
    a.tenantId, a.sourceId, a.facilityId, a.sourceRevision,
    a.startCheckpointSequence, a.endCheckpointSequence, a.issuedSequence,
    a.finalEpoch, a.pages, a.steps, a.abandonedReservations];
}
function validateAnchor(a: StageFMultiAnchor): void {
  if (!a || a.schemaVersion !== 1 || a.kind !== 'SYNTHETIC_OFFLINE_EXPORTED_MULTI_PAGE_ANCHOR' ||
      ![a.tenantId, a.sourceId, a.facilityId].every(v => typeof v === 'string' && ID.test(v) && v !== '..') ||
      !REV.test(a.sourceRevision) || !nn(a.startCheckpointSequence) ||
      !pos(a.endCheckpointSequence) || a.endCheckpointSequence <= a.startCheckpointSequence ||
      !pos(a.issuedSequence) || !pos(a.finalEpoch) ||
      !Array.isArray(a.pages) || a.pages.length < 2 || a.pages.length > 3 ||
      !Array.isArray(a.steps) || a.steps.length < 2 || a.steps.length > 12 ||
      !Array.isArray(a.abandonedReservations) || a.abandonedReservations.length > 12) {
    fail('ANCHOR_INVALID');
  }
  let cursor = a.startCheckpointSequence;
  const pageIds = new Set<string>();
  for (const page of a.pages) {
    if (!page || !REAL_UUID.test(page.manifestId) || pageIds.has(page.manifestId) ||
        !REV.test(page.manifestRevision) || !nn(page.startCheckpointSequence) ||
        !pos(page.itemCount) || page.itemCount > 12 ||
        cursor !== page.startCheckpointSequence) fail('PAGE_CHAIN_INVALID');
    pageIds.add(page.manifestId);
    cursor += page.itemCount;
  }
  if (cursor !== a.endCheckpointSequence || a.steps.length !== cursor - a.startCheckpointSequence) {
    fail('PAGE_SEQUENCE_GAP');
  }
  let lastOp = 0;
  let lastEpoch = 0;
  let pageIndex = 0;
  const workIds = new Set<string>();
  for (let i=0; i<a.steps.length; i++) {
    const step = a.steps[i];
    const sequence = a.startCheckpointSequence + i + 1;
    while (pageIndex+1 < a.pages.length &&
        sequence > a.pages[pageIndex].startCheckpointSequence + a.pages[pageIndex].itemCount) pageIndex++;
    const page = a.pages[pageIndex];
    if (!step || step.manifestId !== page.manifestId ||
        step.sequence !== sequence || step.index !== sequence - page.startCheckpointSequence - 1 ||
        !pos(step.epoch) || step.epoch < lastEpoch ||
        !pos(step.operationSequence) || step.operationSequence <= lastOp ||
        !REAL_UUID.test(step.workId) || workIds.has(step.workId) ||
        !FSE.test(step.reservationEventId) || !FSE.test(step.checkpointEventId) ||
        !FIR.test(step.receiptId) || !HEX.test(step.checkpointDigest)) fail('STEP_SEQUENCE_INVALID');
    workIds.add(step.workId);
    lastOp = step.operationSequence;
    lastEpoch = step.epoch;
  }
  if (a.finalEpoch !== lastEpoch || a.issuedSequence !== lastOp) fail('FINAL_WATERMARK_INVALID');
  const abandonedOps = new Set<number>();
  for (const skip of a.abandonedReservations) {
    if (!skip || !pos(skip.operationSequence) || skip.operationSequence > a.issuedSequence ||
        !pos(skip.epoch) || skip.epoch >= a.finalEpoch ||
        !REAL_UUID.test(skip.workId) || !FSE.test(skip.reservationEventId) ||
        abandonedOps.has(skip.operationSequence)) fail('ABANDONED_RESERVATION_INVALID');
    if (!a.steps.some(step => step.operationSequence > skip.operationSequence &&
        step.epoch > skip.epoch)) fail('ABANDONED_NOT_SUPERSEDED_BY_NEW_EPOCH');
    abandonedOps.add(skip.operationSequence);
  }
  // Every issued reservation in this bounded, fresh-source rehearsal must be
  // accounted for by a checkpoint or an abandoned prior-epoch reservation.
  const claimed = new Set(a.steps.map(s => s.operationSequence));
  for (let seq=1;seq<=a.issuedSequence;seq++) {
    if (seq>24) fail('ISSUED_WATERMARK_TOO_LARGE');
    if (claimed.has(seq) === abandonedOps.has(seq)) fail('RESERVATION_WATERMARK_GAP_OR_DUPLICATE');
  }
}

/** Emulator-only detached signer. Anchor/key must be exported outside Firestore. */
export class EmulatorOnlyStageFRecoverySigner {
  private readonly key: Buffer;
  constructor(key: Uint8Array) {
    assertStageFEmulatorOnly();
    if (key.byteLength !== 32) fail('KEY_INVALID');
    this.key = Buffer.from(key);
  }
  sign(draft: Omit<StageFMultiAnchor, 'macHex'>): StageFMultiAnchor {
    assertStageFEmulatorOnly();
    const candidate = {...draft, macHex: ''} as StageFMultiAnchor;
    validateAnchor(candidate);
    return {...candidate, macHex: this.mac(candidate)};
  }
  private mac(a: StageFMultiAnchor): string {
    return createHmac('sha256', this.key).update(canonical(anchorContent(a))).digest('hex');
  }
  verify(a: StageFMultiAnchor): void {
    assertStageFEmulatorOnly();
    validateAnchor(a);
    const computed = this.mac(a);
    if (typeof a.macHex !== 'string' || !HEX.test(a.macHex) ||
        !timingSafeEqual(Buffer.from(a.macHex, 'hex'), Buffer.from(computed, 'hex'))) {
      fail('SIGNATURE_INVALID');
    }
  }
}
export function stageFAnchorFingerprint(a: StageFMultiAnchor): string {
  validateAnchor(a);
  return createHash('sha256').update(canonical(anchorContent(a))).digest('hex');
}
export function stageFReservationId(
  tenantId: string, sourceId: string, epoch: number, operationSequence: number,
): string { return 'fse_' + sha([tenantId,sourceId,epoch,'RESERVED',operationSequence]); }
export function stageFCheckpointId(
  tenantId: string, sourceId: string, epoch: number, sequence: number,
): string { return 'fse_' + sha([tenantId,sourceId,epoch,'CHECKPOINTED',sequence]); }
export function stageFCheckpointDigest(m: PollWorkManifest, index: number): string {
  const w=m.items[index];
  if (!w) fail('ITEM_OUTSIDE_MANIFEST');
  return sha(['CI_EXT12_CHECKPOINT_V1',m.tenantId,m.sourceId,m.manifestId,
    m.startCheckpointSequence,index+1,w.workId,w.resourceType,w.resourceId,w.expectedVersionId]);
}
export function stageFReceiptId(m: PollWorkManifest, index: number): string {
  const w=m.items[index];
  if (!w) fail('ITEM_OUTSIDE_MANIFEST');
  return 'fir_' + sha([m.sourceId,w.resourceType,w.resourceId,w.expectedVersionId]);
}
function requireReservation(r: Record<string,unknown>|null, a: StageFMultiAnchor,
  op: StageFStepAnchor|StageFAbandonedReservation): void {
  if (!r || r.eventType !== 'FHIR_SOURCE_POLL_RESERVED' || r.immutable !== true ||
      r.tenantId !== a.tenantId || r.sourceId !== a.sourceId ||
      r.epoch !== op.epoch || r.sequence !== op.operationSequence ||
      r.workId !== op.workId ||
      r.eventId !== op.reservationEventId ||
      op.reservationEventId !== stageFReservationId(a.tenantId,a.sourceId,op.epoch,op.operationSequence)) {
    fail('RESERVATION_EVIDENCE_INVALID');
  }
}
export function assertStageFMultiRecoveryEvidence(e: StageFMultiEvidence): void {
  const a=e.anchor;
  validateAnchor(a);
  if (e.pages.length !== a.pages.length || e.steps.length !== a.steps.length ||
      e.abandonedReservations.length !== a.abandonedReservations.length) fail('EVIDENCE_CARDINALITY_INVALID');
  const s=e.source;
  if (e.sourceRevision !== a.sourceRevision || !s ||
      s.tenantId !== a.tenantId || s.sourceId !== a.sourceId || s.facilityId !== a.facilityId ||
      s.status !== 'ACTIVE' || s.securityReviewStatus !== 'APPROVED' ||
      s.syncMode !== 'FENCED' || s.syntheticOnly !== true ||
      !Array.isArray(s.approvedResourceTypes)) fail('SOURCE_CHANGED_OR_UNAUTHORIZED');
  const l=e.lease;
  const last=a.steps[a.steps.length-1];
  if (!l || l.tenantId !== a.tenantId || l.sourceId !== a.sourceId ||
      l.facilityId !== a.facilityId || l.status !== 'RELEASED' ||
      l.expiresAtMs !== 0 || l.epoch !== a.finalEpoch ||
      l.issuedSequence !== a.issuedSequence ||
      l.checkpointSequence !== a.endCheckpointSequence ||
      l.checkpointDigest !== last.checkpointDigest ||
      l.checkpointWorkId !== last.workId) fail('RESTORED_OR_INFLIGHT_LEASE_INVALID');
  const seenResourceKeys=new Set<string>();
  for (let p=0; p<a.pages.length; p++) {
    const anchorPage=a.pages[p];
    const evidence=e.pages[p];
    const m=evidence.manifest;
    validManifest(m);
    if (m.manifestId !== anchorPage.manifestId || m.tenantId !== a.tenantId ||
        m.sourceId !== a.sourceId || m.facilityId !== a.facilityId ||
        m.sourceRevision !== a.sourceRevision ||
        m.startCheckpointSequence !== anchorPage.startCheckpointSequence ||
        m.items.length !== anchorPage.itemCount ||
        evidence.manifestRevision !== anchorPage.manifestRevision ||
        !evidence.sealed || evidence.sealed.status !== 'SEALED' ||
        evidence.sealed.immutable !== true || evidence.sealed.clinicalAuthority !== false ||
        evidence.sealed.sourceRevision !== a.sourceRevision ||
        evidence.sealed.tenantId !== a.tenantId || evidence.sealed.sourceId !== a.sourceId ||
        evidence.sealed.facilityId !== a.facilityId ||
        evidence.sealed.manifestId !== m.manifestId) fail('PAGE_REVISION_OR_PAYLOAD_INVALID');
    const me=evidence.manifestEvent,ma=evidence.manifestAudit,mo=evidence.manifestOutbox;
    const expectedEvent='fpme_'+m.manifestId;
    if (!me || !ma || !mo ||
        me.eventId!==expectedEvent || me.eventType!=='FHIR_POLL_MANIFEST_SEALED' ||
        me.tenantId!==a.tenantId || me.sourceId!==a.sourceId ||
        me.manifestId!==m.manifestId || me.sourceRevision!==a.sourceRevision ||
        me.immutable!==true || ma.eventId!==expectedEvent ||
        ma.tenantId!==a.tenantId || ma.sourceId!==a.sourceId ||
        ma.action!=='FHIR_POLL_MANIFEST_SEALED' || ma.immutable!==true ||
        mo.eventId!==expectedEvent || mo.tenantId!==a.tenantId ||
        mo.sourceId!==a.sourceId || mo.status!=='HELD' ||
        mo.destination!=='CI_EXTERNAL_CONTEXT_QUALIFICATION') fail('MANIFEST_EVIDENCE_INCOMPLETE');
    for (const item of m.items) {
      const key=JSON.stringify([item.resourceType,item.resourceId]);
      if (seenResourceKeys.has(key)) fail('DUPLICATE_RESOURCE_HEAD_ACROSS_PAGES');
      seenResourceKeys.add(key);
      if (!(s.approvedResourceTypes as string[]).includes(item.resourceType)) fail('RESOURCE_SCOPE_REVOKED');
    }
  }
  for (let i=0;i<a.abandonedReservations.length;i++) {
    requireReservation(e.abandonedReservations[i],a,a.abandonedReservations[i]);
  }
  for (let i=0;i<a.steps.length;i++) {
    const x=a.steps[i]; const ev=e.steps[i];
    const page=e.pages.find(p=>p.manifest.manifestId===x.manifestId);
    if (!page) fail('STEP_UNBOUND_FROM_PAGE');
    const m=page.manifest;
    const item=m.items[x.index];
    if (!item || item.workId!==x.workId || x.sequence!==m.startCheckpointSequence+x.index+1 ||
        x.receiptId!==stageFReceiptId(m,x.index) ||
        x.checkpointDigest!==stageFCheckpointDigest(m,x.index) ||
        x.checkpointEventId!==stageFCheckpointId(a.tenantId,a.sourceId,x.epoch,x.sequence)) fail('STEP_DIGEST_OR_LINEAGE_INVALID');
    requireReservation(ev.reservation,a,x);
    const cp=ev.checkpoint, ca=ev.checkpointAudit, co=ev.checkpointOutbox;
    if (!cp || !ca || !co || cp.eventType!=='FHIR_SOURCE_POLL_CHECKPOINTED' ||
        cp.immutable!==true || cp.clinicalAuthority!==false ||
        cp.eventId!==x.checkpointEventId || cp.tenantId!==a.tenantId ||
        cp.sourceId!==a.sourceId || cp.facilityId!==a.facilityId ||
        cp.manifestId!==x.manifestId || cp.manifestRevision!==page.manifestRevision ||
        cp.manifestSourceRevision!==a.sourceRevision ||
        cp.sequence!==x.sequence || cp.operationSequence!==x.operationSequence ||
        cp.epoch!==x.epoch || cp.workId!==x.workId ||
        cp.checkpointDigest!==x.checkpointDigest || cp.receiptId!==x.receiptId ||
        ca.eventId!==x.checkpointEventId || ca.tenantId!==a.tenantId ||
        ca.sourceId!==a.sourceId || ca.immutable!==true ||
        ca.action!=='FHIR_SOURCE_POLL_CHECKPOINTED' ||
        co.eventId!==x.checkpointEventId || co.tenantId!==a.tenantId ||
        co.sourceId!==a.sourceId || co.status!=='HELD' ||
        co.destination!=='CI_EXTERNAL_CONTEXT_QUALIFICATION') fail('CHECKPOINT_CHAIN_INVALID');
    const r=ev.receipt, head=ev.head, ie=ev.importEvent, ia=ev.importAudit, io=ev.importOutbox;
    if (!r || !head || !ie || !ia || !io ||
        r.tenantId!==a.tenantId || r.sourceId!==a.sourceId ||
        r.resourceType!==item.resourceType || r.resourceId!==item.resourceId ||
        r.sourceVersionId!==item.expectedVersionId || r.receiptId!==x.receiptId ||
        r.status!=='CURRENT' || r.immutable!==true ||
        r.projectionAuthority!=='UNVERIFIED_EXTERNAL_EVIDENCE' ||
        typeof r.resourceHash!=='string' || !HEX.test(r.resourceHash) ||
        typeof r.resourceJson!=='string' || Buffer.byteLength(r.resourceJson,'utf8')>120000 ||
        createHash('sha256').update(r.resourceJson,'utf8').digest('hex')!==r.resourceHash ||
        head.tenantId!==a.tenantId || head.sourceId!==a.sourceId ||
        head.receiptId!==x.receiptId || head.patientId!==r.patientId ||
        head.resourceType!==item.resourceType || head.resourceId!==item.resourceId ||
        head.sourceVersionId!==item.expectedVersionId ||
        ie.tenantId!==a.tenantId || ie.sourceId!==a.sourceId ||
        ie.receiptId!==x.receiptId || ie.eventType!=='EXTERNAL_FHIR_VERSION_IMPORTED' ||
        ie.resourceHash!==r.resourceHash || ie.patientId!==r.patientId ||
        ia.tenantId!==a.tenantId || ia.sourceId!==a.sourceId ||
        ia.targetId!==x.receiptId || ia.action!=='EXTERNAL_FHIR_IMPORT' ||
        ia.resourceHash!==r.resourceHash || ia.result!=='CURRENT' || ia.immutable!==true ||
        io.tenantId!==a.tenantId || io.sourceId!==a.sourceId ||
        io.receiptId!==x.receiptId || io.resourceHash!==r.resourceHash ||
        io.status!=='HELD' || io.destination!=='CI_EXTERNAL_CONTEXT_QUALIFICATION') fail('IMPORT_EVIDENCE_INVALID');
    let body:unknown;
    try { body=JSON.parse(r.resourceJson as string); } catch { fail('RESOURCE_JSON_INVALID'); }
    const resource=rec(body)?body:null;
    const meta=resource&&rec(resource.meta)?resource.meta:null;
    if (!resource || resource.resourceType!==item.resourceType || resource.id!==item.resourceId ||
        !meta || meta.versionId!==item.expectedVersionId) fail('RESOURCE_JSON_IDENTITY_INVALID');
    const link=ev.link,patient=ev.patient;
    const provenance=rec(r.provenance)?r.provenance:null;
    const subject=resource.resourceType==='Patient'?`Patient/${resource.id}`:
      rec(resource.subject)?resource.subject.reference:null;
    if (!link || !patient || !provenance ||
        link.tenantId!==a.tenantId || link.sourceId!==a.sourceId ||
        link.facilityId!==a.facilityId || link.patientId!==r.patientId ||
        link.matchStatus!=='VERIFIED' || link.consentStatus!=='GRANTED' ||
        typeof link.externalPatientId!=='string' ||
        subject!==`Patient/${link.externalPatientId}` ||
        provenance.mappedByVerifiedLink!==link._documentId ||
        provenance.contentSha256!==r.resourceHash ||
        provenance.sourceId!==a.sourceId ||
        provenance.sourceFacilityId!==a.facilityId ||
        provenance.sourceResourceType!==item.resourceType ||
        provenance.sourceResourceId!==item.resourceId ||
        provenance.sourceVersionId!==item.expectedVersionId ||
        patient.tenantId!==a.tenantId || patient.status!=='ACTIVE' ||
        patient.mergedIntoPatientId) fail('CONSENT_OR_PATIENT_LINEAGE_INVALID');
    if (ev.availability && (ev.availability.status!=='AVAILABLE_CONFIRMED' ||
        ev.availability.sourceReceiptId!==x.receiptId ||
        ev.availability.headId!=='fhd_'+sha([a.sourceId,item.resourceType,item.resourceId]) ||
        typeof ev.availability.lastOperationSequence==='number' &&
        ev.availability.lastOperationSequence>x.operationSequence)) fail('AVAILABILITY_UNRESOLVED');
  }
  const reviews=e.reviews;
  const fp=stageFAnchorFingerprint(a);
  if (!Array.isArray(reviews) || reviews.length!==2 ||
      new Set(reviews.map(x=>x.reviewerId)).size!==2 ||
      new Set(reviews.map(x=>x.role)).size!==2 ||
      !reviews.some(x=>x.role==='SECURITY_REVIEWER') ||
      !reviews.some(x=>x.role==='CLINICAL_REVIEWER') ||
      !reviews.every(x=>x.disposition==='APPROVE' &&
        typeof x.reviewerId==='string' && ID.test(x.reviewerId) &&
        x.anchorFingerprint===fp)) fail('REVIEW_NOT_INDEPENDENT');
}
