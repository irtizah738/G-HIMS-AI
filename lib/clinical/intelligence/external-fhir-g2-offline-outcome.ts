/**
 * G2 pre-hosting: pure, emulator-only classification of external FHIR poll
 * outcomes. This code has NO network, Firestore, secrets, scheduling, Cloud Run
 * or billing access. It cannot promote external evidence to clinical authority.
 * A hosted coordinator must re-evaluate authorization and persist each
 * transition in a server-authoritative, fenced Firestore transaction.
 */
import { createHash } from 'node:crypto';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_ATTEMPTS = 5;
const MAX_DELAY_MS = 60_000;
const MAX_RETRY_AFTER_SECONDS = 3_600;

export type G2OfflineAction =
  | 'VERIFY_IMMUTABLE_RECEIPT'
  | 'PAUSE_SOURCE_FOR_AUTH_REVIEW'
  | 'HOLD_ABSENCE_FOR_RECONCILIATION'
  | 'REJECT_UNEXPECTED_REDIRECT'
  | 'RETRY_BOUNDED'
  | 'HOLD_RATE_LIMIT_FOR_REVIEW'
  | 'QUARANTINE_FOR_REVIEW';

export type G2OfflinePollResponse = Readonly<{
  tenantId: string;
  sourceId: string;
  workId: string;
  attempt: number;
  httpStatus: number;
  /** Parsed trusted response header, never copied from client submissions. */
  retryAfterSeconds?: number | null;
}>;

export type G2OfflineDecision = Readonly<{
  schema: 'helixis.g2.synthetic-response-policy.v1';
  action: G2OfflineAction;
  retryDelayMs: number | null;
  checkpointAuthorized: false;
  clinicalAuthority: false;
  deletionAuthorized: false;
  sourceMigrationAuthorized: false;
  productionRelease: 'NO_GO';
}>;

function assertOfflineOnly(): void {
  if (process.env.NODE_ENV !== 'test' ||
      process.env.GHIMS_RUNTIME_MODE !== 'TEST' ||
      process.env.FIREBASE_PROJECT_ID !== 'ghims-p4-ci' ||
      process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
      process.env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
      process.env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED') {
    throw new Error('FHIR_G2_OFFLINE_TEST_ONLY');
  }
}

function deterministicBoundedDelay(input: G2OfflinePollResponse): number {
  const ceiling = Math.min(MAX_DELAY_MS, 1_000 * 2 ** Math.min(6, input.attempt));
  const floor = Math.floor(ceiling / 2);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([input.tenantId,input.sourceId,input.workId,input.attempt]))
    .digest();
  const fraction = fingerprint.readUInt32BE(0) / 0x1_0000_0000;
  return floor + Math.floor(fraction * (ceiling - floor + 1));
}

export function classifyG2OfflinePollResponse(input: G2OfflinePollResponse): G2OfflineDecision {
  assertOfflineOnly();
  if (!input || typeof input !== 'object' ||
      ![input.tenantId,input.sourceId,input.workId].every(value =>
        typeof value === 'string' && ID.test(value)) ||
      !Number.isSafeInteger(input.attempt) || input.attempt < 1 ||
      input.attempt > MAX_ATTEMPTS ||
      !Number.isSafeInteger(input.httpStatus) ||
      input.httpStatus < 100 || input.httpStatus > 599 ||
      (input.retryAfterSeconds !== undefined && input.retryAfterSeconds !== null &&
        (!Number.isSafeInteger(input.retryAfterSeconds) || input.retryAfterSeconds < 0))) {
    throw new Error('FHIR_G2_OFFLINE_RESPONSE_INVALID');
  }

  const result = (action: G2OfflineAction, retryDelayMs: number | null = null): G2OfflineDecision =>
    Object.freeze({
      schema:'helixis.g2.synthetic-response-policy.v1' as const,
      action, retryDelayMs,
      checkpointAuthorized:false as const,
      clinicalAuthority:false as const,
      deletionAuthorized:false as const,
      sourceMigrationAuthorized:false as const,
      productionRelease:'NO_GO' as const,
    });
  const s = input.httpStatus;

  // Even HTTP 200 is not an immutable receipt. It must pass the Stage D
  // manifest, import-event, consent, audit, held-outbox, and body-hash checks.
  if (s === 200) return result('VERIFY_IMMUTABLE_RECEIPT');
  if (s === 401 || s === 403) return result('PAUSE_SOURCE_FOR_AUTH_REVIEW');
  if (s === 404 || s === 410) return result('HOLD_ABSENCE_FOR_RECONCILIATION');
  if (s >= 300 && s < 400) return result('REJECT_UNEXPECTED_REDIRECT');

  // A Retry-After beyond the safe bounded window MUST NOT be truncated into
  // an earlier retry, as that would violate the vendor's rate limit.
  const transient = s === 408 || s === 425 || s === 429 ||
    s === 500 || s === 502 || s === 503 || s === 504;
  if (!transient || input.attempt >= MAX_ATTEMPTS) {
    return result('QUARANTINE_FOR_REVIEW');
  }
  const suggested = deterministicBoundedDelay(input);
  if (s === 429 || s === 503) {
    const seconds = input.retryAfterSeconds;
    if (seconds !== undefined && seconds !== null) {
      if (seconds > MAX_RETRY_AFTER_SECONDS) {
        return result('HOLD_RATE_LIMIT_FOR_REVIEW');
      }
      const vendorDelayMs = seconds * 1000;
      if (vendorDelayMs > MAX_DELAY_MS) {
        return result('HOLD_RATE_LIMIT_FOR_REVIEW');
      }
      return result('RETRY_BOUNDED',Math.max(vendorDelayMs,suggested));
    }
  }
  return result('RETRY_BOUNDED',suggested);
}
