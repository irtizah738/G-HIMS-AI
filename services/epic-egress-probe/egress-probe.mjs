/** CI-EXT-07G-D0 disposable Direct VPC egress probe.
 * No Epic calls, FHIR data, OAuth, secrets, Firestore, or clinical activity.
 * A failed connection is NOT proof that the firewall caused it.
 */
import net from 'node:net';
import { pathToFileURL } from 'node:url';

export const TARGETS = Object.freeze([
  Object.freeze({ label: 'cloudflare-public-tls', host: '1.1.1.1', port: 443 }),
  Object.freeze({ label: 'cloudflare-secondary-tls', host: '1.0.0.1', port: 443 }),
]);

export function assertProbeEnvironment(env) {
  if (env.GHIMS_RUNTIME_MODE !== 'STAGING' ||
      env.HELIXIS_EPIC_PROBE_MODE !== 'DENY_ONLY' ||
      env.HELIXIS_EPIC_PROBE_PROJECT !== 'studio-1130431360-48a05' ||
      env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false') {
    throw new Error('CI_EXT07GC_PROBE_ENVIRONMENT_DENIED');
  }
}

export async function probeTarget(target, { connect = net.createConnection, timeoutMs = 2500 } = {}) {
  if (!TARGETS.some(t => t.label === target.label && t.host === target.host && t.port === target.port)) {
    throw new Error('CI_EXT07GC_PROBE_TARGET_DENIED');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) {
    throw new Error('CI_EXT07GC_PROBE_TIMEOUT_INVALID');
  }
  return new Promise(resolve => {
    let done = false;
    let socket;
    const finish = reachable => {
      if (done) return;
      done = true;
      if (socket) socket.destroy();
      resolve({ label: target.label, reachable });
    };
    try {
      socket = connect({ host: target.host, port: target.port });
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.setTimeout(timeoutMs);
    } catch {
      finish(false);
    }
  });
}

export async function runDenyOnlyProbe({ env = process.env, connect = net.createConnection } = {}) {
  assertProbeEnvironment(env);
  const results = [];
  for (const target of TARGETS) results.push(await probeTarget(target, { connect }));
  return {
    schema: 'helixis.ci-ext07gc.probe.v1',
    mode: 'DENY_ONLY',
    result: results.every(r => !r.reachable) ? 'PASS_NO_PUBLIC_TCP_CONNECTION' : 'FAIL_PUBLIC_TCP_REACHABLE',
    endpoints: results,
    limitations: ['No firewall causality established', 'No gateway/NAT path tested', 'No Epic requests sent'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDenyOnlyProbe().then(result => {
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.result.startsWith('PASS') ? 0 : 1;
  }).catch(() => {
    process.stderr.write('CI_EXT07GC_DENY_PROBE=ERROR\n');
    process.exitCode = 1;
  });
}
