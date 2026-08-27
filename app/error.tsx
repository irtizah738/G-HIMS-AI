'use client';

import React, { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App-level error captured:', error);
  }, [error]);

  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full p-6 bg-white dark:bg-slate-900 rounded-2xl border border-rose-200 dark:border-rose-900/60 shadow-xs">
        <h3 className="text-base font-bold text-rose-600 dark:text-rose-400 mb-2">
          Clinical Encounter Error
        </h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
          {error.message || 'An unexpected rendering error occurred in the clinical workstation.'}
        </p>
        <button
          onClick={() => reset()}
          className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-xl transition-colors"
        >
          Retry View
        </button>
      </div>
    </div>
  );
}
