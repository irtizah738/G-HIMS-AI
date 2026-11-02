# CI-EXT-07G-E — SWP non-intercepting next-hop prerequisites

Status: **candidate operator execution, not gateway deployment**. Source repo: `G-HIMS-AI`. Approval scope: isolated staging network-security lab, maximum two gateway-hours after a separately verified gateway creation + full teardown plan. This phase starts **zero** gateway-hours.

## Why a second subnet?

Google's [SWP initial setup](https://docs.cloud.google.com/secure-web-proxy/docs/initial-setup-steps) requires a `PRIVATE` subnet referenced by the gateway and an independent regional `REGIONAL_MANAGED_PROXY` subnet (recommended `/23`). The previous foundation created only `helixis-epic-lab-subnet` (`10.250.240.0/24`, purpose `PRIVATE`). This PR proposes `helixis-epic-lab-proxy-only` (`10.250.242.0/23`, non-overlapping, `us-central1`, `ACTIVE`); it does not modify the first subnet.

Google also lists `certificatemanager.googleapis.com` as a **required API**. An actual TLS certificate is *optional* for a next-hop SWP that enforces SNI host rules without TLS inspection. Do not create a self-signed certificate, TLS inspection CA, `privateca.googleapis.com` or new IAM grants for this phase.

## Guarded operator workflow

Use the exact `scripts/ops/ci-ext07ge-swp-proxy-subnet.sh` from this PR, only after reviewing final SHA. It checks the isolated VPC, no peering, original private subnet, and unchanged deny-all egress firewall.

```bash
REPO_DIR="$HOME/helixis-epic-proxy-prereq-20261102"
git clone --depth=1 --single-branch \
  --branch feat/ci-ext07ge-swp-proxy-only-subnet-20261102 \
  https://github.com/irtizah738/G-HIMS-AI.git "$REPO_DIR"
cd "$REPO_DIR" || exit

GHIMS_RUNTIME_MODE=STAGING \
HELIXIS_CI_EXT07GE_CONFIRM_PROJECT=studio-1130431360-48a05 \
bash scripts/ops/ci-ext07ge-swp-proxy-subnet.sh plan
```

Expected: `CI_EXT07GE_PROXY_SUBNET_PLAN=READY`, `CI_EXT07GE_GCP_WRITES=NONE`.

After plan and exact-SHA review:

```bash
GHIMS_RUNTIME_MODE=STAGING \
HELIXIS_CI_EXT07GE_CONFIRM_PROJECT=studio-1130431360-48a05 \
HELIXIS_CI_EXT07GE_ACTION_ACK=CREATE_ISOLATED_PROXY_SUBNET \
bash scripts/ops/ci-ext07ge-swp-proxy-subnet.sh create
```

Expected: `CI_EXT07GE_PROXY_SUBNET_CREATE=PASS`, `CI_EXT07GE_PAID_GATEWAY_CLOCK=NOT_STARTED`. If the API enable succeeds but subnet creation fails, the API remains enabled; **do not blindly retry**.

## Recovery and teardown

No actual SWP, NAT or route is managed by this script. Before deleting the proxy-only subnet, **remove the gateway, next-hop routes, automatically created Cloud NAT and Cloud Router**, with separate reviewed teardown. The `destroy` action refuses any regional gateways, lab Cloud Routers, or non-default lab next-hop routes. It does not disable the project-wide Certificate Manager API.

```bash
GHIMS_RUNTIME_MODE=STAGING \
HELIXIS_CI_EXT07GE_CONFIRM_PROJECT=studio-1130431360-48a05 \
HELIXIS_CI_EXT07GE_ACTION_ACK=DELETE_ISOLATED_PROXY_SUBNET \
bash scripts/ops/ci-ext07ge-swp-proxy-subnet.sh destroy
```

**Order:** first paid SWP/route/NAT/Router (if deployed), then proxy-only subnet, then lab Cloud Run job/service-account after archiving evidence and accounting for subnet IP release, then original `ci-ext07gc-lab-foundation.sh destroy`. The original foundation teardown *intentionally refuses* extra subnets and is not suitable until this proxy subnet is removed.

## Stop criteria

- Protected `helixis-epic-sealed-worker` or original `helixis-epic-egress` changed.
- Unexpected lab peering/subnet/firewall state.
- Any proposal to create `ALLOW 0.0.0.0/0` to get SWP to work.
- Missing full SWP/NAT/router cleanup or timed operator response.
- Positive egress when next-hop removed not proven blocked.

**Network caveat:** current Cloud Run negative baseline proves only no successful TCP connection without NAT, not that SWP can route through the priority-1000 EGRESS DENY rule. Actual gateway + route + NAT failure matrix remains an explicit security release gate.

Sources: https://docs.cloud.google.com/secure-web-proxy/docs/initial-setup-steps and https://docs.cloud.google.com/secure-web-proxy/docs/deploy-next-hop and https://docs.cloud.google.com/secure-web-proxy/docs/quickstart
