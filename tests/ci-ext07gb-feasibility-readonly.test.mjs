import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const scriptPath = 'scripts/ops/ci-ext07gb-feasibility-readonly.sh';
const contract = JSON.parse(readFileSync('config/ci-ext07gb-lab-gates.json', 'utf8'));

test('07G-B blocks gateway provisioning until cost, rollback and security approvals', () => {
  assert.equal(contract.status, 'READ_ONLY_FEASIBILITY_NOT_ROUTING_APPROVAL');
  assert.equal(contract.sourceProject, 'studio-1130431360-48a05');
  assert.equal(contract.protectedResources.cloudRunManualInstanceCount, 0);
  assert.equal(contract.protectedResources.secretAccess, 'DENIED');
  assert.equal(contract.protectedResources.imports, 'DISABLED');
  assert.equal(contract.protectedResources.existingFirewallChangesApproved, false);
  assert.equal(contract.lab.gatewayProvisioned, false);
  assert.equal(contract.lab.liveLabAuthorized, false);
  assert.equal(contract.lab.financeApproval, false);
  assert.equal(contract.lab.securityReviewApproved, false);
  assert.equal(contract.lab.teardownPlanApproved, false);
  assert.equal(contract.lab.noBroadEgressAllow, true);
  assert.equal(contract.lab.noPatientData, true);
  assert.equal(contract.lab.noEpicCredentials, true);
  assert.equal(contract.lab.separateDisposableVPC, true);
  assert.equal(contract.acceptance.blockDeploymentIfAnyUnknown, true);
  assert.equal(contract.acceptance.noGoIfBroadAllowRequired, true);
  for (const [key, value] of Object.entries(contract.decisions)) {
    if (key.endsWith('Compatibility') || key.startsWith('routeFailover') ||
        key.startsWith('sourceEgress') || key.startsWith('cloudRunSource') ||
        key.startsWith('sourceTag') || key.startsWith('automaticCloud') ||
        key.startsWith('egressFirewall')) {
      assert.equal(value, 'UNVERIFIED', key);
    }
  }
  for (const name of ['DEFAULT_ROUTE_FALLBACK','NEXT_HOP_ROUTE_REMOVED',
    'GATEWAY_UNHEALTHY','FIREWALL_HIGHER_PRIORITY_ALLOW','CLOUD_NAT_DIRECT_BYPASS',
    'CLOUD_RUN_SOURCE_IDENTITY_MISMATCH','IPV6','UDP_443_QUIC','DNS_REBINDING']) {
    assert.ok(contract.mandatoryNegativeTests.includes(name), name);
  }
});

test('feasibility script exposes only Cloud read/list/get commands', () => {
  const text = readFileSync(scriptPath, 'utf8');
  assert.match(text, /STAGING_REQUIRED/);
  assert.match(text, /PROJECT_CONFIRMATION_REQUIRED/);
  assert.match(text, /WORKER_NOT_SEALED/);
  assert.match(text, /DENY_RULE_INVALID/);
  for (const expected of [
    'run services describe', 'compute networks subnets describe',
    'compute firewall-rules describe',
    'compute network-firewall-policies get-effective-firewalls',
    'compute routes list', 'compute routers list'
  ]) assert.ok(text.includes(expected), expected);
  const commandLines = text.split('\n').filter(s =>
    /^\s*(?:read_json|if\s+!\s+.*gcloud|gcloud)\s/.test(s));
  assert.equal(commandLines.filter(s => s.includes('read_json')).length, 6);
  assert.doesNotMatch(text,
    /\bgcloud\s+(?:services\s+enable|run\s+(?:deploy|update|delete)|compute\s+(?:firewall-rules|routes|networks)\s+(?:create|update|delete)|secrets\s+(?:add-iam-policy-binding|versions\s+access)|network-security\s+gateways\s+create)/);
  assert.doesNotMatch(text, /\bcurl\b|\bwget\b|\bnc\s|--allow-unauthenticated/);
  assert.match(text, /CI_EXT07GB_CLOUD_WRITES=NONE/);
});

function fixtures() {
  return {
    MOCK_SERVICE: {
      metadata: { name:'helixis-epic-sealed-worker', annotations:{
        'run.googleapis.com/scalingMode':'manual',
        'run.googleapis.com/manualInstanceCount':'0',
        'run.googleapis.com/default-url-disabled':'true',
        'run.googleapis.com/ingress':'internal',
      }},
      status:{url:null,traffic:[{revisionName:'helixis-epic-sealed-worker-00001-ccv',percent:100}]},
      spec:{template:{
        metadata:{annotations:{
          'run.googleapis.com/network-interfaces':
            JSON.stringify([{network:'helixis-epic-egress',subnetwork:'helixis-epic-us-central1',tags:['helixis-epic-worker']}]),
          'run.googleapis.com/vpc-access-egress':'all-traffic'
        }},
        spec:{
          serviceAccountName:'helixis-epic-staging-runtime@studio-1130431360-48a05.iam.gserviceaccount.com',
          containers:[{env:[
            {name:'HELIXIS_EPIC_WORKER_MODE',value:'SEALED'},
            {name:'GHIMS_RUNTIME_MODE',value:'STAGING'},
            {name:'GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED',value:'false'},
            {name:'GHIMS_INTEGRATION_FHIR_R4_STATE',value:'DISABLED'},
            {name:'GHIMS_CI_FHIR_AUTH_MODE',value:'DISABLED'}
          ]}]
        }
      }}
    },
    MOCK_SUBNET:{
      stackType:'IPV4_ONLY',network:'projects/p/global/networks/helixis-epic-egress',
      ipCidrRange:'10.240.40.0/24'
    },
    MOCK_DENY:{
      name:'helixis-epic-deny-egress',
      disabled:false,direction:'EGRESS',priority:1000,
      network:'projects/p/global/networks/helixis-epic-egress',
      destinationRanges:['0.0.0.0/0'],denied:[{IPProtocol:'all'}]
    },
    MOCK_EFFECTIVE:[{type:'network-firewall',name:'helixis-epic-deny-egress'}],
    MOCK_ROUTES:[{name:'default-route',network:'projects/p/global/networks/helixis-epic-egress',
      destRange:'0.0.0.0/0',priority:1000,nextHopGateway:'default-internet-gateway'}],
    MOCK_ROUTERS:[]
  };
}

test('read-only inventory produces evidence but refuses to qualify the actual packet path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-ext07gb-test-'));
  const mock = join(dir, 'gcloud');
  const lines = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'case "$1:$2:$3" in',
    '  "config:get-value:project") echo studio-1130431360-48a05 ;;',
    '  "run:services:describe") printf "%s\\n" "$MOCK_SERVICE" ;;',
    '  "compute:networks:subnets") printf "%s\\n" "$MOCK_SUBNET" ;;',
    '  "compute:firewall-rules:describe") printf "%s\\n" "$MOCK_DENY" ;;',
    '  "compute:network-firewall-policies:get-effective-firewalls") printf "%s\\n" "$MOCK_EFFECTIVE" ;;',
    '  "compute:routes:list") printf "%s\\n" "$MOCK_ROUTES" ;;',
    '  "compute:routers:list") printf "%s\\n" "$MOCK_ROUTERS" ;;',
    '  *) echo "UNEXPECTED_CLOUD_COMMAND:$*" >&2; exit 87 ;;',
    'esac'
  ];
  writeFileSync(mock, lines.join('\n')+'\n');
  chmodSync(mock, 0o700);
  const baseline = fixtures();
  const run = (objects, overrides={}) =>
    spawnSync('bash', [scriptPath], {
      cwd:process.cwd(), encoding:'utf8', timeout:15000,
      env:{
        ...process.env, HOME:dir, PATH:dir+':'+process.env.PATH,
        GHIMS_RUNTIME_MODE:'STAGING',
        HELIXIS_CI_EXT07GB_CONFIRM_PROJECT:'studio-1130431360-48a05',
        ...Object.fromEntries(Object.entries(objects).map(([k,v])=>[k,JSON.stringify(v)])),
        ...overrides
      }
    });
  try {
    const pass = run(baseline);
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /CI_EXT07GB_READONLY_CAPTURE=PASS/);
    assert.match(pass.stdout, /GATE_REQUIRES_ISOLATED_NETWORK_PROOF/);
    assert.match(pass.stdout, /CI_EXT07GB_CLOUD_WRITES=NONE/);
    const enabled = fixtures();
    enabled.MOCK_SERVICE.metadata.annotations['run.googleapis.com/manualInstanceCount']='1';
    const denied = run(enabled);
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /WORKER_NOT_SEALED/);
    const badRule = fixtures();
    badRule.MOCK_DENY.disabled = true;
    const bad = run(badRule);
    assert.notEqual(bad.status,0);
    assert.match(bad.stderr,/DENY_RULE_INVALID/);
    const missingConfirmation = run(fixtures(),{HELIXIS_CI_EXT07GB_CONFIRM_PROJECT:''});
    assert.notEqual(missingConfirmation.status,0);
    assert.match(missingConfirmation.stderr,/PROJECT_CONFIRMATION_REQUIRED/);
  } finally {
    rmSync(dir, {force:true,recursive:true});
  }
});
