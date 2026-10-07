import { NextResponse, type NextRequest } from 'next/server';

// Tenant boundary path regex (e.g., /central-metro-hospital/diagnostics/...).
// This is routing context only; protected APIs re-resolve tenant authority from
// the authenticated membership/session and never trust this header by itself.
const TENANT_PATH_REGEX = /^\/([a-zA-Z0-9_-]+)(\/.*)?$/;

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

function runtimeMode(): string {
  return String(
    process.env.GHIMS_RUNTIME_MODE ||
      process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE ||
      ''
  )
    .trim()
    .toUpperCase();
}

function buildContentSecurityPolicy(nonce: string): string {
  const developmentScriptPolicy =
    process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentScriptPolicy}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data: https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com https://*.google.com",
    "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function resolveRoutingTenant(request: NextRequest): string | null {
  const { pathname } = request.nextUrl;
  const hostname = request.headers.get('host') || '';

  const hostParts = hostname.split('.');
  if (
    hostParts.length > 2 &&
    !hostname.includes('localhost') &&
    !hostname.includes('run.app')
  ) {
    const subdomain = hostParts[0].toLowerCase();
    if (subdomain !== 'www' && subdomain !== 'app') {
      return subdomain;
    }
  }

  const pathMatch = pathname.match(TENANT_PATH_REGEX);
  const firstSegment = pathMatch ? pathMatch[1] : null;
  if (firstSegment && !RESERVED_ROUTES.has(firstSegment)) {
    return firstSegment.toLowerCase();
  }

  const tenantCookie = request.cookies.get('ghims_tenant_id')?.value?.trim();
  return tenantCookie ? tenantCookie.toLowerCase() : null;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.includes('.') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

  const resolvedTenantId = resolveRoutingTenant(request);
  if (resolvedTenantId) {
    requestHeaders.set('x-ghims-tenant-id', resolvedTenantId);
    requestHeaders.set('x-ghims-tenant-path', pathname);
  } else {
    // Never invent a tenant. Unscoped routes stay unscoped until the user
    // chooses an authorized tenant or a protected API derives one explicitly.
    requestHeaders.delete('x-ghims-tenant-id');
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (resolvedTenantId) {
    const mode = runtimeMode();
    response.cookies.set({
      name: 'ghims_tenant_id',
      value: resolvedTenantId,
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'lax',
      secure: mode === 'STAGING' || mode === 'PRODUCTION',
    });
  }

  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()'
  );
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  const mode = runtimeMode();
  if (mode === 'STAGING' || mode === 'PRODUCTION') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
