import crypto from 'node:crypto';
import type {
  ClinicalEvidenceRef,
  ClinicalEvidenceSnapshot,
  CopilotClaim,
} from '@/types/clinical-intelligence-evidence';
import type {
  ClinicalTrendComputationStatus,
  ClinicalTrendDirection,
  ClinicalTrendExclusion,
  ClinicalTrendMetric,
  ClinicalTrendPoint,
} from '@/types/clinical-trend-intelligence';

type MetricIdentity = {
  metricKey: string;
  codeSystem: string;
  code: string;
  display: string;
};

type QuantityIdentity = {
  value: number;
  unit: string;
  unitKey: string;
};

type ExtractedPoint = ClinicalTrendPoint & {
  metric: MetricIdentity;
  recordedAt?: number;
};

const VALID_STATUSES = new Set(['FINAL', 'AMENDED', 'CORRECTED']);
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function normalized(value: unknown): string {
  return stringValue(value).trim().toLowerCase();
}

function hash(parts: string[]): string {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function codingIdentity(
  concept: unknown,
  fallbackDisplay: string
): MetricIdentity | null {
  const data = record(concept);
  const codings = Array.isArray(data.codings)
    ? data.codings.map(record)
    : [];
  const preferred =
    codings.find((item) => normalized(item.system).includes('loinc')) ||
    codings.find(
      (item) => stringValue(item.system) && stringValue(item.code)
    );

  const code = stringValue(preferred?.code);
  const system = stringValue(preferred?.system);
  if (!code || !system) return null;

  const display =
    stringValue(data.text) ||
    stringValue(preferred?.display) ||
    fallbackDisplay ||
    code;

  return {
    metricKey: `${system.toUpperCase()}:${code.toUpperCase()}`,
    codeSystem: system,
    code,
    display,
  };
}

function quantityIdentity(value: unknown): QuantityIdentity | null {
  const quantity = record(value);
  const numeric = numberValue(quantity.value);
  if (numeric === undefined) return null;

  const system = stringValue(quantity.system);
  const code = stringValue(quantity.code);
  const unit = stringValue(quantity.unit) || code;
  if (!unit && !code) return null;

  const keyBasis = code || unit;
  const unitKey = `${(system || 'DISPLAY').toUpperCase()}:${keyBasis
    .trim()
    .toLowerCase()}`;

  return {
    value: numeric,
    unit: unit || code,
    unitKey,
  };
}

function interpretationText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!Array.isArray(value)) return '';

  return value
    .map((entry) => {
      const concept = record(entry);
      if (stringValue(concept.text)) return stringValue(concept.text);
      const codings = Array.isArray(concept.codings)
        ? concept.codings.map(record)
        : [];
      const first = codings[0];
      return stringValue(first?.display) || stringValue(first?.code);
    })
    .filter(Boolean)
    .join(', ');
}

function abnormalInterpretation(value: string): boolean {
  return /\b(H|L|HH|LL|HIGH|LOW|ABNORMAL|CRITICAL|PANIC)\b/i.test(
    value
  );
}

function sourceRangeAbnormal(
  observation: Record<string, unknown>,
  quantity: QuantityIdentity
): boolean {
  const ranges = Array.isArray(observation.referenceRange)
    ? observation.referenceRange.map(record)
    : [];

  for (const range of ranges) {
    const low = quantityIdentity(range.low);
    const high = quantityIdentity(range.high);

    if (
      low &&
      low.unitKey === quantity.unitKey &&
      quantity.value < low.value
    ) {
      return true;
    }
    if (
      high &&
      high.unitKey === quantity.unitKey &&
      quantity.value > high.value
    ) {
      return true;
    }
  }

  return false;
}

function exclusion(
  evidence: ClinicalEvidenceRef,
  reason: ClinicalTrendExclusion['reason'],
  detail: string
): ClinicalTrendExclusion {
  return {
    evidenceId: evidence.evidenceId,
    sourceEntityId: evidence.sourceEntityId,
    reason,
    detail,
  };
}

function selectObservationEvidence(
  snapshot: ClinicalEvidenceSnapshot
): ClinicalEvidenceRef[] {
  const historical = snapshot.evidenceRefs.filter(
    (item) => item.sourceType === 'OBSERVATION_HISTORY'
  );
  if (
    snapshot.coverage?.observations?.status === 'COMPLETE' ||
    historical.length > 0
  ) {
    return historical;
  }

  return snapshot.evidenceRefs.filter(
    (item) => item.sourceType === 'OBSERVATION'
  );
}

function supersededObservationIds(
  evidence: ClinicalEvidenceRef[]
): Set<string> {
  const ids = new Set<string>();

  for (const item of evidence) {
    const content = record(item.content);
    const provenance = record(content.provenance);
    for (const candidate of [
      provenance.correctedFromId,
      provenance.supersedesId,
      content.correctedFromId,
      content.supersedesId,
    ]) {
      const id = stringValue(candidate);
      if (id) ids.add(id);
    }
  }

  return ids;
}

function metricPoint(
  evidence: ClinicalEvidenceRef,
  metric: MetricIdentity,
  quantity: QuantityIdentity,
  effectiveAt: number,
  interpretation: string,
  abnormalByRange: boolean,
  observationId: string,
  status: string
): ExtractedPoint {
  return {
    metric,
    observationId,
    evidenceId: evidence.evidenceId,
    effectiveAt,
    value: quantity.value,
    unit: quantity.unit,
    unitKey: quantity.unitKey,
    status,
    interpretation: interpretation || undefined,
    abnormal: abnormalInterpretation(interpretation) || abnormalByRange,
    abnormalBasis: abnormalInterpretation(interpretation)
      ? 'SOURCE_INTERPRETATION'
      : abnormalByRange
        ? 'SOURCE_REFERENCE_RANGE'
        : undefined,
    recordedAt: evidence.recordedAt,
  };
}

function extractEvidence(
  snapshot: ClinicalEvidenceSnapshot
): {
  points: ExtractedPoint[];
  exclusions: ClinicalTrendExclusion[];
} {
  const evidence = selectObservationEvidence(snapshot);
  const superseded = supersededObservationIds(evidence);
  const points: ExtractedPoint[] = [];
  const exclusions: ClinicalTrendExclusion[] = [];

  for (const item of evidence) {
    const observation = record(item.content);
    const observationId =
      stringValue(observation.observationId) || item.sourceEntityId;
    const status = stringValue(observation.status || item.status).toUpperCase();

    if (superseded.has(observationId)) {
      exclusions.push(
        exclusion(
          item,
          'SUPERSEDED',
          'A later observation explicitly corrects or supersedes this observation.'
        )
      );
      continue;
    }

    if (!VALID_STATUSES.has(status)) {
      const reason =
        status === 'PRELIMINARY'
          ? 'PRELIMINARY'
          : status === 'CANCELLED'
            ? 'CANCELLED'
            : status === 'ENTERED_IN_ERROR'
              ? 'ENTERED_IN_ERROR'
              : 'PRELIMINARY';
      exclusions.push(
        exclusion(
          item,
          reason,
          `Observation status ${status || 'UNKNOWN'} is not eligible for deterministic longitudinal trend computation.`
        )
      );
      continue;
    }

    const effectiveAt =
      numberValue(observation.effectiveAt) ?? item.occurredAt;
    if (effectiveAt === undefined) {
      exclusions.push(
        exclusion(
          item,
          'MISSING_EFFECTIVE_TIME',
          'Observation has no usable clinical effective time.'
        )
      );
      continue;
    }
    if (effectiveAt > snapshot.createdAt + FUTURE_TOLERANCE_MS) {
      exclusions.push(
        exclusion(
          item,
          'FUTURE_EFFECTIVE_TIME',
          'Observation effective time is materially later than the evidence snapshot creation time.'
        )
      );
      continue;
    }

    const value = record(observation.value);
    const valueType = stringValue(value.valueType).toUpperCase();
    const interpretation = interpretationText(observation.interpretation);

    if (valueType === 'QUANTITY') {
      const metric = codingIdentity(observation.code, item.label);
      if (!metric) {
        exclusions.push(
          exclusion(
            item,
            'UNIDENTIFIED_METRIC',
            'Quantitative observation lacks a canonical coded metric identity.'
          )
        );
        continue;
      }

      const quantity = quantityIdentity(value.quantity);
      if (!quantity) {
        exclusions.push(
          exclusion(
            item,
            'MISSING_UNIT',
            'Quantitative observation lacks a usable numeric value or explicit unit.'
          )
        );
        continue;
      }

      points.push(
        metricPoint(
          item,
          metric,
          quantity,
          effectiveAt,
          interpretation,
          sourceRangeAbnormal(observation, quantity),
          observationId,
          status
        )
      );
      continue;
    }

    if (valueType === 'COMPONENTS') {
      const components = Array.isArray(value.components)
        ? value.components.map(record)
        : [];
      let quantitativeComponentCount = 0;

      components.forEach((component, index) => {
        const componentValue = record(component.value);
        if (
          stringValue(componentValue.valueType).toUpperCase() !==
          'QUANTITY'
        ) {
          return;
        }
        quantitativeComponentCount += 1;

        const metric = codingIdentity(
          component.code,
          `${item.label} component ${index + 1}`
        );
        if (!metric) {
          exclusions.push(
            exclusion(
              item,
              'UNIDENTIFIED_METRIC',
              `Quantitative component ${index + 1} lacks a canonical coded metric identity.`
            )
          );
          return;
        }

        const quantity = quantityIdentity(componentValue.quantity);
        if (!quantity) {
          exclusions.push(
            exclusion(
              item,
              'MISSING_UNIT',
              `Quantitative component ${index + 1} lacks a usable numeric value or explicit unit.`
            )
          );
          return;
        }

        points.push(
          metricPoint(
            item,
            metric,
            quantity,
            effectiveAt,
            interpretation,
            false,
            observationId,
            status
          )
        );
      });

      if (quantitativeComponentCount === 0) {
        exclusions.push(
          exclusion(
            item,
            'NON_QUANTITATIVE',
            'Component observation contains no quantitative component eligible for trend computation.'
          )
        );
      }
      continue;
    }

    exclusions.push(
      exclusion(
        item,
        'NON_QUANTITATIVE',
        `Observation value type ${valueType || 'UNKNOWN'} is not quantitative.`
      )
    );
  }

  return { points, exclusions };
}

function dedupeAndCheckTime(
  points: ExtractedPoint[]
): {
  usable: ExtractedPoint[];
  exclusions: ClinicalTrendExclusion[];
  conflict: boolean;
} {
  const byTime = new Map<number, ExtractedPoint[]>();
  for (const point of points) {
    const list = byTime.get(point.effectiveAt) || [];
    list.push(point);
    byTime.set(point.effectiveAt, list);
  }

  const usable: ExtractedPoint[] = [];
  const exclusions: ClinicalTrendExclusion[] = [];
  let conflict = false;

  for (const [effectiveAt, sameTime] of byTime.entries()) {
    const valueKeys = new Set(
      sameTime.map((point) => `${point.unitKey}:${point.value}`)
    );

    if (valueKeys.size > 1) {
      conflict = true;
      for (const point of sameTime) {
        exclusions.push({
          evidenceId: point.evidenceId,
          sourceEntityId: point.observationId,
          reason: 'CONFLICTING_SAME_TIME',
          detail: `Multiple different values exist for the same metric at effective time ${effectiveAt}.`,
        });
      }
      usable.push(...sameTime);
      continue;
    }

    const sorted = [...sameTime].sort(
      (left, right) =>
        Number(right.recordedAt || 0) - Number(left.recordedAt || 0) ||
        right.evidenceId.localeCompare(left.evidenceId)
    );
    usable.push(sorted[0]);

    for (const duplicate of sorted.slice(1)) {
      exclusions.push({
        evidenceId: duplicate.evidenceId,
        sourceEntityId: duplicate.observationId,
        reason: 'DUPLICATE_IDENTICAL',
        detail:
          'An identical value exists at the same effective time; the latest recorded evidence is retained.',
      });
    }
  }

  return {
    usable: usable.sort(
      (left, right) =>
        left.effectiveAt - right.effectiveAt ||
        left.evidenceId.localeCompare(right.evidenceId)
    ),
    exclusions,
    conflict,
  };
}

function trendDirection(points: ExtractedPoint[]): ClinicalTrendDirection {
  if (points.length < 2) return 'NOT_COMPUTED';

  let increased = false;
  let decreased = false;

  for (let index = 1; index < points.length; index += 1) {
    if (points[index].value > points[index - 1].value) increased = true;
    if (points[index].value < points[index - 1].value) decreased = true;
  }

  if (!increased && !decreased) return 'STABLE';
  if (increased && !decreased) return 'INCREASING';
  if (decreased && !increased) return 'DECREASING';
  return 'VARIABLE';
}

function explanationFor(
  snapshot: ClinicalEvidenceSnapshot,
  metricKey: string,
  display: string,
  points: ExtractedPoint[],
  direction: ClinicalTrendDirection
): CopilotClaim {
  const first = points[0];
  const last = points[points.length - 1];
  const unit = last.unit;
  const text =
    `Descriptive trend: ${display} changed from ${first.value}${unit ? ` ${unit}` : ''} to ${last.value}${unit ? ` ${unit}` : ''} across ${points.length} represented observations; direction: ${direction.toLowerCase()}.`;

  const evidenceRefs = Array.from(
    new Set(points.map((point) => point.evidenceId))
  ).sort();

  return {
    claimId: `trendclaim_${hash([
      snapshot.snapshotId,
      metricKey,
      text,
      ...evidenceRefs,
    ]).slice(0, 32)}`,
    text,
    classification: 'TREND',
    evidenceRefs,
    confidence: 1,
  };
}

function buildMetric(
  snapshot: ClinicalEvidenceSnapshot,
  metric: MetricIdentity,
  rawPoints: ExtractedPoint[]
): ClinicalTrendMetric {
  const checked = dedupeAndCheckTime(rawPoints);
  const points = checked.usable;
  const evidenceRefs = Array.from(
    new Set(points.map((point) => point.evidenceId))
  ).sort();
  const unitKeys = new Set(points.map((point) => point.unitKey));

  let status: ClinicalTrendComputationStatus;
  let direction: ClinicalTrendDirection = 'NOT_COMPUTED';
  const caveats = [
    'Trend direction is a deterministic numeric description and does not establish diagnosis, causality, severity, or treatment significance.',
  ];

  if (checked.conflict) {
    status = 'CONFLICTING_SAME_TIME';
    caveats.push(
      'Conflicting values share the same clinical effective time; direction is suppressed.'
    );
  } else if (unitKeys.size > 1) {
    status = 'MIXED_UNITS';
    caveats.push(
      'Multiple explicit units are represented. CI-10D does not convert units without a governed conversion rule, so direction is suppressed.'
    );
  } else if (points.some((point) => !Number.isFinite(point.effectiveAt))) {
    status = 'INVALID_TEMPORAL_DATA';
    caveats.push('One or more observation times are invalid.');
  } else if (points.length < 2) {
    status = 'INSUFFICIENT_DATA';
    caveats.push(
      'At least two comparable quantitative observations are required.'
    );
  } else {
    status = 'COMPUTED';
    direction = trendDirection(points);
  }

  const first = points[0];
  const last = points[points.length - 1];
  const values = points.map((point) => point.value);
  const elapsedMs =
    first && last ? last.effectiveAt - first.effectiveAt : undefined;
  const absoluteChange =
    status === 'COMPUTED' && first && last
      ? last.value - first.value
      : undefined;
  const percentChange =
    absoluteChange !== undefined && first && first.value !== 0
      ? (absoluteChange / first.value) * 100
      : undefined;
  const slopePerDay =
    absoluteChange !== undefined &&
    elapsedMs !== undefined &&
    elapsedMs > 0
      ? absoluteChange / (elapsedMs / DAY_MS)
      : undefined;

  return {
    metricKey: metric.metricKey,
    codeSystem: metric.codeSystem,
    code: metric.code,
    display: metric.display,
    unit: unitKeys.size === 1 ? points[0]?.unit : undefined,
    unitKey: unitKeys.size === 1 ? points[0]?.unitKey : undefined,
    status,
    direction,
    points,
    pointCount: points.length,
    abnormalPointCount: points.filter((point) => point.abnormal).length,
    firstValue: first?.value,
    lastValue: last?.value,
    minimumValue: values.length ? Math.min(...values) : undefined,
    maximumValue: values.length ? Math.max(...values) : undefined,
    absoluteChange,
    percentChange,
    elapsedMs,
    slopePerDay,
    evidenceRefs,
    exclusions: checked.exclusions,
    explanation:
      status === 'COMPUTED'
        ? explanationFor(
            snapshot,
            metric.metricKey,
            metric.display,
            points,
            direction
          )
        : undefined,
    caveats,
  };
}

export class ClinicalTrendEngine {
  public static compute(snapshot: ClinicalEvidenceSnapshot): {
    metrics: ClinicalTrendMetric[];
    excludedEvidence: ClinicalTrendExclusion[];
  } {
    if (snapshot.purpose !== 'TREND_EXPLANATION') {
      throw new Error('CI10D_EVIDENCE_PURPOSE_MISMATCH');
    }

    if (
      snapshot.evidenceRefs.some(
        (item) =>
          item.tenantId !== snapshot.tenantId ||
          item.patientId !== snapshot.patientId
      )
    ) {
      throw new Error('CI10D_EVIDENCE_SCOPE_MISMATCH');
    }

    const extracted = extractEvidence(snapshot);
    const grouped = new Map<
      string,
      { metric: MetricIdentity; points: ExtractedPoint[] }
    >();

    for (const point of extracted.points) {
      const current = grouped.get(point.metric.metricKey) || {
        metric: point.metric,
        points: [],
      };
      current.points.push(point);
      grouped.set(point.metric.metricKey, current);
    }

    const metrics = Array.from(grouped.values())
      .map(({ metric, points }) => buildMetric(snapshot, metric, points))
      .sort(
        (left, right) =>
          left.display.localeCompare(right.display) ||
          left.metricKey.localeCompare(right.metricKey)
      );

    return {
      metrics,
      excludedEvidence: extracted.exclusions,
    };
  }
}
