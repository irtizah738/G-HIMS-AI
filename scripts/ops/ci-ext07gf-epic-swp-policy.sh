#!/usr/bin/env bash
# CI-EXT-07G-F: prepare policy and exact HTTPS Epic-sandbox allow rule.
# Does not create SWP gateway, Cloud NAT/Router, routes, firewall, IAM, or FHIR requests.
set -Eeuo pipefail
set +x
umask 077

PROJECT=studio-1130431360-48a05
REGION=us-central1
NETWORK=helixis-epic-lab-net
POLICY=helixis-epic-lab-policy
RULE=allow-epic-sandbox-https
MATCH='host() == "fhir.epic.com" && destination.port == 443'

fail(){ printf 'CI_EXT07GF_FAILED=%s\n' "$1" >&2; exit 1; }
[[ "${GHIMS_RUNTIME_MODE:-}" == STAGING ]] || fail STAGING_RUNTIME_REQUIRED
[[ "${HELIXIS_CI_EXT07GF_CONFIRM_PROJECT:-}" == "$PROJECT" ]] || fail PROJECT_CONFIRMATION_REQUIRED
for bin in gcloud jq; do command -v "$bin" >/dev/null || fail "TOOL_MISSING_$bin"; done

# Do not touch the serving Epic VPC or worker; require the disposable lab controls.
gcloud compute networks describe "$NETWORK" --project="$PROJECT" --format=json |
  jq -e '.autoCreateSubnetworks==false and ((.peerings//[])|length==0)' >/dev/null ||
  fail LAB_NETWORK_NOT_ISOLATED
gcloud compute firewall-rules describe helixis-epic-lab-deny-egress --project="$PROJECT" --format=json |
  jq -e --arg n "$NETWORK" '
    .disabled==false and .direction=="EGRESS" and .priority==1000 and
    (.network | endswith("/networks/"+$n)) and
    (.destinationRanges|index("0.0.0.0/0")!=null) and
    any(.denied[]; .IPProtocol=="all")' >/dev/null ||
  fail LAB_DENY_NOT_VERIFIED
for item in 'helixis-epic-lab-subnet|PRIVATE|10.250.240.0/24' 'helixis-epic-lab-proxy-only|REGIONAL_MANAGED_PROXY|10.250.242.0/23'; do
  IFS='|' read -r name purpose cidr <<< "$item"
  gcloud compute networks subnets describe "$name" --project="$PROJECT" --region="$REGION" --format=json |
    jq -e --arg n "$NETWORK" --arg p "$purpose" --arg c "$cidr" '
      .purpose==$p and .ipCidrRange==$c and (.network|endswith("/networks/"+$n))' >/dev/null ||
    fail "LAB_SUBNET_MISMATCH_$name"
done

policies(){ gcloud network-security gateway-security-policies list --project="$PROJECT" --location="$REGION" --format=json; }
gateways(){ gcloud network-services gateways list --project="$PROJECT" --location="$REGION" --format=json; }
rules(){ gcloud network-security gateway-security-policies rules list --project="$PROJECT" --location="$REGION" --gateway-security-policy="$POLICY" --format=json; }

require_no_regional_gateways() {
  local g; g="$(gateways)" || fail GATEWAY_INVENTORY_UNAVAILABLE
  printf '%s' "$g" | jq -e 'type=="array" and length==0' >/dev/null ||
    fail EXISTING_GATEWAYS_REQUIRE_REVIEW
}
require_no_policy_collision() {
  local p; p="$(policies)" || fail POLICY_INVENTORY_UNAVAILABLE
  printf '%s' "$p" |
    jq -e --arg id "/gatewaySecurityPolicies/$POLICY" '
      type=="array" and all(.[]; (.name|endswith($id)|not))' >/dev/null ||
    fail POLICY_ALREADY_EXISTS
}
verify() {
  local p r
  p="$(gcloud network-security gateway-security-policies describe "$POLICY" --project="$PROJECT" --location="$REGION" --format=json)" ||
    fail POLICY_LOOKUP_FAILED
  printf '%s' "$p" | jq -e --arg tail "/gatewaySecurityPolicies/$POLICY" '
    .name|endswith($tail)' >/dev/null || fail POLICY_IDENTITY_MISMATCH
  r="$(rules)" || fail RULE_INVENTORY_UNAVAILABLE
  printf '%s' "$r" | jq -e --arg id "/rules/$RULE" --arg match "$MATCH" '
    type=="array" and length==1 and
    (.[0].name|endswith($id)) and
    (.[0].enabled==true) and
    (.[0].priority==100) and
    (.[0].basicProfile=="ALLOW") and
    (.[0].sessionMatcher==$match) and
    ((.[0].applicationMatcher//"")=="")
  ' >/dev/null || fail POLICY_RULES_NOT_EXACT
  echo 'CI_EXT07GF_POLICY=PASS'
  echo 'CI_EXT07GF_ALLOW_RULE=EPIC_SANDBOX_HTTPS_ONLY'
  echo 'CI_EXT07GF_DEFAULT=DENY_UNMATCHED'
  echo 'CI_EXT07GF_GATEWAY=NOT_MANAGED_BY_POLICY_SCRIPT'
}

case "${1:-plan}" in
  plan)
    require_no_regional_gateways
    require_no_policy_collision
    echo 'CI_EXT07GF_PLAN=READY'
    echo "CI_EXT07GF_MATCH=$MATCH"
    echo 'CI_EXT07GF_CLOUD_WRITES=NONE'
    ;;
  create)
    [[ "${HELIXIS_CI_EXT07GF_ACTION_ACK:-}" == CREATE_EPIC_LAB_POLICY_ONLY ]] ||
      fail CREATE_ACK_REQUIRED
    require_no_regional_gateways
    require_no_policy_collision
    dir="$(mktemp -d)"
    trap 'rm -rf "$dir"' EXIT
    cat > "$dir/policy.yaml" <<EOF
name: projects/$PROJECT/locations/$REGION/gatewaySecurityPolicies/$POLICY
description: Isolated Epic sandbox SNI-only experiment, default deny
EOF
    cat > "$dir/rule.yaml" <<EOF
name: projects/$PROJECT/locations/$REGION/gatewaySecurityPolicies/$POLICY/rules/$RULE
description: Allow only exact Epic sandbox SNI on HTTPS port 443
enabled: true
priority: 100
basicProfile: ALLOW
sessionMatcher: '$MATCH'
EOF
    gcloud network-security gateway-security-policies import "$POLICY" \
      --source="$dir/policy.yaml" --project="$PROJECT" --location="$REGION"
    gcloud network-security gateway-security-policies rules import "$RULE" \
      --source="$dir/rule.yaml" --gateway-security-policy="$POLICY" \
      --project="$PROJECT" --location="$REGION"
    verify
    echo 'CI_EXT07GF_POLICY_CREATED=PASS'
    echo 'CI_EXT07GF_PAID_GATEWAY_CLOCK=NOT_STARTED'
    ;;
  verify)
    verify
    ;;
  destroy)
    [[ "${HELIXIS_CI_EXT07GF_ACTION_ACK:-}" == DELETE_EPIC_LAB_POLICY_ONLY ]] ||
      fail DELETE_ACK_REQUIRED
    require_no_regional_gateways
    verify
    gcloud network-security gateway-security-policies rules delete "$RULE" \
      --gateway-security-policy="$POLICY" --project="$PROJECT" --location="$REGION" --quiet
    gcloud network-security gateway-security-policies delete "$POLICY" \
      --project="$PROJECT" --location="$REGION" --quiet
    require_no_policy_collision
    echo 'CI_EXT07GF_POLICY_REMOVED=PASS'
    ;;
  *) fail UNKNOWN_ACTION ;;
esac
