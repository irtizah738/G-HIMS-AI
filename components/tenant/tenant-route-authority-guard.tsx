'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth/auth-context';

/**
 * Route scope may lag behind authenticated tenant switching. Never allow a
 * module to hydrate using a URL tenant that differs from the verified session.
 */
export function TenantRouteAuthorityGuard({
  routeTenantId,
  children,
}: {
  routeTenantId: string;
  children: React.ReactNode;
}) {
  const { activeTenant, user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const sessionTenant = String(activeTenant?.tenantId || user?.tenantId || '').trim().toLowerCase();
  const routeTenant = String(routeTenantId || '').trim().toLowerCase();
  // Absence of verified scope is not an authorization grant.
  const unresolved = !sessionTenant || !routeTenant;
  const mismatched = Boolean(sessionTenant && routeTenant && sessionTenant !== routeTenant);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
      return;
    }
    if (loading || !mismatched) return;
    // Preserve the subpage, never preserve a foreign tenant identifier.
    const segments = String(pathname || '').split('/');
    if (segments.length < 2 || segments[1]?.toLowerCase() !== routeTenant) return;
    segments[1] = encodeURIComponent(sessionTenant);
    router.replace(segments.join('/') || `/${encodeURIComponent(sessionTenant)}`);
  }, [loading, user, mismatched, pathname, routeTenant, router, sessionTenant]);

  if (loading) {
    return (
      <div role="status" className="min-h-[40vh] flex flex-col items-center justify-center p-6 text-center space-y-3">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          Resolving authenticated hospital context…
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div role="status" className="min-h-[40vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <div className="text-base font-bold text-slate-900 dark:text-white">
          Authentication Required
        </div>
        <p className="text-xs text-slate-500 max-w-sm">
          Please sign in with your hospital credentials to access clinical records.
        </p>
        <button
          onClick={() => router.replace('/login')}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition cursor-pointer"
        >
          Sign In to G-HIMS
        </button>
      </div>
    );
  }

  if (unresolved) {
    return (
      <div role="status" className="p-6 text-sm text-slate-600 dark:text-slate-400">
        Resolving hospital facility scope…
      </div>
    );
  }

  if (mismatched) {
    return (
      <div role="status" className="rounded-xl border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/20 p-5 text-sm text-amber-800 dark:text-amber-200">
        Your hospital selection changed. Restoring the verified tenant session before loading records…
      </div>
    );
  }
  return <>{children}</>;
}
