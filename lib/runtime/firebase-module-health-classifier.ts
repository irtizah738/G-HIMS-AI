/**
 * PHI- and credential-safe classification for startup failures of the
 * Firebase Admin module in protected health endpoints. Never emit raw
 * exception messages, import paths, configuration or arbitrary SDK codes.
 */
export type FirebaseHealthModuleFailure =
  | 'FIREBASE_MODULE_NOT_FOUND'
  | 'FIREBASE_MODULE_ESM_INTEROP_FAILURE'
  | 'FIREBASE_MODULE_EXPORT_FAILURE'
  | 'FIREBASE_MODULE_SYNTAX_FAILURE'
  | 'FIREBASE_MODULE_TYPE_FAILURE'
  | 'FIREBASE_MODULE_REFERENCE_FAILURE'
  | 'FIREBASE_MODULE_CREDENTIAL_FAILURE'
  | 'FIREBASE_MODULE_ENVIRONMENT_GUARD_FAILURE'
  | 'FIREBASE_MODULE_UNCLASSIFIED_FAILURE';

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 2048) : '';
}

export function classifyFirebaseModuleLoadFailure(error: unknown): FirebaseHealthModuleFailure {
  if (!error || typeof error !== 'object') return 'FIREBASE_MODULE_UNCLASSIFIED_FAILURE';
  const source = error as { code?: unknown; name?: unknown; message?: unknown };
  const code = safeString(source.code);
  const name = safeString(source.name);
  const message = safeString(source.message);
  if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND' ||
      /Cannot find module|Cannot find package|Module not found/i.test(message)) {
    return 'FIREBASE_MODULE_NOT_FOUND';
  }
  if (code === 'ERR_REQUIRE_ESM' || /require\(\) of ES Module|must use import to load ES Module/i.test(message)) {
    return 'FIREBASE_MODULE_ESM_INTEROP_FAILURE';
  }
  if (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || /Package subpath.*not defined by.*exports/i.test(message)) {
    return 'FIREBASE_MODULE_EXPORT_FAILURE';
  }
  if (name === 'SyntaxError') return 'FIREBASE_MODULE_SYNTAX_FAILURE';
  if (name === 'TypeError') return 'FIREBASE_MODULE_TYPE_FAILURE';
  if (name === 'ReferenceError') return 'FIREBASE_MODULE_REFERENCE_FAILURE';
  if (name === 'FirebaseAppError' || name === 'FirebaseAuthError' ||
      /invalid (?:pem|private key|credential|certificate)|Failed to parse private key/i.test(message)) {
    return 'FIREBASE_MODULE_CREDENTIAL_FAILURE';
  }
  if (code.startsWith('ENVIRONMENT_') || message.startsWith('ENVIRONMENT_')) {
    return 'FIREBASE_MODULE_ENVIRONMENT_GUARD_FAILURE';
  }
  return 'FIREBASE_MODULE_UNCLASSIFIED_FAILURE';
}
