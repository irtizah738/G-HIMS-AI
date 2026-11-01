#!/usr/bin/env bash
# CI-EXT-07G-B read-only discovery. Never provisions network, gateway, IAM or Cloud Run.
set +x
set -Eeuo pipefail
umask 077
fail() { printf 'CI_EXT07GB_FAILED=%s\n' "$1" >&2; exit 1; }
PROJECT=studio-1130431360-48a05
REGION=us-central1
NETWORK=helixis-epic-egress
SUBNET=helixis-epic-us-central1
SERVICE=helixis-epic-sealed-worker
DENY=helixis-epic-deny-egress
[[ "${GHIMS_RUNTIME_MODE:-}" == STAGING ]] || fail STAGING_REQUIRED
[[ "${HELIXIS_CI_EXT07GB_CONFIRM_PROJECT:-}" == "$PROJECT" ]] || fail PROJECT_CONFIRMATION_REQUIRED
for tool in gcloud jq sha256sum; do
  command -v "$tool" >/dev/null || fail "TOOL_MISSING_$tool"
done
[[ "$(gcloud config get-value project 2>/dev/null)" == "$PROJECT" ]] || fail PROJECT_MISMATCH

EVIDENCE="$HOME/helixis-ci-ext07gb-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 -- "$EVIDENCE" || fail EVIDENCE_DIRECTORY_FAILED
read_json() {
  local name="$1"
  shift
  if ! "$@" --format=json >"$EVIDENCE/$name.json"; then
    fail "READ_$name"_FAILED
  fi
  jq -e . "$EVIDENCE/$name.json" >/dev/null || fail "INVALID_$name"_JSON
}
read_json service gcloud run services describe "$SERVICE" --project="$PROJECT" --region="$REGION"
jq -e --arg sa "helixis-epic-staging-runtime@$PROJECT.iam.gserviceaccount.com" \
  --arg network "$NETWORK" --arg subnet "$SUBNET" '
  . as $s |
  ($s.spec.template.spec.containers[0].env |
    map({key:.name,value:(.value//null)})|from_entries) as $e |
  ($s.spec.template.metadata.annotations["run.googleapis.com/network-interfaces"] |
    fromjson) as $n |
  ($s.metadata.annotations["run.googleapis.com/scalingMode"] == "manual") and
  ($s.metadata.annotations["run.googleapis.com/manualInstanceCount"] == "0") and
  ($s.metadata.annotations["run.googleapis.com/default-url-disabled"] == "true") and
  ($s.metadata.annotations["run.googleapis.com/ingress"] == "internal") and
  ($s.metadata.annotations["run.googleapis.com/invoker-iam-disabled"] != "true") and
  ($s.status.url == null) and
  (all($s.status.traffic[]; .tag==null)) and
  ($s.spec.template.spec.serviceAccountName == $sa) and
  ($s.spec.template.metadata.annotations["run.googleapis.com/vpc-access-egress"] == "all-traffic") and
  (any($n[]; .network==$network and .subnetwork==$subnet)) and
  (($s.spec.template.spec.volumes//[])|length==0) and
  (all($s.spec.template.spec.containers[0].env[]?; .valueFrom==null)) and
  ($e.HELIXIS_EPIC_WORKER_MODE=="SEALED") and
  ($e.GHIMS_RUNTIME_MODE=="STAGING") and
  ($e.GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED=="false") and
  ($e.GHIMS_INTEGRATION_FHIR_R4_STATE=="DISABLED") and
  ($e.GHIMS_CI_FHIR_AUTH_MODE=="DISABLED")
' "$EVIDENCE/service.json" >/dev/null || fail WORKER_NOT_SEALED

read_json subnet gcloud compute networks subnets describe "$SUBNET" --project="$PROJECT" --region="$REGION"
jq -e --arg n "$NETWORK" '
  .stackType=="IPV4_ONLY" and (.network|endswith("/networks/"+$n)) and
  .ipCidrRange=="10.240.40.0/24"
' "$EVIDENCE/subnet.json" >/dev/null || fail SUBNET_UNEXPECTED

read_json deny gcloud compute firewall-rules describe "$DENY" --project="$PROJECT"
jq -e --arg n "$NETWORK" '
  .disabled==false and .direction=="EGRESS" and .priority==1000 and
  (.network|endswith("/networks/"+$n)) and
  (.destinationRanges|index("0.0.0.0/0")!=null) and
  any(.denied[]; .IPProtocol=="all") and
  ((.targetTags//[])|length==0)
' "$EVIDENCE/deny.json" >/dev/null || fail DENY_RULE_INVALID

# These inventories are evidence inputs, not a simulation of effective packet forwarding.
read_json effective-firewalls gcloud compute network-firewall-policies get-effective-firewalls \
  --network="$NETWORK" --region="$REGION" --project="$PROJECT"
read_json routes gcloud compute routes list --project="$PROJECT"
read_json routers gcloud compute routers list --project="$PROJECT"

jq -n --arg n "$NETWORK" --arg project "$PROJECT" --arg region "$REGION" \
  --arg folder "$EVIDENCE" \
  --slurpfile routes "$EVIDENCE/routes.json" \
  --slurpfile routers "$EVIDENCE/routers.json" \
  --slurpfile effective "$EVIDENCE/effective-firewalls.json" '
  {
    schema:"helixis.ci-ext07gb.inventory.v1",
    project:$project,region:$region,network:$n,
    verdict:"GATE_REQUIRES_ISOLATED_NETWORK_PROOF",
    workerVerifiedDisabled:true,
    effectiveFirewallRead:true,
    effectiveFirewallPayloadType:($effective[0]|type),
    vpcRoutes:[
      $routes[0][]? |
      select((.network//"")|endswith("/networks/"+$n)) |
      {name,destRange,priority,tags,nextHopGateway,nextHopIlb,nextHopIp}
    ],
    vpcRouters:[
      $routers[0][]? |
      select((.network//"")|endswith("/networks/"+$n)) |
      {name,region,natCount:((.nats//[])|length)}
    ],
    localEvidenceDirectory:$folder,
    limitations:[
      "No Cloud resource was created or changed",
      "No network packets were sent from the disabled worker",
      "Effective routing and anti-bypass remain unqualified",
      "No broad outbound allow rule is authorized"
    ]
  }' > "$EVIDENCE/summary.json" || fail SUMMARY_FAILED
(
  cd "$EVIDENCE"
  sha256sum service.json subnet.json deny.json effective-firewalls.json \
    routes.json routers.json summary.json > manifest.sha256
)
printf 'CI_EXT07GB_CLOUD_WRITES=NONE\n'
printf 'CI_EXT07GB_READONLY_CAPTURE=PASS\n'
printf 'CI_EXT07GB_GATE=ISOLATED_NETWORK_PROOF_REQUIRED\n'
cat "$EVIDENCE/summary.json"
