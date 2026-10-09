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
    if (loading || !mismatched) return;
    // Preserve the subpage, never preserve a foreign tenant identifier.
    const segments = String(pathname || '').split('/');
    if (segments.length < 2 || segments[1]?.toLowerCase() !== routeTenant) return;
    segments[1] = encodeURIComponent(sessionTenant);
    router.replace(segments.join('/') || `/${encodeURIComponent(sessionTenant)}`);
  }, [loading, mismatched, pathname, routeTenant, router, sessionTenant]);

  if (loading || unresolved) {
    return <div role="status" className="p-6 text-sm">Resolving authenticated hospital context…</div>;
  }
  if (mismatched) {
    return (
      <div role="status" className="rounded-xl border border-amber-300 p-5 text-sm">
        Your hospital selection changed. Restoring the verified tenant session before loading records…
      </div>
    );
  }
  return <>{children}</>;
}
