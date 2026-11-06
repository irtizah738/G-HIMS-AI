#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
cat > "$TEMP/gcloud" <<'GCLOUD'
#!/usr/bin/env bash
set -Eeuo pipefail
args="$*"
case "$args" in
  "compute networks describe "*)
    printf '%s\n' '{"autoCreateSubnetworks":false,"peerings":[]}'
    ;;
  "compute firewall-rules describe "*)
    printf '%s\n' '{"disabled":false,"direction":"EGRESS","priority":1000,"network":"projects/studio-1130431360-48a05/global/networks/helixis-epic-lab-net","destinationRanges":["0.0.0.0/0"],"denied":[{"IPProtocol":"all"}]}'
    ;;
  "compute networks subnets describe "*)
    if [[ "$args" == *helixis-epic-lab-proxy-only* ]]; then
      printf '%s\n' '{"purpose":"REGIONAL_MANAGED_PROXY","ipCidrRange":"10.250.242.0/23","network":"projects/studio-1130431360-48a05/global/networks/helixis-epic-lab-net"}'
    else
      printf '%s\n' '{"purpose":"PRIVATE","ipCidrRange":"10.250.240.0/24","network":"projects/studio-1130431360-48a05/global/networks/helixis-epic-lab-net"}'
    fi
    ;;
  "network-security gateway-security-policies list "*)
    if [[ "${STUB_TLS_DRIFT:-}" == 1 ]]; then
      printf '%s\n' '[{"name":"projects/studio-1130431360-48a05/locations/us-central1/gatewaySecurityPolicies/helixis-epic-lab-policy","tlsInspectionPolicy":"unexpected"}]'
    else
      printf '%s\n' '[{"name":"projects/studio-1130431360-48a05/locations/us-central1/gatewaySecurityPolicies/helixis-epic-lab-policy","tlsInspectionPolicy":""}]'
    fi
    ;;
  "network-security gateway-security-policies rules list "*)
    MATCH='host() == "fhir.epic.com" && destination.port == 443'
    if [[ "${STUB_MATCH_DRIFT:-}" == 1 ]]; then
      MATCH='host() == "fhir.epic.com"'
    fi
    jq -n --arg match "$MATCH" '[
      {name:"projects/studio-1130431360-48a05/locations/us-central1/gatewaySecurityPolicies/helixis-epic-lab-policy/rules/allow-epic-sandbox-https",enabled:true,priority:100,basicProfile:"ALLOW",sessionMatcher:$match,applicationMatcher:"",tlsInspectionEnabled:false}]'
    ;;
  *)
    printf 'UNEXPECTED_CLOUD_COMMAND=%s\n' "$args" >&2
    exit 42
    ;;
esac
GCLOUD
chmod +x "$TEMP/gcloud"
export GHIMS_RUNTIME_MODE=STAGING
export HELIXIS_CI_EXT07GF_CONFIRM_PROJECT=studio-1130431360-48a05
export PATH="$TEMP:$PATH"
SCRIPT="$ROOT/scripts/ops/ci-ext07gf-epic-swp-policy.sh"

bash -n "$SCRIPT"
out="$(bash "$SCRIPT" verify)"
grep -Fxq 'CI_EXT07GF_POLICY=PASS' <<< "$out"
grep -Fxq 'CI_EXT07GF_DEFAULT=DENY_UNMATCHED' <<< "$out"
if STUB_MATCH_DRIFT=1 bash "$SCRIPT" verify >"$TEMP/mismatch.out" 2>&1; then
  echo 'FAIL: Wrong matcher was accepted' >&2; exit 1
fi
grep -Fq 'CI_EXT07GF_FAILED=POLICY_RULES_NOT_EXACT' "$TEMP/mismatch.out"
if STUB_TLS_DRIFT=1 bash "$SCRIPT" verify >"$TEMP/tls.out" 2>&1; then
  echo 'FAIL: TLS inspection policy drift was accepted' >&2; exit 1
fi
grep -Fq 'CI_EXT07GF_FAILED=POLICY_IDENTITY_OR_TLS_MISMATCH' "$TEMP/tls.out"
printf 'CI_EXT07GF_MOCK_VERIFICATION_TESTS=3_PASS\n'
