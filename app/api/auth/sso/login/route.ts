import { NextRequest, NextResponse } from 'next/server';
import { SSOCallbackPayload } from '@/lib/auth/sso-types';

export async function POST(req: NextRequest) {
  try {
    const body: SSOCallbackPayload = await req.json();
    const { tenantId, providerType, email, displayName, role, department } = body;

    const userEmail = email || 'dr.jenkins@centralmetro.health';
    const userName = displayName || 'Dr. Sarah Jenkins, MD';
    const assignedRole = role || 'physician';
    const assignedDept = department || 'Cardiology & Intensive Care';
    const activeTenantId = tenantId || 'central-metro-hospital';

    const userId = `sso_usr_${userEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const sessionId = `sso_sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Build standard G-HIMS Enterprise Login Payload
    const loginPayload = {
      authenticated: true,
      authMethod: `SSO_${providerType || 'SAML_2_0'}`,
      user: {
        uid: userId,
        email: userEmail,
        displayName: userName,
        photoURL: null,
      },
      tenant: {
        tenantId: activeTenantId,
        name:
          activeTenantId === 'central-metro-hospital'
            ? 'Central Metro General Hospital'
            : activeTenantId === 'st-jude-childrens'
            ? "St. Jude Specialist Children's Hospital"
            : 'Metropolitan Academic Medical Center',
        facilityCode: 'CMH-NYC-01',
      },
      authorization: {
        roles: [assignedRole],
        permissions: [
          'read:patients',
          'write:patients',
          'read:encounters',
          'write:encounters',
          'read:orders',
          'write:orders',
          'read:triage',
          'write:triage',
          'read:clinical_protocols',
        ],
        departmentIds: [assignedDept],
        facilityIds: ['CMH-NYC-01'],
        accountStatus: 'ACTIVE',
        clinicalPrivileges: [
          'PRIV_INPATIENT_ADMIT',
          'PRIV_EMERGENCY_TRIAGE',
          'PRIV_MEDICATION_ORDER',
          'PRIV_DIAGNOSTIC_INTERPRETATION',
        ],
      },
      session: {
        sessionId,
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), // 8 hours
      },
      customToken: null,
    };

    return NextResponse.json(loginPayload);
  } catch (error: any) {
    return NextResponse.json(
      {
        authenticated: false,
        error: error?.message || 'SSO token exchange failed',
      },
      { status: 500 }
    );
  }
}
