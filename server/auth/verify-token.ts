/**
 * G-HIMS Server-Side Token Verification
 * Strictly backend-only, verifies Firebase ID tokens with revocation checks
 */

import { getAdminAuth } from '@/server/firebase/admin';
import { DecodedIdToken } from 'firebase-admin/auth';
import { AuthError } from '@/lib/auth/auth-errors';

export interface VerifiedTokenResult {
  uid: string;
  email: string;
  name?: string;
  claims: DecodedIdToken;
}

export async function verifyFirebaseToken(
  token: string,
  checkRevoked = true
): Promise<VerifiedTokenResult> {
  if (!token || typeof token !== 'string') {
    throw new AuthError({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Missing or empty authorization token',
      statusCode: 401,
    });
  }

  const auth = getAdminAuth();
  if (auth) {
    try {
      const decodedToken = await auth.verifyIdToken(token, checkRevoked);
      return {
        uid: decodedToken.uid,
        email: decodedToken.email || '',
        name: decodedToken.name,
        claims: decodedToken,
      };
    } catch (err: any) {
      if (err?.code === 'auth/id-token-revoked') {
        throw new AuthError({
          code: 'SESSION_REVOKED',
          message: 'Security token has been revoked by an administrator or security policy',
          statusCode: 401,
          originalError: err,
        });
      }

      if (err?.code === 'auth/id-token-expired') {
        throw new AuthError({
          code: 'TOKEN_EXPIRED',
          message: 'Security token expired. Please refresh credentials',
          statusCode: 401,
          originalError: err,
        });
      }

      throw new AuthError({
        code: 'INVALID_CREDENTIALS',
        message: err?.message || 'Failed to verify authentication token',
        statusCode: 401,
        originalError: err,
      });
    }
  }

  // Fallback: Verify ID token authoritatively using Google Identity Toolkit
  try {
    const apiKey =
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      process.env.FIREBASE_API_KEY ||
      'AIzaSyDStZ-zlI6kAP_oZu7fr3GYSw3drz9PqT0';

    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      }
    );

    const lookupData = await lookupRes.json();
    if (!lookupRes.ok || !lookupData.users || lookupData.users.length === 0) {
      const rawMsg = lookupData?.error?.message || 'Failed to verify authentication token';
      if (rawMsg.includes('EXPIRED')) {
        throw new AuthError({
          code: 'TOKEN_EXPIRED',
          message: 'Security token expired. Please refresh credentials',
          statusCode: 401,
        });
      }
      throw new AuthError({
        code: 'INVALID_CREDENTIALS',
        message: rawMsg,
        statusCode: 401,
      });
    }

    const idUser = lookupData.users[0];
    let customClaims: Record<string, any> = {};
    if (idUser.customAttributes) {
      try {
        customClaims = JSON.parse(idUser.customAttributes);
      } catch {
        // Ignore custom claim parse error
      }
    }

    return {
      uid: idUser.localId,
      email: idUser.email || '',
      name: idUser.displayName,
      claims: {
        ...customClaims,
        uid: idUser.localId,
        sub: idUser.localId,
        email: idUser.email || '',
        name: idUser.displayName,
        aud: process.env.FIREBASE_PROJECT_ID || 'g-hims-ai',
        iss: `https://securetoken.google.com/${process.env.FIREBASE_PROJECT_ID || 'g-hims-ai'}`,
        auth_time: Math.floor(Date.now() / 1000),
      } as any,
    };
  } catch (lookupErr: any) {
    if (lookupErr instanceof AuthError) throw lookupErr;
    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: lookupErr?.message || 'Firebase token verification failed',
      statusCode: 503,
      originalError: lookupErr,
    });
  }
}

export function extractBearerToken(authHeader: string | null | undefined): string {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Malformed or missing Authorization: Bearer <token> header',
      statusCode: 401,
    });
  }
  const token = authHeader.substring(7).trim();
  if (!token) {
    throw new AuthError({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Empty Bearer token in request header',
      statusCode: 401,
    });
  }
  return token;
}
