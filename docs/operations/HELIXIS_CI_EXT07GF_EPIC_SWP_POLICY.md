# CI-EXT-07G-F — Exact Epic sandbox next-hop SWP security policy

**State:** policy-only design and guarded operator commands. No paid Secure Web Proxy gateway, Cloud NAT, Cloud Router, next-hop route, firewall allow, Epic OAuth, FHIR data or patient data deployed by this PR. No changes to protected `helixis-epic-sealed-worker` or `g-hims-ai`.

## Verified starting state

Operator on 2026-11-02 reported `CI_EXT07GE_PROXY_SUBNET_CREATE=PASS`, `CI_EXT07GE_PROXY_SUBNET=PASS` and `CI_EXT07GE_DENY_RULE=UNCHANGED`, after enabling `certificatemanager.googleapis.com`. Lab only:
- `helixis-epic-lab-net`, `us-central1`
- private application subnet `helixis-epic-lab-subnet` `10.250.240.0/24`
- dedicated proxy subnet `helixis-epic-lab-proxy-only` `10.250.242.0/23`
- network-wide egress `DENY all 0.0.0.0/0`, priority 1000
- disposable Cloud Run job `helixis-epic-lab-deny-probe`; first execution produced both `reachable=false` to public TCP endpoints without NAT. This **does not establish firewall causality**.

## Security policy

Create a dedicated regional gateway security policy:
- `helixis-epic-lab-policy`: unmatched traffic is implicitly **denied**.
- exactly one rule: `allow-epic-sandbox-https`, priority 100, enabled, `basicProfile=ALLOW`, `sessionMatcher: host() == "fhir.epic.com" && destination.port == 443`.
- No source service-account condition: Google notes Cloud Run Direct VPC egress is not qualified for SWP source-identity matching; use isolated VPC, route tags and independently verified network policy.
- Next-hop SNI matching is **not** FHIR path or verb validation. The Helixis HTTP client must independently pin hostname, HTTPS, request methods and paths, reject redirects and restrict resource types; no backend OAuth token is exposed to clients.
- Do not add a general `ALLOW`, wildcard suffix, URL list or `applicationMatcher` without separate review.

## Guarded policy-only deployment (after review and green checks)

```bash
REPO_DIR="$HOME/helixis-epic-swp-policy-20261102"
git clone --depth=1 --single-branch \
  --branch feat/ci-ext07gf-epic-swp-policy-20261102 \
  https://github.com/irtizah738/G-HIMS-AI.git "$REPO_DIR"
cd "$REPO_DIR" || exit

GHIMS_RUNTIME_MODE=STAGING \
HELIXIS_CI_EXT07GF_CONFIRM_PROJECT=studio-1130431360-48a05 \
bash scripts/ops/ci-ext07gf-epic-swp-policy.sh plan
```

`plan` reads the VPC, firewall, subnets, regional SWP gateways and regional policy inventory. It must return `CI_EXT07GF_PLAN=READY`, `CI_EXT07GF_CLOUD_WRITES=NONE`.

After exact-source review, `create` enables no APIs and creates only the policy/rule:

```bash
GHIMS_RUNTIME_MODE=STAGING \
HELIXIS_CI_EXT07GF_CONFIRM_PROJECT=studio-1130431360-48a05 \
HELIXIS_CI_EXT07GF_ACTION_ACK=CREATE_EPIC_LAB_POLICY_ONLY \
bash scripts/ops/ci-ext07gf-epic-swp-policy.sh create
```

After creation, `verify` checks that there is exactly **one** allow rule with the exact host, port, priority, no application matcher. If create fails after the policy but before the rule, stop and reconcile; **do not run create again**.

### Reversible cleanup if no gateway exists

```bash
GHIMS_RUNTIME_MODE=STAGING \
HELIXIS_CI_EXT07GF_CONFIRM_PROJECT=studio-1130431360-48a05 \
HELIXIS_CI_EXT07GF_ACTION_ACK=DELETE_EPIC_LAB_POLICY_ONLY \
bash scripts/ops/ci-ext07gf-epic-swp-policy.sh destroy
```

The script refuses deletion if *any* regional gateway exists; this is deliberately conservative. Later paid gateway teardown must remove the gateway first, including route, SWP-generated NAT and Cloud Router, before policy removal.

## **Hard NO-GO before billable gateway**

1. Prepare and review a **single executable gateway/route/Cloud NAT+Cloud Router teardown**, including discovery of automatically-generated resource names and failure cleanup.
2. Prove with actual Cloud Run Direct VPC egress traffic that exact SNI `fhir.epic.com:443` can pass and wrong host/port fails; after next-hop route removal or gateway unhealthy, direct bypass remains impossible.
3. Keep existing priority-1000 deny-all egress. **Never introduce broad `ALLOW 0.0.0.0/0` merely to make next-hop work.** If positive traffic cannot coexist with this, stop and redesign. No unverified assumptions about firewall evaluation against next-hop addresses.
4. Timebox the gateway's billable existence with an on-duty operator and explicit teardown, noting Google billing alerts are not a hard cap. Gateway alone is $1.25/hour plus $0.018/GB, Cloud NAT, networking, Cloud Run and logging; two hours is not an absolute spend cap.
5. Do not run new clinical workload, import synthetic FHIR data or enable the original Epic worker until network and vendor OAuth scopes independently qualify.

References:
- https://docs.cloud.google.com/secure-web-proxy/docs/policies-and-rules-overview
- https://docs.cloud.google.com/secure-web-proxy/docs/configure-rules
- https://docs.cloud.google.com/secure-web-proxy/docs/cel-matcher-language-reference
- https://docs.cloud.google.com/secure-web-proxy/docs/deploy-next-hop
- https://docs.cloud.google.com/secure-web-proxy/docs/quickstart
- https://cloud.google.com/secure-web-proxy/pricing
