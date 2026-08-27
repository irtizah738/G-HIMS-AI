import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/server/firebase/admin';
import { logAuthEvent } from '@/server/auth/audit-service';

export async function POST(req: NextRequest) {
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
  const userAgent = req.headers.get('user-agent') || 'Unknown';

  try {
    const body = await req.json().catch(() => ({}));
    const email = (body.email || '').trim().toLowerCase();

    if (!email || !email.includes('@')) {
      return NextResponse.json({
        success: true,
        message: 'If an account exists for this email, password-reset instructions have been sent.',
      });
    }

    const auth = getAdminAuth();
    if (auth) {
      try {
        await auth.generatePasswordResetLink(email);
      } catch (err: any) {
        // Do not leak user existence error
        console.warn('Password reset generation notice:', err?.message);
      }
    }

    await logAuthEvent({
      eventType: 'PASSWORD_RESET_REQUESTED',
      userEmail: email,
      ip: clientIp,
      userAgent,
      reason: 'User password reset request',
    });

    return NextResponse.json({
      success: true,
      message: 'If an account exists for this email, password-reset instructions have been sent.',
    });
  } catch (err) {
    return NextResponse.json({
      success: true,
      message: 'If an account exists for this email, password-reset instructions have been sent.',
    });
  }
}
