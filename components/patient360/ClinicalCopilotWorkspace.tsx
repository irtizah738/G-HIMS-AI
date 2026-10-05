'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  ClipboardCheck,
  Database,
  FileSignature,
  FileText,
  History,
  Loader2,
  Pill,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  WifiOff,
} from 'lucide-react';
import {
  generateClinicalTrendIntelligence,
  generateEncounterPreparationBrief,
  generateLongitudinalClinicalSummary,
  generateMedicationReconciliationCopilot,
} from '@/lib/clinical/patient360/patient360-client';
import { ClinicalCopilotEvidencePanel } from '@/components/patient360/ClinicalCopilotEvidencePanel';
import { GovernedClinicalDraftPanel } from '@/components/patient360/GovernedClinicalDraftPanel';
import type { ClinicalCareSetting } from '@/types/consultant-visibility';
import type {
  ClinicalCopilotArtifactKey,
  ClinicalCopilotArtifactState,
  ClinicalCopilotEvidenceDisplayItem,
  ClinicalCopilotWorkspaceArtifacts,
  ClinicalCopilotWorkspaceTab,
} from '@/types/clinical-copilot-workspace';

const EMPTY_ARTIFACTS: ClinicalCopilotWorkspaceArtifacts = {
  longitudinal: null,
  encounterPreparation: null,
  trends: null,
  medicationReconciliation: null,
  draft: null,
};

function stateClass(state: ClinicalCopilotArtifactState): string {
  switch (state) {
    case 'CURRENT':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'STALE':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'ERROR':
      return 'border-rose-200 bg-rose-50 text-rose-800';
    case 'UNAVAILABLE_OFFLINE':
      return 'border-slate-300 bg-slate-100 text-slate-600';
    default:
      return 'border-slate-200 bg-white text-slate-500';
  }
}

function artifactLabel(key: ClinicalCopilotArtifactKey): string {
  switch (key) {
    case 'ENCOUNTER_PREP':
      return 'Encounter preparation';
    case 'LONGITUDINAL':
      return 'Longitudinal summary';
    case 'TRENDS':
      return 'Trend intelligence';
    case 'MEDICATIONS':
      return 'Medication reconciliation';
    case 'DRAFT':
      return 'Clinical drafting';
  }
}

function artifactTab(key: ClinicalCopilotArtifactKey): ClinicalCopilotWorkspaceTab {
  switch (key) {
    case 'ENCOUNTER_PREP':
      return 'ENCOUNTER_PREP';
    case 'LONGITUDINAL':
      return 'LONGITUDINAL';
    case 'TRENDS':
      return 'TRENDS';
    case 'MEDICATIONS':
      return 'MEDICATIONS';
    case 'DRAFT':
      return 'DRAFTING';
  }
}

function displayState(state: ClinicalCopilotArtifactState): string {
  return state.replace(/_/g, ' ').toLowerCase();
}

function dateTime(value?: number): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(value);
}

export function ClinicalCopilotWorkspace({
  tenantId,
  patientId,
  encounterId,
  careSetting,
  offline,
  currentRevision,
  currentSourceCheckpoint,
  onAuthoritativeChange,
}: {
  tenantId: string;
  patientId: string;
  encounterId?: string;
  careSetting?: ClinicalCareSetting;
  offline: boolean;
  currentRevision: number;
  currentSourceCheckpoint: string;
  onAuthoritativeChange?: () => Promise<void> | void;
}) {
  const [activeTab, setActiveTab] =
    useState<ClinicalCopilotWorkspaceTab>('OVERVIEW');
  const [artifacts, setArtifacts] =
    useState<ClinicalCopilotWorkspaceArtifacts>(EMPTY_ARTIFACTS);
  const [loading, setLoading] = useState<
    Partial<Record<ClinicalCopilotArtifactKey, boolean>>
  >({});
  const [errors, setErrors] = useState<
    Partial<Record<ClinicalCopilotArtifactKey, string>>
  >({});
  const [refreshingAll, setRefreshingAll] = useState(false);

  useEffect(() => {
    setArtifacts(EMPTY_ARTIFACTS);
    setErrors({});
    setLoading({});
    setActiveTab('OVERVIEW');
  }, [tenantId, patientId, encounterId, careSetting]);

  const artifactRevision = (key: ClinicalCopilotArtifactKey): number | null => {
    switch (key) {
      case 'LONGITUDINAL':
        return artifacts.longitudinal?.summary.patient360Revision ?? null;
      case 'ENCOUNTER_PREP':
        return artifacts.encounterPreparation?.brief.patient360Revision ?? null;
      case 'TRENDS':
        return artifacts.trends?.artifact.patient360Revision ?? null;
      case 'MEDICATIONS':
        return artifacts.medicationReconciliation?.artifact.patient360Revision ?? null;
      case 'DRAFT':
        return artifacts.draft?.draft.patient360Revision ?? null;
    }
  };

  const artifactCheckpoint = (
    key: ClinicalCopilotArtifactKey
  ): string | null => {
    switch (key) {
      case 'LONGITUDINAL':
        return artifacts.longitudinal?.summary.patient360SourceCheckpoint ?? null;
      case 'ENCOUNTER_PREP':
        return artifacts.encounterPreparation?.brief.patient360SourceCheckpoint ?? null;
      case 'TRENDS':
        return artifacts.trends?.artifact.patient360SourceCheckpoint ?? null;
      case 'MEDICATIONS':
        return artifacts.medicationReconciliation?.artifact.patient360SourceCheckpoint ?? null;
      case 'DRAFT':
        return artifacts.draft?.draft.patient360SourceCheckpoint ?? null;
    }
  };

  const artifactState = (
    key: ClinicalCopilotArtifactKey
  ): ClinicalCopilotArtifactState => {
    if (errors[key]) return 'ERROR';
    const revision = artifactRevision(key);
    if (revision === null) {
      return offline ? 'UNAVAILABLE_OFFLINE' : 'NOT_GENERATED';
    }
    if (
      revision !== currentRevision ||
      artifactCheckpoint(key) !== currentSourceCheckpoint
    ) {
      return 'STALE';
    }
    return 'CURRENT';
  };

  const generateArtifact = async (key: Exclude<ClinicalCopilotArtifactKey, 'DRAFT'>) => {
    if (offline) {
      setErrors((current) => ({
        ...current,
        [key]:
          'Fresh clinical intelligence requires authoritative server connectivity.',
      }));
      return;
    }

    if (
      (key === 'ENCOUNTER_PREP' || key === 'MEDICATIONS') &&
      !encounterId
    ) {
      setErrors((current) => ({
        ...current,
        [key]: 'Select an active care encounter before generating this artifact.',
      }));
      return;
    }

    setLoading((current) => ({ ...current, [key]: true }));
    setErrors((current) => ({ ...current, [key]: undefined }));

    try {
      if (key === 'LONGITUDINAL') {
        const next = await generateLongitudinalClinicalSummary(
          tenantId,
          patientId
        );
        setArtifacts((current) => ({ ...current, longitudinal: next }));
      } else if (key === 'ENCOUNTER_PREP') {
        const next = await generateEncounterPreparationBrief(tenantId, {
          patientId,
          encounterId: encounterId!,
          careSetting,
        });
        setArtifacts((current) => ({
          ...current,
          encounterPreparation: next,
        }));
      } else if (key === 'TRENDS') {
        const next = await generateClinicalTrendIntelligence(
          tenantId,
          patientId
        );
        setArtifacts((current) => ({ ...current, trends: next }));
      } else if (key === 'MEDICATIONS') {
        const next = await generateMedicationReconciliationCopilot(tenantId, {
          patientId,
          encounterId: encounterId!,
          careSetting,
        });
        setArtifacts((current) => ({
          ...current,
          medicationReconciliation: next,
        }));
      }
    } catch (caught) {
      setErrors((current) => ({
        ...current,
        [key]:
          caught instanceof Error
            ? caught.message
            : `${artifactLabel(key)} could not be generated.`,
      }));
    } finally {
      setLoading((current) => ({ ...current, [key]: false }));
    }
  };

  const refreshAll = async () => {
    if (offline) return;
    setRefreshingAll(true);
    try {
      const keys: Array<Exclude<ClinicalCopilotArtifactKey, 'DRAFT'>> = [
        'LONGITUDINAL',
        'TRENDS',
        ...(encounterId
          ? (['ENCOUNTER_PREP', 'MEDICATIONS'] as const)
          : []),
      ];
      await Promise.allSettled(keys.map((key) => generateArtifact(key)));
    } finally {
      setRefreshingAll(false);
    }
  };

  const evidenceItems = useMemo<ClinicalCopilotEvidenceDisplayItem[]>(() => {
    const result: ClinicalCopilotEvidenceDisplayItem[] = [];
    const append = (
      sourceArtifact: ClinicalCopilotArtifactKey,
      items: Array<{
        evidenceId: string;
        sourceType: string;
        sourceEntityId: string;
        label: string;
        status?: string;
        occurredAt?: number;
        provenanceStatus: string;
        sourceEventIds: string[];
        contentHash: string;
        content?: unknown;
      }>
    ) => {
      for (const item of items) result.push({ ...item, sourceArtifact });
    };

    append('LONGITUDINAL', artifacts.longitudinal?.evidenceIndex || []);
    append(
      'ENCOUNTER_PREP',
      artifacts.encounterPreparation?.evidenceIndex || []
    );
    append('TRENDS', artifacts.trends?.evidenceIndex || []);
    append(
      'MEDICATIONS',
      artifacts.medicationReconciliation?.evidenceIndex || []
    );
    append('DRAFT', artifacts.draft?.evidenceIndex || []);

    return result;
  }, [artifacts]);

  const warnings = useMemo(
    () =>
      Array.from(
        new Set([
          ...(artifacts.longitudinal?.summary.warnings || []),
          ...(artifacts.encounterPreparation?.brief.warnings || []),
          ...(artifacts.trends?.artifact.warnings || []),
          ...(artifacts.medicationReconciliation?.artifact.warnings || []),
          ...(artifacts.draft?.draft.warnings || []),
        ])
      ),
    [artifacts]
  );

  const tabs: Array<{
    id: ClinicalCopilotWorkspaceTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'OVERVIEW', label: 'Overview', icon: BrainCircuit },
    { id: 'ENCOUNTER_PREP', label: 'Encounter', icon: ClipboardCheck },
    { id: 'LONGITUDINAL', label: 'Longitudinal', icon: History },
    { id: 'TRENDS', label: 'Trends', icon: TrendingUp },
    { id: 'MEDICATIONS', label: 'Medications', icon: Pill },
    { id: 'DRAFTING', label: 'Drafting', icon: FileSignature },
    { id: 'EVIDENCE', label: 'Evidence', icon: Database },
  ];

  const renderGenerateButton = (
    key: Exclude<ClinicalCopilotArtifactKey, 'DRAFT'>
  ) => (
    <button
      type="button"
      onClick={() => void generateArtifact(key)}
      disabled={
        offline ||
        Boolean(loading[key]) ||
        ((key === 'ENCOUNTER_PREP' || key === 'MEDICATIONS') && !encounterId)
      }
      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {loading[key] ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      {artifactRevision(key) === null ? 'Generate' : 'Regenerate'}
    </button>
  );

  const artifactCards: Array<ClinicalCopilotArtifactKey> = [
    'ENCOUNTER_PREP',
    'LONGITUDINAL',
    'TRENDS',
    'MEDICATIONS',
    'DRAFT',
  ];

  return (
    <section
      id="clinical-copilot-workspace"
      className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm"
    >
      <div className="border-b border-indigo-100 bg-gradient-to-r from-slate-950 via-indigo-950 to-blue-950 p-5 text-white">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-300" />
              <h2 className="text-base font-bold">
                CI-10G Clinical Intelligence Copilot
              </h2>
              <span className="rounded-full border border-blue-300/30 bg-blue-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-200">
                Governed workspace
              </span>
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-300">
              One clinician-facing workspace over Patient 360, CI-10B–F
              intelligence, frozen evidence provenance, and governed clinical
              drafting. Read-only intelligence never becomes clinical authority
              by itself.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-300">
              <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono">
                P360 rev {currentRevision}
              </span>
              <span className="max-w-full truncate rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono">
                {currentSourceCheckpoint}
              </span>
              {encounterId && (
                <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono">
                  {careSetting || 'UNKNOWN'} · {encounterId}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={offline || refreshingAll}
            className="inline-flex w-fit items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-900 disabled:opacity-40"
          >
            {refreshingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh review intelligence
          </button>
        </div>
      </div>

      {offline && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs text-amber-900">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Patient 360 continuity is available from the encrypted edge
            snapshot, but CI-10G will not generate new summaries, trends,
            reconciliation artifacts, or drafts from stale offline data.
            Offline copilot qualification belongs to CI-10I.
          </span>
        </div>
      )}

      <div className="border-b border-slate-200 bg-slate-50 px-3 pt-2">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={
                activeTab === id
                  ? 'flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-white border-slate-200 bg-white px-3 py-2 text-xs font-bold text-indigo-700'
                  : 'flex shrink-0 items-center gap-1.5 rounded-t-lg border border-transparent px-3 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800'
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {activeTab === 'OVERVIEW' && (
          <div className="space-y-5">
            <div className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-950">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Copilot output is evidence-linked decision support. It cannot
                diagnose, prescribe, place orders, complete reconciliation, or
                sign documentation. The only path to authoritative
                documentation is the CI-10F edit → approval → signature
                lifecycle.
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {artifactCards.map((key) => {
                const state = artifactState(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(artifactTab(key))}
                    className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-300 hover:shadow-sm"
                  >
                    <div className="text-xs font-bold text-slate-800">
                      {artifactLabel(key)}
                    </div>
                    <span
                      className={`mt-3 inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase ${stateClass(
                        state
                      )}`}
                    >
                      {displayState(state)}
                    </span>
                    {artifactRevision(key) !== null && (
                      <div className="mt-2 text-[10px] text-slate-500">
                        artifact rev {artifactRevision(key)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {(artifacts.encounterPreparation ||
              artifacts.medicationReconciliation ||
              artifacts.trends ||
              artifacts.longitudinal) && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <div className="text-[10px] font-bold uppercase text-rose-600">
                    Critical attention
                  </div>
                  <div className="mt-1 text-xl font-bold text-rose-900">
                    {(artifacts.encounterPreparation?.brief.attention.critical ||
                      0) +
                      (artifacts.medicationReconciliation?.artifact.counts
                        .critical || 0)}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div className="text-[10px] font-bold uppercase text-amber-600">
                    Action required
                  </div>
                  <div className="mt-1 text-xl font-bold text-amber-900">
                    {(artifacts.encounterPreparation?.brief.attention
                      .actionRequired || 0) +
                      (artifacts.medicationReconciliation?.artifact.counts
                        .actionRequired || 0)}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-500">
                    Longitudinal claims
                  </div>
                  <div className="mt-1 text-xl font-bold">
                    {artifacts.longitudinal?.summary.claimCount || 0}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-bold uppercase text-slate-500">
                    Computed trends
                  </div>
                  <div className="mt-1 text-xl font-bold">
                    {artifacts.trends?.artifact.computedMetricCount || 0}
                  </div>
                </div>
              </div>
            )}

            {warnings.length > 0 && (
              <details className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <summary className="cursor-pointer text-xs font-bold text-amber-900">
                  Combined safety and evidence limitations ({warnings.length})
                </summary>
                <ul className="mt-2 space-y-1 text-[11px] text-amber-900">
                  {warnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              {(['ENCOUNTER_PREP', 'LONGITUDINAL', 'TRENDS', 'MEDICATIONS'] as const).map(
                (key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800">
                        {artifactLabel(key)}
                      </div>
                      {errors[key] && (
                        <div className="mt-1 text-[10px] text-rose-700">
                          {errors[key]}
                        </div>
                      )}
                    </div>
                    {renderGenerateButton(key)}
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {activeTab === 'ENCOUNTER_PREP' && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Encounter preparation</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Evidence-grounded reason for visit, changes since review,
                  abnormal investigations, medication discrepancies, unresolved
                  work, safety signals, contradictions, and missing information.
                </p>
              </div>
              {renderGenerateButton('ENCOUNTER_PREP')}
            </div>
            {errors.ENCOUNTER_PREP && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                {errors.ENCOUNTER_PREP}
              </div>
            )}
            {!encounterId ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                Select a care-setting encounter in Patient 360 first.
              </div>
            ) : artifacts.encounterPreparation ? (
              <>
                {artifactState('ENCOUNTER_PREP') === 'STALE' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    Patient 360 changed after this brief was generated. Regenerate
                    before relying on it for the current encounter.
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-4">
                  {[
                    ['Critical', artifacts.encounterPreparation.brief.attention.critical],
                    ['Action', artifacts.encounterPreparation.brief.attention.actionRequired],
                    ['Review', artifacts.encounterPreparation.brief.attention.reviewRequired],
                    ['Information', artifacts.encounterPreparation.brief.attention.information],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl bg-slate-50 p-3">
                      <div className="text-[10px] uppercase text-slate-400">
                        {label}
                      </div>
                      <div className="mt-1 text-xl font-bold">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {artifacts.encounterPreparation.brief.sections.map((section) => (
                    <details
                      key={section.sectionId}
                      open={section.claims.some(
                        (claim) =>
                          claim.severity === 'CRITICAL_REVIEW_REQUIRED' ||
                          claim.severity === 'ACTION_REQUIRED'
                      )}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <summary className="cursor-pointer text-xs font-bold text-slate-800">
                        {section.title} · {section.state.replace(/_/g, ' ')} ·{' '}
                        {section.claims.length}
                      </summary>
                      <div className="mt-3 space-y-2">
                        {section.claims.map((claim) => (
                          <div
                            key={claim.claimId}
                            className="rounded-lg border border-slate-200 bg-white p-3"
                          >
                            <div className="text-xs font-medium">{claim.text}</div>
                            <div className="mt-1 text-[9px] font-bold uppercase text-slate-500">
                              {claim.severity.replace(/_/g, ' ')} · evidence{' '}
                              {claim.evidenceRefs.length}
                            </div>
                            {claim.caveat && (
                              <div className="mt-1 text-[10px] text-amber-700">
                                {claim.caveat}
                              </div>
                            )}
                          </div>
                        ))}
                        {section.claims.length === 0 && (
                          <div className="text-xs text-slate-500">
                            No represented claim in this section.
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                Generate the encounter brief when you are ready to review it.
              </div>
            )}
          </div>
        )}

        {activeTab === 'LONGITUDINAL' && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Longitudinal clinical summary</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Source-linked chart synthesis across represented clinical
                  history. Unsupported absence is never converted into a
                  negative clinical finding.
                </p>
              </div>
              {renderGenerateButton('LONGITUDINAL')}
            </div>
            {errors.LONGITUDINAL && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                {errors.LONGITUDINAL}
              </div>
            )}
            {artifacts.longitudinal ? (
              <>
                {artifactState('LONGITUDINAL') === 'STALE' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    The chart changed after this summary was generated.
                  </div>
                )}
                <div className="space-y-2">
                  {artifacts.longitudinal.summary.sections.map((section) => (
                    <details
                      key={section.sectionId}
                      open={section.sectionId === 'ACTIVE_PROBLEMS'}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <summary className="cursor-pointer text-xs font-bold">
                        {section.title} · {section.state.replace(/_/g, ' ')} ·{' '}
                        {section.claims.length}
                      </summary>
                      <div className="mt-3 space-y-2">
                        {section.claims.map((claim) => (
                          <div
                            key={claim.claimId}
                            className="rounded-lg border border-slate-200 bg-white p-3"
                          >
                            <div className="text-xs font-medium">{claim.text}</div>
                            <div className="mt-1 text-[9px] uppercase text-slate-500">
                              {claim.classification.replace(/_/g, ' ')} · confidence{' '}
                              {Math.round(claim.confidence * 100)}% · evidence{' '}
                              {claim.evidenceRefs.length}
                            </div>
                            {claim.caveat && (
                              <div className="mt-1 text-[10px] text-amber-700">
                                {claim.caveat}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                No longitudinal artifact has been generated in this workspace.
              </div>
            )}
          </div>
        )}

        {activeTab === 'TRENDS' && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Clinical trend intelligence</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Deterministic longitudinal computation over eligible coded
                  quantitative observations. Mixed, missing, conflicting, and
                  unsupported data is excluded rather than normalized by guess.
                </p>
              </div>
              {renderGenerateButton('TRENDS')}
            </div>
            {errors.TRENDS && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                {errors.TRENDS}
              </div>
            )}
            {artifacts.trends ? (
              <>
                {artifactState('TRENDS') === 'STALE' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    Patient 360 changed after this trend artifact was computed.
                  </div>
                )}
                <div className="space-y-2">
                  {artifacts.trends.artifact.metrics.map((metric) => (
                    <details
                      key={metric.metricKey}
                      className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
                    >
                      <summary className="cursor-pointer">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold">{metric.display}</span>
                          <span className="text-[9px] font-bold uppercase text-slate-500">
                            {metric.status.replace(/_/g, ' ')} ·{' '}
                            {metric.direction.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </summary>
                      <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        {[
                          ['Points', metric.pointCount],
                          ['Abnormal', metric.abnormalPointCount],
                          ['First', metric.firstValue ?? '—'],
                          ['Last', metric.lastValue ?? '—'],
                        ].map(([label, value]) => (
                          <div key={String(label)} className="rounded-lg bg-white p-2.5">
                            <div className="text-[9px] uppercase text-slate-400">
                              {label}
                            </div>
                            <div className="mt-1 text-sm font-bold">
                              {value} {label === 'First' || label === 'Last' ? metric.unit || '' : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                      {metric.explanation && (
                        <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-950">
                          {metric.explanation.text}
                        </div>
                      )}
                      {metric.caveats.length > 0 && (
                        <ul className="mt-3 space-y-1 text-[10px] text-amber-800">
                          {metric.caveats.map((caveat) => (
                            <li key={caveat}>• {caveat}</li>
                          ))}
                        </ul>
                      )}
                      {metric.exclusions.length > 0 && (
                        <details className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2">
                          <summary className="cursor-pointer text-[10px] font-bold text-rose-800">
                            Suppressed / excluded evidence ({metric.exclusions.length})
                          </summary>
                          <div className="mt-2 space-y-1 text-[10px] text-rose-800">
                            {metric.exclusions.map((item, index) => (
                              <div key={`${item.evidenceId}:${item.reason}:${index}`}>
                                <span className="font-bold">
                                  {item.reason.replace(/_/g, ' ')}
                                </span>
                                {' — '}
                                {item.detail}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </details>
                  ))}
                  {artifacts.trends.artifact.metrics.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                      No eligible quantitative series is currently represented.
                    </div>
                  )}
                </div>
                {artifacts.trends.artifact.excludedEvidence.length > 0 && (
                  <details className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <summary className="cursor-pointer text-xs font-bold text-amber-900">
                      Excluded observation evidence (
                      {artifacts.trends.artifact.excludedEvidence.length})
                    </summary>
                    <div className="mt-2 space-y-1 text-[10px] text-amber-900">
                      {artifacts.trends.artifact.excludedEvidence.map((item, index) => (
                        <div key={`${item.evidenceId}:${item.reason}:${index}`}>
                          <span className="font-bold">
                            {item.reason.replace(/_/g, ' ')}
                          </span>
                          {' — '}
                          {item.detail}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                No trend artifact has been generated in this workspace.
              </div>
            )}
          </div>
        )}

        {activeTab === 'MEDICATIONS' && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold">Medication reconciliation copilot</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Compares represented history, orders, dispenses,
                  administrations, allergies, reconciliation evidence, and CI-9
                  safety findings without altering therapy.
                </p>
              </div>
              {renderGenerateButton('MEDICATIONS')}
            </div>
            {errors.MEDICATIONS && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
                {errors.MEDICATIONS}
              </div>
            )}
            {!encounterId ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                Select a care-setting encounter first.
              </div>
            ) : artifacts.medicationReconciliation ? (
              <>
                {artifactState('MEDICATIONS') === 'STALE' && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    Patient 360 changed after this medication review was generated.
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-4">
                  {[
                    ['Critical', artifacts.medicationReconciliation.artifact.counts.critical],
                    ['Action', artifacts.medicationReconciliation.artifact.counts.actionRequired],
                    ['Review', artifacts.medicationReconciliation.artifact.counts.reviewRequired],
                    ['Information', artifacts.medicationReconciliation.artifact.counts.information],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-xl bg-slate-50 p-3">
                      <div className="text-[10px] uppercase text-slate-400">
                        {label}
                      </div>
                      <div className="mt-1 text-xl font-bold">{value}</div>
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  {artifacts.medicationReconciliation.artifact.findings.map(
                    (finding) => (
                      <details
                        key={finding.findingId}
                        className={
                          finding.severity === 'CRITICAL_REVIEW_REQUIRED'
                            ? 'rounded-xl border border-rose-200 bg-rose-50 px-4 py-3'
                            : finding.severity === 'ACTION_REQUIRED'
                              ? 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-3'
                              : 'rounded-xl border border-slate-200 bg-slate-50 px-4 py-3'
                        }
                      >
                        <summary className="cursor-pointer">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-bold">{finding.title}</div>
                              <p className="mt-1 text-xs">{finding.description}</p>
                            </div>
                            <span className="text-[9px] font-bold uppercase">
                              {finding.severity.replace(/_/g, ' ')}
                            </span>
                          </div>
                        </summary>
                        <div className="mt-2 text-[10px] text-slate-600">
                          Evidence references: {finding.evidenceRefs.length}
                        </div>
                        {finding.caveat && (
                          <div className="mt-2 text-[10px] text-amber-800">
                            {finding.caveat}
                          </div>
                        )}
                      </details>
                    )
                  )}
                  {artifacts.medicationReconciliation.artifact.findings.length ===
                    0 && (
                    <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                      No discrepancy is derived from represented evidence. This
                      does not prove medication reconciliation is clinically
                      complete.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                No medication reconciliation artifact has been generated.
              </div>
            )}
          </div>
        )}

        {activeTab === 'DRAFTING' && (
          <>
            {encounterId && careSetting ? (
              <GovernedClinicalDraftPanel
                tenantId={tenantId}
                patientId={patientId}
                encounterId={encounterId}
                careSetting={careSetting}
                offline={offline}
                currentRevision={currentRevision}
                value={artifacts.draft}
                onChange={(draft) =>
                  setArtifacts((current) => ({ ...current, draft }))
                }
                onAuthoritativeChange={onAuthoritativeChange}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                Select an active OPD, IPD, emergency, or telehealth encounter
                before creating a governed clinical draft.
              </div>
            )}
          </>
        )}

        {activeTab === 'EVIDENCE' && (
          <ClinicalCopilotEvidencePanel items={evidenceItems} />
        )}
      </div>

      <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
          <span>
            CI-10G workspace does not write diagnoses, prescriptions, orders, or
            clinical state directly.
          </span>
          <span>
            Evidence refs {evidenceItems.length} · warnings {warnings.length}
          </span>
        </div>
      </div>
    </section>
  );
}
