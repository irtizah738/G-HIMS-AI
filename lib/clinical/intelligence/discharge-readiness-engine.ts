import crypto from 'node:crypto';
import type {
  DischargeEvidenceReference,
  DischargeReadinessFinding,
  DischargeReadinessProjection,
  DischargeReadinessSnapshot,
  DischargeReadinessState,
} from '@/types/discharge-readiness';

export const DISCHARGE_READINESS_RULESET_VERSION = 'CI7-DR-1.0.0';
export const DISCHARGE_READINESS_ENGINE_VERSION = 1;
const VITALS_WARNING_AGE_MS = 8 * 60 * 60 * 1000;

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function num(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finding(input: Omit<DischargeReadinessFinding, 'findingId' | 'ruleVersion'>): DischargeReadinessFinding {
  const findingId = crypto
    .createHash('sha256')
    .update([
      input.ruleId,
      input.code,
      ...input.evidence.map((item) => `${item.entityType}:${item.entityId}`),
    ].join('|'))
    .digest('hex')
    .slice(0, 24);

  return {
    ...input,
    findingId: `drf_${findingId}`,
    ruleVersion: DISCHARGE_READINESS_RULESET_VERSION,
  };
}

function evidence(
  source: DischargeEvidenceReference['source'],
  entityType: string,
  entity: Record<string, unknown>,
  fallbackId: string,
  label?: string
): DischargeEvidenceReference {
  return {
    source,
    entityType,
    entityId: text(
      entity.evidenceId ||
      entity.orderId ||
      entity.encounterId ||
      entity.id ||
      fallbackId
    ),
    eventId: text(entity.eventId) || undefined,
    occurredAt: num(
      entity.measuredAt ||
      entity.completedAt ||
      entity.updatedAt ||
      entity.createdAt ||
      entity.orderedAt
    ),
    label,
  };
}

function isClosed(status: unknown): boolean {
  return ['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED'].includes(
    text(status).toUpperCase()
  );
}

export class DischargeReadinessEngine {
  public static evaluate(
    snapshot: DischargeReadinessSnapshot,
    evaluatedAt = Date.now()
  ): Omit<DischargeReadinessProjection, 'evaluationId'> {
    const findings: DischargeReadinessFinding[] = [];
    const encounterType = text(
      snapshot.encounter.encounterType || snapshot.patient360.activeEncounter?.encounterType
    ).toUpperCase();
    const encounterStatus = text(
      snapshot.encounter.status || snapshot.patient360.activeEncounter?.status
    ).toUpperCase();

    if (encounterType !== 'IPD' || isClosed(encounterStatus)) {
      return {
        tenantId: snapshot.tenantId,
        patientId: snapshot.patientId,
        encounterId: snapshot.encounterId,
        state: 'NOT_APPLICABLE',
        blockers: [],
        warnings: [],
        information: [],
        evaluatedAt,
        evaluatedThroughEventId: snapshot.patient360.lastEventId,
        patient360Revision: snapshot.patient360.revision,
        patient360SourceCheckpoint: snapshot.patient360.sourceCheckpoint,
        rulesetVersion: DISCHARGE_READINESS_RULESET_VERSION,
        engineVersion: DISCHARGE_READINESS_ENGINE_VERSION,
      };
    }

    const encounterRef = evidence(
      'ENCOUNTER',
      'ENCOUNTER',
      snapshot.encounter,
      snapshot.encounterId,
      'Active inpatient encounter'
    );

    const latestVitals = snapshot.encounterEvidence
      .filter((item) =>
        text(item.evidenceType).toUpperCase() === 'VITALS' &&
        text(item.status).toUpperCase() === 'FINAL'
      )
      .sort(
        (a, b) =>
          Number(b.measuredAt || b.createdAt || 0) -
          Number(a.measuredAt || a.createdAt || 0)
      )[0];

    if (!latestVitals || text(latestVitals.news2Status).toUpperCase() !== 'VERIFIED') {
      findings.push(finding({
        severity: 'BLOCKER',
        domain: 'CLINICAL_STABILITY',
        code: 'NEWS2_NOT_VERIFIED',
        title: 'Clinical stability is not verified',
        explanation:
          'A final authoritative vital-sign assessment with a verified NEWS2 score is required before routine inpatient discharge can be reviewed.',
        ruleId: 'DR-STABILITY-001',
        evidence: latestVitals
          ? [evidence('ENCOUNTER_EVIDENCE', 'VITALS', latestVitals, 'latest-vitals', 'Latest vitals')]
          : [encounterRef],
      }));
    } else {
      const score = num(latestVitals.news2Score);
      const vitalsRef = evidence(
        'ENCOUNTER_EVIDENCE',
        'VITALS',
        latestVitals,
        'latest-vitals',
        `NEWS2 ${score ?? 'unknown'}`
      );
      if (score === undefined) {
        findings.push(finding({
          severity: 'BLOCKER',
          domain: 'CLINICAL_STABILITY',
          code: 'NEWS2_SCORE_MISSING',
          title: 'Verified NEWS2 score is missing',
          explanation:
            'The latest vital-sign evidence is marked verified but does not contain a finite NEWS2 score. This inconsistent safety evidence must be corrected before discharge review.',
          ruleId: 'DR-STABILITY-002',
          evidence: [vitalsRef],
        }));
      } else if (score >= 5) {
        findings.push(finding({
          severity: 'BLOCKER',
          domain: 'CLINICAL_STABILITY',
          code: 'NEWS2_HIGH_RISK',
          title: `NEWS2 ${score} requires escalation`,
          explanation:
            'The latest authoritative NEWS2 is at or above the routine-discharge safety threshold. Clinical escalation or an explicitly governed emergency override is required.',
          ruleId: 'DR-STABILITY-003',
          evidence: [vitalsRef],
        }));
      } else if (score >= 3) {
        findings.push(finding({
          severity: 'WARNING',
          domain: 'CLINICAL_STABILITY',
          code: 'NEWS2_REVIEW',
          title: `NEWS2 ${score} requires clinician review`,
          explanation:
            'The patient is not automatically blocked by this rule, but the current deterioration score should be reviewed before discharge authorization.',
          ruleId: 'DR-STABILITY-004',
          evidence: [vitalsRef],
        }));
      }

      const measuredAt = num(latestVitals.measuredAt || latestVitals.createdAt);
      if (measuredAt && evaluatedAt - measuredAt > VITALS_WARNING_AGE_MS) {
        findings.push(finding({
          severity: 'WARNING',
          domain: 'CLINICAL_STABILITY',
          code: 'VITALS_STALE',
          title: 'Latest discharge-relevant vitals are older than 8 hours',
          explanation:
            'A clinician should confirm that the current physiologic state is represented before authorizing discharge.',
          ruleId: 'DR-STABILITY-005',
          evidence: [vitalsRef],
        }));
      }
    }

    const unresolvedStatOrders = snapshot.diagnosticOrders.filter((order) => {
      const priority = text(order.priority).toUpperCase();
      const status = text(order.status).toUpperCase();
      return priority === 'STAT' &&
        !['COMPLETED', 'CANCELLED', 'RESULTS_READY', 'FINALIZED'].includes(status);
    });
    for (const order of unresolvedStatOrders) {
      findings.push(finding({
        severity: 'BLOCKER',
        domain: 'DIAGNOSTICS',
        code: 'STAT_ORDER_UNRESOLVED',
        title: 'Outstanding STAT diagnostic order',
        explanation:
          'A STAT diagnostic order remains unresolved and must be completed, cancelled, or formally handed off before routine discharge.',
        ruleId: 'DR-DIAG-001',
        evidence: [evidence('ORDER', 'DIAGNOSTIC_ORDER', order, 'stat-order', text(order.orderName || order.catalogCode))],
      }));
    }

    const pendingRoutineDiagnostics = snapshot.diagnosticOrders.filter((order) => {
      const priority = text(order.priority).toUpperCase();
      const status = text(order.status).toUpperCase();
      return priority !== 'STAT' &&
        !['COMPLETED', 'CANCELLED', 'RESULTS_READY', 'FINALIZED'].includes(status);
    });
    if (pendingRoutineDiagnostics.length > 0) {
      findings.push(finding({
        severity: 'WARNING',
        domain: 'DIAGNOSTICS',
        code: 'DIAGNOSTICS_PENDING',
        title: `${pendingRoutineDiagnostics.length} diagnostic order(s) remain open`,
        explanation:
          'Open non-STAT investigations do not automatically prevent discharge, but the clinician should decide whether they can be followed after discharge.',
        ruleId: 'DR-DIAG-002',
        evidence: pendingRoutineDiagnostics.slice(0, 10).map((order) =>
          evidence('ORDER', 'DIAGNOSTIC_ORDER', order, 'diagnostic-order', text(order.orderName || order.catalogCode))
        ),
      }));
    }

    if (snapshot.patient360.dataQuality.hasPreliminaryResults) {
      findings.push(finding({
        severity: 'WARNING',
        domain: 'DIAGNOSTICS',
        code: 'PRELIMINARY_RESULTS_PRESENT',
        title: 'Preliminary diagnostic results are present',
        explanation:
          'Patient 360 contains diagnostic information that is not yet final. The clinician should confirm whether follow-up is required.',
        ruleId: 'DR-DIAG-003',
        evidence: [{
          source: 'PATIENT360',
          entityType: 'PATIENT360_PROJECTION',
          entityId: snapshot.patientId,
          label: 'Patient 360 data quality',
        }],
      }));
    }

    const medicationReconciliation = snapshot.encounterEvidence
      .filter((item) =>
        text(item.evidenceType).toUpperCase() === 'MEDICATION_RECONCILIATION' &&
        text(item.status).toUpperCase() === 'FINAL'
      )
      .sort(
        (a, b) =>
          Number(b.completedAt || b.createdAt || 0) -
          Number(a.completedAt || a.createdAt || 0)
      )[0];

    if (!medicationReconciliation) {
      findings.push(finding({
        severity: 'BLOCKER',
        domain: 'MEDICATION',
        code: 'MEDICATION_RECONCILIATION_REQUIRED',
        title: 'Medication reconciliation is incomplete',
        explanation:
          'A final medication reconciliation is required before inpatient discharge can be authorized.',
        ruleId: 'DR-MED-001',
        evidence: [encounterRef],
      }));
    } else {
      const discrepancyCount = num(medicationReconciliation.discrepancyCount) || 0;
      if (discrepancyCount > 0) {
        findings.push(finding({
          severity: 'INFORMATION',
          domain: 'MEDICATION',
          code: 'MEDICATION_DISCREPANCIES_RESOLVED',
          title: `${discrepancyCount} medication discrepancy/discrepancies were reconciled`,
          explanation:
            'Medication reconciliation is final. The prior discrepancies are retained as discharge-review context.',
          ruleId: 'DR-MED-002',
          evidence: [
            evidence(
              'ENCOUNTER_EVIDENCE',
              'MEDICATION_RECONCILIATION',
              medicationReconciliation,
              'medication-reconciliation'
            ),
          ],
        }));
      }
    }

    if (
      ['UNKNOWN', 'NOT_ASSESSED', 'PATIENT_UNABLE_TO_REPORT'].includes(
        snapshot.patient360.dataQuality.medicationKnowledge
      )
    ) {
      findings.push(finding({
        severity: 'BLOCKER',
        domain: 'DATA_QUALITY',
        code: 'MEDICATION_HISTORY_UNRESOLVED',
        title: 'Medication history remains unresolved',
        explanation:
          'Patient 360 does not contain a reviewed medication-knowledge state suitable for a safe discharge medication plan.',
        ruleId: 'DR-DQ-001',
        evidence: [{
          source: 'PATIENT360',
          entityType: 'PATIENT360_PROJECTION',
          entityId: snapshot.patientId,
          label: `Medication knowledge: ${snapshot.patient360.dataQuality.medicationKnowledge}`,
        }],
      }));
    }

    if (
      ['UNKNOWN', 'NOT_ASSESSED', 'PATIENT_UNABLE_TO_REPORT'].includes(
        snapshot.patient360.dataQuality.allergyKnowledge
      )
    ) {
      findings.push(finding({
        severity: 'BLOCKER',
        domain: 'DATA_QUALITY',
        code: 'ALLERGY_HISTORY_UNRESOLVED',
        title: 'Allergy status remains unresolved',
        explanation:
          'Allergy knowledge must be explicitly reviewed before discharge medication decisions are finalized.',
        ruleId: 'DR-DQ-002',
        evidence: [{
          source: 'PATIENT360',
          entityType: 'PATIENT360_PROJECTION',
          entityId: snapshot.patientId,
          label: `Allergy knowledge: ${snapshot.patient360.dataQuality.allergyKnowledge}`,
        }],
      }));
    }

    if (
      ['UNKNOWN', 'NOT_ASSESSED', 'PATIENT_UNABLE_TO_REPORT'].includes(
        snapshot.patient360.dataQuality.problemListKnowledge
      )
    ) {
      findings.push(finding({
        severity: 'WARNING',
        domain: 'DATA_QUALITY',
        code: 'PROBLEM_LIST_UNRESOLVED',
        title: 'Problem list has unresolved knowledge status',
        explanation:
          'The clinician should confirm that discharge diagnoses and the active problem list are reconciled.',
        ruleId: 'DR-DQ-003',
        evidence: [{
          source: 'PATIENT360',
          entityType: 'PATIENT360_PROJECTION',
          entityId: snapshot.patientId,
          label: `Problem-list knowledge: ${snapshot.patient360.dataQuality.problemListKnowledge}`,
        }],
      }));
    }

    const activeInpatientOrders = snapshot.inpatientOrders.filter((order) =>
      !['COMPLETED', 'CANCELLED', 'DISCONTINUED'].includes(text(order.status).toUpperCase())
    );
    const criticalInpatientOrders = activeInpatientOrders.filter(
      (order) => text(order.priority).toUpperCase() === 'STAT'
    );
    if (criticalInpatientOrders.length > 0) {
      findings.push(finding({
        severity: 'BLOCKER',
        domain: 'CARE_PLAN',
        code: 'CRITICAL_INPATIENT_ORDER_OPEN',
        title: 'Critical inpatient care remains active',
        explanation:
          'One or more STAT inpatient orders remain active and require resolution before routine discharge review.',
        ruleId: 'DR-CARE-001',
        evidence: criticalInpatientOrders.slice(0, 10).map((order) =>
          evidence('INPATIENT_ORDER', 'INPATIENT_ORDER', order, 'inpatient-order', text(order.description))
        ),
      }));
    } else if (activeInpatientOrders.length > 0) {
      findings.push(finding({
        severity: 'WARNING',
        domain: 'CARE_PLAN',
        code: 'INPATIENT_ORDERS_OPEN',
        title: `${activeInpatientOrders.length} inpatient order(s) remain active`,
        explanation:
          'Active inpatient orders should be completed, discontinued, or explicitly transitioned into the post-discharge plan.',
        ruleId: 'DR-CARE-002',
        evidence: activeInpatientOrders.slice(0, 10).map((order) =>
          evidence('INPATIENT_ORDER', 'INPATIENT_ORDER', order, 'inpatient-order', text(order.description))
        ),
      }));
    }

    const dischargeSummary = snapshot.encounterEvidence
      .filter((item) =>
        text(item.evidenceType).toUpperCase() === 'SIGNED_CLINICAL_NOTE' &&
        text(item.category).toUpperCase() === 'DISCHARGE' &&
        text(item.status).toUpperCase() === 'FINAL' &&
        Boolean(text(item.signedBy)) &&
        num(item.signedAt) !== undefined
      )
      .sort(
        (a, b) =>
          Number(b.signedAt || b.createdAt || 0) -
          Number(a.signedAt || a.createdAt || 0)
      )[0];

    if (!dischargeSummary) {
      findings.push(finding({
        severity: 'BLOCKER',
        domain: 'DOCUMENTATION',
        code: 'DISCHARGE_SUMMARY_REQUIRED',
        title: 'Final signed discharge summary is missing',
        explanation:
          'The authoritative discharge workflow requires a final signed discharge summary for this encounter.',
        ruleId: 'DR-DOC-001',
        evidence: [encounterRef],
      }));
    } else {
      findings.push(finding({
        severity: 'INFORMATION',
        domain: 'DOCUMENTATION',
        code: 'DISCHARGE_SUMMARY_READY',
        title: 'Final discharge summary is available',
        explanation:
          'A final signed discharge summary is present for the active inpatient encounter.',
        ruleId: 'DR-DOC-002',
        evidence: [
          evidence('ENCOUNTER_EVIDENCE', 'DISCHARGE_SUMMARY', dischargeSummary, 'discharge-summary'),
        ],
      }));
    }

    findings.push(finding({
      severity: 'INFORMATION',
      domain: 'OPERATIONAL',
      code: 'CLINICIAN_AUTHORIZATION_REQUIRED',
      title: 'Clinician authorization is still required',
      explanation:
        'CI-7 does not discharge patients. A credentialed clinician must review the evidence and execute the governed discharge command.',
      ruleId: 'DR-OPS-001',
      evidence: [encounterRef],
    }));

    const blockers = findings.filter((item) => item.severity === 'BLOCKER');
    const warnings = findings.filter((item) => item.severity === 'WARNING');
    const information = findings.filter((item) => item.severity === 'INFORMATION');
    const state: DischargeReadinessState =
      blockers.length > 0
        ? 'BLOCKED'
        : warnings.length > 0
          ? 'REQUIRES_REVIEW'
          : 'READY_FOR_CLINICIAN_REVIEW';

    return {
      tenantId: snapshot.tenantId,
      patientId: snapshot.patientId,
      encounterId: snapshot.encounterId,
      state,
      blockers,
      warnings,
      information,
      evaluatedAt,
      evaluatedThroughEventId: snapshot.patient360.lastEventId,
      patient360Revision: snapshot.patient360.revision,
      patient360SourceCheckpoint: snapshot.patient360.sourceCheckpoint,
      rulesetVersion: DISCHARGE_READINESS_RULESET_VERSION,
      engineVersion: DISCHARGE_READINESS_ENGINE_VERSION,
    };
  }
}
