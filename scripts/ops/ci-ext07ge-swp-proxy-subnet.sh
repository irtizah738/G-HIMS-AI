#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077
PROJECT=studio-1130431360-48a05
REGION=us-central1
NETWORK=helixis-epic-lab-net
PRIVATE_SUBNET=helixis-epic-lab-subnet
PROXY_SUBNET=helixis-epic-lab-proxy-only
PROXY_CIDR=10.250.242.0/23
fail(){ printf 'CI_EXT07GE_FAILED=%s\n' "$1" >&2; exit 1; }
[[ "${GHIMS_RUNTIME_MODE:-}" == STAGING ]] || fail STAGING_ONLY
[[ "${HELIXIS_CI_EXT07GE_CONFIRM_PROJECT:-}" == "$PROJECT" ]] || fail WRONG_PROJECT
for bin in gcloud jq; do command -v "$bin" >/dev/null || fail "MISSING_TOOL_$bin"; done
check_boundary() {
  gcloud compute networks describe "$NETWORK" --project="$PROJECT" --format=json |
    jq -e '.autoCreateSubnetworks == false and ((.peerings // []) | length == 0)' >/dev/null || fail VPC_CHANGED
  gcloud compute firewall-rules describe helixis-epic-lab-deny-egress --project="$PROJECT" --format=json |
    jq -e --arg n "$NETWORK" '.disabled==false and .direction=="EGRESS" and .priority==1000 and (.network | endswith("/networks/"+$n)) and (.destinationRanges|index("0.0.0.0/0")!=null) and any(.denied[]; .IPProtocol=="all")' >/dev/null || fail DENY_RULE_CHANGED
  gcloud compute networks subnets describe "$PRIVATE_SUBNET" --project="$PROJECT" --region="$REGION" --format=json |
    jq -e --arg n "$NETWORK" '.purpose=="PRIVATE" and .stackType=="IPV4_ONLY" and .ipCidrRange=="10.250.240.0/24" and (.network|endswith("/networks/"+$n))' >/dev/null || fail PRIVATE_SUBNET_CHANGED
}
subnets() {
  gcloud compute networks subnets list --project="$PROJECT" --regions="$REGION" --format=json
}
check_inventory() {
  local expected="$1" data
  data="$(subnets)" || fail SUBNET_LIST_FAILED
  printf '%s' "$data" | jq -e --arg n "$NETWORK" --arg a "$PRIVATE_SUBNET" --arg b "$PROXY_SUBNET" --arg expected "$expected" '([.[] | select((.network//"")|endswith("/networks/"+$n))|.name]|sort) == (if $expected=="before" then [$a] else [$a,$b]|sort end)' >/dev/null || fail UNEXPECTED_SUBNETS
}
cert_enabled() {
  gcloud services list --enabled --project="$PROJECT" --format='value(config.name)' | grep -Fxq certificatemanager.googleapis.com
}
check_proxy() {
  check_inventory after
  gcloud compute networks subnets describe "$PROXY_SUBNET" --project="$PROJECT" --region="$REGION" --format=json |
    jq -e --arg n "$NETWORK" --arg c "$PROXY_CIDR" '.purpose=="REGIONAL_MANAGED_PROXY" and .role=="ACTIVE" and .ipCidrRange==$c and (.network|endswith("/networks/"+$n))' >/dev/null || fail PROXY_SUBNET_INVALID
  cert_enabled || fail CERT_MANAGER_DISABLED
  echo 'CI_EXT07GE_PROXY_SUBNET=PASS'
  echo 'CI_EXT07GE_DENY_RULE=UNCHANGED'
}
check_boundary
case "${1:-plan}" in
  plan)
    check_inventory before
    echo 'CI_EXT07GE_PROXY_SUBNET_PLAN=READY'
    echo "CI_EXT07GE_PROXY_CIDR=$PROXY_CIDR"
    echo 'CI_EXT07GE_GCP_WRITES=NONE'
    ;;
  create)
    [[ "${HELIXIS_CI_EXT07GE_ACTION_ACK:-}" == CREATE_ISOLATED_PROXY_SUBNET ]] || fail CREATE_ACK_REQUIRED
    check_inventory before
    gcloud services enable certificatemanager.googleapis.com --project="$PROJECT"
    gcloud compute networks subnets create "$PROXY_SUBNET" --project="$PROJECT" --region="$REGION" --network="$NETWORK" --purpose=REGIONAL_MANAGED_PROXY --role=ACTIVE --range="$PROXY_CIDR"
    check_proxy
    echo 'CI_EXT07GE_PROXY_SUBNET_CREATE=PASS'
    echo 'CI_EXT07GE_PAID_GATEWAY_CLOCK=NOT_STARTED'
    ;;
  verify)
    check_proxy
    ;;
  destroy)
    [[ "${HELIXIS_CI_EXT07GE_ACTION_ACK:-}" == DELETE_ISOLATED_PROXY_SUBNET ]] || fail DELETE_ACK_REQUIRED
    check_proxy
    # Fail closed on any regional gateway, router or non-default next-hop route in the lab.
    gateways="$(gcloud network-services gateways list --project="$PROJECT" --location="$REGION" --format=json)" || fail GATEWAY_LIST_FAILED
    printf '%s' "$gateways" | jq -e 'type=="array" and length==0' >/dev/null || fail GATEWAY_STILL_PRESENT
    routers="$(gcloud compute routers list --project="$PROJECT" --format=json)" || fail ROUTER_LIST_FAILED
    printf '%s' "$routers" | jq -e --arg n "$NETWORK" '[.[] | select((.network//"")|endswith("/networks/"+$n))] | length == 0' >/dev/null || fail ROUTER_STILL_PRESENT
    routes="$(gcloud compute routes list --project="$PROJECT" --format=json)" || fail ROUTE_LIST_FAILED
    printf '%s' "$routes" | jq -e --arg n "$NETWORK" '[.[] | select((.network//"")|endswith("/networks/"+$n)) | select((.nextHopIlb//"")!="" or (.nextHopIp//"")!="")] | length==0' >/dev/null || fail NEXT_HOP_STILL_PRESENT
    gcloud compute networks subnets delete "$PROXY_SUBNET" --project="$PROJECT" --region="$REGION" --quiet
    check_inventory before
    echo 'CI_EXT07GE_PROXY_SUBNET_DELETE=PASS'
    ;;
  *) fail INVALID_ACTION ;;
esac
