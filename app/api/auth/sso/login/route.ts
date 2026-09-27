import { NextRequest, NextResponse } from 'next/server';
import { isDemoRuntime } from '@/lib/runtime/runtime-mode';

/**
 * Enterprise SSO remains disabled until a real OIDC/SAML assertion verifier is configured.
 * Synthetic SSO is permitted only in the isolated DEMO runtime.
 */
export async function POST(req: NextRequest) {
  if (!isDemoRuntime()) {
    return NextResponse.json(
      {
        authenticated: false,
        code: 'SSO_CONFIG_ERROR',
        error: 'Enterprise SSO is not configured for this environment.',
      },
      { status: 501 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || 'demo.clinician@example.invalid').trim().toLowerCase();
  const tenantId = String(body.tenantId || 'central-metro-hospital').trim().toLowerCase();

  return NextResponse.json({
    authenticated: true,
    authMethod: 'DEMO_SSO',
    user: {
      uid: `demo_sso_${email.replace(/[^a-z0-9]/g, '_')}`,
      email,
      displayName: String(body.displayName || 'Demo Clinician'),
    },
    tenant: {
      tenantId,
      name: 'G-HIMS Demo Hospital',
      facilityCode: 'DEMO',
    },
    authorization: {
      roles: ['doctor'],
      permissions: ['read:patients', 'read:encounters'],
      departmentIds: ['demo_department'],
      facilityIds: ['demo_facility'],
      accountStatus: 'ACTIVE',
      clinicalPrivileges: [],
    },
    session: {
      sessionId: `demo_sess_${Date.now()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    accessibleTenants: [
      {
        tenantId,
        name: 'G-HIMS Demo Hospital',
        facilityCode: 'DEMO',
        roles: ['doctor'],
      },
    ],
  });
}
