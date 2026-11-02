import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import test from 'node:test';
import { TARGETS, assertProbeEnvironment, probeTarget, runDenyOnlyProbe } from '../services/epic-egress-probe/egress-probe.mjs';

const env = {
  GHIMS_RUNTIME_MODE: 'STAGING',
  HELIXIS_EPIC_PROBE_MODE: 'DENY_ONLY',
  HELIXIS_EPIC_PROBE_PROJECT: 'studio-1130431360-48a05',
  GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED: 'false',
};
const mock = event => () => {
  const socket = new EventEmitter();
  socket.destroy = () => {};
  socket.setTimeout = () => {};
  process.nextTick(() => socket.emit(event, event === 'error' ? new Error('blocked') : undefined));
  return socket;
};

test('environment fails closed, including production and missing flags', () => {
  assert.doesNotThrow(() => assertProbeEnvironment(env));
  for (const key of Object.keys(env)) {
    const invalid = { ...env };
    delete invalid[key];
    assert.throws(() => assertProbeEnvironment(invalid));
  }
  assert.throws(() => assertProbeEnvironment({ ...env, GHIMS_RUNTIME_MODE: 'PRODUCTION' }));
});

test('unreviewed targets rejected', async () => {
  await assert.rejects(probeTarget({ label: 'other', host: '8.8.8.8', port: 443 }));
});

test('blocked sockets report only no-TCP-connection evidence', async () => {
  const result = await runDenyOnlyProbe({ env, connect: mock('error') });
  assert.equal(result.result, 'PASS_NO_PUBLIC_TCP_CONNECTION');
  assert.equal(result.endpoints.length, TARGETS.length);
  assert.equal(result.limitations.length, 3);
});

test('reachable public TCP aborts the gate', async () => {
  let count = 0;
  const result = await runDenyOnlyProbe({ env, connect: () => mock(++count === 1 ? 'connect' : 'error')() });
  assert.equal(result.result, 'FAIL_PUBLIC_TCP_REACHABLE');
});
