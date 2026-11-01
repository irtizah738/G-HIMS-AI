/**
 * CI-EXT-07F — inert synthetic Epic Cloud Run worker.
 * No FHIR, OAuth, Firestore, Secret Manager, or outbound client.
 */
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED = Object.freeze({
  HELIXIS_EPIC_WORKER_MODE: 'SEALED',
  HELIXIS_EPIC_PROJECT: 'studio-1130431360-48a05',
  GHIMS_RUNTIME_MODE: 'STAGING',
  GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED: 'false',
  GHIMS_INTEGRATION_FHIR_R4_STATE: 'DISABLED',
  GHIMS_CI_FHIR_AUTH_MODE: 'DISABLED',
});

export function assertSealedConfig(env) {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    if (env[name] !== expected) throw new Error('CI_EXT07F_SEALED_CONFIG_INVALID:' + name);
  }
  if (env.NODE_ENV !== 'production') throw new Error('CI_EXT07F_PRODUCTION_NODE_MODE_REQUIRED');
  const port = Number(env.PORT ?? '8080');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CI_EXT07F_PORT_INVALID');
  return port;
}

export function createSealedServer() {
  const server = createServer((req, res) => {
    // Never inspect or log request bodies, headers, tokens, or patient identifiers.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('{"state":"SEALED","fhir":"DISABLED"}');
      return;
    }
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
    res.end('{"code":"CI_EXT07F_WORKER_SEALED"}');
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxRequestsPerSocket = 10;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = assertSealedConfig(process.env);
  createSealedServer().listen(port, '0.0.0.0', () => {
    process.stdout.write('CI_EXT07F_WORKER_STATE=SEALED\n');
  });
}
