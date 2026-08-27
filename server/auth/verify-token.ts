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
  if (!auth) {
    throw new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Firebase Admin Auth service is uninitialized',
      statusCode: 503,
    });
  }

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
