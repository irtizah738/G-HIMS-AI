# CI-EXT-07G-C — Isolated disposable Epic egress lab (foundation only)

**State:** operator execution required. The founder approved a temporary **maximum two gateway-hour** *isolated network-security experiment* on 2026-11-02. This is **not** authorization to change the serving Epic worker or existing network. It does not override independent security review, and cost is not hard-capped by Google Cloud.

## Fixed scope

- Project: `studio-1130431360-48a05`, region: `us-central1`.
- Fresh dedicated VPC `helixis-epic-lab-net`, IPv4-only subnet `helixis-epic-lab-subnet` CIDR `10.250.240.0/24`, and deny-all EGRESS firewall `helixis-epic-lab-deny-egress`.
- The foundation script creates **no** Secure Web Proxy, Cloud NAT, router, route exceptions, probe, IAM grant, secret, clinical import, or Epic HTTP request.
- Existing `helixis-epic-egress` VPC, `helixis-epic-deny-egress`, and `helixis-epic-sealed-worker` remain unchanged, and the script checks sealed-worker invariants before acting.
- Default internet routes are not proof of reachable internet; deny-all firewall is an initial condition, **not** a packet-level causal proof.

## Reviewed operator workflow

Use the branch in this PR (not production main until merged). The code was syntax-checked locally with `bash -n`; actual Cloud Shell success is **not** yet claimed.

```bash
REPO_DIR="$HOME/helixis-epic-lab-20261102"
git clone --depth=1 --single-branch \
  --branch feat/ci-ext07gc-isolated-epic-egress-lab-20261102 \
  https://github.com/irtizah738/G-HIMS-AI.git "$REPO_DIR"
cd "$REPO_DIR" || exit

export GHIMS_RUNTIME_MODE=STAGING
export HELIXIS_CI_EXT07GC_CONFIRM_PROJECT=studio-1130431360-48a05

bash scripts/ops/ci-ext07gc-lab-foundation.sh plan

# Only after reading the plan; creates isolated resources, NOT the proxy.
export HELIXIS_CI_EXT07GC_ACTION_ACK=CREATE_DISPOSABLE_DENY_ONLY_LAB
bash scripts/ops/ci-ext07gc-lab-foundation.sh create
unset HELIXIS_CI_EXT07GC_ACTION_ACK

bash scripts/ops/ci-ext07gc-lab-foundation.sh verify
```

Expected create result: `CI_EXT07GC_FOUNDATION_CREATE=PASS`, `CI_EXT07GC_LAB_DENY=PASS`, `CI_EXT07GC_GATEWAY=NOT_CREATED`, `CI_EXT07GC_PAID_GATEWAY_CLOCK=NOT_STARTED`. If plan returns collision, stop and review; do **not** adopt or overwrite unknown resources. If create fails partially, retain the error, do not assume rollback occurred.

### Foundation-only cleanup

Before attaching any gateway or probe, the guarded cleanup is:

```bash
export HELIXIS_CI_EXT07GC_ACTION_ACK=DELETE_DISPOSABLE_LAB_FOUNDATION
bash scripts/ops/ci-ext07gc-lab-foundation.sh destroy
unset HELIXIS_CI_EXT07GC_ACTION_ACK
```

Cleanup aborts on unexpected routes/rules/peering/subnet dependencies. It removes the subnet **before** deleting the deny rule so attached workloads cannot accidentally lose the deny boundary. Do not force deletion of unknown dependencies. If a paid gateway is subsequently installed, its own independently reviewed teardown **including Cloud NAT and Cloud Router** must happen **before** foundation cleanup.

## Before provisioning the paid Secure Web Proxy (future controlled phase)

1. Independent infrastructure/security review, no-bypass routing design, actual Cloud Run Direct VPC probe image/config and network authorization.
2. Review executable gateway **and** automatic Cloud NAT/Cloud Router deletion steps before creation. Establish operator and cover, timestamp, two-hour end time, spend visibility and abort conditions. **Cloud Shell disconnection or budget alerts cannot enforce a two-hour lifetime.**
3. SWP Standard is $1.25/hour **plus** processing, egress, NAT, Cloud Run and logging. Provision only when operator is ready to test and immediately tear down; never claim two gateway-hours is a hard spend limit.
4. Mandatory negative tests: default route/direct-IP, gateway and route removal, inherited firewall priority, wrong SNI/host/port, IPv6 and UDP/443, redirect/rebinding, source identity and cross-network isolation. Confirm positive HTTPS only through approved gateway, with no credentials or patient-like payloads.
5. **NO-GO:** if a broad EGRESS allow to `0.0.0.0/0` is needed to make SWP work, do not weaken the deny firewall. Choose a different egress architecture. Keep original worker disabled.

Docs:
- https://docs.cloud.google.com/secure-web-proxy/docs/deploy-next-hop
- https://docs.cloud.google.com/secure-web-proxy/docs/configure-rules
- https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc
- https://docs.cloud.google.com/secure-web-proxy/docs/quickstart
- https://cloud.google.com/secure-web-proxy/pricing
