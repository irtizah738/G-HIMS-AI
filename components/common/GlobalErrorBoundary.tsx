'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home, ShieldAlert } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in application boundary:', error, errorInfo);
    this.setState({ errorInfo });

    // Handle chunk loading timeout or stale deployment chunks gracefully
    if (typeof window !== 'undefined' && error?.message) {
      const isChunkError = /Loading chunk .* failed/i.test(error.message) || /failed to fetch dynamically imported module/i.test(error.message);
      if (isChunkError) {
        const hasAutoReloaded = sessionStorage.getItem('ghims_chunk_retry');
        if (!hasAutoReloaded) {
          sessionStorage.setItem('ghims_chunk_retry', 'true');
          setTimeout(() => {
            window.location.reload();
          }, 300);
        }
      }
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  private handleClearCacheAndReset = () => {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.clear();
        localStorage.removeItem('ghims_active_tab');
      } catch (e) {
        console.error('Failed to clear storage:', e);
      }
      window.location.href = '/';
    }
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 sm:p-6 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
          <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-xl space-y-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0 border border-rose-200 dark:border-rose-800">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Application Exception Caught
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  G-HIMS resilient runtime shielded the clinical interface.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-rose-50/50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/50 font-mono text-xs text-rose-700 dark:text-rose-300 break-words max-h-40 overflow-y-auto">
              {this.state.error?.message || 'An unexpected runtime error occurred.'}
            </div>

            {this.state.errorInfo && (
              <details className="text-xs text-slate-500 dark:text-slate-400">
                <summary className="cursor-pointer hover:text-slate-700 dark:hover:text-slate-300 font-semibold mb-2">
                  View component stack trace
                </summary>
                <pre className="p-3 rounded-lg bg-slate-100 dark:bg-slate-950 text-[11px] font-mono overflow-x-auto text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 max-h-48 overflow-y-auto">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}

            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="w-full sm:flex-1 h-10 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs cursor-pointer active:scale-95 transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload Interface</span>
              </button>

              <button
                type="button"
                onClick={this.handleClearCacheAndReset}
                className="w-full sm:flex-1 h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <Home className="w-4 h-4" />
                <span>Reset View State</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
