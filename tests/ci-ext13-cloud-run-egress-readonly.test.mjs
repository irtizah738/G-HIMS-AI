import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessCloudRunEgressInventory } from '../scripts/ops/ci-ext13-assess-cloud-run-egress.mjs';

const project='studio-1130431360-48a05';
const service='helixis-epic-sealed-worker';
const network='helixis-epic-egress';
const subnet='helixis-epic-us-central1';
const region='us-central1';
const serviceAccount='helixis-epic-staging-runtime@'+project+'.iam.gserviceaccount.com';
const expected={project,service,network,subnet,region,serviceAccount};
function fixture() {
  return {
    service:{
      metadata:{name:service,annotations:{
        'run.googleapis.com/scalingMode':'manual',
        'run.googleapis.com/manualInstanceCount':'0',
        'run.googleapis.com/default-url-disabled':'true',
        'run.googleapis.com/ingress':'internal',
      }},
      status:{url:null},
      spec:{template:{
        metadata:{annotations:{
          'run.googleapis.com/network-interfaces':
            JSON.stringify([{network,subnetwork:subnet,tags:['epic-worker']}]),
          'run.googleapis.com/vpc-access-egress':'all-traffic',
        }},
        spec:{serviceAccountName:serviceAccount,containers:[{env:[
          {name:'HELIXIS_EPIC_WORKER_MODE',value:'SEALED'},
          {name:'GHIMS_RUNTIME_MODE',value:'STAGING'},
          {name:'GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED',value:'false'},
          {name:'GHIMS_INTEGRATION_FHIR_R4_STATE',value:'DISABLED'},
          {name:'GHIMS_CI_FHIR_AUTH_MODE',value:'DISABLED'},
        ]}]}
      }}
    },
    subnet:{name:subnet,network:'projects/'+project+'/global/networks/'+network,
      region:'projects/'+project+'/regions/'+region},
    routes:[{
      network:'projects/'+project+'/global/networks/'+network,
      destRange:'0.0.0.0/0',nextHopGateway:'projects/'+project+'/global/gateways/default-internet-gateway',
    }],
    firewalls:[{
      network:'projects/'+project+'/global/networks/'+network,
      disabled:false,direction:'EGRESS',
      destinationRanges:['0.0.0.0/0'],denied:[{IPProtocol:'all'}],
    }],
    effectiveFirewalls:[],
  };
}
test('CI-EXT-13 source runtime inventory never asserts SWP identity or production readiness',()=>{
  const result=assessCloudRunEgressInventory(fixture(),expected);
  assert.equal(result.inventoryVerdict,'READONLY_CONFIGURATION_MATCH');
  assert.equal(result.swpServiceAccountMatcherProven,false);
  assert.equal(result.swpSecureTagMatcherProven,false);
  assert.equal(result.directInternetBypassPreventionProven,false);
  assert.equal(result.actualCloudRunPacketsTested,false);
  assert.equal(result.productionRelease,'NO_GO');
  assert.equal(result.routeInventory.hasDefaultInternetRoute,true);
});
test('CI-EXT-13 wrong service account, no all-traffic VPC or missing deny are review-required',()=>{
  const bad=fixture();
  bad.service.spec.template.spec.serviceAccountName='wrong@'+project+'.iam.gserviceaccount.com';
  bad.service.spec.template.metadata.annotations['run.googleapis.com/vpc-access-egress']='private-ranges-only';
  bad.firewalls[0].disabled=true;
  const result=assessCloudRunEgressInventory(bad,expected);
  assert.equal(result.inventoryVerdict,'READONLY_CONFIGURATION_REVIEW_REQUIRED');
  assert.equal(result.observations.dedicatedServiceAccount,false);
  assert.equal(result.observations.allTrafficDirectVPC,false);
  assert.equal(result.observations.untaggedDenyAllEgressRulePresent,false);
  assert.equal(result.productionRelease,'NO_GO');
});
test('CI-EXT-13 inventory shell contract is cloud read-only and requires confirmation',()=>{
  const script=readFileSync('scripts/ops/ci-ext13-cloud-run-egress-readonly.sh','utf8');
  assert.match(script,/HELIXIS_CI_EXT13_CONFIRM_PROJECT/);
  assert.match(script,/ACTIVE_PROJECT_MISMATCH/);
  assert.match(script,/CI_EXT13_CLOUD_MUTATIONS=NONE/);
  assert.match(script,/CI_EXT13_PRODUCTION_RELEASE=NO_GO/);
  for(const expectedText of [
    'run services describe','networks subnets describe','compute routes list',
    'compute firewall-rules list','get-effective-firewalls'
  ])assert.ok(script.includes(expectedText),expectedText);
  assert.doesNotMatch(script,/\bgcloud\s+(?:run\s+(?:deploy|update|delete|jobs\s+execute)|compute\s+(?:firewall-rules|routes|networks)\s+(?:create|update|delete)|secrets\s+versions\s+access)/);
  assert.doesNotMatch(script,/\bcurl\b|\bwget\b|\bnc\s|--allow-unauthenticated/);
});
