import fs from 'node:fs';
import net, { type Server as NetServer, type Socket } from 'node:net';
import tls, { type Server as TlsServer, type TLSSocket, type TlsOptions } from 'node:tls';
import { generateACK, parseHL7 } from '@/lib/interop/hl7-parser';
import {
  frameMllpMessage,
  MllpFrameDecoder,
  sourceIdentityFromHl7,
} from '@/lib/interop/hl7-mllp-framing';
import { getServerIntegrationState } from '@/lib/interop/integration-state';
import {
  resolveHl7TenantForSource,
  type Hl7SourceTenantRoute,
} from '@/lib/interop/hl7-source-routing';

export type MllpTenantRoute = Hl7SourceTenantRoute;

export interface Hl7MllpServerConfig {
  host: string;
  port: number;
  ingestUrl: string;
  ingestApiKey: string;
  sourceRoutes: MllpTenantRoute[];
  maxFrameBytes?: number;
  socketTimeoutMs?: number;
  internalRequestTimeoutMs?: number;
  internalRetryCount?: number;
  tls?: {
    certPath: string;
    keyPath: string;
    caPath?: string;
    requestClientCertificate?: boolean;
    rejectUnauthorized?: boolean;
  };
  fetchImpl?: typeof fetch;
}

function runtimeIsProduction(): boolean {
  return String(process.env.GHIMS_RUNTIME_MODE || process.env.NODE_ENV || '')
    .trim()
    .toUpperCase() === 'PRODUCTION';
}

export function validateHl7MllpConfig(config: Hl7MllpServerConfig): void {
  if (getServerIntegrationState('HL7') !== 'LIVE') {
    throw new Error('HL7_MLLP_NOT_LIVE: HL7 integration state must be LIVE.');
  }
  if (!config.ingestUrl || !config.ingestApiKey || !config.host || !Number.isInteger(config.port)) {
    throw new Error('HL7_MLLP_CONFIG_INVALID');
  }
  const url = new URL(config.ingestUrl);
  if (
    runtimeIsProduction() &&
    url.protocol !== 'https:' &&
    !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  ) {
    throw new Error('HL7_MLLP_INSECURE_INTERNAL_INGEST_URL');
  }
  if (runtimeIsProduction() && !config.tls) {
    throw new Error('HL7_MLLP_TLS_REQUIRED_IN_PRODUCTION');
  }
  if (runtimeIsProduction() && config.tls?.rejectUnauthorized === false) {
    throw new Error('HL7_MLLP_MTLS_VERIFICATION_REQUIRED_IN_PRODUCTION');
  }
  if (!Array.isArray(config.sourceRoutes) || config.sourceRoutes.length === 0) {
    throw new Error('HL7_MLLP_SOURCE_ROUTES_REQUIRED');
  }
}

async function postToIngest(
  config: Hl7MllpServerConfig,
  tenantId: string,
  message: string,
  messageControlId: string
): Promise<string> {
  const fetchImpl = config.fetchImpl || fetch;
  const retryCount = Math.max(0, Math.min(3, config.internalRetryCount ?? 1));
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.internalRequestTimeoutMs || 15000
    );
    try {
      const response = await fetchImpl(config.ingestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'x-api-key': config.ingestApiKey,
          'x-ghims-tenant-id': tenantId,
          'x-correlation-id': `mllp:${messageControlId}`,
        },
        body: message,
        signal: controller.signal,
      });
      const body = await response.text();
      if (response.ok) return body;

      if (![502, 503, 504].includes(response.status) || attempt === retryCount) {
        throw new Error(`HL7_MLLP_INGEST_HTTP_${response.status}: ${body.slice(0, 500)}`);
      }
      lastError = new Error(`HL7_MLLP_INGEST_HTTP_${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === retryCount) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('HL7_MLLP_INGEST_FAILED');
}

async function processMessage(config: Hl7MllpServerConfig, message: string): Promise<Buffer> {
  let parsed: ReturnType<typeof parseHL7> | undefined;
  try {
    parsed = parseHL7(message);
    const source = sourceIdentityFromHl7(message);
    if (!source.messageControlId) {
      return frameMllpMessage(generateACK(parsed, 'AR', 'MSH-10 message control ID is required'));
    }

    const tenantId = resolveHl7TenantForSource(
      config.sourceRoutes,
      source.sendingApplication,
      source.sendingFacility
    );
    if (!tenantId) {
      return frameMllpMessage(
        generateACK(parsed, 'AR', 'Sending application/facility is not mapped to a tenant')
      );
    }

    const ack = await postToIngest(config, tenantId, message, source.messageControlId);
    return frameMllpMessage(ack);
  } catch (error) {
    if (parsed) {
      return frameMllpMessage(
        generateACK(
          parsed,
          'AE',
          error instanceof Error ? error.message.slice(0, 180) : 'Internal ingestion failure'
        )
      );
    }
    throw error;
  }
}

function bindSocket(config: Hl7MllpServerConfig, socket: Socket | TLSSocket): void {
  socket.setTimeout(config.socketTimeoutMs || 30000);
  const decoder = new MllpFrameDecoder(config.maxFrameBytes);

  socket.on('data', async (chunk) => {
    socket.pause();
    try {
      const messages = decoder.push(Buffer.from(chunk));
      for (const message of messages) {
        const ack = await processMessage(config, message);
        if (!socket.destroyed) socket.write(ack);
      }
    } catch {
      socket.destroy();
    } finally {
      if (!socket.destroyed) socket.resume();
    }
  });
  socket.on('timeout', () => socket.destroy());
  socket.on('error', () => socket.destroy());
}

export function createHl7MllpServer(config: Hl7MllpServerConfig): NetServer | TlsServer {
  validateHl7MllpConfig(config);

  if (config.tls) {
    const options: TlsOptions = {
      cert: fs.readFileSync(config.tls.certPath),
      key: fs.readFileSync(config.tls.keyPath),
      ...(config.tls.caPath ? { ca: fs.readFileSync(config.tls.caPath) } : {}),
      requestCert: config.tls.requestClientCertificate ?? true,
      rejectUnauthorized: config.tls.rejectUnauthorized ?? true,
      minVersion: 'TLSv1.2',
    };
    return tls.createServer(options, (socket) => bindSocket(config, socket));
  }

  return net.createServer((socket) => bindSocket(config, socket));
}

export function startHl7MllpServer(config: Hl7MllpServerConfig): NetServer | TlsServer {
  const server = createHl7MllpServer(config);
  server.listen(config.port, config.host);
  return server;
}
