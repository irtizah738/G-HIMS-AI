/**
 * CIQP-182 disposable synthetic-source adapter ONLY. Never use for production.
 * firebase-admin/getFirestore rejects keyless custom credentials; Cloud
 * Firestore's gRPC transport accepts an injected GoogleAuth client.
 */
import { Firestore as CloudFirestore } from '@google-cloud/firestore';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import type { Firestore as AdminFirestore } from 'firebase-admin/firestore';

const SOURCE = 'ciqp-ghims-source-20261022';
const TENANT = 'ciqp-synthetic-hospital0';
const WRITER = 'ciqp182-synthetic-writer@' + SOURCE + '.iam.gserviceaccount.com';

export function ciqp182NormalizeGrpcHeaders(
  incoming: Headers | Record<string, string>
): Headers {
  if (!incoming || typeof incoming !== 'object') {
    throw new Error('CIQP182_GRPC_HEADER_INVALID');
  }
  const headers = incoming instanceof Headers ? incoming : new Headers(incoming);
  if (!headers.get('authorization')?.startsWith('Bearer ')) {
    throw new Error('CIQP182_GRPC_HEADER_INVALID');
  }
  return headers;
}

function assertDisposableScope(): void {
  const env = process.env;
  if (env.GHIMS_RUNTIME_MODE !== 'STAGING' ||
      env.NODE_ENV === 'production' ||
      Boolean(env.VERCEL) || Boolean(env.GITHUB_ACTIONS) ||
      Boolean(env.GOOGLE_APPLICATION_CREDENTIALS) ||
      Boolean(env.FIREBASE_PRIVATE_KEY) ||
      Boolean(env.FIRESTORE_EMULATOR_HOST) ||
      env.CIQP182_HOSTED_SOURCE_MODE !== 'APPLY' ||
      env.CIQP182_HOSTED_SOURCE_AUTH_MODE !== 'GCLOUD_IMPERSONATION_APPLY' ||
      env.FIREBASE_PROJECT_ID !== SOURCE ||
      env.GHIMS_FIREBASE_PROJECT_ID_STAGING !== SOURCE ||
      env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION !== 'g-hims-ai' ||
      env.GHIMS_CIQP_STAGING_TENANT_ID !== TENANT ||
      env.CIQP182_HOSTED_SOURCE_CONFIRM_PROJECT !== SOURCE ||
      env.CIQP182_HOSTED_SOURCE_CONFIRM_TENANT !== TENANT ||
      env.CIQP182_HOSTED_SOURCE_WRITER_EMAIL !== WRITER ||
      env.FIRESTORE_DATABASE_ID !== '(default)') {
    throw new Error('CIQP182_GRPC_SCOPE_DENIED');
  }
}

/** Caller must first independently verify the approved exact SHA and scope. */
export function ciqp182HostedSourceFirestoreClient(
  mintSourceToken: () => string
): AdminFirestore {
  assertDisposableScope();
  const oauth = new OAuth2Client();
  let expiresAt = 0;
  const renew = (): void => {
    oauth.setCredentials({
      access_token: mintSourceToken(),
      expiry_date: Date.now() + 840_000,
    });
    expiresAt = Date.now() + 840_000;
  };
  renew();
  const getHeaders = oauth.getRequestHeaders.bind(oauth);
  oauth.getRequestHeaders = async (url?: string | URL) => {
    if (Date.now() >= expiresAt - 60_000) renew();
    return ciqp182NormalizeGrpcHeaders(
      (await getHeaders(url)) as Headers | Record<string, string>
    );
  };
  const settings = {
    projectId: SOURCE,
    databaseId: '(default)',
    preferRest: false,
    ignoreUndefinedProperties: true,
    auth: new GoogleAuth({ projectId: SOURCE, authClient: oauth }),
  };
  return new CloudFirestore(
    settings as ConstructorParameters<typeof CloudFirestore>[0]
  ) as unknown as AdminFirestore;
}
