import crypto from 'node:crypto';
import {
  criticalObservationIds,
  isCriticalDiagnosticResult,
} from '@/lib/clinical/diagnostics/critical-result';
import type {
  DeteriorationEvidenceReference,
  DeteriorationFinding,
  DeteriorationProjection,
  DeteriorationSnapshot,
  DeteriorationState,
} from '@/types/clinical-deterioration';

export const DETERIORATION_RULESET_VERSION = 'CI8-DE-1.0.0';
export const DETERIORATION_ENGINE_VERSION = 1;

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function num(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isClosed(status: unknown): boolean {
  return ['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED'].includes(
    text(status).toUpperCase()
  );
}

function evidence(
  source: DeteriorationEvidenceReference['source'],
  entityType: string,
  entity: Record<string, unknown>,
  fallbackId: string,
  label?: string
): DeteriorationEvidenceReference {
  return {
    source,
    entityType,
    entityId: text(
      entity.evidenceId ||
      entity.reportId ||
      entity.diagnosticResultId ||
      entity.observationId ||
      entity.acknowledgementId ||
      entity.encounterId ||
      entity.id ||
      fallbackId
    ),
    eventId: text(entity.eventId) || undefined,
    occurredAt: num(
      entity.measuredAt ||
      entity.effectiveAt ||
      entity.issuedAt ||
      entity.updatedAt ||
      entity.createdAt
    ),
    label,
  };
}

function finding(
  input: Omit<DeteriorationFinding, 'findingId' | 'ruleVersion'>
): DeteriorationFinding {
  const findingId = crypto
    .createHash('sha256')
    .update(
      [
        input.ruleId,
        input.code,
        ...input.evidence.map((item) => `${item.entityType}:${item.entityId}`),
      ].join('|')
    )
    .digest('hex')
    .slice(0, 24);

  return {
    ...input,
    findingId: `dif_${findingId}`,
    ruleVersion: DETERIORATION_RULESET_VERSION,
  };
}

export class ClinicalDeteriorationEngine {
  public static evaluate(
    snapshot: DeteriorationSnapshot,
    evaluatedAt = Date.now()
  ): Omit<DeteriorationProjection, 'evaluationId'> {
    const findings: DeteriorationFinding[] = [];
    const encounterStatus = text(
      snapshot.encounter.status || snapshot.patient360.activeEncounter?.status
    ).toUpperCase();

    if (!snapshot.patient360.activeEncounter || isClosed(encounterStatus)) {
      return {
        tenantId: snapshot.tenantId,
        patientId: snapshot.patientId,
        encounterId: snapshot.encounterId,
        state: 'NOT_APPLICABLE',
        critical: [],
        escalations: [],
        warnings: [],
        information: [],
        evaluatedAt,
        evaluatedThroughEventId: snapshot.patient360.lastEventId,
        patient360Revision: snapshot.patient360.revision,
        patient360SourceCheckpoint: snapshot.patient360.sourceCheckpoint,
        rulesetVersion: DETERIORATION_RULESET_VERSION,
        engineVersion: DETERIORATION_ENGINE_VERSION,
      };
    }

    const encounterType = text(
      snapshot.encounter.encounterType ||
      snapshot.patient360.activeEncounter.encounterType
    ).toUpperCase();

    const vitals = snapshot.encounterEvidence
      .filter(
        (item) =>
          text(item.evidenceType).toUpperCase() === 'VITALS' &&
          text(item.status).toUpperCase() === 'FINAL'
      )
      .sort(
        (a, b) =>
          Number(b.measuredAt || b.createdAt || 0) -
          Number(a.measuredAt || a.createdAt || 0)
      );

    const latestVitals = vitals[0];
    if (!latestVitals) {
      findings.push(
        finding({
          severity: 'WARNING',
          domain: 'DATA_QUALITY',
          code: 'NO_CURRENT_VITALS',
          title: 'No current authoritative vital-sign assessment',
          explanation:
            'Clinical deterioration cannot be classified as stable without current authoritative vital-sign evidence. This finding requests clinician review; it does not diagnose deterioration.',
          ruleId: 'DE-DQ-001',
          evidence: [
            {
              source: 'ENCOUNTER',
              entityType: 'ENCOUNTER',
              entityId: snapshot.encounterId,
              label: 'Active encounter',
            },
          ],
        })
      );
    } else {
      const latestRef = evidence(
        'ENCOUNTER_EVIDENCE',
        'VITALS',
        latestVitals,
        'latest-vitals',
        'Latest authoritative vitals'
      );
      const verified =
        text(latestVitals.news2Status).toUpperCase() === 'VERIFIED';
      const score = num(latestVitals.news2Score);

      if (!verified || score === undefined) {
        findings.push(
          finding({
            severity: 'WARNING',
            domain: 'DATA_QUALITY',
            code: 'NEWS2_NOT_VERIFIED',
            title: 'NEWS2 deterioration score is not verified',
            explanation:
              'The latest vital-sign evidence does not contain a verified finite NEWS2 score, so the intelligence layer will not infer stability.',
            ruleId: 'DE-DQ-002',
            evidence: [latestRef],
          })
        );
      } else if (score >= 7) {
        findings.push(
          finding({
            severity: 'CRITICAL',
            domain: 'PHYSIOLOGY',
            code: 'NEWS2_CRITICAL',
            title: `NEWS2 ${score} requires urgent clinical review`,
            explanation:
              'The latest verified NEWS2 meets the deterministic critical-review threshold. CI-8 only surfaces the signal and provenance; it does not initiate treatment or replace clinician judgment.',
            ruleId: 'DE-PHYS-001',
            evidence: [latestRef],
          })
        );
      } else if (score >= 5) {
        findings.push(
          finding({
            severity: 'ESCALATION',
            domain: 'PHYSIOLOGY',
            code: 'NEWS2_ESCALATION',
            title: `NEWS2 ${score} requires escalation review`,
            explanation:
              'The latest verified NEWS2 is within the deterministic escalation range and should be reviewed by the responsible clinical team.',
            ruleId: 'DE-PHYS-002',
            evidence: [latestRef],
          })
        );
      } else if (score >= 3) {
        findings.push(
          finding({
            severity: 'WARNING',
            domain: 'PHYSIOLOGY',
            code: 'NEWS2_WATCH',
            title: `NEWS2 ${score} requires closer observation`,
            explanation:
              'The latest verified NEWS2 is above the low-risk range and is surfaced as a watch condition.',
            ruleId: 'DE-PHYS-003',
            evidence: [latestRef],
          })
        );
      }

      if (Boolean(latestVitals.news2RedTrigger || latestVitals.hasRedTrigger)) {
        findings.push(
          finding({
            severity: 'CRITICAL',
            domain: 'PHYSIOLOGY',
            code: 'NEWS2_SINGLE_PARAMETER_RED_TRIGGER',
            title: 'Single-parameter NEWS2 red trigger detected',
            explanation:
              'The authoritative vital-sign assessment records a red-trigger parameter requiring urgent clinician review regardless of aggregate score.',
            ruleId: 'DE-PHYS-004',
            evidence: [latestRef],
          })
        );
      }

      const latestMeasuredAt = num(
        latestVitals.measuredAt || latestVitals.createdAt
      );
      const staleAfterMs =
        encounterType === 'IPD'
          ? 4 * 60 * 60 * 1000
          : 8 * 60 * 60 * 1000;
      if (
        latestMeasuredAt !== undefined &&
        evaluatedAt - latestMeasuredAt > staleAfterMs
      ) {
        findings.push(
          finding({
            severity: 'WARNING',
            domain: 'DATA_QUALITY',
            code: 'VITALS_STALE',
            title: 'Latest vital-sign assessment may no longer represent current state',
            explanation:
              'The latest authoritative vital-sign assessment is older than the deterministic freshness window for this encounter type.',
            ruleId: 'DE-DQ-003',
            evidence: [latestRef],
          })
        );
      }
    }

    const verifiedSeries = vitals
      .map((item) => ({
        item,
        score:
          text(item.news2Status).toUpperCase() === 'VERIFIED'
            ? num(item.news2Score)
            : undefined,
        measuredAt: num(item.measuredAt || item.createdAt),
      }))
      .filter(
        (item): item is {
          item: Record<string, unknown>;
          score: number;
          measuredAt: number;
        } => item.score !== undefined && item.measuredAt !== undefined
      )
      .slice(0, 4);

    if (verifiedSeries.length >= 2) {
      const latest = verifiedSeries[0];
      const prior = verifiedSeries[1];
      const rise = latest.score - prior.score;
      const withinSixHours =
        latest.measuredAt >= prior.measuredAt &&
        latest.measuredAt - prior.measuredAt <= 6 * 60 * 60 * 1000;

      if (withinSixHours && rise >= 3) {
        findings.push(
          finding({
            severity: latest.score >= 7 ? 'CRITICAL' : 'ESCALATION',
            domain: 'TRAJECTORY',
            code: 'NEWS2_RAPID_RISE',
            title: `NEWS2 increased by ${rise} points`,
            explanation:
              'Two verified authoritative NEWS2 assessments show a deterioration of at least three points within six hours.',
            ruleId: 'DE-TRJ-001',
            evidence: [
              evidence(
                'ENCOUNTER_EVIDENCE',
                'VITALS',
                latest.item,
                'latest-vitals',
                `Current NEWS2 ${latest.score}`
              ),
              evidence(
                'ENCOUNTER_EVIDENCE',
                'VITALS',
                prior.item,
                'prior-vitals',
                `Prior NEWS2 ${prior.score}`
              ),
            ],
          })
        );
      }
    }

    const criticalIds = criticalObservationIds(snapshot.clinicalObservations);
    const acknowledgedReportIds = new Set(
      snapshot.diagnosticAcknowledgements
        .map((item) => text(item.reportId).trim())
        .filter(Boolean)
    );
    const unacknowledgedCritical = snapshot.diagnosticResults.filter(
      (result) =>
        isCriticalDiagnosticResult(result, criticalIds) &&
        !acknowledgedReportIds.has(
          text(result.reportId || result.diagnosticResultId).trim()
        )
    );

    for (const result of unacknowledgedCritical) {
      findings.push(
        finding({
          severity: 'CRITICAL',
          domain: 'DIAGNOSTICS',
          code: 'CRITICAL_RESULT_UNACKNOWLEDGED',
          title: 'Critical diagnostic result requires clinician review',
          explanation:
            'A final critical diagnostic result is present without an authoritative acknowledgement from the responsible clinician.',
          ruleId: 'DE-DIAG-001',
          evidence: [
            evidence(
              'DIAGNOSTIC_RESULT',
              'DIAGNOSTIC_RESULT',
              result,
              'critical-result',
              text(result.reportDisplay || result.reportCode) ||
                'Critical diagnostic result'
            ),
          ],
        })
      );
    }

    findings.push(
      finding({
        severity: 'INFORMATION',
        domain: 'DATA_QUALITY',
        code: 'CLINICIAN_DECISION_REQUIRED',
        title: 'Clinical interpretation remains clinician-owned',
        explanation:
          'CI-8 is deterministic surveillance intelligence. It does not diagnose disease, prescribe treatment, change orders, or autonomously escalate the patient.',
        ruleId: 'DE-GOV-001',
        evidence: [
          {
            source: 'PATIENT360',
            entityType: 'PATIENT360_PROJECTION',
            entityId: snapshot.patientId,
            label: 'Patient 360 source projection',
          },
        ],
      })
    );

    const critical = findings.filter((item) => item.severity === 'CRITICAL');
    const escalations = findings.filter(
      (item) => item.severity === 'ESCALATION'
    );
    const warnings = findings.filter((item) => item.severity === 'WARNING');
    const information = findings.filter(
      (item) => item.severity === 'INFORMATION'
    );

    const state: DeteriorationState =
      critical.length > 0
        ? 'CRITICAL_REVIEW_REQUIRED'
        : escalations.length > 0
          ? 'ESCALATION_REQUIRED'
          : warnings.length > 0
            ? 'WATCH'
            : 'STABLE';

    return {
      tenantId: snapshot.tenantId,
      patientId: snapshot.patientId,
      encounterId: snapshot.encounterId,
      state,
      critical,
      escalations,
      warnings,
      information,
      evaluatedAt,
      evaluatedThroughEventId: snapshot.patient360.lastEventId,
      patient360Revision: snapshot.patient360.revision,
      patient360SourceCheckpoint: snapshot.patient360.sourceCheckpoint,
      rulesetVersion: DETERIORATION_RULESET_VERSION,
      engineVersion: DETERIORATION_ENGINE_VERSION,
    };
  }
}
