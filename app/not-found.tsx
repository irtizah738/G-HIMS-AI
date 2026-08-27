import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 p-6 text-center">
      <div className="max-w-md w-full p-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <h2 className="text-3xl font-black text-slate-900 dark:text-white mb-2">404</h2>
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-6">
          The requested clinical module or patient route could not be found.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
        >
          Return to Clinical Hub
        </Link>
      </div>
    </div>
  );
}
