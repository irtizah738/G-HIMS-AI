'use client';

import React from 'react';
import { WorkflowSnapshot, WorkflowStage } from '@/types/encounter-runtime';
import {
  CheckCircle2,
  Clock,
  Lock,
  ChevronRight,
  ShieldCheck,
  UserCheck,
  AlertCircle,
} from 'lucide-react';

interface ClinicalWorkflowStepperProps {
  snapshot: WorkflowSnapshot;
  onStageSelect?: (stage: WorkflowStage) => void;
  selectedStageId?: string;
}

export function ClinicalWorkflowStepper({
  snapshot,
  onStageSelect,
  selectedStageId,
}: ClinicalWorkflowStepperProps) {
  const currentStageIndex = snapshot.stages.findIndex(
    (s) => s.id === snapshot.currentStageId
  );

  return (
    <div
      id="clinical-workflow-stepper"
      className="w-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs transition-all"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100 dark:border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-600 animate-pulse" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              Clinical Workflow Runtime Lifecycle
            </h3>
            {snapshot.isCompleted ? (
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                Encounter Concluded
              </span>
            ) : (
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                Active Cycle
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Deterministic 5-stage progression with RBAC verification & SLA dwell tracking
          </p>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-medium">
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-200/80 dark:border-slate-700">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>
              Initialized:{' '}
              <strong className="text-slate-700 dark:text-slate-200 font-semibold">
                {new Date(snapshot.initializedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </strong>
            </span>
          </div>
          {snapshot.totalDurationMinutes !== undefined && (
            <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>
                Total: <strong>{snapshot.totalDurationMinutes}m</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Stepper Progress Bar and Stage Cards */}
      <div className="relative grid grid-cols-1 md:grid-cols-5 gap-3">
        {snapshot.stages.map((stage, idx) => {
          const isCompleted = stage.status === 'COMPLETED';
          const isActive = stage.status === 'ACTIVE';
          const isPending = stage.status === 'PENDING' && idx > (currentStageIndex >= 0 ? currentStageIndex : 0);
          const isSelected = selectedStageId === stage.id;

          let stateStyle = 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 text-slate-400';
          let badgeColor = 'bg-slate-100 dark:bg-slate-800 text-slate-500';

          if (isCompleted) {
            stateStyle = 'border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/40 dark:bg-emerald-950/20 text-slate-800 dark:text-slate-100 hover:border-emerald-400';
            badgeColor = 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300';
          } else if (isActive) {
            stateStyle = 'border-blue-500 dark:border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/40 dark:bg-blue-950/30 text-slate-900 dark:text-white shadow-xs';
            badgeColor = 'bg-blue-600 text-white animate-pulse';
          }

          if (isSelected) {
            stateStyle += ' ring-2 ring-offset-1 ring-slate-900 dark:ring-white';
          }

          return (
            <button
              key={stage.id}
              id={`stage-card-${stage.id}`}
              type="button"
              onClick={() => onStageSelect?.(stage)}
              className={`text-left p-3.5 rounded-xl border transition-all relative flex flex-col justify-between group ${stateStyle}`}
            >
              <div>
                {/* Header row with Step number / State Icon */}
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`w-6 h-6 rounded-lg text-xs font-black flex items-center justify-center ${badgeColor}`}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    ) : isActive ? (
                      <span>{stage.order}</span>
                    ) : isPending ? (
                      <Lock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-600" />
                    ) : (
                      <span>{stage.order}</span>
                    )}
                  </span>

                  {/* Status Pill */}
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                      isCompleted
                        ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                        : isActive
                        ? 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-200'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {isCompleted ? 'Done' : isActive ? 'Active' : 'Locked'}
                  </span>
                </div>

                {/* Stage Title */}
                <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1">
                  {stage.name}
                </h4>

                {/* Role / Actor info */}
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {isCompleted ? (
                    <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                      <UserCheck className="w-3 h-3 shrink-0" />
                      <span className="truncate">{stage.actorName || stage.actorRole}</span>
                    </div>
                  ) : isActive ? (
                    <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>SLA: {stage.slaTargetMinutes || 15}m</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-slate-400 dark:text-slate-500 text-[10px] truncate">
                      <span>Roles: {stage.requiredRoles.slice(0, 2).join(', ')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom metric: duration or SLA */}
              <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
                {isCompleted ? (
                  <span>
                    Dwell: <strong className="text-slate-700 dark:text-slate-300">{stage.durationMinutes || 1} min</strong>
                  </span>
                ) : isActive ? (
                  <span className="text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping inline-block" />
                    In Progress
                  </span>
                ) : (
                  <span>Target: {stage.slaTargetMinutes || 15}m</span>
                )}
                <ChevronRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
