/**
 * CI-EXT-10 — Bounded FHIR R4 instance-history qualification.
 *
 * This boundary accepts a server-obtained FHIR history Bundle, never browser
 * history claims. It records only normalized version metadata, not PHI.
 * An opaque versionId is never treated as a sequential number. History
 * pagination, deletion and incomplete anchors cannot authorize clinical use.
 *
 * Admin SDK only. No HTTP within a Firestore transaction.
 */
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { assertSourcePollFenceInTransaction, type FhirSourcePollOperationFence } from './external-fhir-sync-coordinator';
import {
  assertFhirIdentifier, assertFhirSource, fhirImportHeadId, fhirPatientLinkId,
  type ExternalFhirImportType, type FhirImportActor, type FhirPatientLink,
  type FhirSourceRecord,
} from './external-fhir-import';
import {
  siteApprovalDocId, validateFhirSiteApproval, type FhirSiteApproval,
} from '@/lib/interop/fhir-site-approval';

export type FhirHistoryStatus = 'WINDOW_ANCHORED' | 'REVIEW_REQUIRED';
export type FhirHistoryReason =
  | 'HISTORY_WINDOW_EMPTY'
  | 'HEAD_VERSION_NOT_LATEST'
  | 'HEAD_TIMESTAMP_MISMATCH'
  | 'HISTORY_TIMESTAMPS_AMBIGUOUS'
  | 'HISTORY_DELETE_ENTRY_OBSERVED';
export type FhirHistoryState = {
  tenantId: string;
  patientId: string;
  sourceId: string;
  resourceType: ExternalFhirImportType;
  resourceId: string;
  headId: string;
  headReceiptId: string;
  status: FhirHistoryStatus;
  reasons: FhirHistoryReason[];
  historyHash: string;
  revision: number;
  probeStartedAt: number;
  lastOperationSequence?: number;
  observedAt: number;
  eventId: string;
  caseId: string | null;
};
export type FhirHistoryObservationArgs = {
  db: Firestore;
  actor: FhirImportActor;
  sourceId: string;
  resourceType: ExternalFhirImportType;
  resourceId: string;
  /** Captured before the remote history request. */
  expectedHeadReceiptId: string;
  /** Server-generated UUID per HTTP history retrieval. */
  probeId: string;
  probeStartedAt: number;
  syncFence?: FhirSourcePollOperationFence;
  bundle: unknown;
  expectedBaseUrl?: string;
  expectedCredentialRevision?: number;
  expectedSiteApprovalId?: string;
  now?: () => number;
};
export type FhirHistoryResult = {
  status: FhirHistoryStatus | 'STALE_IGNORED';
  assessmentId: string;
  replay: boolean;
  reasons: FhirHistoryReason[];
};
type ParsedHistory = {
  status: FhirHistoryStatus;
  reasons: FhirHistoryReason[];
  historyHash: string;
  entryCount: number;
  paginated: boolean;
  rows: Array<{ kind: 'VERSION' | 'DELETE'; versionId: string | null; modifiedAt: number }>;
};
type Head = {
  tenantId: string; patientId: string; sourceId: string; resourceType: string;
  resourceId: string; receiptId: string; sourceVersionId: string;
  sourceLastUpdatedAt: number;
};
type Receipt = {
  tenantId: string; patientId: string; sourceId: string;
  resourceType: string; resourceId: string; receiptId: string;
  provenance?: { mappedByVerifiedLink?: string };
};
function object(input: unknown): Record<string, unknown> | null {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : null;
}
function str(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}
function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function timestamp(value: unknown): number {
  const text = str(value);
  const parsed = Date.parse(text);
  if (!text || !Number.isFinite(parsed) || !/(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    throw new Error('FHIR_HISTORY_TIMESTAMP_REQUIRED');
  }
  return parsed;
}
function entryTime(row: Record<string, unknown>, response: Record<string, unknown>): number {
  const resource = object(row.resource);
  return timestamp(object(resource?.meta)?.lastUpdated || response.lastModified);
}
export function assessFhirHistoryWindow(
  bundle: unknown,
  resourceType: ExternalFhirImportType,
  resourceId: string,
  head: { sourceVersionId: string; sourceLastUpdatedAt: number },
): ParsedHistory {
  const doc = object(bundle);
  if (!doc || doc.resourceType !== 'Bundle' || doc.type !== 'history') {
    throw new Error('FHIR_HISTORY_BUNDLE_TYPE_INVALID');
  }
  // Limit untrusted source payload before any Firestore operation.
  if (Buffer.byteLength(JSON.stringify(bundle), 'utf8') > 256_000) {
    throw new Error('FHIR_HISTORY_BUNDLE_TOO_LARGE');
  }
  const entries = doc.entry === undefined ? [] : doc.entry;
  if (!Array.isArray(entries) || entries.length > 64) {
    throw new Error('FHIR_HISTORY_WINDOW_BOUNDS_EXCEEDED');
  }
  const links = doc.link === undefined ? [] : doc.link;
  if (!Array.isArray(links) || links.length > 16 ||
      links.some(x => !object(x) || !str(object(x)?.relation))) {
    throw new Error('FHIR_HISTORY_LINK_INVALID');
  }
  const paginated = links.some(x => object(x)?.relation === 'next');
  const rows: ParsedHistory['rows'] = [];
  const versions = new Set<string>();
  let ambiguous = false;
  let deletion = false;
  for (const entry of entries) {
    const row = object(entry);
    if (!row) throw new Error('FHIR_HISTORY_ENTRY_INVALID');
    const request = object(row.request);
    const method = str(request?.method);
    const resource = object(row.resource);
    const response = object(row.response) || {};
    if (method === 'DELETE') {
      // A tombstone is not a resource version with a fabricated payload.
      if (resource || str(request?.url) !== resourceType + '/' + resourceId) {
        throw new Error('FHIR_HISTORY_DELETION_SCOPE_INVALID');
      }
      deletion = true;
      rows.push({ kind: 'DELETE', versionId: null, modifiedAt: timestamp(response.lastModified) });
    } else {
      if (!resource || resource.resourceType !== resourceType ||
          resource.id !== resourceId ||
          (method && !['POST', 'PUT', 'PATCH'].includes(method))) {
        throw new Error('FHIR_HISTORY_RESOURCE_SCOPE_INVALID');
      }
      const versionId = assertFhirIdentifier(object(resource.meta)?.versionId,
        'FHIR_HISTORY_VERSION_ID_REQUIRED');
      if (versions.has(versionId)) throw new Error('FHIR_HISTORY_DUPLICATE_VERSION_ID');
      versions.add(versionId);
      rows.push({ kind: 'VERSION', versionId, modifiedAt: entryTime(row, response) });
    }
    if (rows.length > 1) {
      const prior = rows[rows.length - 2];
      const next = rows[rows.length - 1];
      if (next.modifiedAt > prior.modifiedAt) {
        throw new Error('FHIR_HISTORY_NOT_NEWEST_FIRST');
      }
      if (next.modifiedAt === prior.modifiedAt) ambiguous = true;
    }
  }
  const reasons: FhirHistoryReason[] = [];
  if (!rows.length) reasons.push('HISTORY_WINDOW_EMPTY');
  const newest = rows[0];
  if (newest?.kind !== 'VERSION' || newest.versionId !== head.sourceVersionId) {
    reasons.push('HEAD_VERSION_NOT_LATEST');
  } else if (newest.modifiedAt !== head.sourceLastUpdatedAt) {
    reasons.push('HEAD_TIMESTAMP_MISMATCH');
  }
  if (ambiguous) reasons.push('HISTORY_TIMESTAMPS_AMBIGUOUS');
  if (deletion) reasons.push('HISTORY_DELETE_ENTRY_OBSERVED');
  const status: FhirHistoryStatus = reasons.length ? 'REVIEW_REQUIRED' : 'WINDOW_ANCHORED';
  // A pagination link is not a data gap. Even a non-paginated response only
  // attests to the observed window, never global/source-history completeness.
  return {
    status, reasons, paginated, entryCount: rows.length, rows,
    historyHash: sha([resourceType, resourceId, rows, paginated]),
  };
}
export async function recordFhirHistoryObservation(
  args: FhirHistoryObservationArgs,
): Promise<FhirHistoryResult> {
  const { actor, db } = args;
  const tenantId = assertFhirIdentifier(actor.tenantId, 'FHIR_HISTORY_TENANT_INVALID');
  const sourceId = assertFhirIdentifier(args.sourceId, 'FHIR_HISTORY_SOURCE_INVALID');
  const resourceId = assertFhirIdentifier(args.resourceId, 'FHIR_HISTORY_RESOURCE_INVALID');
  if (!(['Patient', 'Encounter', 'Observation'] as string[]).includes(args.resourceType) ||
      !/^fir_[0-9a-f]{64}$/.test(args.expectedHeadReceiptId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.probeId) ||
      !Number.isSafeInteger(args.probeStartedAt) || args.probeStartedAt < 1) {
    throw new Error('FHIR_HISTORY_OBSERVATION_INVALID');
  }
  const headId = fhirImportHeadId(sourceId, args.resourceType, resourceId);
  const tenant = db.collection('tenants').doc(tenantId);
  const headRef = tenant.collection('fhirResourceHeads').doc(headId);
  const stateRef = tenant.collection('fhirHistoryStates').doc(headId);
  const assessmentId = 'fhe_' + sha([tenantId, sourceId, args.resourceType,
    resourceId, args.probeId]);
  const eventRef = tenant.collection('fhirHistoryEvents').doc(assessmentId);
  return db.runTransaction(async tx => {
    const [sourceSnap, headSnap, stateSnap, existingEvent] = await tx.getAll(
      tenant.collection('fhirSources').doc(sourceId), headRef, stateRef, eventRef,
    );
    const source = assertFhirSource(
      sourceSnap.exists ? sourceSnap.data() as FhirSourceRecord : null,
      tenantId, sourceId, actor, args.resourceType, args.expectedBaseUrl,
    );
    if (source.oauth && (args.expectedCredentialRevision === undefined ||
        !args.expectedSiteApprovalId)) {
      throw new Error('FHIR_HISTORY_SITE_APPROVAL_REQUIRED');
    }
    if (args.expectedCredentialRevision !== undefined &&
        source.oauth?.credentialRevision !== args.expectedCredentialRevision) {
      throw new Error('FHIR_HISTORY_CREDENTIAL_CHANGED');
    }
    // A coordinated source's operation reservation must still belong to the
    // active epoch at the exact evidence transaction commit.
    if (source.syncMode === 'FENCED' && !args.syncFence?.operationSequence) {
      throw new Error('FHIR_SYNC_OPERATION_NOT_RESERVED');
    }
    await assertSourcePollFenceInTransaction({
      tx, db, source, fence: args.syncFence,
    });
    const head = headSnap.exists ? headSnap.data() as Head : null;
    if (!head || head.tenantId !== tenantId || head.sourceId !== sourceId ||
        head.resourceType !== args.resourceType || head.resourceId !== resourceId ||
        head.receiptId !== args.expectedHeadReceiptId ||
        !/^[A-Za-z0-9._-]{1,128}$/.test(head.patientId)) {
      throw new Error('FHIR_HISTORY_HEAD_CHANGED');
    }
    const analysis = assessFhirHistoryWindow(args.bundle, args.resourceType,
      resourceId, head);
    const [receiptSnap, patientSnap] = await tx.getAll(
      tenant.collection('fhirImportedVersions').doc(head.receiptId),
      tenant.collection('patients').doc(head.patientId),
    );
    const receipt = receiptSnap.exists ? receiptSnap.data() as Receipt : null;
    if (!receipt || receipt.tenantId !== tenantId || receipt.sourceId !== sourceId ||
        receipt.patientId !== head.patientId || receipt.receiptId !== head.receiptId ||
        receipt.resourceType !== args.resourceType || receipt.resourceId !== resourceId ||
        !patientSnap.exists || patientSnap.get('mergedIntoPatientId') ||
        (patientSnap.get('tenantId') && patientSnap.get('tenantId') !== tenantId)) {
      throw new Error('FHIR_HISTORY_SOURCE_LINEAGE_INVALID');
    }
    const linkId = receipt.provenance?.mappedByVerifiedLink || '';
    if (!/^fpl_[0-9a-f]{64}$/.test(linkId)) throw new Error('FHIR_HISTORY_LINK_MISSING');
    const linkSnap = await tx.get(tenant.collection('fhirPatientLinks').doc(linkId));
    const link = linkSnap.exists ? linkSnap.data() as FhirPatientLink : null;
    if (!link || link.tenantId !== tenantId || link.sourceId !== sourceId ||
        link.patientId !== head.patientId || link.facilityId !== source.facilityId ||
        link.matchStatus !== 'VERIFIED' || link.consentStatus !== 'GRANTED' ||
        fhirPatientLinkId(sourceId, link.externalPatientId) !== linkId) {
      throw new Error('FHIR_HISTORY_LINK_OR_CONSENT_INVALID');
    }
    if (args.expectedCredentialRevision !== undefined) {
      if (source.siteApprovalId !== args.expectedSiteApprovalId) {
        throw new Error('FHIR_HISTORY_SITE_APPROVAL_CHANGED');
      }
      const approvalSnap = await tx.get(
        tenant.collection('fhirSiteApprovals').doc(siteApprovalDocId(source)),
      );
      validateFhirSiteApproval(source,
        approvalSnap.exists ? approvalSnap.data() as FhirSiteApproval : null,
        args.resourceType, (args.now || Date.now)());
    }
    const previous = stateSnap.exists ? stateSnap.data() as FhirHistoryState : null;
    if (previous && (previous.tenantId !== tenantId || previous.patientId !== head.patientId ||
        previous.sourceId !== sourceId || previous.headId !== headId ||
        !Number.isSafeInteger(previous.revision) || previous.revision < 1 ||
        !Number.isSafeInteger(previous.probeStartedAt) || !previous.historyHash)) {
      throw new Error('FHIR_HISTORY_STATE_CORRUPT');
    }
    if (existingEvent.exists) {
      const old = existingEvent.data()!;
      if (old.historyHash !== analysis.historyHash ||
          old.headReceiptId !== head.receiptId ||
          old.probeStartedAt !== args.probeStartedAt ||
          old.operationSequence !== (args.syncFence?.operationSequence || null)) {
        throw new Error('FHIR_HISTORY_REPLAY_CONFLICT');
      }
      return {
        status: old.disposition as FhirHistoryResult['status'],
        assessmentId, replay: true, reasons: analysis.reasons,
      };
    }
    const stale = !!previous && (source.syncMode === 'FENCED'
      ? args.syncFence!.operationSequence <= (previous.lastOperationSequence || 0)
      : args.probeStartedAt <= previous.probeStartedAt);
    const issueHash = sha([headId, head.receiptId, analysis.reasons]);
    const caseId = analysis.status === 'REVIEW_REQUIRED'
      ? 'frc_' + issueHash : null;
    const caseRef = caseId ? tenant.collection('fhirReconciliationCases').doc(caseId) : null;
    const caseSnap = caseRef && !stale ? await tx.get(caseRef) : null;
    if (caseSnap?.exists && (caseSnap.get('reason') !== 'SOURCE_HISTORY_REVIEW' ||
        caseSnap.get('patientId') !== head.patientId ||
        caseSnap.get('currentReceiptId') !== head.receiptId ||
        caseSnap.get('sourceId') !== sourceId)) {
      throw new Error('FHIR_HISTORY_CASE_SCOPE_INVALID');
    }
    const recordedAt = (args.now || Date.now)();
    const disposition: FhirHistoryResult['status'] =
      stale ? 'STALE_IGNORED' : analysis.status;
    const common = {
      tenantId, patientId: head.patientId, sourceId,
      resourceType: args.resourceType, resourceId, headId,
      headReceiptId: head.receiptId, assessmentId,
      historyHash: analysis.historyHash, entryCount: analysis.entryCount,
      paginated: analysis.paginated, reasons: analysis.reasons,
      probeId: args.probeId, probeStartedAt: args.probeStartedAt,
      operationSequence: args.syncFence?.operationSequence || null,
      fencingEpoch: args.syncFence?.epoch || null,
      disposition, recordedAt, caseId,
    };
    tx.create(eventRef, {
      ...common, eventType: 'EXTERNAL_FHIR_HISTORY_WINDOW_OBSERVED',
      immutable: true, clinicalAuthority: false,
      // No raw FHIR history, token, patient demographics or URI.
    });
    tx.create(tenant.collection('auditLogs').doc('fau_' + assessmentId), {
      ...common, actorId: actor.actorId, action: 'FHIR_HISTORY_ASSESSED',
      immutable: true, clinicalAuthority: false,
    });
    tx.create(tenant.collection('fhirHistoryOutbox').doc('fho_' + assessmentId), {
      ...common, status: 'HELD',
      destination: 'CI_EXTERNAL_CONTEXT_QUALIFICATION',
      reason: 'History observations require independent clinical and source review',
    });
    if (!stale) {
      if (caseRef && !caseSnap?.exists) {
        tx.create(caseRef, {
          caseId, tenantId, patientId: head.patientId, sourceId,
          facilityId: source.facilityId, resourceType: args.resourceType,
          resourceId, headId, reason: 'SOURCE_HISTORY_REVIEW',
          currentReceiptId: head.receiptId, conflictingReceiptId: head.receiptId,
          status: 'OPEN', approvals: [], resolution: null,
          recordedAt, immutableSourceVersion: true,
          reviewReasons: analysis.reasons,
        });
      }
      tx.set(stateRef, {
        tenantId, patientId: head.patientId, sourceId, headId,
        resourceType: args.resourceType, resourceId,
        headReceiptId: head.receiptId,
        status: analysis.status,
        reasons: analysis.reasons,
        historyHash: analysis.historyHash,
        revision: (previous?.revision || 0) + 1,
        probeStartedAt: args.probeStartedAt,
        lastOperationSequence: args.syncFence?.operationSequence ||
          previous?.lastOperationSequence || 0,
        observedAt: recordedAt,
        eventId: assessmentId,
        caseId,
      } satisfies FhirHistoryState);
    }
    return { status: disposition, assessmentId, replay: false, reasons: analysis.reasons };
  });
}
