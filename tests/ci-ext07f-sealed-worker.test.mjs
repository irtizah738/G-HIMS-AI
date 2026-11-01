import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
    '--scaling=0', '--no-default-url', '--invoker-iam-check',
    'helixis-epic-staging-runtime',
    'HELIXIS_CI_EXT07F_CONFIRM_DEPLOY',
    'CI_EXT07F_IMPORT_ENABLED=NO', 'CI_EXT07F_SECRET_GRANTS=NOT_CHANGED',
  ]) assert.ok(shell.includes(entry), entry);
  assert.doesNotMatch(shell, /--(?:set|update)-secrets|secrets add-iam-policy-binding|--ingress=all|--vpc-egress=private-ranges-only|--no-traffic|--min-instances|--max-instances/);
  // On first create, a revision may receive 100% routing but MUST be disabled.
  assert.match(shell, /--scaling=0/);
  assert.match(shell, /--no-default-url/);
});


test('regional inventory proves absence; existing service, malformed listing and IAM errors fail closed', () => {
  const work = mkdtempSync(join(tmpdir(), 'helixis-epic-inventory-'));
  const script = join(work, 'gcloud');
  // Mock gcloud; never authenticates to a real Google Cloud project.
  const mockCode = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'case "$1 $2" in',
    '  "config get-value") echo studio-1130431360-48a05 ;;',
    '  "run services")',
    '    if [[ "$MOCK_LIST_DENIED" == true ]]; then echo PERMISSION_DENIED >&2; exit 1; fi',
    '    echo "$MOCK_SERVICE_INVENTORY" ;;',
    '  "compute networks")',
    '    if [[ "$*" == *stackType* ]]; then echo IPV4_ONLY;',
    '    else echo projects/p/global/networks/helixis-epic-egress; fi ;;',
    '  "iam service-accounts")',
    '    if [[ "$3" == describe ]]; then echo False; fi ;;',
    '  "compute firewall-rules")',
    "    jq -cn '{direction:\"EGRESS\",priority:1000,network:\"projects/p/global/networks/helixis-epic-egress\",destinationRanges:[\"0.0.0.0/0\"],denied:[{IPProtocol:\"all\"}]}' ;;",
    "  \"secrets get-iam-policy\" | \"projects get-iam-policy\") jq -cn '{bindings:[]}' ;;",
    '  *) echo "MOCK_UNEXPECTED_GCLOUD_CALL:$1:$2" >&2; exit 91 ;;',
    'esac',
  ].join('\n');
  writeFileSync(script, mockCode + '\n');
  chmodSync(script, 0o700);
  const invoke = (inventory, denied = false) =>
    spawnSync('bash', ['scripts/ops/ci-ext07f-sealed-worker.sh', 'plan'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: work + ':' + process.env.PATH,
        MOCK_SERVICE_INVENTORY: JSON.stringify(inventory),
        MOCK_LIST_DENIED: String(denied),
        GHIMS_RUNTIME_MODE: 'STAGING',
        HELIXIS_CI_EXT07F_CONFIRM_PROJECT: 'studio-1130431360-48a05',
        GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED: 'false',
        GHIMS_INTEGRATION_FHIR_R4_STATE: 'DISABLED',
        GHIMS_CI_FHIR_AUTH_MODE: 'DISABLED',
        HELIXIS_CI_EXT07F_IMAGE:
          'us-central1-docker.pkg.dev/studio-1130431360-48a05/helixis-epic-staging/epic-sealed-worker@sha256:' + 'a'.repeat(64),
      },
    });
  try {
    const absent = invoke([{ metadata: { name: 'unrelated-service' } }]);
    assert.equal(absent.status, 0, absent.stderr);
    assert.match(absent.stdout, /CI_EXT07F_ACTION=PLAN_ONLY/);
    const exists = invoke([{ metadata: { name: 'helixis-epic-sealed-worker' } }]);
    assert.notEqual(exists.status, 0);
    assert.match(exists.stderr, /CI_EXT07F_FAILED=SERVICE_ALREADY_EXISTS/);
    const denied = invoke([], true);
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /CI_EXT07F_FAILED=SERVICE_INVENTORY_NOT_VERIFIABLE/);
    const malformed = invoke({ unexpected: true });
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /CI_EXT07F_FAILED=SERVICE_INVENTORY_INVALID/);
    const unknown = invoke([{ type: 'service-without-name' }]);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /CI_EXT07F_FAILED=SERVICE_INVENTORY_INVALID/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
