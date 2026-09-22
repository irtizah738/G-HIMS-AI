/**
 * G-HIMS Standardized State Views (Empty, Loading, Error, Warning, Success & Audit)
 * Implements Rule 7 (Global UI Consistency Pass)
 */

'use client';

import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  FolderOpen,
  ShieldCheck,
  RefreshCw,
  Info,
} from 'lucide-react';

interface StateViewBaseProps {
  title: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
  className?: string;
  icon?: React.ReactNode;
}

export function EmptyState({
  title,
  description,
  actionText,
  onAction,
  className = '',
  icon,
}: StateViewBaseProps) {
  return (
    <div
      className={`w-full p-8 sm:p-12 flex flex-col items-center justify-center text-center bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl ${className}`}
    >
      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center mb-3">
        {icon || <FolderOpen className="w-6 h-6" />}
      </div>
      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed mb-4">
          {description}
        </p>
      )}
      {actionText && onAction && (
        <button
          onClick={onAction}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          {actionText}
        </button>
      )}
    </div>
  );
}

export function LoadingState({
  title = 'Processing Hospital Pipeline...',
  description = 'Executing authoritative server-side domain verification',
  className = '',
}: {
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={`w-full p-8 flex flex-col items-center justify-center text-center bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl ${className}`}
    >
      <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-3 animate-spin">
        <Loader2 className="w-5 h-5" />
      </div>
      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">{title}</h4>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{description}</p>
    </div>
  );
}

export function ErrorState({
  title = 'Operation Invariant Failure',
  description,
  actionText = 'Retry Operation',
  onAction,
  className = '',
}: StateViewBaseProps) {
  return (
    <div
      className={`w-full p-6 sm:p-8 flex flex-col items-center justify-center text-center bg-red-50/40 dark:bg-red-950/20 border border-red-200 dark:border-red-900/60 rounded-3xl ${className}`}
    >
      <div className="w-11 h-11 rounded-2xl bg-red-100 dark:bg-red-900/60 text-red-600 dark:text-red-300 flex items-center justify-center mb-3">
        <XCircle className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-bold text-red-900 dark:text-red-200 mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-red-700 dark:text-red-400 max-w-md leading-relaxed mb-4">
          {description}
        </p>
      )}
      {actionText && onAction && (
        <button
          onClick={onAction}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{actionText}</span>
        </button>
      )}
    </div>
  );
}

export function WarningState({
  title,
  description,
  actionText,
  onAction,
  className = '',
}: StateViewBaseProps) {
  return (
    <div
      className={`w-full p-5 sm:p-6 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/80 rounded-2xl flex items-start gap-3.5 ${className}`}
    >
      <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
        <AlertTriangle className="w-4 h-4" />
      </div>
      <div className="flex-1 text-xs">
        <h4 className="font-bold text-amber-900 dark:text-amber-200 text-sm">{title}</h4>
        {description && <p className="text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">{description}</p>}
        {actionText && onAction && (
          <button
            onClick={onAction}
            className="mt-3 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            {actionText}
          </button>
        )}
      </div>
    </div>
  );
}

export function SuccessState({
  title,
  description,
  className = '',
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={`w-full p-4 bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 rounded-2xl flex items-center gap-3 text-xs text-emerald-900 dark:text-emerald-200 ${className}`}
    >
      <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
        <CheckCircle2 className="w-4 h-4" />
      </div>
      <div>
        <h5 className="font-bold text-emerald-950 dark:text-emerald-100">{title}</h5>
        {description && <p className="text-emerald-700 dark:text-emerald-300 text-[11px] mt-0.5">{description}</p>}
      </div>
    </div>
  );
}

export function AuditIndicator({
  auditId,
  actor,
  timestamp,
}: {
  auditId: string;
  actor: string;
  timestamp?: string;
}) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-mono text-slate-600 dark:text-slate-400 select-none">
      <ShieldCheck className="w-3 h-3 text-emerald-500" />
      <span>AUDIT:{auditId.substring(0, 8)}</span>
      <span>•</span>
      <span>{actor}</span>
    </div>
  );
}
