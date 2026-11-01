/**
 * Two-operator review of source-version collisions.
 *
 * This never changes an immutable FHIR payload or promotes source data to a
 * clinical decision. A resolved tie means an explicitly reviewed conflicting
 * version remains suppressed; the existing current source head is unchanged.
 */
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { FhirImportActor, FhirSourceRecord } from './external-fhir-import';

export type FhirReconciliationDecision = 'SUPPRESS_CONFLICTING_VERSION';
export type FhirCaseDecisionResult = {
  tenantId: string;
  caseId: string;
  status: 'OPEN' | 'RESOLVED';
  approvalCount: number;
  replay: boolean;
};
function sha(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
export async function approveFhirReconciliation(args: {
  db: Firestore;
  actor: FhirImportActor;
  caseId: string;
  decision: FhirReconciliationDecision;
  rationale: string;
  now?: () => number;
}): Promise<FhirCaseDecisionResult> {
  const { db, actor, caseId, decision } = args;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(caseId) ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(actor.tenantId) ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(actor.actorId)) {
    throw new Error('FHIR_RECONCILIATION_SCOPE_INVALID');
  }
  if (!actor.permissions.map(p => p.toUpperCase()).includes('FHIR_RECONCILE')) {
    throw new Error('FHIR_RECONCILIATION_PERMISSION_DENIED');
  }
  if (decision !== 'SUPPRESS_CONFLICTING_VERSION') {
    throw new Error('FHIR_RECONCILIATION_DECISION_UNSUPPORTED');
  }
  const rationale = args.rationale.trim();
  if (rationale.length < 16 || rationale.length > 2000) {
    throw new Error('FHIR_RECONCILIATION_RATIONALE_REQUIRED');
  }
  const root = db.collection('tenants').doc(actor.tenantId);
  const caseRef = root.collection('fhirReconciliationCases').doc(caseId);
  const decisionId = 'frd_' + sha(JSON.stringify([caseId, actor.actorId]));
  const decisionRef = root.collection('fhirReconciliationDecisions').doc(decisionId);
  const auditRef = root.collection('auditLogs').doc('fau_' + decisionId);
  return db.runTransaction(async tx => {
    const caseSnap = await tx.get(caseRef);
    if (!caseSnap.exists) throw new Error('FHIR_RECONCILIATION_CASE_NOT_FOUND');
    const row = caseSnap.data() as {
      tenantId: string; patientId: string; sourceId: string; facilityId: string;
      reason: string; status: string; conflictingReceiptId: string;
      approvals?: Array<{ actorId: string; decisionId: string }>;
    };
    if (row.tenantId !== actor.tenantId || !actor.facilityIds.includes(row.facilityId)) {
      throw new Error('FHIR_RECONCILIATION_FACILITY_DENIED');
    }
    if (row.reason !== 'SOURCE_VERSION_TIE') {
      throw new Error('FHIR_RECONCILIATION_REQUIRES_SOURCE_REPAIR');
    }
    const [sourceSnap, existing] = await tx.getAll(
      root.collection('fhirSources').doc(row.sourceId), decisionRef
    );
    const source = sourceSnap.exists ? sourceSnap.data() as FhirSourceRecord : null;
    if (!source || source.tenantId !== actor.tenantId ||
        source.sourceId !== row.sourceId || source.facilityId !== row.facilityId ||
        source.status !== 'ACTIVE' || source.securityReviewStatus !== 'APPROVED') {
      throw new Error('FHIR_RECONCILIATION_SOURCE_NOT_ACTIVE');
    }
    const approvals = row.approvals || [];
    if (existing.exists) {
      const prior = existing.data() as { decision: string; rationale: string };
      if (prior.decision !== decision || prior.rationale !== rationale) {
        throw new Error('FHIR_RECONCILIATION_REPLAY_MISMATCH');
      }
      return {
        tenantId: actor.tenantId, caseId,
        status: row.status as 'OPEN' | 'RESOLVED',
        approvalCount: approvals.length, replay: true,
      };
    }
    if (row.status !== 'OPEN' || approvals.length >= 2 ||
        approvals.some(a => a.actorId === actor.actorId)) {
      throw new Error('FHIR_RECONCILIATION_ALREADY_RESOLVED');
    }
    const now = (args.now || Date.now)();
    const next = [...approvals, { actorId: actor.actorId, decisionId }];
    const status = next.length === 2 ? 'RESOLVED' as const : 'OPEN' as const;
    tx.create(decisionRef, {
      decisionId, caseId, tenantId: actor.tenantId,
      patientId: row.patientId, sourceId: row.sourceId,
      actorId: actor.actorId, decision, rationale,
      conflictingReceiptId: row.conflictingReceiptId,
      recordedAt: now, immutable: true,
    });
    tx.create(auditRef, {
      tenantId: actor.tenantId, patientId: row.patientId, caseId,
      actorId: actor.actorId, targetId: decisionId,
      action: 'EXTERNAL_FHIR_RECONCILIATION_APPROVED',
      decision, recordedAt: now, immutable: true,
    });
    tx.update(caseRef, {
      approvals: next, status,
      ...(status === 'RESOLVED'
        ? { resolution: decision, resolvedAt: now, resolvedBy: next.map(x => x.actorId) }
        : {}),
    });
    return {
      tenantId: actor.tenantId, caseId,
      status, approvalCount: next.length, replay: false,
    };
  });
}
