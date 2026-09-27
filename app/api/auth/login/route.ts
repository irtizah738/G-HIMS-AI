import { NextResponse } from 'next/server';

/**
 * Password authentication is intentionally performed by the Firebase client SDK.
 * The G-HIMS server must never receive or mutate user passwords.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Direct password login endpoint removed. Authenticate with Firebase and exchange the ID token at /api/auth/session.',
      code: 'AUTHENTICATION_REQUIRED',
    },
    { status: 410 }
  );
}
