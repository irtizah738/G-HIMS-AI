import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CONTRACT_PATH = 'config/ci-ext07g-egress-design.json';
const policy = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));

test('07G only specifies a disabled, synthetic staging source and no authorized infrastructure changes', () => {
  assert.equal(policy.schema, 'helixis.ci-ext07g.egress-design.v1');
  assert.equal(policy.status, 'DESIGN_ONLY');
  assert.equal(policy.project, 'studio-1130431360-48a05');
  assert.equal(policy.region, 'us-central1');
  assert.equal(policy.tenant, 'helixis-epic-sandbox');
  assert.equal(policy.source.service, 'helixis-epic-sealed-worker');
  assert.equal(policy.source.expectedManualInstanceCount, 0);
  assert.equal(policy.source.serviceEnabled, false);
  assert.equal(policy.source.expectedMode, 'SEALED');
  assert.equal(policy.source.fhirImportEnabled, false);
  assert.equal(policy.source.fhirAuthEnabled, false);
  assert.equal(policy.gateway.gatewayResourceCreated, false);
  assert.equal(policy.gateway.deploymentApproved, false);
  assert.equal(policy.network.firewallOrRouteChangesApproved, false);
  assert.equal(policy.qualification.stagingDeploymentEnabled, false);
  assert.equal(policy.security.clinicalDataTransferEnabled, false);
  assert.equal(policy.epic.requests, 'DISABLED');
  assert.equal(policy.epic.tokenExchange, 'DISABLED');
  assert.equal(policy.epic.patientImports, 'DISABLED');
});

test('07G policy is exact sandbox-only host/port and cannot silently allow other HTTPS targets', () => {
  assert.deepEqual(policy.epic.allowedHosts, ['fhir.epic.com']);
  assert.deepEqual(policy.epic.allowedDestinationPorts, [443]);
  assert.equal(policy.epic.uriScheme, 'https');
  assert.equal(policy.epic.sandboxOnly, true);
  assert.equal(policy.epic.productionDomainsAllowed, false);
  assert.equal(policy.epic.redirects, 'DENY');
  assert.deepEqual(policy.epic.methodsAllowedByApplication, ['GET', 'POST_TOKEN_ONLY']);
  assert.equal(policy.gateway.product, 'GOOGLE_CLOUD_SECURE_WEB_PROXY');
  assert.equal(policy.gateway.candidateMode, 'NEXT_HOP_ROUTING_MODE');
  assert.equal(policy.gateway.defaultPolicy, 'DENY');
  assert.equal(policy.gateway.sessionMatch, 'EXACT_SNI_AND_PORT');
  assert.equal(policy.gateway.sniRequired, true);
  assert.equal(policy.gateway.missingSni, 'DENY');
  assert.equal(policy.gateway.encryptedClientHello, 'DENY_UNLESS_PROVEN_FILTERABLE');
  assert.equal(policy.gateway.tlsInspection, 'DISABLED');
  assert.equal(policy.gateway.proxyBypass, 'DENY');
  assert.equal(policy.gateway.routingCompatibility, 'UNQUALIFIED');
  assert.equal(policy.gateway.firewallCompatibility, 'UNQUALIFIED');
});

test('no direct internet bypass, IAM escalation, secret logging or unapproved cost is authorized', () => {
  assert.equal(policy.network.vpc, 'helixis-epic-egress');
  assert.equal(policy.network.subnet, 'helixis-epic-us-central1');
  assert.equal(policy.network.addressFamily, 'IPV4_ONLY');
  assert.equal(policy.network.egress, 'all-traffic');
  assert.equal(policy.network.denyRule, 'helixis-epic-deny-egress');
  assert.equal(policy.network.denyRulePriority, 1000);
  assert.equal(policy.network.denyAllEgressMustRemain, true);
  assert.equal(policy.network.globalAllowAllExceptionPermitted, false);
  assert.equal(policy.network.anyVPCWideAllowExceptionPermitted, false);
  assert.equal(policy.security.secretsAccess, 'DENIED');
  assert.equal(policy.security.credentialMounts, false);
  for (const name of ['logRequestBodies','logAuthHeaders','logTokenValues','logPatientIdentifiers']) {
    assert.equal(policy.security[name], false, name);
  }
  for (const name of ['separateChangeApprovalRequired', 'costApprovalRequired',
    'networkNegativeProofRequired','policyDriftMonitoringRequired']) {
    assert.equal(policy.security[name], true, name);
  }
  assert.equal(policy.externalCosts.costCapApproved, false);
  assert.equal(policy.externalCosts.priceUSDPerGatewayHour, 1.25);
  assert.equal(policy.externalCosts.estimate730hGatewayUSD, 912.5);
  assert.equal(policy.externalCosts.priceUSDPerGiB, 0.0193);
});

test('fail-closed threat model requires comprehensive negative and rollback proofs', () => {
  const cases = policy.qualification.necessaryNegativeCases;
  assert.ok(Array.isArray(cases));
  assert.equal(new Set(cases).size, cases.length, 'No duplicate negative tests');
  for (const name of [
    'UNAUTHORIZED_HOST', 'SUBDOMAIN_MISMATCH', 'MISSING_SNI',
    'ENCRYPTED_CLIENT_HELLO', 'UNAPPROVED_PORT', 'IP_LITERAL',
    'DNS_REBIND', 'PROXY_DOWN', 'DIRECT_IP_BYPASS',
    'ROUTE_REMOVED', 'FIREWALL_OVERRIDE', 'HTTP3_UDP',
    'REDIRECT_CROSS_HOST', 'MUTUAL_TLS_OR_CA_FAILURE',
    'TOKEN_AND_PHI_LOGGING', 'POLICY_DRIFT', 'INSTANCE_COLD_START',
  ]) {
    assert.ok(cases.includes(name), 'Missing negative qualification: ' + name);
  }
  const doc = readFileSync('docs/architecture/HELIXIS_CI_EXT07G_EGRESS_GATEWAY_ADR.md', 'utf8');
  assert.match(doc, /NO-GO/);
  assert.match(doc, /Cloud Run Direct VPC egress/);
  assert.match(doc, /No live network test/);
  assert.match(doc, /explicit proxy mode\s+without TLS inspection/s);
  assert.match(doc, /does \*\*not\*\* restrict URL paths or HTTP methods/);
  assert.match(doc, /Clinical Governance/);
  assert.match(doc, /Route failure must not fall back/);
  assert.match(doc, /no Cloud resources|no Cloud resources/i);
});
