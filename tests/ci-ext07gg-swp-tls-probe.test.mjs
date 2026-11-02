import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { CASES, assertEnvironment, tlsCase, runSwpTlsProbe } from '../services/epic-egress-probe/swp-tls-probe.mjs';

const env = Object.freeze({
  GHIMS_RUNTIME_MODE:'STAGING',
  HELIXIS_EPIC_PROBE_MODE:'SWP_TLS',
  HELIXIS_EPIC_PROBE_PROJECT:'studio-1130431360-48a05',
  GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED:'false',
});

function fakeConnection(results, observed = []) {
  return options => {
    observed.push(options);
    const s = new EventEmitter();
    s.authorized = true;
    s.destroy = () => {};
    s.setTimeout = () => {};
    const connected = results[options.servername];
    process.nextTick(() => {
      if (connected) s.emit('secureConnect');
      else s.emit('error', new Error('blocked'));
    });
    return s;
  };
}

test('rejects production, missing environment, and modes', () => {
  assert.doesNotThrow(() => assertEnvironment(env));
  for (const key of Object.keys(env)) {
    const bad = { ...env };
    delete bad[key];
    assert.throws(() => assertEnvironment(bad));
  }
  assert.throws(() => assertEnvironment({...env, GHIMS_RUNTIME_MODE:'PRODUCTION'}));
  assert.throws(() => assertEnvironment({...env, HELIXIS_EPIC_PROBE_MODE:'DENY_ONLY'}));
});

test('rejects unapproved probe cases and timeouts', async () => {
  await assert.rejects(tlsCase({...CASES[0]}));
  await assert.rejects(tlsCase(CASES[0], {timeoutMs:20000}));
});

test('expected exact-host TLS passes, wrong/other SNI denied', async () => {
  const observed = [];
  const connect = options => {
    observed.push(options);
    const s = new EventEmitter();
    s.authorized = true;
    s.destroy = () => {};
    s.setTimeout = () => {};
    process.nextTick(() => {
      if (options.host === 'fhir.epic.com' && options.servername === 'fhir.epic.com') s.emit('secureConnect');
      else s.emit('error', new Error('denied'));
    });
    return s;
  };
  const result = await runSwpTlsProbe({env,connect});
  assert.equal(result.outcome,'PASS_OBSERVED_TLS_POLICY');
  assert.deepEqual(result.observations.map(x=>x.tlsConnected),[true,false,false]);
  assert.equal(observed.length,3);
  assert(observed.every(o=>o.port===443 && o.minVersion==='TLSv1.2'));
  assert.equal(observed[0].rejectUnauthorized,true);
  assert.equal(observed[1].rejectUnauthorized,false);
});

test('unknown public TLS reachability fails', async () => {
  const connect = options => {
    const s = new EventEmitter();
    s.authorized = true;
    s.destroy = () => {};
    s.setTimeout = () => {};
    process.nextTick(() => s.emit('secureConnect'));
    return s;
  };
  const result = await runSwpTlsProbe({env,connect});
  assert.equal(result.outcome,'FAIL_UNEXPECTED_TLS_RESULT');
});

test('missing authorized Epic certificate fails', async () => {
  const connect = options => {
    const s = new EventEmitter();
    s.authorized = false;
    s.destroy = () => {};
    s.setTimeout = () => {};
    process.nextTick(() => {
      if(options.servername === 'fhir.epic.com') s.emit('secureConnect');
      else s.emit('error',new Error('denied'));
    });
    return s;
  };
  const result = await runSwpTlsProbe({env,connect});
  assert.equal(result.outcome,'FAIL_UNEXPECTED_TLS_RESULT');
});
