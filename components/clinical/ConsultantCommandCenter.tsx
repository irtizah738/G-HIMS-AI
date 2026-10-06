'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileSearch,
  RefreshCw,
  Stethoscope,
  Users,
} from 'lucide-react';
import { useAuth } from '@/lib/auth/auth-context';
import { useHospital } from '@/lib/context/hospital-context';
import { useRBAC } from '@/lib/auth/rbac-context';
import {
  acceptClinicalConsultation,
  acceptClinicalHandoff,
  acknowledgeClinicalConsultation,
  acknowledgeClinicalOpenItem,
  completeClinicalConsultation,
  loadConsultantWorklist,
} from '@/lib/clinical/intelligence/consultant-worklist-client';
import type {
  ConsultantWorklist,
  ConsultantWorklistItem,
} from '@/types/clinical-coordination';

function formatTime(value?: number) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function priorityLabel(item: ConsultantWorklistItem) {
  return item.clinicalPriority.replace(/_/g, ' ');
}

export function ConsultantCommandCenter() {
  const auth = useAuth();
  const { setActiveTab } = useHospital();
  const { setActivePatientId } = useRBAC();
  const tenantId = auth.activeTenant?.tenantId || auth.user?.tenantId || '';

  const [worklist, setWorklist] = useState<ConsultantWorklist | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingItemId, setActingItemId] = useState<string | null>(null);
  const [completionItem, setCompletionItem] = useState<ConsultantWorklistItem | null>(null);
  const [completionAssessment, setCompletionAssessment] = useState('');
  const [completionRecommendations, setCompletionRecommendations] = useState('');

  const load = useCallback(async () => {
    if (!tenantId || auth.isOffline) return;
    setLoading(true);
    setError(null);
    try {
      setWorklist(await loadConsultantWorklist(tenantId));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Consultant worklist could not be loaded.'
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId, auth.isOffline]);

  useEffect(() => {
    void load();
  }, [load]);

  const overdue = useMemo(
    () =>
      (worklist?.items || []).filter(
        (item) => item.dueAt && item.dueAt < Date.now() && item.status !== 'RESOLVED'
      ).length,
    [worklist]
  );

  const openPatient = (item: ConsultantWorklistItem) => {
    setActivePatientId(item.patientId);
    setActiveTab('patients');
  };

  const acknowledge = async (item: ConsultantWorklistItem) => {
    if (!tenantId || !item.encounterId || item.status !== 'OPEN') return;
    setActingItemId(item.openItemId);
    setError(null);
    try {
      await acknowledgeClinicalOpenItem(tenantId, {
        patientId: item.patientId,
        encounterId: item.encounterId,
        openItemId: item.openItemId,
      });
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Attention item could not be acknowledged.'
      );
    } finally {
      setActingItemId(null);
    }
  };

  const acknowledgeConsultation = async (item: ConsultantWorklistItem) => {
    if (!tenantId || !item.encounterId || item.category !== 'CONSULTATION' || item.slaPhase !== 'ACKNOWLEDGEMENT') return;
    const consultationId = item.sourceRefs[0];
    if (!consultationId) return;
    setActingItemId(item.openItemId);
    setError(null);
    try {
      await acknowledgeClinicalConsultation(tenantId, {
        patientId: item.patientId,
        encounterId: item.encounterId,
        consultationId,
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Consultation could not be acknowledged.');
    } finally {
      setActingItemId(null);
    }
  };

  const acceptCoordinationItem = async (item: ConsultantWorklistItem) => {
    if (!tenantId || !item.encounterId) return;
    const sourceId = item.sourceRefs[0];
    if (!sourceId || !['CONSULTATION', 'HANDOFF'].includes(item.category)) return;

    setActingItemId(item.openItemId);
    setError(null);
    try {
      if (item.category === 'CONSULTATION') {
        await acceptClinicalConsultation(tenantId, {
          patientId: item.patientId,
          encounterId: item.encounterId,
          consultationId: sourceId,
        });
      } else {
        await acceptClinicalHandoff(tenantId, {
          patientId: item.patientId,
          encounterId: item.encounterId,
          handoffId: sourceId,
        });
      }
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Clinical coordination item could not be accepted.'
      );
    } finally {
      setActingItemId(null);
    }
  };

  const completeConsultation = async () => {
    if (!tenantId || !completionItem?.encounterId) return;
    const consultationId = completionItem.sourceRefs[0];
    const assessment = completionAssessment.trim();
    const recommendations = completionRecommendations
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!consultationId || !assessment || recommendations.length === 0) {
      setError('Assessment and at least one recommendation are required to complete a consultation.');
      return;
    }

    setActingItemId(completionItem.openItemId);
    setError(null);
    try {
      await completeClinicalConsultation(tenantId, {
        patientId: completionItem.patientId,
        encounterId: completionItem.encounterId,
        consultationId,
        assessment,
        recommendations,
        primaryTeamReviewRequired: true,
      });
      setCompletionItem(null);
      setCompletionAssessment('');
      setCompletionRecommendations('');
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Consultation could not be completed.'
      );
    } finally {
      setActingItemId(null);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Stethoscope className="h-5 w-5 text-indigo-600" />
              <h1 className="text-xl font-black text-slate-900 dark:text-slate-100">
                Consultant Command Center
              </h1>
            </div>
            <p className="mt-1 max-w-3xl text-xs text-slate-500">
              Authoritative attention queue across OPD, IPD, ED and longitudinal Patient 360. Items are projected from clinical source state and preserve ownership, acknowledgment and escalation state.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || auth.isOffline}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {auth.isOffline && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
            Consultant worklist requires authoritative server connectivity. Use the encrypted Patient 360 edge view for offline continuity; do not assume the attention queue is current while offline.
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
            {error}
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label: 'Needs attention',
            value: worklist?.counts.total || 0,
            icon: Users,
          },
          {
            label: 'Critical',
            value: worklist?.counts.critical || 0,
            icon: AlertTriangle,
          },
          {
            label: 'Action required',
            value: worklist?.counts.actionRequired || 0,
            icon: Activity,
          },
          {
            label: 'Diagnostics',
            value: worklist?.counts.diagnostics || 0,
            icon: FileSearch,
          },
          {
            label: 'Overdue SLA',
            value: overdue,
            icon: Clock3,
          },
        ].map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {label}
              </span>
              <Icon className="h-4 w-4 text-slate-400" />
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">
              {value}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <h2 className="text-sm font-bold">My authoritative attention queue</h2>
          <p className="mt-1 text-xs text-slate-500">
            Critical and action-required items are ordered before routine review items. Source-controlled items close only when the underlying clinical state resolves.
          </p>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {!loading && !worklist?.items.length ? (
            <div className="px-6 py-12 text-center">
              <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-2 text-sm font-bold">No unresolved consultant attention items</p>
              <p className="mt-1 text-xs text-slate-500">
                This reflects the current authoritative projection, not an inferred “all clear.”
              </p>
            </div>
          ) : (
            (worklist?.items || []).map((item) => {
              const isOverdue = Boolean(item.dueAt && item.dueAt < Date.now());
              return (
                <div key={item.openItemId} className="p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={
                            item.clinicalPriority === 'CRITICAL_REVIEW_REQUIRED'
                              ? 'rounded-full bg-rose-100 px-2 py-1 text-[10px] font-black text-rose-800'
                              : item.clinicalPriority === 'ACTION_REQUIRED'
                                ? 'rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800'
                                : 'rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600'
                          }
                        >
                          {priorityLabel(item)}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          {item.category}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {item.careSetting}
                        </span>
                        {item.slaPhase && item.slaPhase !== 'COMPLETE' && (
                          <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">
                            {item.slaPhase === 'ACKNOWLEDGEMENT' ? 'Awaiting acknowledgement' : 'Awaiting acceptance'}
                          </span>
                        )}
                        {isOverdue && (
                          <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">
                            SLA overdue
                          </span>
                        )}
                      </div>

                      <div className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                        {item.description}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        Patient {item.patientId}
                        {item.encounterId ? ` · Encounter ${item.encounterId}` : ''}
                        {item.dueAt ? ` · Due ${formatTime(item.dueAt)}` : ''}
                      </div>
                      <div className="mt-1 text-[10px] text-slate-400">
                        Owner {item.ownerType}
                        {item.ownerId ? ` · ${item.ownerId}` : ''}
                        {item.acknowledgedAt
                          ? ` · acknowledged ${formatTime(item.acknowledgedAt)}`
                          : ''}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openPatient(item)}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200"
                      >
                        Open Patient 360
                      </button>
                      {item.encounterId &&
                        item.category === 'CONSULTATION' &&
                        item.slaPhase === 'ACKNOWLEDGEMENT' &&
                        Boolean(item.sourceRefs[0]) && (
                          <button
                            type="button"
                            onClick={() => void acknowledgeConsultation(item)}
                            disabled={actingItemId === item.openItemId}
                            className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800 disabled:opacity-50"
                          >
                            {actingItemId === item.openItemId ? 'Acknowledging…' : 'Acknowledge consult'}
                          </button>
                        )}
                      {item.encounterId &&
                        ((item.category === 'CONSULTATION' && item.slaPhase === 'ACCEPTANCE') ||
                          item.category === 'HANDOFF') &&
                        Boolean(item.sourceRefs[0]) && (
                          <button
                            type="button"
                            onClick={() => void acceptCoordinationItem(item)}
                            disabled={actingItemId === item.openItemId}
                            className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-800 disabled:opacity-50"
                          >
                            {actingItemId === item.openItemId
                              ? 'Accepting…'
                              : item.category === 'CONSULTATION'
                                ? 'Accept consult'
                                : 'Accept handoff'}
                          </button>
                        )}
                      {item.category === 'CONSULTATION' &&
                        item.slaPhase === 'COMPLETE' &&
                        Boolean(item.sourceRefs[0]) && (
                          <button
                            type="button"
                            onClick={() => {
                              setCompletionItem(item);
                              setCompletionAssessment('');
                              setCompletionRecommendations('');
                            }}
                            disabled={actingItemId === item.openItemId}
                            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 disabled:opacity-50"
                          >
                            Complete consult
                          </button>
                        )}
                      {item.status === 'OPEN' &&
                        item.encounterId &&
                        !(
                          item.category === 'CONSULTATION' &&
                          item.slaPhase === 'ACKNOWLEDGEMENT'
                        ) && (
                        <button
                          type="button"
                          onClick={() => void acknowledge(item)}
                          disabled={actingItemId === item.openItemId}
                          className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                          {actingItemId === item.openItemId
                            ? 'Recording…'
                            : 'Acknowledge'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {completionItem && (
        <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm dark:border-emerald-900 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-slate-100">
                Complete specialist consultation
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Record the consultant assessment and explicit recommendations. The worklist closes only after the authoritative consultation completion event commits.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCompletionItem(null)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold"
            >
              Cancel
            </button>
          </div>
          <div className="mt-4 grid gap-4">
            <label className="grid gap-1 text-xs font-bold text-slate-700 dark:text-slate-200">
              Assessment
              <textarea
                value={completionAssessment}
                onChange={(event) => setCompletionAssessment(event.target.value)}
                rows={4}
                maxLength={12000}
                className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-700 dark:text-slate-200">
              Recommendations
              <textarea
                value={completionRecommendations}
                onChange={(event) => setCompletionRecommendations(event.target.value)}
                rows={4}
                maxLength={12000}
                placeholder="One recommendation per line"
                className="rounded-xl border border-slate-200 bg-white p-3 text-sm font-normal dark:border-slate-700 dark:bg-slate-950"
              />
            </label>
            <div>
              <button
                type="button"
                onClick={() => void completeConsultation()}
                disabled={
                  actingItemId === completionItem.openItemId ||
                  !completionAssessment.trim() ||
                  !completionRecommendations.trim()
                }
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50"
              >
                {actingItemId === completionItem.openItemId
                  ? 'Completing…'
                  : 'Commit consultation completion'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
