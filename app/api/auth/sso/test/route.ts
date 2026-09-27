import { NextResponse } from 'next/server';
import { isDemoRuntime } from '@/lib/runtime/runtime-mode';

export async function POST() {
  if (!isDemoRuntime()) {
    return NextResponse.json(
      {
        success: false,
        code: 'SSO_CONFIG_ERROR',
        statusMessage: 'SSO connectivity simulation is disabled outside DEMO runtime.',
      },
      { status: 501 }
    );
  }

  return NextResponse.json({
    success: true,
    providerType: 'DEMO',
    statusMessage: 'Demo-only SSO simulation. No external IdP verification was performed.',
    certificateValid: false,
    endpointsReachable: false,
    simulated: true,
    testedAt: new Date().toISOString(),
  });
}
