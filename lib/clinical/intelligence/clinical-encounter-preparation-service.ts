import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import type { CommandContext, DomainEventEnvelope } from '@/lib/backend/types';
import type {
  ClinicalEvidenceRef,
  ClinicalEvidenceSnapshot,
} from '@/types/clinical-intelligence-evidence';
import type {
  ClinicalEncounterPreparationBrief,
  ClinicalEncounterPreparationResponse,
  EncounterPreparationClaim,
  EncounterPreparationEvidenceIndexItem,
  EncounterPreparationSection,
  EncounterPreparationSectionId,
  EncounterPreparationSectionState,
} from '@/types/clinical-encounter-preparation';
import type {
  ClinicalCareSetting,
  ConsultantChangeSeverity,
} from '@/types/consultant-visibility';

const POLICY_VERSION = 'ci10c-encounter-preparation-v1' as const;
const MAX_SECTION_CLAIMS = 50;

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalStringify(item)).join(',') + ']';
  }
  const item = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(item)
      .sort()
      .map(
        (key) =>
          JSON.stringify(key) + ':' + canonicalStringify(item[key])
      )
      .join(',') +
    '}'
  );
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

function normalize(value: unknown): string {
  return stringValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function iso(value: unknown): string | undefined {
  const numeric = numberValue(value);
  if (numeric === undefined) return undefined;
  const date = new Date(numeric);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function severityRank(value: ConsultantChangeSeverity): number {
  return (
    {
      CRITICAL_REVIEW_REQUIRED: 0,
      ACTION_REQUIRED: 1,
      REVIEW_REQUIRED: 2,
      INFORMATION: 3,
    } as Record<ConsultantChangeSeverity, number>
  )[value];
}

function claim(
  snapshot: ClinicalEvidenceSnapshot,
  sectionId: EncounterPreparationSectionId,
  text: string,
  evidence: ClinicalEvidenceRef[],
  options: {
    severity?: ConsultantChangeSeverity;
    classification?: EncounterPreparationClaim['classification'];
    caveat?: string;
    occurredAt?: number;
  } = {}
): EncounterPreparationClaim {
  const evidenceRefs = Array.from(
    new Set(evidence.map((item) => item.evidenceId))
  ).sort();

  return {
    claimId: stableId('ciprepclaim', [
      snapshot.snapshotId,
      sectionId,
      options.classification || 'DIRECT_FACT',
      text,
      ...evidenceRefs,
    ]),
    sectionId,
    text,
    classification: options.classification || 'DIRECT_FACT',
    severity: options.severity || 'INFORMATION',
    evidenceRefs,
    confidence: 1,
    ...(options.caveat ? { caveat: options.caveat } : {}),
    ...(options.occurredAt !== undefined
      ? { occurredAt: options.occurredAt }
      : {}),
  };
}

function section(
  sectionId: EncounterPreparationSectionId,
  title: string,
  allClaims: EncounterPreparationClaim[],
  caveats: string[] = [],
  emptyCaveat = 'No represented evidence is available for this section.'
): EncounterPreparationSection {
  const ordered = [...allClaims].sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      Number(right.occurredAt || 0) - Number(left.occurredAt || 0) ||
      left.claimId.localeCompare(right.claimId)
  );

  let state: EncounterPreparationSectionState =
    ordered.length > 0 ? 'SUPPORTED' : 'NO_REPRESENTED_DATA';
  if (
    ordered.some((item) =>
      ['CRITICAL_REVIEW_REQUIRED', 'ACTION_REQUIRED'].includes(
        item.severity
      )
    )
  ) {
    state = 'REVIEW_REQUIRED';
  }

  let claims = ordered;
  const nextCaveats = [...caveats];
  if (ordered.length === 0) nextCaveats.push(emptyCaveat);
  if (ordered.length > MAX_SECTION_CLAIMS) {
    claims = ordered.slice(0, MAX_SECTION_CLAIMS);
    state = 'PARTIAL';
    nextCaveats.push(
      `Showing ${MAX_SECTION_CLAIMS} of ${ordered.length} evidence-backed claims. Full frozen evidence remains available.`
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

function evidenceOfType(
  snapshot: ClinicalEvidenceSnapshot,
  ...types: ClinicalEvidenceRef['sourceType'][]
): ClinicalEvidenceRef[] {
  const wanted = new Set(types);
  return snapshot.evidenceRefs.filter((item) => wanted.has(item.sourceType));
}

function currentContext(
  snapshot: ClinicalEvidenceSnapshot,
  encounterId: string
): ClinicalEvidenceRef {
  const context = snapshot.evidenceRefs.find(
    (item) =>
      item.sourceType === 'ENCOUNTER_CONTEXT' &&
      item.sourceEntityId === encounterId
  );
  if (!context) throw new Error('CI10C_ENCOUNTER_CONTEXT_EVIDENCE_REQUIRED');
  return context;
}

function evidenceByEntityIds(
  snapshot: ClinicalEvidenceSnapshot,
  ids: string[]
): ClinicalEvidenceRef[] {
  const wanted = new Set(ids.filter(Boolean));
  if (wanted.size === 0) return [];
  return snapshot.evidenceRefs.filter((item) =>
    wanted.has(item.sourceEntityId)
  );
}

function encounterContextData(contextEvidence: ClinicalEvidenceRef) {
  const outer = record(contextEvidence.content);
  const encounter = record(outer.encounter);
  const authoritative = record(outer.authoritativeEncounter);
  return { outer, encounter, authoritative };
}

function lastReviewAt(contextEvidence: ClinicalEvidenceRef): number | undefined {
  return numberValue(record(contextEvidence.content).lastConsultantReviewAt);
}

function currentEncounterStartedAt(
  contextEvidence: ClinicalEvidenceRef
): number | undefined {
  const { encounter, authoritative } = encounterContextData(contextEvidence);
  return (
    numberValue(encounter.startedAt) ||
    numberValue(authoritative.startedAt) ||
    numberValue(authoritative.createdAt)
  );
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
  return stringValue(record(knowledgeRef(snapshot)?.content)[field]).toUpperCase();
}

function interpretationText(item: ClinicalEvidenceRef): string {
  const content = record(item.content);
  const interpretation = content.interpretation;
  if (typeof interpretation === 'string') return interpretation.trim();
  if (!Array.isArray(interpretation)) return '';
  return interpretation
    .map((entry) => {
      const value = record(entry);
      if (stringValue(value.text)) return stringValue(value.text);
      const codings = Array.isArray(value.codings) ? value.codings : [];
      const first = codings.length ? record(codings[0]) : {};
      return stringValue(first.display) || stringValue(first.code);
    })
    .filter(Boolean)
    .join(', ');
}

function abnormalInterpretation(value: string): boolean {
  return /\b(H|L|HH|LL|HIGH|LOW|ABNORMAL|CRITICAL|PANIC)\b/i.test(value);
}

function buildReasonForVisit(
  snapshot: ClinicalEvidenceSnapshot,
  contextEvidence: ClinicalEvidenceRef
): EncounterPreparationSection {
  const { encounter, authoritative } = encounterContextData(contextEvidence);
  const complaint =
    stringValue(authoritative.chiefComplaint) ||
    stringValue(authoritative.reasonForVisit) ||
    stringValue(authoritative.visitReason) ||
    stringValue(encounter.chiefComplaint);

  const claims = complaint
    ? [
        claim(
          snapshot,
          'REASON_FOR_VISIT',
          `Reason for current encounter: ${complaint}.`,
          [contextEvidence],
          { severity: 'INFORMATION', occurredAt: contextEvidence.occurredAt }
        ),
      ]
    : [];

  return section(
    'REASON_FOR_VISIT',
    'Why the patient is here',
    claims,
    [],
    'No chief complaint or reason-for-visit field is represented for the selected encounter.'
  );
}

function buildActiveProblems(
  snapshot: ClinicalEvidenceSnapshot
): EncounterPreparationSection {
  const claims = evidenceOfType(snapshot, 'CONDITION')
    .filter(
      (item) =>
        stringValue(record(item.content).clinicalStatus).toUpperCase() ===
        'ACTIVE'
    )
    .map((item) =>
      claim(
        snapshot,
        'MAJOR_ACTIVE_PROBLEMS',
        `Active problem: ${item.label}.`,
        [item],
        {
          severity: 'REVIEW_REQUIRED',
          occurredAt: item.occurredAt,
        }
      )
    );

  return section(
    'MAJOR_ACTIVE_PROBLEMS',
    'Major active problems',
    claims,
    [],
    'No active problem is represented. This does not prove that no active problem exists.'
  );
}

function buildChangesSinceReview(
  snapshot: ClinicalEvidenceSnapshot,
  contextEvidence: ClinicalEvidenceRef
): EncounterPreparationSection {
  const reviewAt = lastReviewAt(contextEvidence);
  const claims = evidenceOfType(snapshot, 'CONSULTANT_CHANGE').map((item) => {
    const data = record(item.content);
    const severity =
      stringValue(data.severity) as ConsultantChangeSeverity;
    return claim(
      snapshot,
      'CHANGES_SINCE_REVIEW',
      stringValue(data.statement) || item.label,
      [item],
      {
        severity: severity || 'REVIEW_REQUIRED',
        occurredAt: item.occurredAt,
      }
    );
  });

  return section(
    'CHANGES_SINCE_REVIEW',
    reviewAt ? 'Changes since your last review' : 'Clinical changes requiring review',
    claims,
    reviewAt
      ? [`Compared with consultant review checkpoint at ${iso(reviewAt) || reviewAt}.`]
      : ['No prior consultant review checkpoint exists; represented change items should be treated as unreviewed.'],
    'No unreviewed clinical-change item is represented for this care context.'
  );
}

function buildAbnormalInvestigations(
  snapshot: ClinicalEvidenceSnapshot,
  contextEvidence: ClinicalEvidenceRef
): EncounterPreparationSection {
  const threshold =
    lastReviewAt(contextEvidence) ||
    currentEncounterStartedAt(contextEvidence) ||
    0;
  const claims: EncounterPreparationClaim[] = [];

  for (const item of evidenceOfType(
    snapshot,
    'OBSERVATION_HISTORY',
    'OBSERVATION'
  )) {
    if (Number(item.occurredAt || 0) < threshold) continue;
    const interpretation = interpretationText(item);
    if (!interpretation || !abnormalInterpretation(interpretation)) continue;

    claims.push(
      claim(
        snapshot,
        'NEW_ABNORMAL_INVESTIGATIONS',
        `${item.label} is source-marked ${interpretation}.`,
        [item],
        {
          severity: /CRITICAL|PANIC|HH|LL/i.test(interpretation)
            ? 'CRITICAL_REVIEW_REQUIRED'
            : 'ACTION_REQUIRED',
          caveat:
            'The source interpretation is reported as recorded; no new diagnosis or clinical significance is inferred.',
          occurredAt: item.occurredAt,
        }
      )
    );
  }

  for (const item of evidenceOfType(snapshot, 'CONSULTANT_CHANGE')) {
    const data = record(item.content);
    if (
      stringValue(data.category) !== 'DIAGNOSTICS' ||
      stringValue(data.severity) !== 'CRITICAL_REVIEW_REQUIRED'
    ) {
      continue;
    }
    claims.push(
      claim(
        snapshot,
        'NEW_ABNORMAL_INVESTIGATIONS',
        stringValue(data.statement) || item.label,
        [item],
        {
          severity: 'CRITICAL_REVIEW_REQUIRED',
          occurredAt: item.occurredAt,
        }
      )
    );
  }

  return section(
    'NEW_ABNORMAL_INVESTIGATIONS',
    'New abnormal investigations',
    claims,
    [],
    'No source-marked abnormal investigation after the relevant review/encounter threshold is represented. Absence of a flagged item is not proof that all investigations are normal.'
  );
}

function buildMedicationChanges(
  snapshot: ClinicalEvidenceSnapshot
): EncounterPreparationSection {
  const claims = evidenceOfType(snapshot, 'CONSULTANT_CHANGE')
    .filter((item) => stringValue(record(item.content).category) === 'MEDICATIONS')
    .map((item) => {
      const data = record(item.content);
      const severity =
        (stringValue(data.severity) as ConsultantChangeSeverity) ||
        'REVIEW_REQUIRED';
      return claim(
        snapshot,
        'MEDICATION_CHANGES',
        stringValue(data.statement) || item.label,
        [item],
        {
          severity,
          caveat:
            'This reports a recorded medication change and does not infer why the therapy changed.',
          occurredAt: item.occurredAt,
        }
      );
    });

  return section(
    'MEDICATION_CHANGES',
    'Medication changes',
    claims,
    [],
    'No unreviewed medication-change event is represented for this care context.'
  );
}

function buildMedicationDiscrepancies(
  snapshot: ClinicalEvidenceSnapshot
): EncounterPreparationSection {
  const claims = evidenceOfType(
    snapshot,
    'MEDICATION_SAFETY_FINDING'
  ).map((item) => {
    const data = record(item.content);
    const related = evidenceByEntityIds(snapshot, [
      ...(Array.isArray(data.medicationOrderIds)
        ? data.medicationOrderIds.map(stringValue)
        : []),
      ...(Array.isArray(data.allergyIds)
        ? data.allergyIds.map(stringValue)
        : []),
    ]);
    const severity =
      (stringValue(data.severity) as ConsultantChangeSeverity) ||
      'REVIEW_REQUIRED';
    return claim(
      snapshot,
      'MEDICATION_DISCREPANCIES',
      stringValue(data.description) || item.label,
      [item, ...related],
      {
        severity,
        classification: 'POSSIBLE_DISCREPANCY',
        caveat:
          'This is a governed CI-9 review signal, not an autonomous medication change.',
        occurredAt: item.occurredAt,
      }
    );
  });

  return section(
    'MEDICATION_DISCREPANCIES',
    'Medication reconciliation and safety discrepancies',
    claims,
    [],
    'No current CI-9 finding is frozen into this encounter-preparation packet. This is not proof that medication therapy is safe.'
  );
}

function buildOutstandingWork(
  snapshot: ClinicalEvidenceSnapshot
): EncounterPreparationSection {
  const claims: EncounterPreparationClaim[] = [];

  for (const item of evidenceOfType(snapshot, 'CLINICAL_OPEN_ITEM')) {
    const data = record(item.content);
    const severity =
      (stringValue(data.clinicalPriority) as ConsultantChangeSeverity) ||
      'REVIEW_REQUIRED';
    claims.push(
      claim(
        snapshot,
        'OUTSTANDING_WORK',
        stringValue(data.description) || item.label,
        [item],
        { severity, occurredAt: item.occurredAt }
      )
    );
  }

  for (const item of evidenceOfType(snapshot, 'DIAGNOSTIC_ORDER')) {
    const data = record(item.content);
    const status = stringValue(data.status || item.status).toUpperCase();
    if (!['PLACED', 'ACTIVE', 'ON_HOLD'].includes(status)) continue;
    claims.push(
      claim(
        snapshot,
        'OUTSTANDING_WORK',
        `Pending investigation: ${item.label} (status: ${status}).`,
        [item],
        {
          severity:
            stringValue(data.priority).toUpperCase() === 'STAT'
              ? 'ACTION_REQUIRED'
              : 'REVIEW_REQUIRED',
          occurredAt: item.occurredAt,
        }
      )
    );
  }

  for (const item of evidenceOfType(snapshot, 'CARE_PLAN')) {
    const data = record(item.content);
    const activities = Array.isArray(data.activities) ? data.activities : [];
    for (const rawActivity of activities) {
      const activity = record(rawActivity);
      const status = stringValue(activity.status).toUpperCase();
      if (['COMPLETED', 'CANCELLED'].includes(status)) continue;
      const description =
        stringValue(activity.description) || 'Care-plan activity';
      claims.push(
        claim(
          snapshot,
          'OUTSTANDING_WORK',
          `Follow-up: ${description} (status: ${status || 'UNKNOWN'}).`,
          [item],
          {
            severity: 'REVIEW_REQUIRED',
            occurredAt:
              numberValue(activity.scheduledAt) || item.occurredAt,
          }
        )
      );
    }
  }

  return section(
    'OUTSTANDING_WORK',
    'Outstanding investigations and follow-up',
    claims,
    [],
    'No open item is represented in the frozen evidence packet. External or undocumented work may still be pending.'
  );
}

function buildRecentAdmissions(
  snapshot: ClinicalEvidenceSnapshot,
  encounterId: string
): EncounterPreparationSection {
  const claims = evidenceOfType(snapshot, 'ENCOUNTER_HISTORY', 'ENCOUNTER')
    .filter((item) => item.sourceEntityId !== encounterId)
    .filter((item) => {
      const data = record(item.content);
      const careSetting = stringValue(
        data.careSetting || data.encounterType
      ).toUpperCase();
      const status = stringValue(data.status || item.status).toUpperCase();
      return (
        ['IPD', 'EMERGENCY'].some((value) => careSetting.includes(value)) ||
        ['COMPLETED', 'DISCHARGED', 'TRANSFERRED'].includes(status)
      );
    })
    .slice(0, 10)
    .map((item) => {
      const data = record(item.content);
      const careSetting =
        stringValue(data.careSetting || data.encounterType) || item.label;
      const status = stringValue(data.status || item.status) || 'UNKNOWN';
      const started = iso(data.startedAt || item.occurredAt);
      const completed = iso(data.completedAt || data.dischargeDate);
      return claim(
        snapshot,
        'RECENT_ADMISSIONS_DISCHARGES',
        `${careSetting} encounter (status: ${status})${started ? `, started ${started}` : ''}${completed ? `, completed ${completed}` : ''}.`,
        [item],
        {
          severity: 'INFORMATION',
          occurredAt: item.occurredAt,
        }
      );
    });

  return section(
    'RECENT_ADMISSIONS_DISCHARGES',
    'Recent admissions and acute-care encounters',
    claims,
    [],
    'No prior represented admission/acute-care encounter met this deterministic selection rule.'
  );
}

function buildSafetySignals(
  snapshot: ClinicalEvidenceSnapshot
): EncounterPreparationSection {
  const claims: EncounterPreparationClaim[] = [];

  for (const item of evidenceOfType(snapshot, 'DETERIORATION_FINDING')) {
    const data = record(item.content);
    const sourceSeverity = stringValue(data.severity).toUpperCase();
    const severity: ConsultantChangeSeverity =
      sourceSeverity === 'CRITICAL'
        ? 'CRITICAL_REVIEW_REQUIRED'
        : sourceSeverity === 'ESCALATION'
          ? 'ACTION_REQUIRED'
          : sourceSeverity === 'WARNING'
            ? 'REVIEW_REQUIRED'
            : 'INFORMATION';
    claims.push(
      claim(
        snapshot,
        'SAFETY_SIGNALS',
        stringValue(data.explanation) || item.label,
        [item],
        {
          severity,
          caveat:
            'This is a deterministic CI-8 finding and requires clinician interpretation.',
          occurredAt: item.occurredAt,
        }
      )
    );
  }

  for (const item of evidenceOfType(
    snapshot,
    'DISCHARGE_READINESS_FINDING'
  )) {
    const data = record(item.content);
    const sourceSeverity = stringValue(data.severity).toUpperCase();
    claims.push(
      claim(
        snapshot,
        'SAFETY_SIGNALS',
        stringValue(data.explanation) || item.label,
        [item],
        {
          severity:
            sourceSeverity === 'BLOCKER'
              ? 'ACTION_REQUIRED'
              : sourceSeverity === 'WARNING'
                ? 'REVIEW_REQUIRED'
                : 'INFORMATION',
          caveat:
            'This is a deterministic discharge-readiness signal, not an autonomous disposition decision.',
          occurredAt: item.occurredAt,
        }
      )
    );
  }

  return section(
    'SAFETY_SIGNALS',
    'Clinical safety signals',
    claims,
    [],
    'No current CI-8/discharge-readiness finding is included in this packet; this does not establish clinical stability.'
  );
}

function buildContradictions(
  snapshot: ClinicalEvidenceSnapshot
): EncounterPreparationSection {
  const claims: EncounterPreparationClaim[] = [];
  const knowledge = knowledgeRef(snapshot);
  if (!knowledge) {
    return section(
      'CONTRADICTIONS',
      'Contradictions requiring review',
      [],
      ['Knowledge-status evidence is unavailable, so deterministic contradiction checks are incomplete.'],
      'No contradiction claim can be established from the represented evidence.'
    );
  }

  const allergyRefs = evidenceOfType(snapshot, 'ALLERGY');
  const activeMedRefs = evidenceOfType(
    snapshot,
    'MEDICATION_HISTORY',
    'MEDICATION'
  ).filter(
    (item) =>
      stringValue(record(item.content).status || item.status).toUpperCase() ===
      'ACTIVE'
  );
  const activeProblems = evidenceOfType(snapshot, 'CONDITION').filter(
    (item) =>
      stringValue(record(item.content).clinicalStatus).toUpperCase() ===
      'ACTIVE'
  );

  if (
    knowledgeStatus(snapshot, 'allergyKnowledge') === 'KNOWN_NONE' &&
    allergyRefs.length > 0
  ) {
    claims.push(
      claim(
        snapshot,
        'CONTRADICTIONS',
        'Allergy knowledge is recorded as none known while allergy/intolerance records are also represented.',
        [knowledge, ...allergyRefs],
        {
          severity: 'ACTION_REQUIRED',
          classification: 'POSSIBLE_DISCREPANCY',
        }
      )
    );
  }
  if (
    knowledgeStatus(snapshot, 'medicationKnowledge') === 'KNOWN_NONE' &&
    activeMedRefs.length > 0
  ) {
    claims.push(
      claim(
        snapshot,
        'CONTRADICTIONS',
        'Medication knowledge is recorded as none known while active medication orders are also represented.',
        [knowledge, ...activeMedRefs],
        {
          severity: 'ACTION_REQUIRED',
          classification: 'POSSIBLE_DISCREPANCY',
        }
      )
    );
  }
  if (
    knowledgeStatus(snapshot, 'problemListKnowledge') === 'KNOWN_NONE' &&
    activeProblems.length > 0
  ) {
    claims.push(
      claim(
        snapshot,
        'CONTRADICTIONS',
        'Problem-list knowledge is recorded as none known while active problems are also represented.',
        [knowledge, ...activeProblems],
        {
          severity: 'ACTION_REQUIRED',
          classification: 'POSSIBLE_DISCREPANCY',
        }
      )
    );
  }

  const grouped = new Map<string, ClinicalEvidenceRef[]>();
  for (const item of evidenceOfType(snapshot, 'CONDITION')) {
    const data = record(item.content);
    const key =
      normalize(data.code) ||
      normalize(data.display) ||
      normalize(item.label);
    if (!key) continue;
    const list = grouped.get(key) || [];
    list.push(item);
    grouped.set(key, list);
  }
  for (const items of grouped.values()) {
    const statuses = new Set(
      items.map((item) =>
        stringValue(record(item.content).clinicalStatus).toUpperCase()
      )
    );
    if (statuses.has('ACTIVE') && statuses.has('RESOLVED')) {
      claims.push(
        claim(
          snapshot,
          'CONTRADICTIONS',
          `Problem status conflict: ${items[0].label} is represented with both ACTIVE and RESOLVED states.`,
          items,
          {
            severity: 'REVIEW_REQUIRED',
            classification: 'POSSIBLE_DISCREPANCY',
          }
        )
      );
    }
  }

  return section(
    'CONTRADICTIONS',
    'Contradictions requiring review',
    claims,
    ['Only deterministic contradictions covered by implemented rules are surfaced.'],
    'No implemented deterministic contradiction rule fired. This is not proof that the chart is internally consistent.'
  );
}

function buildMissingInformation(
  snapshot: ClinicalEvidenceSnapshot,
  contextEvidence: ClinicalEvidenceRef
): EncounterPreparationSection {
  const claims: EncounterPreparationClaim[] = [];
  const knowledge = knowledgeRef(snapshot);

  if (knowledge) {
    const data = record(knowledge.content);
    const fields = [
      ['allergyKnowledge', 'Allergy status'],
      ['problemListKnowledge', 'Problem-list status'],
      ['medicationKnowledge', 'Medication history'],
    ] as const;
    for (const [field, label] of fields) {
      const status = stringValue(data[field]).toUpperCase();
      if (
        status &&
        !['KNOWN', 'KNOWN_NONE'].includes(status)
      ) {
        claims.push(
          claim(
            snapshot,
            'MISSING_INFORMATION',
            `${label} is ${status}.`,
            [knowledge],
            {
              severity: 'ACTION_REQUIRED',
              classification: 'DIRECT_FACT',
            }
          )
        );
      }
    }

    const missingCanonicalFacts = Array.isArray(data.missingCanonicalFacts)
      ? data.missingCanonicalFacts.map(stringValue).filter(Boolean)
      : [];
    for (const missing of missingCanonicalFacts) {
      claims.push(
        claim(
          snapshot,
          'MISSING_INFORMATION',
          `Canonical data-quality gap: ${missing}.`,
          [knowledge],
          {
            severity: 'REVIEW_REQUIRED',
            classification: 'DIRECT_FACT',
          }
        )
      );
    }
  }

  const { encounter, authoritative } = encounterContextData(contextEvidence);
  const complaint =
    stringValue(authoritative.chiefComplaint) ||
    stringValue(authoritative.reasonForVisit) ||
    stringValue(encounter.chiefComplaint);
  if (!complaint) {
    claims.push(
      claim(
        snapshot,
        'MISSING_INFORMATION',
        'The selected encounter has no represented chief complaint or reason-for-visit value.',
        [contextEvidence],
        {
          severity: 'REVIEW_REQUIRED',
          classification: 'DERIVED_FACT',
        }
      )
    );
  }

  return section(
    'MISSING_INFORMATION',
    'Missing or incomplete information',
    claims,
    [],
    'No implemented missing-information rule fired. This does not prove that the chart is complete.'
  );
}

function evidenceIndex(
  snapshot: ClinicalEvidenceSnapshot
): EncounterPreparationEvidenceIndexItem[] {
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

export class ClinicalEncounterPreparationService {
  public static build(
    snapshot: ClinicalEvidenceSnapshot,
    encounterId: string,
    actorId: string,
    generatedAt = Date.now()
  ): ClinicalEncounterPreparationBrief {
    if (snapshot.purpose !== 'ENCOUNTER_PREP') {
      throw new Error('CI10C_EVIDENCE_PURPOSE_MISMATCH');
    }

    const contextEvidence = currentContext(snapshot, encounterId);
    const context = encounterContextData(contextEvidence);
    const careSetting =
      (stringValue(context.encounter.careSetting) ||
        stringValue(context.authoritative.encounterType) ||
        'UNKNOWN') as ClinicalCareSetting;

    const sections: EncounterPreparationSection[] = [
      buildReasonForVisit(snapshot, contextEvidence),
      buildActiveProblems(snapshot),
      buildChangesSinceReview(snapshot, contextEvidence),
      buildAbnormalInvestigations(snapshot, contextEvidence),
      buildMedicationChanges(snapshot),
      buildMedicationDiscrepancies(snapshot),
      buildOutstandingWork(snapshot),
      buildRecentAdmissions(snapshot, encounterId),
      buildSafetySignals(snapshot),
      buildContradictions(snapshot),
      buildMissingInformation(snapshot, contextEvidence),
    ];

    const allClaims = sections.flatMap((item) => item.claims);
    const grounding = ClinicalEvidenceService.validateClaims(
      snapshot,
      allClaims
    );
    if (!grounding.valid) {
      throw new Error(
        `CI10C_GROUNDING_VALIDATION_FAILED:${grounding.errors.join(',')}`
      );
    }

    const projectionOnlyRefs = snapshot.evidenceRefs.filter(
      (item) => item.provenanceStatus === 'PROJECTION_ONLY'
    ).length;
    const coverageWarnings = Object.entries(snapshot.coverage || {})
      .filter(([, value]) => value.status === 'NOT_INCLUDED')
      .map(
        ([domain]) =>
          `${domain} was not included as current governed evidence for this encounter-preparation snapshot.`
      );

    const attention = {
      critical: allClaims.filter(
        (item) => item.severity === 'CRITICAL_REVIEW_REQUIRED'
      ).length,
      actionRequired: allClaims.filter(
        (item) => item.severity === 'ACTION_REQUIRED'
      ).length,
      reviewRequired: allClaims.filter(
        (item) => item.severity === 'REVIEW_REQUIRED'
      ).length,
      information: allClaims.filter(
        (item) => item.severity === 'INFORMATION'
      ).length,
    };

    const warnings = Array.from(
      new Set([
        ...snapshot.limitations,
        ...coverageWarnings,
        'This encounter brief is a chart-review aid. It does not diagnose, prescribe, order, sign, acknowledge, or close clinical work.',
        ...(projectionOnlyRefs
          ? [
              `${projectionOnlyRefs} evidence item(s) have projection-only provenance and should be checked against the source chart when material to a decision.`,
            ]
          : []),
      ])
    );

    const body = {
      encounterId,
      careSetting,
      evidenceSnapshotId: snapshot.snapshotId,
      evidenceSnapshotHash: snapshot.snapshotHash,
      patient360Revision: snapshot.patient360Revision,
      patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
      policyVersion: POLICY_VERSION,
      generationMode: 'DETERMINISTIC_EVIDENCE_SYNTHESIS' as const,
      lastConsultantReviewAt: lastReviewAt(contextEvidence),
      lastConsultantReviewRevision: numberValue(
        record(contextEvidence.content).lastConsultantReviewRevision
      ),
      sections,
      warnings,
      claimCount: allClaims.length,
      attention,
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
    const briefId = stableId('ciprep', [
      snapshot.tenantId,
      snapshot.patientId,
      encounterId,
      actorId,
      snapshot.snapshotId,
      POLICY_VERSION,
      contentHash,
    ]);

    const brief: ClinicalEncounterPreparationBrief = {
      briefId,
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
      JSON.stringify(sanitizeForFirestore(brief)),
      'utf8'
    );
    if (bytes > 700_000) {
      throw new Error(`CI10C_BRIEF_TOO_LARGE:${bytes}`);
    }

    return brief;
  }

  public static async generateAuthoritatively(
    context: CommandContext,
    patientId: string,
    encounterId: string,
    careSetting?: ClinicalCareSetting
  ): Promise<ClinicalEncounterPreparationResponse> {
    const snapshot = await ClinicalEvidenceService.createAuthoritativeSnapshot(
      context,
      patientId,
      'ENCOUNTER_PREP',
      { encounterId, careSetting }
    );
    const proposed = this.build(
      snapshot,
      encounterId,
      context.actorId
    );

    const db = getAdminFirestore();
    if (!db) throw new Error('CI10C_BRIEF_STORE_UNAVAILABLE');

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const briefRef = tenantRef
      .collection('clinicalEncounterPreparationBriefs')
      .doc(proposed.briefId);

    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(briefRef);
      if (existing.exists) {
        const persisted =
          existing.data() as ClinicalEncounterPreparationBrief;
        if (
          persisted.contentHash !== proposed.contentHash ||
          persisted.evidenceSnapshotId !== snapshot.snapshotId ||
          persisted.patientId !== patientId ||
          persisted.encounterId !== encounterId ||
          persisted.tenantId !== context.tenantId
        ) {
          throw new Error('CI10C_BRIEF_IMMUTABILITY_VIOLATION');
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
        aggregateType: 'CLINICAL_ENCOUNTER_PREPARATION_BRIEF',
        aggregateId: proposed.briefId,
        eventType: 'CLINICAL_ENCOUNTER_PREPARATION_BRIEF_GENERATED',
        eventVersion: 1,
        payload: {
          briefId: proposed.briefId,
          patientId,
          encounterId,
          careSetting: proposed.careSetting,
          evidenceSnapshotId: snapshot.snapshotId,
          evidenceSnapshotHash: snapshot.snapshotHash,
          patient360Revision: snapshot.patient360Revision,
          claimCount: proposed.claimCount,
          attention: proposed.attention,
          contentHash: proposed.contentHash,
          policyVersion: proposed.policyVersion,
        },
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        occurredAt: now,
        recordedAt: now,
        correlationId: context.correlationId,
        commandId: `ci10c-brief:${proposed.briefId}`,
        idempotencyKey: proposed.briefId,
        source: 'system',
        schemaVersion: 1,
      };

      transaction.create(briefRef, sanitizeForFirestore(proposed));
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
          action: 'GENERATE_CLINICAL_ENCOUNTER_PREPARATION_BRIEF',
          resourceType: 'CLINICAL_ENCOUNTER_PREPARATION_BRIEF',
          resourceId: proposed.briefId,
          commandId: event.commandId,
          eventId,
          correlationId: context.correlationId,
          occurredAt: now,
          recordedAt: now,
          reason: `Generated evidence-grounded encounter brief for patient ${patientId}, encounter ${encounterId}`,
          metadata: {
            patientId,
            encounterId,
            careSetting: proposed.careSetting,
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

    const persisted = await briefRef.get();
    if (!persisted.exists) {
      throw new Error('CI10C_BRIEF_PERSISTENCE_FAILED');
    }

    return {
      brief: persisted.data() as ClinicalEncounterPreparationBrief,
      evidenceIndex: evidenceIndex(snapshot),
    };
  }

  public static async get(
    tenantId: string,
    briefId: string
  ): Promise<ClinicalEncounterPreparationBrief | null> {
    const db = getAdminFirestore();
    if (!db) throw new Error('CI10C_BRIEF_STORE_UNAVAILABLE');

    const document = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('clinicalEncounterPreparationBriefs')
      .doc(briefId)
      .get();

    return document.exists
      ? (document.data() as ClinicalEncounterPreparationBrief)
      : null;
  }
}
