#!/usr/bin/env bash
# CI-EXT-07G-C: isolated deny-only disposable network foundation.
# No gateway, routes, NAT, Cloud Run changes, OAuth, Epic calls or secrets.
set -Eeuo pipefail
set +x
umask 077

PROJECT='studio-1130431360-48a05'
REGION='us-central1'
NETWORK='helixis-epic-lab-net'
SUBNET='helixis-epic-lab-subnet'
DENY='helixis-epic-lab-deny-egress'
CIDR='10.250.240.0/24'
PROTECTED_NETWORK='helixis-epic-egress'
PROTECTED_WORKER='helixis-epic-sealed-worker'

fail() { printf 'CI_EXT07GC_FAILED=%s\n' "$1" >&2; exit 1; }
exists_in_list() {
  local name="$1"; shift
  local found
  found="$("$@" --format='value(name)')" || fail LAB_INVENTORY_READ_FAILED
  grep -Fxq "$name" <<< "$found"
}

[[ "${GHIMS_RUNTIME_MODE:-}" == STAGING ]] || fail STAGING_REQUIRED
[[ "${HELIXIS_CI_EXT07GC_CONFIRM_PROJECT:-}" == "$PROJECT" ]] || fail PROJECT_CONFIRMATION_REQUIRED
for tool in gcloud jq; do command -v "$tool" >/dev/null || fail "TOOL_MISSING_${tool}"; done

# Every API call pins the staging project; active gcloud default is untouched.
worker="$(gcloud run services describe "$PROTECTED_WORKER" \
  --project="$PROJECT" --region="$REGION" --format=json)" || fail PROTECTED_WORKER_LOOKUP
printf '%s' "$worker" | jq -e '
  (.metadata.annotations["run.googleapis.com/scalingMode"] == "manual") and
  (.metadata.annotations["run.googleapis.com/manualInstanceCount"] == "0") and
  (.metadata.annotations["run.googleapis.com/default-url-disabled"] == "true") and
  (.status.url == null) and
  ([.spec.template.spec.containers[0].env[]? | select(.name=="GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED") | .value] == ["false"])
' >/dev/null || fail PROTECTED_WORKER_NOT_SEALED

gcloud compute firewall-rules describe helixis-epic-deny-egress \
  --project="$PROJECT" --format=json | jq -e \
  --arg net "$PROTECTED_NETWORK" '
  (.disabled == false) and (.direction == "EGRESS") and
  (.priority == 1000) and
  (.network | endswith("/networks/" + $net)) and
  (.destinationRanges | index("0.0.0.0/0") != null) and
  (any(.denied[]; .IPProtocol == "all"))
' >/dev/null || fail PROTECTED_DENY_NOT_VERIFIED

network_exists() { exists_in_list "$NETWORK" gcloud compute networks list --project="$PROJECT"; }
subnet_exists() { exists_in_list "$SUBNET" gcloud compute networks subnets list --project="$PROJECT" --regions="$REGION"; }
firewall_exists() { exists_in_list "$DENY" gcloud compute firewall-rules list --project="$PROJECT"; }

verify_foundation() {
  gcloud compute networks describe "$NETWORK" --project="$PROJECT" --format=json |
    jq -e '.autoCreateSubnetworks == false' >/dev/null || fail LAB_NETWORK_INVALID
  gcloud compute networks subnets describe "$SUBNET" --project="$PROJECT" \
    --region="$REGION" --format=json |
    jq -e --arg name "$NETWORK" --arg cidr "$CIDR" '
      (.ipCidrRange == $cidr) and (.network | endswith("/networks/" + $name)) and
      (.stackType == "IPV4_ONLY")
    ' >/dev/null || fail LAB_SUBNET_INVALID
  gcloud compute firewall-rules describe "$DENY" --project="$PROJECT" --format=json |
    jq -e --arg net "$NETWORK" '
      (.disabled == false) and (.direction == "EGRESS") and
      (.priority == 1000) and
      (.network | endswith("/networks/" + $net)) and
      (.destinationRanges | index("0.0.0.0/0") != null) and
      (any(.denied[]; .IPProtocol == "all")) and
      ((.targetTags // []) | length == 0)
    ' >/dev/null || fail LAB_DENY_INVALID
  printf 'CI_EXT07GC_LAB_NETWORK=PASS\n'
  printf 'CI_EXT07GC_LAB_SUBNET=PASS\n'
  printf 'CI_EXT07GC_LAB_DENY=PASS\n'
  printf 'CI_EXT07GC_GATEWAY=NOT_MANAGED_BY_FOUNDATION\n'
  printf 'CI_EXT07GC_SOURCE_WORKER=UNCHANGED\n'
}

case "${1:-plan}" in
  plan)
    if network_exists || subnet_exists || firewall_exists; then
      printf 'CI_EXT07GC_LAB_ALREADY_EXISTS=TRUE\n'
      fail LAB_NAME_COLLISION_USE_VERIFY
    fi
    printf 'CI_EXT07GC_FOUNDATION_PLAN=READY\n'
    printf 'CI_EXT07GC_NETWORK=%s\n' "$NETWORK"
    printf 'CI_EXT07GC_SUBNET=%s\n' "$SUBNET"
    printf 'CI_EXT07GC_CIDR=%s\n' "$CIDR"
    printf 'CI_EXT07GC_FIREWALL=DENY_ALL_IPV4\n'
    printf 'CI_EXT07GC_GATEWAY=NOT_CREATED\n'
    printf 'CI_EXT07GC_GCP_WRITES=NONE\n'
    ;;
  create)
    [[ "${HELIXIS_CI_EXT07GC_ACTION_ACK:-}" == 'CREATE_DISPOSABLE_DENY_ONLY_LAB' ]] || fail CREATE_ACK_REQUIRED
    if network_exists || subnet_exists || firewall_exists; then fail LAB_NAME_COLLISION; fi
    gcloud compute networks create "$NETWORK" --project="$PROJECT" --subnet-mode=custom --bgp-routing-mode=regional
    gcloud compute networks subnets create "$SUBNET" --project="$PROJECT" --region="$REGION" \
      --network="$NETWORK" --range="$CIDR" --stack-type=IPV4_ONLY
    gcloud compute firewall-rules create "$DENY" --project="$PROJECT" \
      --network="$NETWORK" --direction=EGRESS --action=DENY \
      --rules=all --destination-ranges=0.0.0.0/0 --priority=1000
    verify_foundation
    printf 'CI_EXT07GC_FOUNDATION_CREATE=PASS\n'
    printf 'CI_EXT07GC_GATEWAY=NOT_CREATED\n'
    printf 'CI_EXT07GC_PAID_GATEWAY_CLOCK=NOT_STARTED\n'
    ;;
  verify)
    verify_foundation
    ;;
  destroy)
    [[ "${HELIXIS_CI_EXT07GC_ACTION_ACK:-}" == 'DELETE_DISPOSABLE_LAB_FOUNDATION' ]] || fail DESTROY_ACK_REQUIRED
    verify_foundation
    # This is foundation cleanup, never gateway teardown. Refuse extra rules/routes/peering.
    local_fw="$(gcloud compute firewall-rules list --project="$PROJECT" --format=json)" || fail FIREWALL_INVENTORY_FAILED
    printf '%s' "$local_fw" | jq -e --arg net "$NETWORK" --arg deny "$DENY" '
      [.[] | select(.network | endswith("/networks/"+$net)) | .name] == [$deny]
    ' >/dev/null || fail EXTRA_LAB_FIREWALL_RULES
    lab_routes="$(gcloud compute routes list --project="$PROJECT" --format=json)" || fail ROUTE_INVENTORY_FAILED
    printf '%s' "$lab_routes" | jq -e --arg net "$NETWORK" --arg cidr "$CIDR" '
      all(.[] | select(.network | endswith("/networks/"+$net));
        (.destRange == "0.0.0.0/0" and (.nextHopGateway // "" | endswith("/gateways/default-internet-gateway")))
        or (.destRange == $cidr and ((.nextHopGateway // "") == "") and ((.nextHopIlb // "") == ""))
      )
    ' >/dev/null || fail LAB_HAS_ADDITIONAL_ROUTES
    lab_net="$(gcloud compute networks describe "$NETWORK" --project="$PROJECT" --format=json)" || fail LAB_NETWORK_READ_FAILED
    printf '%s' "$lab_net" | jq -e --arg subnet "$SUBNET" '
      ((.peerings // []) | length == 0) and
      ((.subnetworks // []) | length == 1) and
      (.subnetworks[0] | endswith("/subnetworks/" + $subnet))
    ' >/dev/null || fail LAB_NETWORK_HAS_EXTRA_DEPENDENCIES
    # Delete subnet before deny: attached workloads block subnet removal and keep deny.
    gcloud compute networks subnets delete "$SUBNET" --project="$PROJECT" --region="$REGION" --quiet
    gcloud compute firewall-rules delete "$DENY" --project="$PROJECT" --quiet
    gcloud compute networks delete "$NETWORK" --project="$PROJECT" --quiet
    printf 'CI_EXT07GC_FOUNDATION_DELETE=PASS\n'
    ;;
  *) fail INVALID_ACTION ;;
esac
