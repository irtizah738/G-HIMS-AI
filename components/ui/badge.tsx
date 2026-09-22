/**
 * G-HIMS Standardized Clinical Badges & Status Indicators
 * Implements Rule 7 (Global UI Consistency Pass)
 */

'use client';

import React from 'react';

export type BadgeVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'outline'
  | 'audit';

export type BadgeSize = 'sm' | 'md' | 'lg';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  children: React.ReactNode;
  icon?: React.ReactNode;
  pulse?: boolean;
}

export function Badge({
  variant = 'default',
  size = 'md',
  children,
  icon,
  pulse = false,
  className = '',
  ...props
}: BadgeProps) {
  const variantClasses: Record<BadgeVariant, string> = {
    default: 'bg-slate-100 dark:bg-slate-850 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700',
    primary: 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    success: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
    warning: 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    danger: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
    info: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
    neutral: 'bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800',
    outline: 'bg-transparent text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700',
    audit: 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 font-mono',
  };

  const sizeClasses: Record<BadgeSize, string> = {
    sm: 'text-[10px] px-1.5 py-0.5 font-bold',
    md: 'text-xs px-2.5 py-0.5 font-semibold',
    lg: 'text-xs px-3 py-1 font-bold',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border tracking-tight transition-colors select-none ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {pulse && (
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
        </span>
      )}
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
}
