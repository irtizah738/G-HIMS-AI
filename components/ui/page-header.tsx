/**
 * G-HIMS Standardized Clinical & Enterprise Page Header
 * Implements Rule 7 (Global UI Consistency Pass) & Rule 8 (Hospital Context)
 */

'use client';

import React from 'react';
import { ChevronRight, ShieldCheck, Activity } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  category?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  auditTag?: string;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon,
  category,
  breadcrumbs,
  actions,
  auditTag,
  children,
  className = '',
}: PageHeaderProps) {
  return (
    <div
      className={`w-full bg-white dark:bg-slate-900 rounded-2xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-xs transition-colors space-y-3 ${className}`}
    >
      {/* Breadcrumbs or Category strip */}
      {(breadcrumbs && breadcrumbs.length > 0) || category ? (
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
          {breadcrumbs ? (
            breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <ChevronRight className="w-3 h-3 text-slate-400" />}
                {crumb.onClick ? (
                  <button
                    onClick={crumb.onClick}
                    className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className={idx === breadcrumbs.length - 1 ? 'text-slate-700 dark:text-slate-300 font-semibold' : ''}>
                    {crumb.label}
                  </span>
                )}
              </React.Fragment>
            ))
          ) : (
            <span className="uppercase font-bold tracking-wider text-blue-600 dark:text-blue-400">
              {category}
            </span>
          )}

          {auditTag && (
            <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-750">
              <ShieldCheck className="w-3 h-3 text-emerald-500" />
              {auditTag}
            </span>
          )}
        </div>
      ) : null}

      {/* Main Header Row: Icon + Title + Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          {icon && (
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold shadow-2xs shrink-0 mt-0.5">
              {icon}
            </div>
          )}
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight">
              {title}
            </h1>
            {description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-2xl leading-relaxed">
                {description}
              </p>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>

      {children && <div className="pt-2">{children}</div>}
    </div>
  );
}
