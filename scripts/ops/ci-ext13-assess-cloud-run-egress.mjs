/**
 * CI-EXT-13 read-only Cloud Run network assessment.
 * Intentionally produces no "GO" verdict. Neither Cloud Run configuration
 * nor a firewall inventory proves SWP identity matching or bypass resistance.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const object = x => x && typeof x === 'object' && !Array.isArray(x) ? x : {};
const entries = x => Array.isArray(x) ? x : [];
const suffix = (value, last) =>
  typeof value === 'string' && (value === last || value.endsWith('/' + last));
const safeId = v => typeof v === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(v);
function networkInterfaces(service) {
  const meta = object(object(object(service.spec).template).metadata);
  const value = object(meta.annotations)['run.googleapis.com/network-interfaces'];
  try {
    return typeof value === 'string' ? entries(JSON.parse(value)) : [];
  } catch {
    return [];
  }
}
function serviceEnvStatus(service) {
  const template = object(object(service.spec).template);
  const containers = entries(object(template.spec).containers);
  const vars = entries(object(containers[0]).env);
  const plain = {};
  for (const name of [
    'HELIXIS_EPIC_WORKER_MODE', 'GHIMS_RUNTIME_MODE',
    'GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED',
    'GHIMS_INTEGRATION_FHIR_R4_STATE', 'GHIMS_CI_FHIR_AUTH_MODE',
  ]) {
    const found = vars.find(e => object(e).name === name);
    plain[name] = found && typeof found.value === 'string' ? found.value : null;
  }
  return plain;
}
export function assessCloudRunEgressInventory(data, expected) {
  const service = object(data.service), subnet = object(data.subnet);
  const routes = entries(data.routes), firewalls = entries(data.firewalls);
  const template = object(object(service.spec).template);
  const tplMeta = object(template.metadata);
  const annotations = object(tplMeta.annotations);
  const metadata = object(service.metadata);
  const metadataAnnotations = object(metadata.annotations);
  const status = object(service.status);
  const runtime = serviceEnvStatus(service);
  const interfaceMatches = networkInterfaces(service).some(n =>
    object(n).network === expected.network && object(n).subnetwork === expected.subnet);
  const subnetMatches = suffix(subnet.network, expected.network) &&
    suffix(subnet.region, expected.region);
  const vpcRoutes = routes.filter(r => suffix(object(r).network, expected.network));
  const directDeny = firewalls.some(f => {
    const rule = object(f);
    return suffix(rule.network, expected.network) &&
      rule.disabled === false && rule.direction === 'EGRESS' &&
      entries(rule.destinationRanges).includes('0.0.0.0/0') &&
      entries(rule.denied).some(d => object(d).IPProtocol === 'all') &&
      entries(rule.targetTags).length === 0;
  });
  const expectedEnv = runtime.HELIXIS_EPIC_WORKER_MODE === 'SEALED' &&
    runtime.GHIMS_RUNTIME_MODE === 'STAGING' &&
    runtime.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED === 'false' &&
    runtime.GHIMS_INTEGRATION_FHIR_R4_STATE === 'DISABLED' &&
    runtime.GHIMS_CI_FHIR_AUTH_MODE === 'DISABLED';
  const observations = {
    expectedCloudRunService: metadata.name === expected.service,
    dedicatedServiceAccount: object(template.spec).serviceAccountName === expected.serviceAccount,
    allTrafficDirectVPC: annotations['run.googleapis.com/vpc-access-egress'] === 'all-traffic' &&
      interfaceMatches,
    expectedSubnet: subnetMatches,
    sealedWorker: expectedEnv &&
      metadataAnnotations['run.googleapis.com/scalingMode'] === 'manual' &&
      metadataAnnotations['run.googleapis.com/manualInstanceCount'] === '0' &&
      metadataAnnotations['run.googleapis.com/default-url-disabled'] === 'true' &&
      metadataAnnotations['run.googleapis.com/ingress'] === 'internal' &&
      status.url == null,
    untaggedDenyAllEgressRulePresent: directDeny,
    effectiveFirewallInventoryReadable: data.effectiveFirewalls !== undefined &&
      data.effectiveFirewalls !== null,
  };
  const complete = Object.values(observations).every(Boolean);
  return {
    schema: 'helixis.ci-ext13.cloud-run-readonly.v1',
    project: expected.project, region: expected.region,
    workload: expected.service, network: expected.network,
    observations,
    routeInventory: {
      routeCount: vpcRoutes.length,
      hasDefaultInternetRoute: vpcRoutes.some(r => suffix(object(r).nextHopGateway, 'default-internet-gateway')),
      hasNextHopIlbRoute: vpcRoutes.some(r => Boolean(object(r).nextHopIlb)),
    },
    inventoryVerdict: complete ? 'READONLY_CONFIGURATION_MATCH' : 'READONLY_CONFIGURATION_REVIEW_REQUIRED',
    swpServiceAccountMatcherProven: false,
    swpSecureTagMatcherProven: false,
    directInternetBypassPreventionProven: false,
    actualCloudRunPacketsTested: false,
    productionRelease: 'NO_GO',
    limitations: [
      'No test traffic was emitted',
      'A sealed Cloud Run service cannot establish a real SWP source-identity result',
      'No inventory can substitute for independently witnessed policy and bypass tests',
      'Existing R24 SWP lab is unchanged and remains frozen',
    ],
  };
}
function run(args) {
  if (args.length !== 11 || !args.slice(5).every(safeId)) {
    throw new Error('CI_EXT13_READONLY_ARGUMENTS_INVALID');
  }
  const [serviceFile, subnetFile, routesFile, firewallsFile, effectiveFile,
    project, region, service, network, subnet, serviceAccount] = args;
  if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(serviceAccount)) {
    throw new Error('CI_EXT13_EXPECTED_SERVICE_ACCOUNT_INVALID');
  }
  const load = file => JSON.parse(readFileSync(file, 'utf8'));
  const result = assessCloudRunEgressInventory({
    service: load(serviceFile), subnet: load(subnetFile),
    routes: load(routesFile), firewalls: load(firewallsFile),
    effectiveFirewalls: load(effectiveFile),
  }, {project,region,service,network,subnet,serviceAccount});
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { run(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write('CI_EXT13_READONLY_ASSESSMENT_FAILED\n');
    process.exitCode = 1;
  }
}
