import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { request } from 'node:http';
import { assertSealedConfig, createSealedServer } from '../services/epic-sealed-worker/server.mjs';

const baseline = Object.freeze({
  HELIXIS_EPIC_WORKER_MODE: 'SEALED',
  HELIXIS_EPIC_PROJECT: 'studio-1130431360-48a05',
  GHIMS_RUNTIME_MODE: 'STAGING',
  GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED: 'false',
  GHIMS_INTEGRATION_FHIR_R4_STATE: 'DISABLED',
  GHIMS_CI_FHIR_AUTH_MODE: 'DISABLED',
  NODE_ENV: 'production',
  PORT: '8080',
});
test('requires an exact sealed staging runtime and import flags disabled', () => {
  assert.equal(assertSealedConfig(baseline), 8080);
  for (const key of Object.keys(baseline)) {
    const missing = { ...baseline };
    delete missing[key];
    if (key !== 'PORT') assert.throws(() => assertSealedConfig(missing), key);
    assert.throws(() => assertSealedConfig({
      ...baseline, [key]: key === 'PORT' ? '0' : 'UNSAFE',
    }), key);
  }
  for (const mode of ['TEST', 'PRODUCTION', 'DEMO']) {
    assert.throws(() => assertSealedConfig({ ...baseline, GHIMS_RUNTIME_MODE: mode }));
  }
});
test('only health is exposed; FHIR, OAuth, imports and arbitrary routes are forbidden', async () => {
  const server = createSealedServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const call = (method, path, body) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method, path }, res => {
      const buffers = [];
      res.on('data', c => buffers.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(buffers).toString(),
      }));
    });
    req.on('error', reject);
    req.end(body);
  });
  try {
    const health = await call('GET', '/healthz');
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.text), {state: 'SEALED', fhir: 'DISABLED'});
    assert.equal(health.headers['cache-control'], 'no-store');
    for (const [method, path, body] of [
      ['GET', '/'], ['GET', '/healthz?debug=1'],
      ['POST', '/healthz', '{}'], ['POST', '/oauth/token', '{}'],
      ['POST', '/fhir/import', '{"patient":"synthetic"}'],
      ['GET', '/metrics'], ['GET', '/fhir/Patient'],
    ]) {
      const result = await call(method, path, body);
      assert.equal(result.status, 403, method + ' ' + path);
      assert.equal(result.text, '{"code":"CI_EXT07F_WORKER_SEALED"}');
    }
  } finally {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
test('image context has no application dependencies or outbound network client', () => {
  const dir='services/epic-sealed-worker/';
  const docker=readFileSync(dir+'Dockerfile','utf8');
  const ignore=readFileSync(dir+'.dockerignore','utf8');
  const code=readFileSync(dir+'server.mjs','utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  // Pin exact x86-64 OCI manifest, not a mutable tag or multiarch index.
  const amd64Digest = '4eefa1bfce4197942661ef9148247d779ddf1bb0ee006d3294a467609de60724';
  assert.ok(docker.split('\n').some(line => line.trim() === 'FROM node:24-alpine@sha256:' + amd64Digest));
  assert.ok(!docker.split('\n').some(line => line.trim() === 'FROM node:24-alpine'));
  assert.ok(docker.includes('linux/amd64 manifest'));
  assert.match(docker, /USER node/);
  assert.match(docker, /COPY --chown=node:node server\.mjs/);
  assert.doesNotMatch(docker, /COPY \./);
  assert.match(ignore, /\*\n!server\.mjs/);
  assert.doesNotMatch(code, /from ['"](?:node:)?(?:https|net|tls|dns|child_process)|fetch\(|SecretManager|Firestore|privateKey|client_secret/);
});
test('script uses safe first deployment and keeps secret and imports disabled', () => {
  const shell=readFileSync('scripts/ops/ci-ext07f-sealed-worker.sh','utf8');
  for (const entry of [
    'set -Eeuo pipefail', 'helixis-epic-egress',
    'helixis-epic-us-central1', 'all-traffic',
    '--ingress=internal', '--no-allow-unauthenticated',
    '--no-traffic', 'helixis-epic-staging-runtime',
    'HELIXIS_CI_EXT07F_CONFIRM_DEPLOY',
    'CI_EXT07F_IMPORT_ENABLED=NO', 'CI_EXT07F_SECRET_GRANTS=NOT_CHANGED',
  ]) assert.ok(shell.includes(entry), entry);
  assert.doesNotMatch(shell, /--(?:set|update)-secrets|secrets add-iam-policy-binding|--ingress=all|--vpc-egress=private-ranges-only/);
});
