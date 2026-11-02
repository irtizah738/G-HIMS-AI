/**
 * CI-EXT-07G-G: disposable no-credentials next-hop SWP TLS probe.
 * NO OAuth, Epic FHIR requests, patient data, HTTP body, or application secrets.
 * A positive TLS handshake is not proof of gateway path or anti-bypass.
 */
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';

export const CASES = Object.freeze([
  Object.freeze({ label:'epic-sni', host:'fhir.epic.com', sni:'fhir.epic.com', expectConnected:true, verifyCert:true }),
  Object.freeze({ label:'unapproved-sni', host:'www.google.com', sni:'www.google.com', expectConnected:false, verifyCert:false }),
  Object.freeze({ label:'wrong-sni', host:'fhir.epic.com', sni:'www.google.com', expectConnected:false, verifyCert:false }),
]);

export function assertEnvironment(env) {
  if (env.GHIMS_RUNTIME_MODE !== 'STAGING' ||
      env.HELIXIS_EPIC_PROBE_MODE !== 'SWP_TLS' ||
      env.HELIXIS_EPIC_PROBE_PROJECT !== 'studio-1130431360-48a05' ||
      env.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED !== 'false') {
    throw new Error('CI_EXT07GG_ENV_DENIED');
  }
}

export async function tlsCase(item, { connect = tls.connect, timeoutMs = 4000 } = {}) {
  if (!CASES.includes(item) || !Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 5000) {
    throw new Error('CI_EXT07GG_CASE_DENIED');
  }
  return new Promise(resolve => {
    let settled = false;
    let socket;
    const finish = tlsConnected => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve({ label:item.label, tlsConnected });
    };
    try {
      socket = connect({
        host:item.host,
        port:443,
        servername:item.sni,
        rejectUnauthorized:item.verifyCert,
        minVersion:'TLSv1.2',
      });
      socket.once('secureConnect', () => finish(item.verifyCert ? socket.authorized === true : true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.setTimeout(timeoutMs);
    } catch {
      finish(false);
    }
  });
}

export async function runSwpTlsProbe({ env = process.env, connect = tls.connect } = {}) {
  assertEnvironment(env);
  const observations = [];
  for (const item of CASES) {
    observations.push(await tlsCase(item, { connect }));
  }
  const passed = observations.every((x, index) => x.tlsConnected === CASES[index].expectConnected);
  return {
    schema:'helixis.ci-ext07gg.probe.v1',
    mode:'SWP_TLS',
    outcome:passed ? 'PASS_OBSERVED_TLS_POLICY' : 'FAIL_UNEXPECTED_TLS_RESULT',
    observations,
    limitations:[
      'TLS observations do not prove routing through Secure Web Proxy',
      'Failure may be caused by DNS, upstream TLS, firewall or lack of connectivity',
      'No route-removal, gateway-unhealthy or direct NAT fallback proof',
      'No Epic OAuth or FHIR requests made',
      'Negative TLS cases intentionally disable certificate verification; no application data is sent'
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSwpTlsProbe()
    .then(result => {
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exitCode = result.outcome.startsWith('PASS') ? 0 : 1;
    })
    .catch(() => {
      process.stderr.write('CI_EXT07GG_TLS_PROBE=ERROR\n');
      process.exitCode = 1;
    });
}
