/**
 * CI-EXT-14 — disposable Cloud Run SWP traffic probe.
 *
 * Synthetic transport only: no OAuth, credentials, FHIR reads, patient data,
 * Firestore, Secret Manager, arbitrary URLs or metadata-server probing.
 *
 * A successful TLS handshake is NOT a successful G1 authorization test:
 * the human evidence gate separately requires matching SWP gateway policy logs.
 */
import tls from 'node:tls';
import dns from 'node:dns/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const cases = Object.freeze({
  'approved-origin': { hostname: 'fhir.epic.com', port: 443, sni: 'fhir.epic.com' },
  'unapproved-origin': { hostname: 'example.com', port: 443, sni: 'example.com' },
  'wrong-sni': { hostname: 'fhir.epic.com', port: 443, sni: 'example.com' },
  'missing-sni': { hostname: 'fhir.epic.com', port: 443, sni: '' },
  'wrong-port': { hostname: 'fhir.epic.com', port: 8443, sni: 'fhir.epic.com' },
  'direct-ip': { hostname: 'fhir.epic.com', port: 443, sni: 'fhir.epic.com', useResolvedIp: true },
});
export function validateG1ProbeConfig(env, argv) {
  if (env.HELIXIS_G1_DISPOSABLE_LAB !== 'true' ||
      env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false' ||
      env.GHIMS_INTEGRATION_FHIR_R4_STATE !== 'DISABLED' ||
      env.GHIMS_RUNTIME_MODE !== 'STAGING' ||
      env.GOOGLE_CLOUD_PROJECT !== 'studio-1130431360-48a05') {
    throw new Error('G1_PROBE_DISPOSABLE_SYNTHETIC_ONLY');
  }
  if (argv.length !== 1 || !Object.hasOwn(cases, argv[0])) {
    throw new Error('G1_PROBE_CASE_NOT_APPROVED');
  }
  return { testCase: argv[0], ...cases[argv[0]] };
}
function emit(testCase, state, details = {}) {
  // No tokens, DNS responses, IP addresses, URL paths, or request payloads.
  process.stdout.write(JSON.stringify({
    schema: 'helixis.g1.transport-probe.v1',
    testCase, state, ...details,
    // Explicitly DO NOT claim proxy enforcement from a client result.
    swpPolicyEnforcementVerified: false,
    productionRelease: 'NO_GO',
  }) + '\n');
}
async function run() {
  let config;
  try { config = validateG1ProbeConfig(process.env, process.argv.slice(2)); }
  catch {
    emit('CONFIG', 'FAIL_CLOSED');
    process.exitCode = 2;
    return;
  }
  const { testCase, hostname, port, sni, useResolvedIp } = config;
  let connectHost = hostname;
  if (useResolvedIp) {
    try {
      const answer = await dns.lookup(hostname, { family: 4 });
      connectHost = answer.address;
    } catch {
      emit(testCase, 'DNS_FAILED');
      return;
    }
  }
  try {
    const result = await new Promise((resolveResult, reject) => {
      const client = tls.connect({
        host: connectHost, port, servername: sni || undefined,
        rejectUnauthorized: true, timeout: 7000,
        minVersion: 'TLSv1.2',
      });
      let finished = false;
      function finish(error, value) {
        if (finished) return;
        finished = true;
        client.destroy();
        if (error) reject(error);
        else resolveResult(value);
      }
      client.once('secureConnect', () => {
        finish(null, {
          peerCertificateVerified: client.authorized,
          tlsVersionKnown: Boolean(client.getProtocol()),
        });
      });
      client.once('error', e => finish(e));
      client.once('timeout', () => finish(new Error('TLS_CONNECT_TIMEOUT')));
    });
    emit(testCase, 'TLS_CONNECTED', result);
  } catch (e) {
    // Deliberately do not log upstream address, raw exception messages, or
    // possibly sensitive TLS details. Exact verdict comes from SWP logs.
    emit(testCase, 'TLS_BLOCKED_OR_FAILED', {
      errorCategory: e && typeof e === 'object' && e.code === 'ETIMEDOUT'
        ? 'TIMEOUT' : 'TRANSPORT_FAILURE',
    });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch(() => { emit('UNEXPECTED', 'FAIL_CLOSED'); process.exitCode = 3; });
}
