/**
 * G-HIMS Master Auth Error Definitions & Sanitary Message Translation
 * Strictly prevents account enumeration & internal system leakage
 */

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_PENDING'
  | 'TENANT_ACCESS_DENIED'
  | 'TENANT_NOT_FOUND'
  | 'TENANT_SELECTION_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'SESSION_NOT_FOUND'
  | 'NETWORK_UNAVAILABLE'
  | 'AUTHENTICATION_REQUIRED'
  | 'EMAIL_VERIFICATION_REQUIRED'
  | 'MFA_REQUIRED'
  | 'AUTHORIZATION_REQUIRED'
  | 'RATE_LIMITED'
  | 'CLINICAL_PRIVILEGE_DENIED'
  | 'DEVICE_REVOKED'
  | 'PASSWORD_RESET_FAILED'
  | 'TOKEN_EXPIRED'
  | 'INTERNAL_AUTH_ERROR'
  | 'BREAK_GLASS_REASON_REQUIRED'
  | 'REAUTH_PROVIDER_REQUIRED'
  | 'SSO_AUTH_FAILED'
  | 'SSO_CONFIG_ERROR';

export interface AuthErrorOptions {
  code: AuthErrorCode;
  message: string;
  statusCode?: number;
  userMessage?: string;
  originalError?: unknown;
}

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly statusCode: number;
  readonly userMessage: string;
  readonly originalError?: unknown;

  constructor(options: AuthErrorOptions) {
    super(options.message);
    this.name = 'AuthError';
    this.code = options.code;
    this.statusCode = options.statusCode || 401;
    this.userMessage = options.userMessage || getDefaultUserMessage(options.code);
    this.originalError = options.originalError;
  }
}

export function getDefaultUserMessage(code: AuthErrorCode): string {
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return 'The email or password entered is incorrect. Please verify your credentials.';
    case 'ACCOUNT_DISABLED':
      return 'This medical account has been disabled. Please contact the Hospital IT Security Officer.';
    case 'ACCOUNT_SUSPENDED':
      return 'This medical account is currently suspended pending credential re-verification.';
    case 'ACCOUNT_PENDING':
      return 'Your account registration is awaiting departmental administrator approval.';
    case 'TENANT_ACCESS_DENIED':
      return 'You do not have authorized privileges for this hospital facility.';
    case 'TENANT_NOT_FOUND':
      return 'The requested hospital facility was not recognized.';
    case 'TENANT_SELECTION_REQUIRED':
      return 'Select an authorized hospital facility before continuing.';
    case 'SESSION_EXPIRED':
      return 'Your clinical session has expired due to inactivity. Please sign in again.';
    case 'SESSION_REVOKED':
      return 'This clinical session has been terminated by administrator or security protocol.';
    case 'SESSION_NOT_FOUND':
      return 'Clinical session not found or invalid.';
    case 'NETWORK_UNAVAILABLE':
      return 'Network connection is unavailable. Switched to offline clinical cache mode.';
    case 'EMAIL_VERIFICATION_REQUIRED':
      return 'Verify your account email with the hospital identity provider before production access.';
    case 'MFA_REQUIRED':
      return 'Complete multifactor authentication for privileged hospital access.';
    case 'AUTHENTICATION_REQUIRED':
      return 'Authentication required. Please sign in to access clinical systems.';
    case 'AUTHORIZATION_REQUIRED':
      return 'You lack required role-based permissions for this medical action.';
    case 'RATE_LIMITED':
      return 'Too many consecutive authentication attempts. Please wait 60 seconds before trying again.';
    case 'CLINICAL_PRIVILEGE_DENIED':
      return 'Action blocked: Required clinical credentials or surgical privileges are unverified or expired.';
    case 'DEVICE_REVOKED':
      return 'This clinical workstation/terminal registration has been revoked.';
    case 'PASSWORD_RESET_FAILED':
      return 'Unable to process password reset. Please contact Hospital System Support.';
    case 'TOKEN_EXPIRED':
      return 'Security token expired. Refreshing authorization context...';
    case 'BREAK_GLASS_REASON_REQUIRED':
      return 'Emergency Break-Glass access elevation requires a clinical justification reason.';
    case 'REAUTH_PROVIDER_REQUIRED':
      return 'Unlock this workstation using the identity provider configured for your account.';
    case 'SSO_AUTH_FAILED':
      return 'Enterprise SSO authentication failed. Please verify your hospital federated credentials.';
    case 'SSO_CONFIG_ERROR':
      return 'Hospital SSO provider configuration is invalid or currently offline.';
    default:
      return 'An authentication error occurred. Please verify your connection or contact IT support.';
  }
}

export function mapAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) {
    return err;
  }

  const rawMessage = err instanceof Error ? err.message : String(err || '');
  const rawCode = (err as any)?.code || '';

  // Firebase client error code mapping
  if (
    rawCode === 'auth/wrong-password' ||
    rawCode === 'auth/user-not-found' ||
    rawCode === 'auth/invalid-credential' ||
    rawCode === 'auth/invalid-login-credentials' ||
    rawCode === 'auth/invalid-email'
  ) {
    return new AuthError({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
      statusCode: 401,
      originalError: err,
    });
  }

  if (rawCode === 'auth/user-disabled') {
    return new AuthError({
      code: 'ACCOUNT_DISABLED',
      message: 'Account disabled by system administrator',
      statusCode: 403,
      originalError: err,
    });
  }

  if (rawCode === 'auth/unauthorized-domain') {
    return new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Google Identity is not authorized for this application domain',
      statusCode: 503,
      userMessage:
        'Google Identity is not authorized for this G-HIMS domain. Hospital IT must add this domain to Firebase Authentication authorized domains.',
      originalError: err,
    });
  }

  if (rawCode === 'auth/operation-not-allowed') {
    return new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Google Identity provider is disabled for this Firebase project',
      statusCode: 503,
      userMessage:
        'Google Identity is not enabled for this G-HIMS Firebase project. Hospital IT must enable the Google sign-in provider.',
      originalError: err,
    });
  }

  if (rawCode === 'auth/popup-blocked' || rawMessage.includes('popup-blocked')) {
    return new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Browser blocked the Google Identity popup',
      statusCode: 400,
      userMessage:
        'Your browser blocked the Google Identity window. Allow pop-ups for G-HIMS and try again.',
      originalError: err,
    });
  }

  if (rawMessage.includes('popup-timeout')) {
    return new AuthError({
      code: 'INTERNAL_AUTH_ERROR',
      message: 'Google Identity popup timed out',
      statusCode: 408,
      userMessage:
        'Google Identity did not complete within 30 seconds. Check pop-up permissions and try again.',
      originalError: err,
    });
  }

  if (rawCode === 'auth/too-many-requests') {
    return new AuthError({
      code: 'RATE_LIMITED',
      message: 'Too many failed authentication attempts',
      statusCode: 429,
      originalError: err,
    });
  }

  if (rawCode === 'auth/network-request-failed' || rawMessage.includes('Failed to fetch') || rawMessage.includes('NetworkError')) {
    return new AuthError({
      code: 'NETWORK_UNAVAILABLE',
      message: 'Network connection unavailable',
      statusCode: 503,
      originalError: err,
    });
  }

  if (rawCode === 'auth/id-token-expired' || rawMessage.includes('token expired') || rawMessage.includes('auth/session-cookie-expired')) {
    return new AuthError({
      code: 'TOKEN_EXPIRED',
      message: 'ID token expired',
      statusCode: 401,
      originalError: err,
    });
  }

  if (rawCode === 'auth/id-token-revoked' || rawMessage.includes('token has been revoked')) {
    return new AuthError({
      code: 'SESSION_REVOKED',
      message: 'ID token revoked by security event',
      statusCode: 401,
      originalError: err,
    });
  }

  return new AuthError({
    code: 'INTERNAL_AUTH_ERROR',
    message: rawMessage || 'Internal authentication error',
    statusCode: 500,
    originalError: err,
  });
}
