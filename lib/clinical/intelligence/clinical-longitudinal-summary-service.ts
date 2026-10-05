import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import type { CommandContext, DomainEventEnvelope } from '@/lib/backend/types';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import { ClinicalTrendEngine } from '@/lib/clinical/intelligence/clinical-trend-engine';
import type {
  ClinicalEvidenceRef,
  ClinicalEvidenceSnapshot,
} from '@/types/clinical-intelligence-evidence';
import type {
  ClinicalLongitudinalSummary,
  ClinicalLongitudinalSummaryResponse,
  LongitudinalEvidenceIndexItem,
  LongitudinalSummaryClaim,
  LongitudinalSummarySection,
  LongitudinalSummarySectionId,
  LongitudinalSummarySectionState,
} from '@/types/clinical-longitudinal-summary';

const POLICY_VERSION = 'ci10b-longitudinal-summary-v1' as const;
const MAX_SECTION_CLAIMS = 100;

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalStringify(item)).join(',') + ']';
  }
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record)
    .sort()
    .map((key) => JSON.stringify(key) + ':' + canonicalStringify(record[key]))
    .join(',') + '}';
}

function hash(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(canonicalStringify(value))
    .digest('hex');
}

function stableId(prefix: string, parts: string[]): string {
  return `${prefix}_${crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 32)}`;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return String(value ?? '').trim();
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function iso(value: unknown): string | undefined {
  const numeric = numberValue(value);
  if (numeric === undefined) return undefined;
  const date = new Date(numeric);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function dedupeByEntity(
  refs: ClinicalEvidenceRef[],
  preferredTypes: string[] = []
): ClinicalEvidenceRef[] {
  const rank = new Map(preferredTypes.map((type, index) => [type, index]));
  const sorted = [...refs].sort(
    (left, right) =>
      (rank.get(left.sourceType) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.sourceType) ?? Number.MAX_SAFE_INTEGER) ||
      Number(right.occurredAt || 0) - Number(left.occurredAt || 0) ||
      left.evidenceId.localeCompare(right.evidenceId)
  );

  const seen = new Set<string>();
  return sorted.filter((item) => {
    const key = item.sourceEntityId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function claim(
  snapshot: ClinicalEvidenceSnapshot,
  sectionId: LongitudinalSummarySectionId,
  text: string,
  evidence: ClinicalEvidenceRef[],
  classification: LongitudinalSummaryClaim['classification'] = 'DIRECT_FACT',
  caveat?: string,
  occurredAt?: number
): LongitudinalSummaryClaim {
  const evidenceRefs = Array.from(
    new Set(evidence.map((item) => item.evidenceId))
  ).sort();

  return {
    claimId: stableId('ciclaim', [
      snapshot.snapshotId,
      sectionId,
      classification,
      text,
      ...evidenceRefs,
    ]),
    sectionId,
    text,
    classification,
    evidenceRefs,
    confidence: 1,
    ...(caveat ? { caveat } : {}),
    ...(occurredAt !== undefined ? { occurredAt } : {}),
  };
}

function section(
  sectionId: LongitudinalSummarySectionId,
  title: string,
  allClaims: LongitudinalSummaryClaim[],
  caveats: string[] = [],
  emptyCaveat = 'No represented evidence is available in this snapshot.'
): LongitudinalSummarySection {
  const ordered = [...allClaims].sort(
    (left, right) =>
      Number(right.occurredAt || 0) - Number(left.occurredAt || 0) ||
      left.claimId.localeCompare(right.claimId)
  );

  let state: LongitudinalSummarySectionState =
    ordered.length > 0 ? 'SUPPORTED' : 'NO_REPRESENTED_DATA';
  let claims = ordered;
  const nextCaveats = [...caveats];

  if (ordered.length === 0) {
    nextCaveats.push(emptyCaveat);
  } else if (ordered.length > MAX_SECTION_CLAIMS) {
    claims = ordered.slice(0, MAX_SECTION_CLAIMS);
    state = 'PARTIAL';
    nextCaveats.push(
      `Showing ${MAX_SECTION_CLAIMS} of ${ordered.length} evidence-backed claims. Full evidence remains available in the frozen snapshot.`
    );
  }

  return {
    sectionId,
    title,
    state,
    claims,
    caveats: Array.from(new Set(nextCaveats)),
  };
}

function knowledgeRef(
  snapshot: ClinicalEvidenceSnapshot
): ClinicalEvidenceRef | undefined {
  return snapshot.evidenceRefs.find(
    (item) => item.sourceType === 'KNOWLEDGE_STATUS'
  );
}

function knowledgeStatus(
  snapshot: ClinicalEvidenceSnapshot,
  field: string
): string {
  const evidence = knowledgeRef(snapshot);
  return stringValue(record(evidence?.content)[field]).toUpperCase();
}

function buildActiveProblems(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalSummarySection {
  const refs = snapshot.evidenceRefs.filter(
    (item) => item.sourceType === 'CONDITION'
  );
  const claims = refs
    .filter((item) => stringValue(record(item.content).clinicalStatus).toUpperCase() === 'ACTIVE')
    .map((item) => {
      const data = record(item.content);
      const verification = stringValue(data.verificationStatus);
      return claim(
        snapshot,
        'ACTIVE_PROBLEMS',
        `Active problem: ${item.label}${verification ? ` (verification: ${verification})` : ''}.`,
        [item],
        'DIRECT_FACT',
        undefined,
        item.occurredAt
      );
    });

  const knownNone = knowledgeStatus(snapshot, 'problemListKnowledge') === 'KNOWN_NONE';
  const knowledge = knowledgeRef(snapshot);
  if (claims.length === 0 && knownNone && knowledge) {
    claims.push(
      claim(
        snapshot,
        'ACTIVE_PROBLEMS',
        'Problem-list status is explicitly recorded as reviewed with none known.',
        [knowledge]
      )
    );
  }

  return section(
    'ACTIVE_PROBLEMS',
    'Active problems',
    claims,
    [],
    'No active problem claim is represented. This must not be interpreted as proof that no active problem exists.'
  );
}

function buildPastProblems(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalSummarySection {
  const claims = snapshot.evidenceRefs
    .filter((item) => item.sourceType === 'CONDITION')
    .filter((item) => stringValue(record(item.content).clinicalStatus).toUpperCase() !== 'ACTIVE')
    .map((item) => {
      const data = record(item.content);
      const status = stringValue(data.clinicalStatus) || item.status || 'UNKNOWN';
      return claim(
        snapshot,
        'PAST_PROBLEMS',
        `Historical problem: ${item.label} (status: ${status}).`,
        [item],
        'DIRECT_FACT',
        undefined,
        item.occurredAt
      );
    });

  return section(
    'PAST_PROBLEMS',
    'Past / resolved problems',
    claims,
    [],
    'No historical problem records are represented in this snapshot; this is not proof of absent past medical history.'
  );
}

function buildAllergies(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalSummarySection {
  const claims = snapshot.evidenceRefs
    .filter((item) => item.sourceType === 'ALLERGY')
    .map((item) => {
      const data = record(item.content);
      const criticality = stringValue(data.criticality);
      const verification = stringValue(data.verificationStatus);
      return claim(
        snapshot,
        'ALLERGIES',
        `Recorded allergy/intolerance: ${item.label}${criticality ? ` (criticality: ${criticality})` : ''}${verification ? `, verification: ${verification}` : ''}.`,
        [item],
        'DIRECT_FACT',
        undefined,
        item.occurredAt
      );
    });

  const knowledge = knowledgeRef(snapshot);
  if (
    claims.length === 0 &&
    knowledgeStatus(snapshot, 'allergyKnowledge') === 'KNOWN_NONE' &&
    knowledge
  ) {
    claims.push(
      claim(
        snapshot,
        'ALLERGIES',
        'Allergy status is explicitly recorded as reviewed with none known.',
        [knowledge]
      )
    );
  }

  return section(
    'ALLERGIES',
    'Allergies and intolerances',
    claims,
    [],
    'No allergy claim is represented. Missing allergy records are not equivalent to a documented negative allergy history.'
  );
}

function buildCurrentMedications(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalSummarySection {
  const refs = dedupeByEntity(
    snapshot.evidenceRefs.filter((item) =>
      ['MEDICATION_HISTORY', 'MEDICATION'].includes(item.sourceType)
    ),
    ['MEDICATION_HISTORY', 'MEDICATION']
  );

  const claims = refs
    .filter((item) => stringValue(record(item.content).status || item.status).toUpperCase() === 'ACTIVE')
    .map((item) => {
      const data = record(item.content);
      const dosage = stringValue(data.dosageText);
      const frequency = stringValue(data.frequency);
      const details = [dosage, frequency].filter(Boolean).join(', ');
      return claim(
        snapshot,
        'CURRENT_MEDICATIONS',
        `Current medication order: ${item.label}${details ? ` — ${details}` : ''}.`,
        [item],
        'DIRECT_FACT',
        undefined,
        item.occurredAt
      );
    });

  const knowledge = knowledgeRef(snapshot);
  if (
    claims.length === 0 &&
    knowledgeStatus(snapshot, 'medicationKnowledge') === 'KNOWN_NONE' &&
    knowledge
  ) {
    claims.push(
      claim(
        snapshot,
        'CURRENT_MEDICATIONS',
        'Medication-history status is explicitly recorded as reviewed with none known.',
        [knowledge]
      )
    );
  }

  return section(
    'CURRENT_MEDICATIONS',
    'Current medications',
    claims,
    [],
    'No active medication claim is represented. This is not proof that the patient takes no medication.'
  );
}

function buildMedicationChanges(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalSummarySection {
  const claims = dedupeByEntity(
    snapshot.evidenceRefs.filter(
      (item) => item.sourceType === 'MEDICATION_HISTORY'
    )
  )
    .filter((item) => {
      const status = stringValue(record(item.content).status || item.status).toUpperCase();
      return Boolean(status && !['ACTIVE', 'DRAFT'].includes(status));
    })
    .map((item) => {
      const status = stringValue(record(item.content).status || item.status) || 'UNKNOWN';
      const authoredAt = iso(record(item.content).authoredAt || item.occurredAt);
      return claim(
        snapshot,
        'MEDICATION_CHANGES',
        `Medication order ${item.label} is recorded with status ${status}${authoredAt ? ` (authored ${authoredAt})` : ''}.`,
        [item],
        'DIRECT_FACT',
        'The order status is reported without inferring the clinical reason for the change.',
        item.occurredAt
      );
    });

  return section(
    'MEDICATION_CHANGES',
    'Medication state changes',
    claims,
    ['Medication-status history is descriptive; reasons for starting, stopping or holding therapy are not inferred.'],
    'No non-active medication-order state is represented in the canonical medication history.'
  );
}

function buildProcedures(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalSummarySection {
  const claims = snapshot.evidenceRefs
    .filter((item) => item.sourceType === 'PROCEDURE')
    .map((item) => {
      const data = record(item.content);
      const status = stringValue(data.status || item.status) || 'UNKNOWN';
      const when = iso(data.performedAt || item.occurredAt);
      return claim(
        snapshot,
        'PROCEDURES',
        `Procedure: ${item.label} (status: ${status})${when ? `, performed/recorded ${when}` : ''}.`,
        [item],
        'DIRECT_FACT',
        undefined,
        item.occurredAt
      );
    });

  return section(
    'PROCEDURES',
    'Procedures',
    claims,
    [],
    'No canonical procedure records are represented in this snapshot. This is not proof that no procedure occurred.'
  );
}

function buildDiagnostics(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalSummarySection {
  const refs = dedupeByEntity(
    snapshot.evidenceRefs.filter((item) =>
      ['DIAGNOSTIC_REPORT_HISTORY', 'DIAGNOSTIC_REPORT'].includes(item.sourceType)
    ),
    ['DIAGNOSTIC_REPORT_HISTORY', 'DIAGNOSTIC_REPORT']
  );

  const claims = refs.map((item) => {
    const data = record(item.content);
    const status = stringValue(data.status || item.status) || 'UNKNOWN';
    const conclusion = stringValue(data.conclusion);
    return claim(
      snapshot,
      'DIAGNOSTICS',
      `Diagnostic report: ${item.label} (status: ${status})${conclusion ? ` — conclusion: ${conclusion}` : ''}.`,
      [item],
      'DIRECT_FACT',
      undefined,
      item.occurredAt
    );
  });

  return section(
    'DIAGNOSTICS',
    'Diagnostics',
    claims,
    [],
    'No diagnostic report is represented in this snapshot.'
  );
}

function buildAbnormalTrends(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalSummarySection {
  const computed = ClinicalTrendEngine.compute(snapshot);
  const evidenceById = new Map(
    snapshot.evidenceRefs.map((item) => [item.evidenceId, item])
  );
  const claims: LongitudinalSummaryClaim[] = [];
  const caveats = new Set<string>([
    'Trend statements are computed by the CI-10D deterministic trend engine and require clinician interpretation.',
  ]);

  for (const metric of computed.metrics) {
    for (const point of metric.points.filter((item) => item.abnormal)) {
      const evidence = evidenceById.get(point.evidenceId);
      if (!evidence) continue;
      claims.push(
        claim(
          snapshot,
          'ABNORMAL_TRENDS',
          `${metric.display} has a source-marked abnormal observation of ${point.value}${point.unit ? ` ${point.unit}` : ''}.`,
          [evidence],
          'DIRECT_FACT',
          'The abnormal marker comes from source interpretation/reference range evidence; no independent diagnosis is inferred.',
          point.effectiveAt
        )
      );
    }

    if (metric.explanation) {
      const refs = metric.explanation.evidenceRefs
        .map((evidenceId) => evidenceById.get(evidenceId))
        .filter((item): item is ClinicalEvidenceRef => Boolean(item));

      if (refs.length > 0) {
        claims.push(
          claim(
            snapshot,
            'ABNORMAL_TRENDS',
            metric.explanation.text,
            refs,
            'TREND',
            'This is deterministic numeric trend description only; clinical significance is not inferred.',
            metric.points[metric.points.length - 1]?.effectiveAt
          )
        );
      }
    }

    if (metric.status !== 'COMPUTED') {
      caveats.add(
        `${metric.display}: trend suppressed (${metric.status.toLowerCase().replace(/_/g, ' ')}).`
      );
    }
  }

  for (const item of computed.excludedEvidence) {
    caveats.add(
      `Observation evidence excluded: ${item.reason.toLowerCase().replace(/_/g, ' ')}.`
    );
  }

  return section(
    'ABNORMAL_TRENDS',
    'Abnormal results and descriptive trends',
    claims,
    Array.from(caveats),
    'No source-marked abnormal observation or CI-10D-computable quantitative trend is represented in this snapshot.'
  );
}

function buildEncounters(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalSummarySection {
  const refs = dedupeByEntity(
    snapshot.evidenceRefs.filter((item) =>
      ['ENCOUNTER_HISTORY', 'ENCOUNTER'].includes(item.sourceType)
    ),
    ['ENCOUNTER_HISTORY', 'ENCOUNTER']
  );

  const claims = refs.map((item) => {
    const data = record(item.content);
    const careSetting =
      stringValue(data.careSetting) ||
      stringValue(data.encounterType) ||
      item.label;
    const status = stringValue(data.status || item.status) || 'UNKNOWN';
    const started = iso(
      data.startedAt || data.createdAt || data.admitDate || item.occurredAt
    );
    const completed = iso(data.completedAt || data.dischargeDate);
    return claim(
      snapshot,
      'ENCOUNTERS_ADMISSIONS',
      `${careSetting} encounter (status: ${status})${started ? `, started ${started}` : ''}${completed ? `, completed ${completed}` : ''}.`,
      [item],
      'DIRECT_FACT',
      undefined,
      item.occurredAt
    );
  });

  return section(
    'ENCOUNTERS_ADMISSIONS',
    'Encounters and admissions',
    claims,
    [],
    'No encounter history is represented in this snapshot.'
  );
}

function buildOutstandingInvestigations(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalSummarySection {
  const claims = snapshot.evidenceRefs
    .filter((item) => item.sourceType === 'DIAGNOSTIC_ORDER')
    .filter((item) =>
      ['PLACED', 'ACTIVE', 'ON_HOLD'].includes(
        stringValue(record(item.content).status || item.status).toUpperCase()
      )
    )
    .map((item) => {
      const data = record(item.content);
      const status = stringValue(data.status || item.status) || 'UNKNOWN';
      const priority = stringValue(data.priority);
      return claim(
        snapshot,
        'OUTSTANDING_INVESTIGATIONS',
        `Outstanding investigation: ${item.label} (status: ${status}${priority ? `, priority: ${priority}` : ''}).`,
        [item],
        'DIRECT_FACT',
        undefined,
        item.occurredAt
      );
    });

  return section(
    'OUTSTANDING_INVESTIGATIONS',
    'Outstanding investigations',
    claims,
    [],
    'No open canonical diagnostic order is represented in this snapshot. This is not proof that no external or undocumented investigation is pending.'
  );
}

function buildFollowUp(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalSummarySection {
  const claims: LongitudinalSummaryClaim[] = [];

  for (const item of snapshot.evidenceRefs.filter(
    (ref) => ref.sourceType === 'CARE_PLAN'
  )) {
    const data = record(item.content);
    const activities = Array.isArray(data.activities) ? data.activities : [];

    for (const activityValue of activities) {
      const activity = record(activityValue);
      const status = stringValue(activity.status).toUpperCase();
      if (['COMPLETED', 'CANCELLED'].includes(status)) continue;

      const description =
        stringValue(activity.description) || 'Care-plan activity';
      const scheduledAt = iso(activity.scheduledAt);
      const responsibleRole = stringValue(activity.responsibleRole);

      claims.push(
        claim(
          snapshot,
          'FOLLOW_UP',
          `Follow-up activity: ${description} (status: ${status || 'UNKNOWN'})${scheduledAt ? `, scheduled ${scheduledAt}` : ''}${responsibleRole ? `, responsible role: ${responsibleRole}` : ''}.`,
          [item],
          'DIRECT_FACT',
          undefined,
          numberValue(activity.scheduledAt) || item.occurredAt
        )
      );
    }
  }

  return section(
    'FOLLOW_UP',
    'Follow-up and care-plan activities',
    claims,
    [],
    'No open care-plan follow-up activity is represented in this snapshot.'
  );
}

function buildDataQuality(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalSummarySection {
  const claims: LongitudinalSummaryClaim[] = [];
  const caveats: string[] = [];
  const knowledge = knowledgeRef(snapshot);

  if (knowledge) {
    const data = record(knowledge.content);
    const statusFields = [
      ['allergyKnowledge', 'Allergy knowledge'],
      ['problemListKnowledge', 'Problem-list knowledge'],
      ['medicationKnowledge', 'Medication knowledge'],
    ] as const;

    for (const [field, label] of statusFields) {
      const status = stringValue(data[field]).toUpperCase();
      if (
        status &&
        !['KNOWN', 'KNOWN_NONE'].includes(status)
      ) {
        claims.push(
          claim(
            snapshot,
            'DATA_QUALITY',
            `${label} state is ${status}.`,
            [knowledge],
            'DIRECT_FACT'
          )
        );
      }
    }

    const missing = Array.isArray(data.missingCanonicalFacts)
      ? data.missingCanonicalFacts.map(stringValue).filter(Boolean)
      : [];
    for (const item of missing) {
      claims.push(
        claim(
          snapshot,
          'DATA_QUALITY',
          `Canonical data-quality warning: ${item}.`,
          [knowledge],
          'DIRECT_FACT'
        )
      );
    }
  }

  const projectionOnly = snapshot.evidenceRefs.filter(
    (item) => item.provenanceStatus === 'PROJECTION_ONLY'
  );
  if (projectionOnly.length > 0) {
    caveats.push(
      `${projectionOnly.length} evidence item(s) are frozen from authoritative projections but did not match a direct immutable source event by entity identifier.`
    );
  }

  for (const [domain, coverage] of Object.entries(snapshot.coverage || {})) {
    if (coverage.status === 'COMPLETE' && coverage.recordCount === 0) {
      caveats.push(
        `No ${domain} records were represented by the canonical query at snapshot time; this is a coverage statement, not a negative clinical finding.`
      );
    }
  }

  return section(
    'DATA_QUALITY',
    'Data quality and evidence limits',
    claims,
    caveats,
    'No explicit data-quality warning is represented, but absence of a warning does not prove the chart is complete.'
  );
}

function evidenceIndex(
  snapshot: ClinicalEvidenceSnapshot
): LongitudinalEvidenceIndexItem[] {
  return snapshot.evidenceRefs.map((item) => ({
    evidenceId: item.evidenceId,
    sourceType: item.sourceType,
    sourceEntityId: item.sourceEntityId,
    label: item.label,
    status: item.status,
    occurredAt: item.occurredAt,
    provenanceStatus: item.provenanceStatus,
    sourceEventIds: item.sourceEventIds,
    contentHash: item.contentHash,
    content: item.content,
  }));
}

export class ClinicalLongitudinalSummaryService {
  public static build(
    snapshot: ClinicalEvidenceSnapshot,
    actorId: string,
    generatedAt = Date.now()
  ): ClinicalLongitudinalSummary {
    if (snapshot.purpose !== 'LONGITUDINAL_SUMMARY') {
      throw new Error('CI10B_EVIDENCE_PURPOSE_MISMATCH');
    }

    const sections: LongitudinalSummarySection[] = [
      buildActiveProblems(snapshot),
      buildPastProblems(snapshot),
      buildAllergies(snapshot),
      buildCurrentMedications(snapshot),
      buildMedicationChanges(snapshot),
      buildProcedures(snapshot),
      buildDiagnostics(snapshot),
      buildAbnormalTrends(snapshot),
      buildEncounters(snapshot),
      buildOutstandingInvestigations(snapshot),
      buildFollowUp(snapshot),
      buildDataQuality(snapshot),
    ];

    const allClaims = sections.flatMap((item) => item.claims);
    const grounding = ClinicalEvidenceService.validateClaims(
      snapshot,
      allClaims
    );
    if (!grounding.valid) {
      throw new Error(
        `CI10B_GROUNDING_VALIDATION_FAILED:${grounding.errors.join(',')}`
      );
    }

    const projectionOnlyRefs = snapshot.evidenceRefs.filter(
      (item) => item.provenanceStatus === 'PROJECTION_ONLY'
    ).length;

    const warnings = Array.from(
      new Set([
        ...snapshot.limitations,
        'Clinical significance, diagnosis, treatment selection and order execution remain clinician responsibilities.',
        ...(projectionOnlyRefs > 0
          ? [
              `${projectionOnlyRefs} evidence item(s) have projection-only provenance and should be reviewed against their source chart when material to a decision.`,
            ]
          : []),
      ])
    );

    const body = {
      evidenceSnapshotId: snapshot.snapshotId,
      evidenceSnapshotHash: snapshot.snapshotHash,
      patient360Revision: snapshot.patient360Revision,
      patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
      policyVersion: POLICY_VERSION,
      generationMode: 'DETERMINISTIC_EVIDENCE_SYNTHESIS' as const,
      sections,
      warnings,
      claimCount: allClaims.length,
      evidenceCoverage: {
        totalEvidenceRefs: snapshot.evidenceRefs.length,
        eventVerifiedRefs:
          snapshot.evidenceRefs.length - projectionOnlyRefs,
        projectionOnlyRefs,
        sourceTypes: Array.from(
          new Set(snapshot.evidenceRefs.map((item) => item.sourceType))
        ).sort(),
      },
      safety: {
        sourceLinked: true as const,
        clinicianReviewRequired: true as const,
        autonomousDiagnosisAllowed: false as const,
        autonomousTreatmentAllowed: false as const,
        autonomousOrdersAllowed: false as const,
        directClinicalMutationAllowed: false as const,
      },
    };

    const contentHash = hash(body);
    const summaryId = stableId('cisummary', [
      snapshot.tenantId,
      snapshot.patientId,
      snapshot.snapshotId,
      POLICY_VERSION,
      contentHash,
    ]);

    const summary: ClinicalLongitudinalSummary = {
      summaryId,
      tenantId: snapshot.tenantId,
      patientId: snapshot.patientId,
      generatedAt,
      generatedBy: actorId,
      immutable: true,
      schemaVersion: 1,
      ...body,
      contentHash,
    };

    const bytes = Buffer.byteLength(
      JSON.stringify(sanitizeForFirestore(summary)),
      'utf8'
    );
    if (bytes > 700_000) {
      throw new Error(`CI10B_SUMMARY_TOO_LARGE:${bytes}`);
    }

    return summary;
  }

  public static async generateAuthoritatively(
    context: CommandContext,
    patientId: string
  ): Promise<ClinicalLongitudinalSummaryResponse> {
    const snapshot = await ClinicalEvidenceService.createAuthoritativeSnapshot(
      context,
      patientId,
      'LONGITUDINAL_SUMMARY'
    );

    const proposed = this.build(snapshot, context.actorId);
    const db = getAdminFirestore();
    if (!db) throw new Error('CI10B_SUMMARY_STORE_UNAVAILABLE');

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const summaryRef = tenantRef
      .collection('clinicalLongitudinalSummaries')
      .doc(proposed.summaryId);

    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(summaryRef);
      if (existing.exists) {
        const persisted = existing.data() as ClinicalLongitudinalSummary;
        if (
          persisted.contentHash !== proposed.contentHash ||
          persisted.evidenceSnapshotId !== snapshot.snapshotId ||
          persisted.patientId !== patientId ||
          persisted.tenantId !== context.tenantId
        ) {
          throw new Error('CI10B_SUMMARY_IMMUTABILITY_VIOLATION');
        }
        return;
      }

      const now = Date.now();
      const eventId = `evt_${crypto.randomUUID()}`;
      const auditId = `aud_${crypto.randomUUID()}`;
      const outboxId = `obx_${crypto.randomUUID()}`;

      const event: DomainEventEnvelope = {
        eventId,
        tenantId: context.tenantId,
        aggregateType: 'CLINICAL_LONGITUDINAL_SUMMARY',
        aggregateId: proposed.summaryId,
        eventType: 'CLINICAL_LONGITUDINAL_SUMMARY_GENERATED',
        eventVersion: 1,
        payload: {
          summaryId: proposed.summaryId,
          patientId,
          evidenceSnapshotId: snapshot.snapshotId,
          evidenceSnapshotHash: snapshot.snapshotHash,
          patient360Revision: snapshot.patient360Revision,
          claimCount: proposed.claimCount,
          contentHash: proposed.contentHash,
          policyVersion: proposed.policyVersion,
        },
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        occurredAt: now,
        recordedAt: now,
        correlationId: context.correlationId,
        commandId: `ci10b-summary:${proposed.summaryId}`,
        idempotencyKey: proposed.summaryId,
        source: 'system',
        schemaVersion: 1,
      };

      transaction.create(summaryRef, sanitizeForFirestore(proposed));
      transaction.create(
        tenantRef.collection('events').doc(eventId),
        sanitizeForFirestore(event)
      );
      transaction.create(
        tenantRef.collection('audit_logs').doc(auditId),
        sanitizeForFirestore({
          auditId,
          tenantId: context.tenantId,
          actorId: context.actorId,
          actorRole: context.roles[0] || 'CLINICIAN',
          action: 'GENERATE_CLINICAL_LONGITUDINAL_SUMMARY',
          resourceType: 'CLINICAL_LONGITUDINAL_SUMMARY',
          resourceId: proposed.summaryId,
          commandId: event.commandId,
          eventId,
          correlationId: context.correlationId,
          occurredAt: now,
          recordedAt: now,
          reason: `Generated evidence-grounded longitudinal summary for patient ${patientId}`,
          metadata: {
            patientId,
            evidenceSnapshotId: snapshot.snapshotId,
            evidenceSnapshotHash: snapshot.snapshotHash,
            claimCount: proposed.claimCount,
            contentHash: proposed.contentHash,
            policyVersion: proposed.policyVersion,
          },
        })
      );
      transaction.create(
        tenantRef.collection('outbox').doc(outboxId),
        sanitizeForFirestore({
          outboxId,
          tenantId: context.tenantId,
          eventId,
          eventType: event.eventType,
          topic: 'g-hims-clinical-intelligence-events',
          payload: event.payload,
          status: 'PENDING',
          attempts: 0,
          maxAttempts: 5,
          nextAttemptAt: now,
          createdAt: now,
        })
      );
    });

    const persisted = await summaryRef.get();
    if (!persisted.exists) {
      throw new Error('CI10B_SUMMARY_PERSISTENCE_FAILED');
    }

    return {
      summary: persisted.data() as ClinicalLongitudinalSummary,
      evidenceIndex: evidenceIndex(snapshot),
    };
  }

  public static async get(
    tenantId: string,
    summaryId: string
  ): Promise<ClinicalLongitudinalSummary | null> {
    const db = getAdminFirestore();
    if (!db) throw new Error('CI10B_SUMMARY_STORE_UNAVAILABLE');

    const document = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('clinicalLongitudinalSummaries')
      .doc(summaryId)
      .get();

    return document.exists
      ? (document.data() as ClinicalLongitudinalSummary)
      : null;
  }
}
