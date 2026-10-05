import crypto from 'node:crypto';
import { getAdminFirestore } from '@/server/firebase/admin';
import { sanitizeForFirestore } from '@/lib/firestore/sanitize';
import type { CommandContext, DomainEventEnvelope } from '@/lib/backend/types';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import type {
  ClinicalEvidenceRef,
  ClinicalEvidenceSnapshot,
} from '@/types/clinical-intelligence-evidence';
import type {
  ClinicalEncounterPreparationBrief,
  ClinicalEncounterPreparationResponse,
  EncounterPreparationAttention,
  EncounterPreparationClaim,
  EncounterPreparationEvidenceIndexItem,
  EncounterPreparationSection,
  EncounterPreparationSectionId,
  EncounterPreparationSectionState,
} from '@/types/clinical-encounter-preparation';

const POLICY_VERSION = 'ci10c-encounter-preparation-v1' as const;
const MAX_SECTION_CLAIMS = 30;

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalStringify(item)).join(',') + ']';
  }
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object)
    .sort()
    .map((key) => JSON.stringify(key) + ':' + canonicalStringify(object[key]))
    .join(',') + '}';
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
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

function timestampValue(value: unknown): number | undefined {
  const numeric = numberValue(value);
  if (numeric !== undefined) return numeric;
  if (typeof value === 'string' && value.trim()) {
    const numericString = Number(value);
    if (Number.isFinite(numericString)) return numericString;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function iso(value: unknown): string | undefined {
  const numeric = timestampValue(value);
  if (numeric === undefined) return undefined;
  const date = new Date(numeric);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function sourceRefs(
  snapshot: ClinicalEvidenceSnapshot,
  ...types: ClinicalEvidenceRef['sourceType'][]
): ClinicalEvidenceRef[] {
  const set = new Set(types);
  return snapshot.evidenceRefs.filter((item) => set.has(item.sourceType));
}

function dedupeByEntity(
  refs: ClinicalEvidenceRef[],
  preferredTypes: ClinicalEvidenceRef['sourceType'][] = []
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
    if (seen.has(item.sourceEntityId)) return false;
    seen.add(item.sourceEntityId);
    return true;
  });
}

function attentionRank(value: EncounterPreparationAttention): number {
  return (
    {
      CRITICAL_REVIEW_REQUIRED: 4,
      ACTION_REQUIRED: 3,
      REVIEW_REQUIRED: 2,
      INFORMATION: 1,
    } as Record<string, number>
  )[value] || 1;
}

function normalizeAttention(value: unknown): EncounterPreparationAttention {
  const candidate = stringValue(value).toUpperCase();
  if (
    [
      'CRITICAL_REVIEW_REQUIRED',
      'ACTION_REQUIRED',
      'REVIEW_REQUIRED',
      'INFORMATION',
    ].includes(candidate)
  ) {
    return candidate as EncounterPreparationAttention;
  }
  return 'INFORMATION';
}

function claim(
  snapshot: ClinicalEvidenceSnapshot,
  sectionId: EncounterPreparationSectionId,
  text: string,
  evidence: ClinicalEvidenceRef[],
  options: {
    classification?: EncounterPreparationClaim['classification'];
    attention?: EncounterPreparationAttention;
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
    evidenceRefs,
    confidence: 1,
    attention: options.attention || 'INFORMATION',
    ...(options.caveat ? { caveat: options.caveat } : {}),
    ...(options.occurredAt !== undefined
      ? { occurredAt: options.occurredAt }
      : {}),
  };
}

function section(
  sectionId: EncounterPreparationSectionId,
  title: string,
  inputClaims: EncounterPreparationClaim[],
  options: {
    caveats?: string[];
    emptyCaveat?: string;
    emptyState?: EncounterPreparationSectionState;
    forceState?: EncounterPreparationSectionState;
  } = {}
): EncounterPreparationSection {
  const ordered = [...inputClaims].sort(
    (left, right) =>
      attentionRank(right.attention) - attentionRank(left.attention) ||
      Number(right.occurredAt || 0) - Number(left.occurredAt || 0) ||
      left.claimId.localeCompare(right.claimId)
  );
  const caveats = [...(options.caveats || [])];
  let claims = ordered;
  let state: EncounterPreparationSectionState =
    options.forceState ||
    (ordered.length > 0
      ? 'SUPPORTED'
      : options.emptyState || 'NO_REPRESENTED_DATA');

  if (ordered.length === 0 && options.emptyCaveat) {
    caveats.push(options.emptyCaveat);
  }
  if (ordered.length > MAX_SECTION_CLAIMS) {
    claims = ordered.slice(0, MAX_SECTION_CLAIMS);
    state = 'PARTIAL';
    caveats.push(
      `Showing ${MAX_SECTION_CLAIMS} of ${ordered.length} evidence-backed items. Review the source chart for the complete set.`
    );
  }

  return {
    sectionId,
    title,
    state,
    claims,
    caveats: Array.from(new Set(caveats)),
  };
}

function interpretationText(evidence: ClinicalEvidenceRef): string {
  const interpretation = record(evidence.content).interpretation;
  if (typeof interpretation === 'string') return interpretation.trim();
  if (!Array.isArray(interpretation)) return '';

  return interpretation
    .map((value) => {
      const item = record(value);
      if (stringValue(item.text)) return stringValue(item.text);
      const codings = Array.isArray(item.codings) ? item.codings : [];
      const first = codings.length ? record(codings[0]) : {};
      return stringValue(first.display) || stringValue(first.code);
    })
    .filter(Boolean)
    .join(', ');
}

function isAbnormalInterpretation(value: string): boolean {
  return /\b(H|L|HH|LL|HIGH|LOW|ABNORMAL|CRITICAL|PANIC)\b/i.test(value);
}

function currentEncounter(snapshot: ClinicalEvidenceSnapshot): ClinicalEvidenceRef {
  const ref = snapshot.evidenceRefs.find(
    (item) =>
      item.sourceType === 'ENCOUNTER_CONTEXT' &&
      item.sourceEntityId === snapshot.scope?.encounterId
  );
  if (!ref) throw new Error('CI10C_ENCOUNTER_CONTEXT_EVIDENCE_MISSING');
  return ref;
}

function previousEncounter(
  snapshot: ClinicalEvidenceSnapshot,
  current: ClinicalEvidenceRef
): ClinicalEvidenceRef | undefined {
  const currentContent = record(record(current.content).encounter);
  const currentStartedAt =
    timestampValue(currentContent.startedAt) ||
    current.occurredAt ||
    Number.MAX_SAFE_INTEGER;

  return sourceRefs(snapshot, 'ENCOUNTER_HISTORY')
    .filter((item) => item.sourceEntityId !== current.sourceEntityId)
    .filter((item) => {
      const content = record(item.content);
      const startedAt =
        timestampValue(content.startedAt) ||
        timestampValue(content.createdAt) ||
        item.occurredAt ||
        0;
      return startedAt < currentStartedAt;
    })
    .sort((left, right) => {
      const l = record(left.content);
      const r = record(right.content);
      const leftTime =
        timestampValue(l.completedAt) ||
        timestampValue(l.dischargeDate) ||
        timestampValue(l.startedAt) ||
        left.occurredAt ||
        0;
      const rightTime =
        timestampValue(r.completedAt) ||
        timestampValue(r.dischargeDate) ||
        timestampValue(r.startedAt) ||
        right.occurredAt ||
        0;
      return rightTime - leftTime;
    })[0];
}

function encounterBaseline(ref?: ClinicalEvidenceRef): number | undefined {
  if (!ref) return undefined;
  const content = record(ref.content);
  return (
    timestampValue(content.completedAt) ||
    timestampValue(content.dischargeDate) ||
    timestampValue(content.startedAt) ||
    ref.occurredAt
  );
}

function evidenceAfter(
  refs: ClinicalEvidenceRef[],
  baseline?: number
): ClinicalEvidenceRef[] {
  if (baseline === undefined) return [];
  return refs.filter((item) => {
    const latestRepresentedAt = Math.max(
      Number(item.occurredAt || 0),
      Number(item.recordedAt || 0)
    );
    return latestRepresentedAt > baseline;
  });
}

function buildReasonForVisit(
  snapshot: ClinicalEvidenceSnapshot,
  encounterRef: ClinicalEvidenceRef
): EncounterPreparationSection {
  const wrapper = record(encounterRef.content);
  const encounter = record(wrapper.encounter);
  const reason =
    stringValue(encounter.chiefComplaint) ||
    stringValue(encounter.reasonForVisit) ||
    stringValue(encounter.presentingComplaint) ||
    stringValue(encounter.complaint);

  const context =
    stringValue(encounter.careSetting) ||
    stringValue(encounter.encounterType) ||
    snapshot.scope?.careSetting ||
    'Clinical';
  const department = stringValue(encounter.department);
  const startedAt = iso(encounter.startedAt || encounterRef.occurredAt);

  const claims: EncounterPreparationClaim[] = [
    claim(
      snapshot,
      'REASON_FOR_VISIT',
      `Current ${context} encounter${department ? ` in ${department}` : ''}${startedAt ? `, started ${startedAt}` : ''}.`,
      [encounterRef],
      { occurredAt: encounterRef.occurredAt }
    ),
  ];

  if (reason) {
    claims.unshift(
      claim(
        snapshot,
        'REASON_FOR_VISIT',
        `Recorded reason for visit: ${reason}.`,
        [encounterRef],
        {
          attention: 'REVIEW_REQUIRED',
          occurredAt: encounterRef.occurredAt,
        }
      )
    );
  }

  return section('REASON_FOR_VISIT', 'Why the patient is here', claims, {
    forceState: reason ? 'SUPPORTED' : 'REVIEW_REQUIRED',
    caveats: reason
      ? []
      : [
          'No chief complaint or reason-for-visit text is represented in the selected encounter. Establish this directly with the patient before relying on the brief.',
        ],
  });
}

function buildActiveProblems(
  snapshot: ClinicalEvidenceSnapshot
): EncounterPreparationSection {
  const claims: EncounterPreparationClaim[] = [];

  for (const item of sourceRefs(snapshot, 'CONDITION').filter(
    (ref) =>
      stringValue(record(ref.content).clinicalStatus).toUpperCase() === 'ACTIVE'
  )) {
    claims.push(
      claim(
        snapshot,
        'ACTIVE_PROBLEMS',
        `Active problem: ${item.label}.`,
        [item],
        {
          attention: 'REVIEW_REQUIRED',
          occurredAt: item.occurredAt,
        }
      )
    );
  }

  for (const item of sourceRefs(snapshot, 'ALLERGY').filter(
    (ref) => stringValue(record(ref.content).criticality).toUpperCase() === 'HIGH'
  )) {
    claims.push(
      claim(
        snapshot,
        'ACTIVE_PROBLEMS',
        `High-criticality allergy/intolerance: ${item.label}.`,
        [item],
        {
          attention: 'ACTION_REQUIRED',
          occurredAt: item.occurredAt,
        }
      )
    );
  }

  const medications = dedupeByEntity(
    sourceRefs(snapshot, 'MEDICATION_HISTORY', 'MEDICATION'),
    ['MEDICATION_HISTORY', 'MEDICATION']
  ).filter(
    (item) =>
      stringValue(record(item.content).status || item.status).toUpperCase() ===
      'ACTIVE'
  );

  for (const item of medications.slice(0, 15)) {
    const data = record(item.content);
    const dosage = stringValue(data.dosageText);
    claims.push(
      claim(
        snapshot,
        'ACTIVE_PROBLEMS',
        `Current medication: ${item.label}${dosage ? ` — ${dosage}` : ''}.`,
        [item],
        { occurredAt: item.occurredAt }
      )
    );
  }

  return section('ACTIVE_PROBLEMS', 'Major active clinical context', claims, {
    emptyCaveat:
      'No active problem, high-criticality allergy or active medication claim is represented. This is not proof that none exist.',
    emptyState: 'REVIEW_REQUIRED',
  });
}

function describeChange(item: ClinicalEvidenceRef): string {
  const data = record(item.content);
  switch (item.sourceType) {
    case 'CONDITION':
      return `Problem-list change: ${item.label} (status: ${stringValue(data.clinicalStatus) || item.status || 'UNKNOWN'}).`;
    case 'MEDICATION_HISTORY':
    case 'MEDICATION':
      return `Medication record changed: ${item.label} (status: ${stringValue(data.status) || item.status || 'UNKNOWN'}).`;
    case 'DIAGNOSTIC_REPORT_HISTORY':
    case 'DIAGNOSTIC_REPORT':
      return `Diagnostic report added/updated: ${item.label} (status: ${stringValue(data.status) || item.status || 'UNKNOWN'}).`;
    case 'PROCEDURE':
      return `Procedure record added/updated: ${item.label} (status: ${stringValue(data.status) || item.status || 'UNKNOWN'}).`;
    case 'CARE_PLAN':
      return `Care plan changed: ${item.label} (status: ${stringValue(data.status) || item.status || 'UNKNOWN'}).`;
    case 'CONSULTANT_CHANGE':
      return stringValue(data.statement) || item.label;
    default:
      return `${item.label} changed in the represented chart.`;
  }
}

function buildChangesSinceLastEncounter(
  snapshot: ClinicalEvidenceSnapshot,
  baseline?: number
): EncounterPreparationSection {
  if (baseline === undefined) {
    return section(
      'CHANGES_SINCE_LAST_ENCOUNTER',
      'Changes since the last encounter',
      [],
      {
        emptyState: 'REVIEW_REQUIRED',
        emptyCaveat:
          'No prior encounter baseline is represented, so “since last encounter” cannot be calculated safely.',
      }
    );
  }

  const candidateTypes: ClinicalEvidenceRef['sourceType'][] = [
    'CONDITION',
    'MEDICATION_HISTORY',
    'DIAGNOSTIC_REPORT_HISTORY',
    'PROCEDURE',
    'CARE_PLAN',
    'CONSULTANT_CHANGE',
  ];
  const changed = evidenceAfter(
    sourceRefs(snapshot, ...candidateTypes),
    baseline
  );

  const claims = changed.map((item) =>
    claim(
      snapshot,
      'CHANGES_SINCE_LAST_ENCOUNTER',
      describeChange(item),
      [item],
      {
        attention:
          item.sourceType === 'CONSULTANT_CHANGE'
            ? normalizeAttention(record(item.content).severity || item.status)
            : 'REVIEW_REQUIRED',
        occurredAt: item.occurredAt,
      }
    )
  );

  return section(
    'CHANGES_SINCE_LAST_ENCOUNTER',
    'Changes since the last encounter',
    claims,
    {
      emptyCaveat:
        'No represented change was derived after the prior encounter baseline. This does not prove that nothing changed outside the captured evidence.',
    }
  );
}

function buildAbnormalInvestigations(
  snapshot: ClinicalEvidenceSnapshot,
  baseline?: number
): EncounterPreparationSection {
  const claims: EncounterPreparationClaim[] = [];

  const observations = dedupeByEntity(
    sourceRefs(snapshot, 'OBSERVATION_HISTORY', 'OBSERVATION'),
    ['OBSERVATION_HISTORY', 'OBSERVATION']
  );

  for (const item of observations) {
    if (
      baseline !== undefined &&
      (item.occurredAt === undefined || item.occurredAt <= baseline)
    ) {
      continue;
    }
    const interpretation = interpretationText(item);
    if (!interpretation || !isAbnormalInterpretation(interpretation)) continue;

    claims.push(
      claim(
        snapshot,
        'NEW_ABNORMAL_INVESTIGATIONS',
        `${item.label} is source-marked ${interpretation}.`,
        [item],
        {
          attention: /CRITICAL|PANIC|HH|LL/i.test(interpretation)
            ? 'CRITICAL_REVIEW_REQUIRED'
            : 'REVIEW_REQUIRED',
          caveat:
            'This reports the source interpretation only; clinical significance is not independently inferred.',
          occurredAt: item.occurredAt,
        }
      )
    );
  }

  for (const item of sourceRefs(snapshot, 'CLINICAL_OPEN_ITEM')) {
    const data = record(item.content);
    if (
      stringValue(data.category).toUpperCase() !== 'DIAGNOSTIC' ||
      stringValue(data.status).toUpperCase() === 'RESOLVED'
    ) {
      continue;
    }
    const priority = normalizeAttention(
      data.clinicalPriority || item.status
    );
    if (
      priority !== 'CRITICAL_REVIEW_REQUIRED' &&
      priority !== 'ACTION_REQUIRED'
    ) {
      continue;
    }

    claims.push(
      claim(
        snapshot,
        'NEW_ABNORMAL_INVESTIGATIONS',
        stringValue(data.description) || item.label,
        [item],
        {
          attention: priority,
          occurredAt: item.occurredAt,
        }
      )
    );
  }

  return section(
    'NEW_ABNORMAL_INVESTIGATIONS',
    'New abnormal investigations',
    claims,
    {
      emptyCaveat:
        'No source-marked abnormal observation or high-priority diagnostic attention item is represented after the available baseline.',
    }
  );
}

function buildMedicationChanges(
  snapshot: ClinicalEvidenceSnapshot,
  baseline?: number
): EncounterPreparationSection {
  const claims: EncounterPreparationClaim[] = [];
  const medicationHistory = dedupeByEntity(
    sourceRefs(snapshot, 'MEDICATION_HISTORY')
  );

  for (const item of medicationHistory) {
    if (
      baseline !== undefined &&
      (item.occurredAt === undefined || item.occurredAt <= baseline)
    ) {
      continue;
    }
    if (baseline === undefined) continue;

    const data = record(item.content);
    claims.push(
      claim(
        snapshot,
        'MEDICATION_CHANGES',
        `Medication order: ${item.label} (status: ${stringValue(data.status) || item.status || 'UNKNOWN'}).`,
        [item],
        {
          attention: 'REVIEW_REQUIRED',
          caveat:
            'The medication-order state is reported without inferring why therapy was started, stopped, held or changed.',
          occurredAt: item.occurredAt,
        }
      )
    );
  }

  for (const item of sourceRefs(snapshot, 'CONSULTANT_CHANGE')) {
    const data = record(item.content);
    if (stringValue(data.category).toUpperCase() !== 'MEDICATIONS') continue;
    claims.push(
      claim(
        snapshot,
        'MEDICATION_CHANGES',
        stringValue(data.statement) || item.label,
        [item],
        {
          attention: normalizeAttention(data.severity || item.status),
          occurredAt: item.occurredAt,
        }
      )
    );
  }

  return section(
    'MEDICATION_CHANGES',
    'Medication changes',
    claims,
    {
      emptyCaveat:
        'No evidence-backed medication change is represented for the available comparison window.',
    }
  );
}

function buildOutstandingWork(
  snapshot: ClinicalEvidenceSnapshot
): EncounterPreparationSection {
  const claims = sourceRefs(snapshot, 'CLINICAL_OPEN_ITEM')
    .filter((item) => {
      const data = record(item.content);
      const status = stringValue(data.status).toUpperCase();
      const category = stringValue(data.category).toUpperCase();
      return (
        status !== 'RESOLVED' &&
        !['DATA_QUALITY', 'MEDICATION'].includes(category)
      );
    })
    .map((item) => {
      const data = record(item.content);
      return claim(
        snapshot,
        'OUTSTANDING_WORK',
        stringValue(data.description) || item.label,
        [item],
        {
          attention: normalizeAttention(
            data.clinicalPriority || item.status
          ),
          occurredAt: item.occurredAt,
        }
      );
    });

  return section(
    'OUTSTANDING_WORK',
    'Outstanding orders, follow-up and care-team work',
    claims,
    {
      emptyCaveat:
        'No unresolved non-medication work item is represented for this encounter. External or undocumented work may still exist.',
    }
  );
}

function buildRecentAdmissions(
  snapshot: ClinicalEvidenceSnapshot,
  currentEncounterId: string
): EncounterPreparationSection {
  const claims = sourceRefs(snapshot, 'ENCOUNTER_HISTORY')
    .filter((item) => item.sourceEntityId !== currentEncounterId)
    .filter((item) => {
      const data = record(item.content);
      const setting = (
        stringValue(data.careSetting) ||
        stringValue(data.encounterType) ||
        item.label
      ).toUpperCase();
      return /IPD|INPATIENT|EMERGENCY|ED|ADMISSION/.test(setting);
    })
    .sort(
      (left, right) =>
        Number(right.occurredAt || 0) - Number(left.occurredAt || 0)
    )
    .slice(0, 5)
    .map((item) => {
      const data = record(item.content);
      const setting =
        stringValue(data.careSetting) ||
        stringValue(data.encounterType) ||
        item.label;
      const status = stringValue(data.status || item.status) || 'UNKNOWN';
      const started = iso(
        data.startedAt || data.createdAt || data.admitDate || item.occurredAt
      );
      const ended = iso(data.completedAt || data.dischargeDate);
      return claim(
        snapshot,
        'RECENT_ADMISSION_DISCHARGE',
        `${setting} encounter (status: ${status})${started ? `, started ${started}` : ''}${ended ? `, ended ${ended}` : ''}.`,
        [item],
        {
          attention: 'REVIEW_REQUIRED',
          occurredAt: item.occurredAt,
        }
      );
    });

  return section(
    'RECENT_ADMISSION_DISCHARGE',
    'Relevant recent admission / emergency history',
    claims,
    {
      emptyCaveat:
        'No recent inpatient/emergency encounter is represented in the frozen canonical history. This is not proof that none occurred elsewhere.',
    }
  );
}

function conditionIdentity(item: ClinicalEvidenceRef): string {
  const data = record(item.content);
  const code = stringValue(data.code).toLowerCase();
  const display =
    stringValue(data.display).toLowerCase() ||
    item.label.toLowerCase();
  return code ? `code:${code}` : `display:${display}`;
}

function knowledgeEvidence(
  snapshot: ClinicalEvidenceSnapshot
): ClinicalEvidenceRef | undefined {
  return sourceRefs(snapshot, 'KNOWLEDGE_STATUS')[0];
}

function buildContradictions(
  snapshot: ClinicalEvidenceSnapshot
): EncounterPreparationSection {
  const claims: EncounterPreparationClaim[] = [];
  const conditions = sourceRefs(snapshot, 'CONDITION');
  const groups = new Map<string, ClinicalEvidenceRef[]>();

  for (const item of conditions) {
    const key = conditionIdentity(item);
    const list = groups.get(key) || [];
    list.push(item);
    groups.set(key, list);
  }

  for (const items of groups.values()) {
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
          `Possible problem-list contradiction: ${items[0].label} is represented with both ACTIVE and RESOLVED states.`,
          items,
          {
            classification: 'POSSIBLE_DISCREPANCY',
            attention: 'REVIEW_REQUIRED',
          }
        )
      );
    }
  }

  const knowledge = knowledgeEvidence(snapshot);
  if (knowledge) {
    const data = record(knowledge.content);
    const checks: Array<{
      field: string;
      label: string;
      refs: ClinicalEvidenceRef[];
    }> = [
      {
        field: 'allergyKnowledge',
        label: 'allergy',
        refs: sourceRefs(snapshot, 'ALLERGY'),
      },
      {
        field: 'problemListKnowledge',
        label: 'problem-list',
        refs: conditions.filter(
          (item) =>
            stringValue(record(item.content).clinicalStatus).toUpperCase() ===
            'ACTIVE'
        ),
      },
      {
        field: 'medicationKnowledge',
        label: 'medication',
        refs: dedupeByEntity(
          sourceRefs(snapshot, 'MEDICATION_HISTORY', 'MEDICATION')
        ).filter(
          (item) =>
            stringValue(record(item.content).status || item.status).toUpperCase() ===
            'ACTIVE'
        ),
      },
    ];

    for (const check of checks) {
      if (
        stringValue(data[check.field]).toUpperCase() === 'KNOWN_NONE' &&
        check.refs.length > 0
      ) {
        claims.push(
          claim(
            snapshot,
            'CONTRADICTIONS',
            `Possible ${check.label} knowledge contradiction: status is KNOWN_NONE while represented ${check.label} evidence exists.`,
            [knowledge, ...check.refs],
            {
              classification: 'POSSIBLE_DISCREPANCY',
              attention: 'ACTION_REQUIRED',
            }
          )
        );
      }
    }
  }

  return section(
    'CONTRADICTIONS',
    'Contradictions requiring review',
    claims,
    {
      emptyCaveat:
        'No deterministic contradiction rule fired on the represented evidence. This does not prove the chart is internally consistent beyond implemented rules.',
    }
  );
}

function buildMedicationDiscrepancies(
  snapshot: ClinicalEvidenceSnapshot
): EncounterPreparationSection {
  const claims = sourceRefs(snapshot, 'MEDICATION_SAFETY_FINDING').map(
    (item) => {
      const data = record(item.content);
      const title = stringValue(data.title) || item.label;
      const description = stringValue(data.description);
      const type = stringValue(data.type).toUpperCase();
      const discrepancy =
        type === 'MEDICATION_ALLERGY_CONFLICT' ||
        type === 'DUPLICATE_ACTIVE_MEDICATION';

      return claim(
        snapshot,
        'MEDICATION_DISCREPANCIES',
        `${title}${description ? `: ${description}` : ''}`,
        [item],
        {
          classification: discrepancy
            ? 'POSSIBLE_DISCREPANCY'
            : 'DIRECT_FACT',
          attention: normalizeAttention(data.severity || item.status),
          caveat:
            'This is a CI-9 deterministic medication-safety finding and requires clinician reconciliation; it is not an autonomous medication decision.',
          occurredAt: item.occurredAt,
        }
      );
    }
  );

  return section(
    'MEDICATION_DISCREPANCIES',
    'Medication reconciliation and discrepancy review',
    claims,
    {
      emptyCaveat:
        'No CI-9 finding is represented for this encounter. Absence of a finding is not proof of medication safety.',
    }
  );
}

function buildMissingInformation(
  snapshot: ClinicalEvidenceSnapshot
): EncounterPreparationSection {
  const claims: EncounterPreparationClaim[] = [];
  const knowledge = knowledgeEvidence(snapshot);

  if (knowledge) {
    const data = record(knowledge.content);
    const fields = [
      ['allergyKnowledge', 'Allergy knowledge'],
      ['problemListKnowledge', 'Problem-list knowledge'],
      ['medicationKnowledge', 'Medication knowledge'],
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
              attention: 'ACTION_REQUIRED',
            }
          )
        );
      }
    }

    const missing = Array.isArray(data.missingCanonicalFacts)
      ? data.missingCanonicalFacts
          .map((value) => stringValue(value))
          .filter(Boolean)
      : [];
    for (const item of missing) {
      claims.push(
        claim(
          snapshot,
          'MISSING_INFORMATION',
          `Canonical clinical information is incomplete: ${item.replace(/_/g, ' ').toLowerCase()}.`,
          [knowledge],
          {
            attention: 'REVIEW_REQUIRED',
          }
        )
      );
    }
  }

  for (const item of sourceRefs(snapshot, 'CLINICAL_OPEN_ITEM')) {
    const data = record(item.content);
    if (stringValue(data.category).toUpperCase() !== 'DATA_QUALITY') continue;
    if (stringValue(data.status).toUpperCase() === 'RESOLVED') continue;

    claims.push(
      claim(
        snapshot,
        'MISSING_INFORMATION',
        stringValue(data.description) || item.label,
        [item],
        {
          attention: normalizeAttention(
            data.clinicalPriority || item.status
          ),
          occurredAt: item.occurredAt,
        }
      )
    );
  }

  return section(
    'MISSING_INFORMATION',
    'Missing or incomplete information',
    claims,
    {
      emptyCaveat:
        'No explicit missing-information flag is represented. This does not prove the chart is complete.',
    }
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
    actorId: string,
    generatedAt = Date.now()
  ): ClinicalEncounterPreparationBrief {
    if (snapshot.purpose !== 'ENCOUNTER_PREP') {
      throw new Error('CI10C_EVIDENCE_PURPOSE_MISMATCH');
    }

    const encounterId = stringValue(snapshot.scope?.encounterId);
    if (!encounterId) throw new Error('CI10C_ENCOUNTER_SCOPE_REQUIRED');
    if (
      snapshot.scope?.actorId &&
      snapshot.scope.actorId !== actorId
    ) {
      throw new Error('CI10C_ACTOR_SCOPE_MISMATCH');
    }

    const encounterRef = currentEncounter(snapshot);
    const previous = previousEncounter(snapshot, encounterRef);
    const previousAt = encounterBaseline(previous);

    const sections: EncounterPreparationSection[] = [
      buildReasonForVisit(snapshot, encounterRef),
      buildActiveProblems(snapshot),
      buildChangesSinceLastEncounter(snapshot, previousAt),
      buildAbnormalInvestigations(snapshot, previousAt),
      buildMedicationChanges(snapshot, previousAt),
      buildOutstandingWork(snapshot),
      buildRecentAdmissions(snapshot, encounterId),
      buildContradictions(snapshot),
      buildMedicationDiscrepancies(snapshot),
      buildMissingInformation(snapshot),
    ];

    const claims = sections.flatMap((item) => item.claims);
    const grounding = ClinicalEvidenceService.validateClaims(snapshot, claims);
    if (!grounding.valid) {
      throw new Error(
        `CI10C_GROUNDING_VALIDATION_FAILED:${grounding.errors.join(',')}`
      );
    }

    const attentionLevel = claims.reduce<EncounterPreparationAttention>(
      (highest, item) =>
        attentionRank(item.attention) > attentionRank(highest)
          ? item.attention
          : highest,
      'INFORMATION'
    );

    const projectionOnly = snapshot.evidenceRefs.filter(
      (item) => item.provenanceStatus === 'PROJECTION_ONLY'
    ).length;

    const warnings = Array.from(
      new Set([
        ...snapshot.limitations,
        'Encounter preparation is a chart-review aid. It does not establish diagnosis, clinical significance, treatment choice, disposition or order intent.',
        'A missing item is never treated as a negative clinical finding unless the underlying clinical knowledge state explicitly records known-none.',
        'Clinicians must verify material findings against source evidence before signing documentation or issuing orders.',
        ...(snapshot.scope?.lastReviewedAt
          ? []
          : [
              'No prior consultant-review checkpoint is represented for this actor and encounter; consultant-delta evidence may therefore include the full available timeline window.',
            ]),
        ...(projectionOnly > 0
          ? [
              `${projectionOnly} evidence item(s) have projection-only provenance and should be source-verified when material to a decision.`,
            ]
          : []),
      ])
    );

    const body = {
      encounterId,
      careSetting: snapshot.scope?.careSetting || 'UNKNOWN',
      evidenceSnapshotId: snapshot.snapshotId,
      evidenceSnapshotHash: snapshot.snapshotHash,
      patient360Revision: snapshot.patient360Revision,
      patient360SourceCheckpoint: snapshot.patient360SourceCheckpoint,
      previousEncounterId: previous?.sourceEntityId,
      previousEncounterAt: previousAt,
      lastReviewedAt: snapshot.scope?.lastReviewedAt,
      lastReviewedRevision: snapshot.scope?.lastReviewedRevision,
      policyVersion: POLICY_VERSION,
      generationMode: 'DETERMINISTIC_EVIDENCE_SYNTHESIS' as const,
      attentionLevel,
      sections,
      warnings,
      claimCount: claims.length,
      evidenceCoverage: {
        totalEvidenceRefs: snapshot.evidenceRefs.length,
        eventVerifiedRefs: snapshot.evidenceRefs.length - projectionOnly,
        projectionOnlyRefs: projectionOnly,
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
        notePrefillAllowed: false as const,
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
    encounterId: string
  ): Promise<ClinicalEncounterPreparationResponse> {
    const snapshot = await ClinicalEvidenceService.createAuthoritativeSnapshot(
      context,
      patientId,
      'ENCOUNTER_PREP',
      { encounterId }
    );

    const proposed = this.build(snapshot, context.actorId);
    const db = getAdminFirestore();
    if (!db) throw new Error('CI10C_BRIEF_STORE_UNAVAILABLE');

    const tenantRef = db.collection('tenants').doc(context.tenantId);
    const briefRef = tenantRef
      .collection('clinicalEncounterPreparationBriefs')
      .doc(proposed.briefId);

    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(briefRef);
      if (existing.exists) {
        const persisted = existing.data() as ClinicalEncounterPreparationBrief;
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
        aggregateType: 'CLINICAL_ENCOUNTER_PREPARATION',
        aggregateId: proposed.briefId,
        eventType: 'CLINICAL_ENCOUNTER_PREPARATION_GENERATED',
        eventVersion: 1,
        payload: {
          briefId: proposed.briefId,
          patientId,
          encounterId,
          evidenceSnapshotId: snapshot.snapshotId,
          evidenceSnapshotHash: snapshot.snapshotHash,
          patient360Revision: snapshot.patient360Revision,
          attentionLevel: proposed.attentionLevel,
          claimCount: proposed.claimCount,
          contentHash: proposed.contentHash,
          policyVersion: proposed.policyVersion,
        },
        actorId: context.actorId,
        actorRole: context.roles[0] || 'CLINICIAN',
        occurredAt: now,
        recordedAt: now,
        correlationId: context.correlationId,
        commandId: `ci10c-prep:${proposed.briefId}`,
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
          action: 'GENERATE_CLINICAL_ENCOUNTER_PREPARATION',
          resourceType: 'CLINICAL_ENCOUNTER_PREPARATION',
          resourceId: proposed.briefId,
          commandId: event.commandId,
          eventId,
          correlationId: context.correlationId,
          occurredAt: now,
          recordedAt: now,
          reason: `Generated evidence-grounded encounter preparation for patient ${patientId}, encounter ${encounterId}`,
          metadata: {
            patientId,
            encounterId,
            evidenceSnapshotId: snapshot.snapshotId,
            evidenceSnapshotHash: snapshot.snapshotHash,
            patient360Revision: snapshot.patient360Revision,
            attentionLevel: proposed.attentionLevel,
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
