/**
 * Secret Manager transport for CI-EXT-04.
 *
 * Private keys are retrieved only from a deterministic tenant+source secret ID
 * using ADC/WIF; they never enter Firestore, browser payloads or logs.
 * Cloud IAM should grant the runtime principal secretAccessor for ONLY the
 * exact source-specific secrets provisioned for that deployment.
 */
import { createHash } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';

const ID = /^[A-Za-z0-9._-]{1,128}$/;
export function smartSecretResource(args: {
  projectId: string; tenantId: string; sourceId: string; version: number;
}): string {
  const { projectId, tenantId, sourceId, version } = args;
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId) ||
      !ID.test(tenantId) || !ID.test(sourceId) ||
      [tenantId,sourceId].includes('.') || [tenantId,sourceId].includes('..') ||
      !Number.isSafeInteger(version) || version < 1) {
    throw new Error('CI_EXT04_SECRET_SCOPE_INVALID');
  }
  const digest = createHash('sha256')
    .update(JSON.stringify([tenantId,sourceId])).digest('hex').slice(0,32);
  return `projects/${projectId}/secrets/helixis-fhir-${digest}/versions/${version}`;
}

export function createGcpFhirPrivateKeyAccessor(args: {
  projectId: string;
  fetchImpl?: typeof fetch;
  getGcpAccessToken?: () => Promise<string>;
}): (tenantId: string, sourceId: string, version: number) => Promise<string> {
  const fetchImpl = args.fetchImpl || fetch;
  const googleAuth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  return async (tenantId, sourceId, version) => {
    const secretName = smartSecretResource({ projectId: args.projectId, tenantId, sourceId, version });
    const accessToken = args.getGcpAccessToken
      ? await args.getGcpAccessToken()
      : (await googleAuth.getClient()).credentials.access_token ||
        (await (await googleAuth.getClient()).getAccessToken()).token;
    if (!accessToken) throw new Error('CI_EXT04_SECRET_IAM_UNAVAILABLE');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchImpl(
        'https://secretmanager.googleapis.com/v1/' + secretName + ':access',
        { method: 'GET', redirect: 'error',
          headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' },
          signal: controller.signal },
      );
      if (!response.ok) throw new Error('CI_EXT04_SECRET_ACCESS_DENIED');
      const body = await response.text();
      if (Buffer.byteLength(body) > 24_000) throw new Error('CI_EXT04_SECRET_TOO_LARGE');
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { throw new Error('CI_EXT04_SECRET_FORMAT_INVALID'); }
      const data = (parsed as { payload?: { data?: unknown } })?.payload?.data;
      if (typeof data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(data)) {
        throw new Error('CI_EXT04_SECRET_FORMAT_INVALID');
      }
      const decoded = Buffer.from(data, 'base64').toString('utf8');
      if (!decoded.includes('-----BEGIN PRIVATE KEY-----') ||
          decoded.length > 16000) throw new Error('CI_EXT04_SECRET_KEY_INVALID');
      return decoded;
    } finally { clearTimeout(timeout); }
  };
}
