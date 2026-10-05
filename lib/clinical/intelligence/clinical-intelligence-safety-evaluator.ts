import crypto from 'node:crypto';
import { ClinicalEvidenceService } from '@/lib/clinical/intelligence/clinical-evidence-service';
import type { ClinicalEvidenceRef, CopilotClaim } from '@/types/clinical-intelligence-evidence';
import {
  CLINICAL_AI_BOUNDARY_VERSION,
  CLINICAL_SAFETY_POLICY_VERSION,
  type ClinicalSafetyEvaluation,
  type ClinicalSafetyEvaluationInput,
  type ClinicalSafetyFinding,
  type ClinicalSafetyFindingCode,
  type ClinicalSafetyDimension,
  type ClinicalSafetySeverity,
} from '@/types/clinical-intelligence-safety';

const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_APPROVED_CLINICAL_AI_PROVIDERS = ['google-genai'];

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /system\s+prompt/i,
  /developer\s+message/i,
  /reveal\s+(the\s+)?prompt/i,
  /override\s+(the\s+)?(system|policy|instructions)/i,
  /act\s+as\s+(an?\s+)?(admin|system|developer)/i,
  /tool\s*call/i,
  /call\s+(the\s+)?tool/i,
  /do\s+not\s+follow\s+(the\s+)?system/i,
];

const CRITICAL_SIGNAL_VALUES = new Set([
  'CRITICAL',
  'CRITICAL_REVIEW_REQUIRED',
  'ACTION_REQUIRED',
  'ESCALATION_REQUIRED',
  'ESCALATION',
  'BLOCKING',
]);

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalStringify(item)).join(',') + ']';
  }
  const record = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(record)
      .sort()
      .map((key) => JSON.stringify(key) + ':' + canonicalStringify(record[key]))
      .join(',') +
    '}'
  );
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

function collectStrings(value: unknown, depth = 0, seen = new WeakSet<object>()): string[] {
  if (depth > 12 || value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (typeof value !== 'object') return [];
  if (seen.has(value as object)) return [];
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item, depth + 1, seen));
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => [
    key,
    ...collectStrings(item, depth + 1, seen),
  ]);
}

function hasPromptInjectionSignal(value: unknown): boolean {
  return collectStrings(value).some((text) =>
    PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text))
  );
}

function hasCriticalSignal(value: unknown): boolean {
  const strings = collectStrings(value).map((item) => item.trim().toUpperCase());
  if (strings.some((item) => CRITICAL_SIGNAL_VALUES.has(item))) return true;

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.requiresOverride === true) {
      return true;
    }
    if (
      Array.isArray(record.blockingFindingIds) &&
      record.blockingFindingIds.length > 0
    ) {
      return true;
    }
  }

  return false;
}

function criticalEvidenceIds(evidenceRefs: ClinicalEvidenceRef[]): string[] {
  return evidenceRefs
    .filter((item) => {
      if (
        item.sourceType !== 'MEDICATION_SAFETY_FINDING' &&
        item.sourceType !== 'DETERIORATION_FINDING' &&
        item.sourceType !== 'CLINICAL_OPEN_ITEM'
      ) {
        return false;
      }
      return hasCriticalSignal(item.content) || hasCriticalSignal(item.status);
    })
    .map((item) => item.evidenceId);
}

function finding(
  code: ClinicalSafetyFindingCode,
  dimension: ClinicalSafetyDimension,
  severity: ClinicalSafetySeverity,
  message: string,
  metadata: Partial<Pick<ClinicalSafetyFinding, 'claimId' | 'evidenceId' | 'metadata'>> = {}
): ClinicalSafetyFinding {
  return {
    findingId: stableId('cisafetyfinding', [
      code,
      metadata.claimId || '',
      metadata.evidenceId || '',
      message,
    ]),
    code,
    dimension,
    severity,
    message,
    ...metadata,
  };
}

function coverageCount(required: string[], claims: CopilotClaim[]): number {
  const cited = new Set(claims.flatMap((claim) => claim.evidenceRefs));
  return required.filter((id) => cited.has(id)).length;
}

function duplicateEvidenceConflicts(evidenceRefs: ClinicalEvidenceRef[]): ClinicalEvidenceRef[][] {
  const groups = new Map<string, ClinicalEvidenceRef[]>();
  for (const item of evidenceRefs) {
    const key = [
      item.sourceType,
      item.sourceEntityId,
      item.occurredAt ?? 'NO_TIME',
    ].join('|');
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  return Array.from(groups.values()).filter(
    (group) =>
      group.length > 1 &&
      new Set(group.map((item) => item.contentHash)).size > 1
  );
}

export class ClinicalIntelligenceSafetyEvaluator {
  public static contentHash(value: unknown): string {
    return hash(value);
  }

  public static sourceEventSetHash(sourceEventIds: string[]): string {
    return hash([...sourceEventIds].sort());
  }

  public static snapshotHash(input: ClinicalSafetyEvaluationInput['snapshot']): string {
    return hash({
      tenantId: input.tenantId,
      patientId: input.patientId,
      purpose: input.purpose,
      projectionVersion: input.patient360ProjectionVersion,
      revision: input.patient360Revision,
      sourceCheckpoint: input.patient360SourceCheckpoint,
      patient360ContentHash: input.patient360ContentHash,
      evidence: input.evidenceRefs.map((item) => ({
        evidenceId: item.evidenceId,
        contentHash: item.contentHash,
        sourceEventSetHash: item.sourceEventSetHash,
      })),
    });
  }

  public static evaluate(input: ClinicalSafetyEvaluationInput): ClinicalSafetyEvaluation {
    const evaluatedAt = input.evaluatedAt ?? Date.now();
    const findings: ClinicalSafetyFinding[] = [];
    const snapshot = input.snapshot;

    if (
      snapshot.tenantId !== input.tenantId ||
      snapshot.patientId !== input.patientId ||
      snapshot.purpose !== input.purpose
    ) {
      findings.push(
        finding(
          'EVIDENCE_SCOPE_MISMATCH',
          'SCOPE',
          'BLOCKER',
          'Safety evaluation input and frozen evidence snapshot do not share the same tenant, patient and purpose scope.'
        )
      );
    }

    for (const item of snapshot.evidenceRefs) {
      if (item.tenantId !== input.tenantId || item.patientId !== input.patientId) {
        findings.push(
          finding(
            'EVIDENCE_SCOPE_MISMATCH',
            'SCOPE',
            'BLOCKER',
            'Evidence reference crosses the evaluated tenant or patient boundary.',
            { evidenceId: item.evidenceId }
          )
        );
      }
      if (hash(item.content) !== item.contentHash) {
        findings.push(
          finding(
            'EVIDENCE_CONTENT_HASH_MISMATCH',
            'INTEGRITY',
            'BLOCKER',
            'Frozen evidence content no longer matches its recorded content hash.',
            { evidenceId: item.evidenceId }
          )
        );
      }
      if (hash([...item.sourceEventIds].sort()) !== item.sourceEventSetHash) {
        findings.push(
          finding(
            'EVIDENCE_EVENT_SET_HASH_MISMATCH',
            'INTEGRITY',
            'BLOCKER',
            'Frozen evidence source-event membership no longer matches its recorded hash.',
            { evidenceId: item.evidenceId }
          )
        );
      }
      if (
        typeof item.occurredAt === 'number' &&
        item.occurredAt > evaluatedAt + FUTURE_CLOCK_SKEW_MS
      ) {
        findings.push(
          finding(
            'FUTURE_EVIDENCE',
            'TEMPORAL',
            'BLOCKER',
            'Evidence occurrence time is materially in the future relative to safety evaluation.',
            { evidenceId: item.evidenceId, metadata: { occurredAt: item.occurredAt, evaluatedAt } }
          )
        );
      }
    }

    const uniqueSourceEvents = new Set(
      snapshot.evidenceRefs.flatMap((item) => item.sourceEventIds)
    );
    if (
      snapshot.evidenceCount !== snapshot.evidenceRefs.length ||
      snapshot.sourceEventCount !== uniqueSourceEvents.size
    ) {
      findings.push(
        finding(
          'SNAPSHOT_COUNT_MISMATCH',
          'INTEGRITY',
          'BLOCKER',
          'Frozen evidence snapshot count metadata does not match represented evidence.'
        )
      );
    }

    if (this.snapshotHash(snapshot) !== snapshot.snapshotHash) {
      findings.push(
        finding(
          'SNAPSHOT_HASH_MISMATCH',
          'INTEGRITY',
          'BLOCKER',
          'Frozen evidence snapshot hash cannot be reproduced from its immutable basis.'
        )
      );
    }

    if (
      input.currentPatient360Revision !== undefined &&
      snapshot.patient360Revision !== input.currentPatient360Revision
    ) {
      findings.push(
        finding(
          'STALE_PATIENT360_REVISION',
          'FRESHNESS',
          'BLOCKER',
          'Clinical intelligence is based on a different Patient 360 revision than the current authoritative chart.',
          { metadata: {
            snapshotRevision: snapshot.patient360Revision,
            currentRevision: input.currentPatient360Revision,
          } }
        )
      );
    }

    if (
      input.currentPatient360SourceCheckpoint !== undefined &&
      snapshot.patient360SourceCheckpoint !== input.currentPatient360SourceCheckpoint
    ) {
      findings.push(
        finding(
          'STALE_PATIENT360_CHECKPOINT',
          'FRESHNESS',
          'BLOCKER',
          'Clinical intelligence is based on a stale Patient 360 source checkpoint.',
          { metadata: {
            snapshotCheckpoint: snapshot.patient360SourceCheckpoint,
            currentCheckpoint: input.currentPatient360SourceCheckpoint,
          } }
        )
      );
    }

    const grounding = ClinicalEvidenceService.validateClaims(snapshot, input.claims);
    for (const error of grounding.errors) {
      findings.push(
        finding(
          'CLAIM_GROUNDING_INVALID',
          'GROUNDING',
          'BLOCKER',
          `Claim grounding validation failed: ${error}`
        )
      );
    }

    const explicitRequired = Array.from(new Set(input.requiredEvidenceRefs || []));
    const criticalRequired = criticalEvidenceIds(snapshot.evidenceRefs);
    const explicitCovered = coverageCount(explicitRequired, input.claims);
    const criticalCovered = coverageCount(criticalRequired, input.claims);
    const cited = new Set(input.claims.flatMap((claim) => claim.evidenceRefs));

    for (const evidenceId of explicitRequired) {
      if (!cited.has(evidenceId)) {
        findings.push(
          finding(
            'REQUIRED_EVIDENCE_OMITTED',
            'OMISSION',
            'BLOCKER',
            'A release-evaluation-required evidence item was omitted from the generated claims.',
            { evidenceId }
          )
        );
      }
    }

    for (const evidenceId of criticalRequired) {
      if (!cited.has(evidenceId)) {
        findings.push(
          finding(
            'CRITICAL_EVIDENCE_OMITTED',
            'MEDICATION_SAFETY',
            'BLOCKER',
            'A critical safety or deterioration evidence item was omitted from the generated claims.',
            { evidenceId }
          )
        );
      }
    }

    for (const group of duplicateEvidenceConflicts(snapshot.evidenceRefs)) {
      findings.push(
        finding(
          'CONTRADICTORY_EVIDENCE',
          'CONTRADICTION',
          'BLOCKER',
          'Conflicting frozen evidence exists for the same source entity and effective time.',
          {
            evidenceId: group[0]?.evidenceId,
            metadata: { evidenceIds: group.map((item) => item.evidenceId) },
          }
        )
      );
    }

    const injectionEvidence = snapshot.evidenceRefs.filter((item) =>
      hasPromptInjectionSignal(item.content)
    );
    for (const item of injectionEvidence) {
      findings.push(
        finding(
          'PROMPT_INJECTION_SOURCE_DETECTED',
          'PROMPT_INJECTION',
          'WARNING',
          'Untrusted clinical source data contains instruction-like text and must remain data-only.',
          { evidenceId: item.evidenceId }
        )
      );
    }

    const outputTexts = [
      ...input.claims.map((claim) => claim.text),
      ...(input.renderedText || []),
    ];
    const leakageSignals = outputTexts.filter((text) =>
      PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text))
    );
    for (const text of leakageSignals) {
      findings.push(
        finding(
          'PROMPT_INJECTION_LEAKAGE',
          'PROMPT_INJECTION',
          'BLOCKER',
          'Generated clinical output contains instruction-like prompt-injection content.',
          { metadata: { textPreview: text.slice(0, 160) } }
        )
      );
    }

    if (input.proposedClinicalActions?.length) {
      findings.push(
        finding(
          'AUTONOMOUS_ACTION_PROPOSED',
          'AUTONOMY',
          'BLOCKER',
          'Clinical intelligence proposed executable clinical actions instead of review-only information.',
          { metadata: { actionCount: input.proposedClinicalActions.length } }
        )
      );
    }

    if (input.generationProvenance) {
      const approvedProviders =
        input.approvedClinicalAIProviders?.length
          ? input.approvedClinicalAIProviders
          : DEFAULT_APPROVED_CLINICAL_AI_PROVIDERS;
      if (
        !approvedProviders.includes(input.generationProvenance.provider) ||
        !input.generationProvenance.model?.trim()
      ) {
        findings.push(
          finding(
            'AI_PROVENANCE_UNAPPROVED',
            'PROVENANCE',
            'BLOCKER',
            'Clinical AI output came from an unapproved or unidentified provider/model.',
            {
              metadata: {
                provider: input.generationProvenance.provider,
                model: input.generationProvenance.model,
              },
            }
          )
        );
      }
      if (
        input.generationProvenance.safetyBoundaryVersion !==
        CLINICAL_AI_BOUNDARY_VERSION
      ) {
        findings.push(
          finding(
            'AI_SAFETY_BOUNDARY_MISSING',
            'PROVENANCE',
            'BLOCKER',
            'Clinical AI generation did not attest the current untrusted-source safety boundary.',
            {
              metadata: {
                safetyBoundaryVersion:
                  input.generationProvenance.safetyBoundaryVersion || null,
              },
            }
          )
        );
      }
    }

    for (const claimId of input.externalAdjudication?.semanticUnsupportedClaimIds || []) {
      findings.push(
        finding(
          'SEMANTIC_UNSUPPORTED_CLAIM',
          'GROUNDING',
          'BLOCKER',
          'Clinical reviewer/oracle marked this claim as semantically unsupported by its cited evidence.',
          { claimId }
        )
      );
    }
    for (const claimId of input.externalAdjudication?.temporalMisattributionClaimIds || []) {
      findings.push(
        finding(
          'TEMPORAL_MISATTRIBUTION',
          'TEMPORAL',
          'BLOCKER',
          'Clinical reviewer/oracle marked this claim as temporally misattributed.',
          { claimId }
        )
      );
    }
    for (const claimId of input.externalAdjudication?.contradictionClaimIds || []) {
      findings.push(
        finding(
          'ADJUDICATED_CONTRADICTION',
          'CONTRADICTION',
          'BLOCKER',
          'Clinical reviewer/oracle marked this claim as contradicting represented evidence.',
          { claimId }
        )
      );
    }

    const blockerCount = findings.filter((item) => item.severity === 'BLOCKER').length;
    const warningCount = findings.filter((item) => item.severity === 'WARNING').length;
    const infoCount = findings.filter((item) => item.severity === 'INFO').length;
    const groundedClaimCount = input.claims.filter(
      (claim) =>
        claim.classification === 'UNCERTAIN' ||
        (claim.evidenceRefs.length > 0 &&
          claim.evidenceRefs.every((id) =>
            snapshot.evidenceRefs.some((item) => item.evidenceId === id)
          ))
    ).length;

    return {
      evaluationId: stableId('cisafety', [
        input.tenantId,
        input.patientId,
        input.purpose,
        snapshot.snapshotId,
        snapshot.snapshotHash,
        String(evaluatedAt),
        hash(input.claims),
      ]),
      tenantId: input.tenantId,
      patientId: input.patientId,
      purpose: input.purpose,
      evidenceSnapshotId: snapshot.snapshotId,
      evidenceSnapshotHash: snapshot.snapshotHash,
      policyVersion: CLINICAL_SAFETY_POLICY_VERSION,
      evaluatedAt,
      status: blockerCount === 0 ? 'PASSED' : 'BLOCKED',
      findings,
      blockerCount,
      warningCount,
      infoCount,
      metrics: {
        claimCount: input.claims.length,
        groundedClaimCount,
        referencedEvidenceCount: cited.size,
        criticalEvidenceCount: criticalRequired.length,
        criticalEvidenceCoveredCount: criticalCovered,
        requiredEvidenceCount: explicitRequired.length,
        requiredEvidenceCoveredCount: explicitCovered,
        promptInjectionSourceSignals: injectionEvidence.length,
        promptInjectionLeakageSignals: leakageSignals.length,
      },
    };
  }
}
