import { NextResponse, type NextRequest } from 'next/server';

// Tenant boundary path regex (e.g., /central-metro-hospital/diagnostics/...)
const TENANT_PATH_REGEX = /^\/([a-zA-Z0-9_-]+)(\/.*)?$/;

// Reserved non-tenant system routes
const RESERVED_ROUTES = new Set([
  'api',
  '_next',
  'favicon.ico',
  'manifest.json',
  'robots.txt',
  'sitemap.xml',
  'login',
  'auth',
  'forgot-password',
  'settings',
  'tenant-selection',
  'dashboard',
  '_not-found',
]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.headers.get('host') || '';

  // Skip static assets, internal Next.js requests and APIs
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // 1. Extract tenant from subdomain if configured (e.g., tenant1.ghims.health)
  let extractedTenantId: string | null = null;
  const hostParts = hostname.split('.');
  if (hostParts.length > 2 && !hostname.includes('localhost') && !hostname.includes('run.app')) {
    const subdomain = hostParts[0].toLowerCase();
    if (subdomain !== 'www' && subdomain !== 'app') {
      extractedTenantId = subdomain;
    }
  }

  // 2. Extract tenant from URL path segment (e.g. /[tenantId]/...)
  const pathMatch = pathname.match(TENANT_PATH_REGEX);
  const firstSegment = pathMatch ? pathMatch[1] : null;

  if (firstSegment && !RESERVED_ROUTES.has(firstSegment)) {
    extractedTenantId = firstSegment;
  }

  // 3. Fallback to cookie if present
  if (!extractedTenantId) {
    const tenantCookie = request.cookies.get('ghims_tenant_id');
    if (tenantCookie?.value) {
      extractedTenantId = tenantCookie.value;
    }
  }

  // Default fallback tenant if none resolved
  const resolvedTenantId = extractedTenantId || 'central-metro-hospital';

  // 4. Boundary enforcement: Attach tenant headers for downstream Server Components / API Routes
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-ghims-tenant-id', resolvedTenantId);
  requestHeaders.set('x-ghims-tenant-path', pathname);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Set tenant isolation cookie
  response.cookies.set({
    name: 'ghims_tenant_id',
    value: resolvedTenantId,
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    sameSite: 'lax',
  });

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
