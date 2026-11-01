# CI-EXT-07G-B — Isolated egress routing feasibility and no-bypass plan

**Status: READ-ONLY FEASIBILITY PACKAGE. No gateway or lab created.**
Date: 2026-11-02. Project: `studio-1130431360-48a05` (`us-central1`).
Prerequisites: merged CI-EXT-07F and CI-EXT-07G-A design. This phase
does not authorize any change to the existing worker, VPC, Cloud NAT,
Secret Manager IAM, FHIR source, or import configuration.

## Decision boundary

The candidate architecture is **Secure Web Proxy next-hop mode with TLS
SNI filtering** to the exact synthetic Epic host `fhir.epic.com:443`.
No TLS interception is proposed. Next-hop routing in Google's docs
requires a default internet route and a tagged static or policy-based
next-hop route. A route's existence **does not by itself prove the absence
of a direct internet bypass**. GCP firewall evaluation and routing
selection must be qualified in a *disposable network*, including the case
where SWP or its route disappears.

The staging VPC `helixis-epic-egress` must retain its enabled,
network-wide IPv4 EGRESS DENY `0.0.0.0/0` at priority 1000. If a
next-hop design requires a broad internet ALLOW that leaves direct egress
possible when the proxy is removed, the result is **NO-GO**. Reject the
candidate; don't waive this requirement.

### Non-negotiable restrictions

- Cloud Run `helixis-epic-sealed-worker` stays manual 0 instances,
  no default URL, internal-only ingress; no revision/traffic changes.
- No Epic secret grants, token exchange, FHIR requests/imports, test
  patient data, or OAuth assertions in this phase.
- The lab must be a distinct disposable VPC/subnet and identity, with
  no peering, PSC access, shared NAT/router or ingress link to patient
  systems. No patient-like payloads; use public non-PHI deny tests.
- Distinguish **VM routing proof** from **Cloud Run Direct VPC egress proof**.
  A passing VM test alone cannot qualify the Cloud Run path.
- Google Cloud Direct VPC egress documentation lists unsupported
  firewall-rules logging and per-revision detail in VPC Flow Logs; do
  not invent those evidence sources. Capture separate sanitized probe
  logs, configuration fingerprints, effective rule inventories, and
  proxy decision logs if available.
- Next-hop SNI matching is **host-level only** without TLS inspection.
  HTTP paths and methods must be constrained in the later outbound client.
  DNS rebinding, SNI/Host discrepancy, ECH, wrong ports, QUIC/UDP 443,
  cross-host redirects and route-loss bypass must all be tested.

## 07G-B deliverables

1. Read-only inventory: `scripts/ops/ci-ext07gb-feasibility-readonly.sh`.
   It confirms the worker is still sealed, then captures VPC subnet,
   direct deny rule, effective firewalls, static routes and Cloud Router
   inventories with `gcloud ... describe/list/get-effective-firewalls`
   **only**. It writes a time-unique private local evidence directory
   and SHA-256 manifest. It does not access any secrets or invoke the worker.
2. A versioned approval contract: `config/ci-ext07gb-lab-gates.json`,
   with every infrastructure authorization initially `false` and
   every critical routing assumption `UNVERIFIED`.
3. Automated tests: no-cloud workflow, mock CLI evidence capture,
   fail-closed sealed-worker and deny-rule regression.
4. A **proposed** lab topology and cost/teardown gate; no Terraform apply,
   gcloud resource creation or credential grant in this PR.

### Run the read-only inventory

Only the authorized staging operator should execute:

```bash
cd ~/G-HIMS-AI  # Or your exact checkout of this PR
export GHIMS_RUNTIME_MODE=STAGING
export HELIXIS_CI_EXT07GB_CONFIRM_PROJECT=studio-1130431360-48a05
gcloud config get-value project   # Must be studio-1130431360-48a05
bash scripts/ops/ci-ext07gb-feasibility-readonly.sh
```

Expected: `CI_EXT07GB_READONLY_CAPTURE=PASS`,
`CI_EXT07GB_CLOUD_WRITES=NONE`, and
`CI_EXT07GB_GATE=ISOLATED_NETWORK_PROOF_REQUIRED`.
This is an **inventory gate**, not permission to create a gateway. If a
command lacks permissions, API support, or returns unexpected JSON, stop
and retain the error; do **not** grant broad project roles. The local
directory contains potentially sensitive *infrastructure metadata* and
must not be publicly attached or uploaded.

## Proposed disposable lab after separate approval (07G-C)

```text
[synthetic probe only, isolated VPC/subnet, restricted identity]
       |  (Cloud Run Direct VPC egress; VM comparison separately)
       v
[Tagged static route or source-IP policy route]
       |                       |
       | qualified             | route absent / proxy down
       v                       v
[SWP next-hop, exact SNI]    [DENY direct egress]
       |                       X
       v
[Public non-PHI test endpoint; no Epic calls initially]
```

**Route constraints:** Confirm selected route priority relative to the
default route; network-tag support and revision tags for Cloud Run;
the regional matching requirement; default internet route presence;
firewall precedence; automatic Cloud NAT created by SWP; and whether
source identity matching behaves as expected for Cloud Run. Do not
assume service-account identity is available to the gateway based only
on VM documentation.

The *first* experiment must be a **denied-public-IP test with no SWP
next-hop route**. Prove the disposable source cannot connect directly,
including if an internet default route and auto-NAT exist. Then test
gateway routing and SNI allow/deny (using only non-PHI endpoints),
then deliberately remove the route, disable the gateway, and alter a
policy to demonstrate that direct connectivity remains impossible.
Finally repeat the negative tests from an approved Cloud Run Direct
VPC probe; source VM results cannot substitute. No FHIR calls.

## Negative acceptance matrix

| Fault injection | Required result |
| --- | --- |
| SWP next-hop route absent or removed | Direct public connection DENIED |
| SWP service unavailable | No fallback to internet |
| SWP auto-generated Cloud NAT active | Cannot bypass SWP |
| Default route to internet gateway | Cannot yield direct egress |
| Other VPC firewall ALLOW, inherited policy, priority conflict | NO-GO until eliminated |
| Wrong hostname, subdomain, IP literal, wrong port, absent SNI | DENY |
| ECH/HTTP3/UDP 443, IPv6 | DENY or unsupported with evidence |
| DNS rebinding, alternate resolver, HTTP redirect | No cross-host access |
| Policy removed or changed mid-request | No direct fallback |
| Unexpected service identity or network tags | DENY |
| Any clinical/patient payload in logs | NO-GO, incident handling |
| Failed teardown / residual NAT or proxy billing | NO-GO |

Evidence needs the observed origin, timestamp, request ID, sanitized
destination, proxy decision, firewall/route snapshots, captured
exit/output, SHA-256 hashes and a reviewer signature. A blocked TCP
connection alone is not a causal proof; require gateway logs and
differential tests that isolate each control.

## Cost and teardown approval

Google's published Secure Web Proxy Standard price:
**$1.25 per gateway-hour + $0.0193/GiB**.
A continuously enabled 730-hour month is **$912.50 in gateway charges
alone**, before Cloud NAT, egress bandwidth, log storage, probe compute,
and other costs. A proposed two-hour lab would have **$2.50 in gateway
hourly charges** plus other charges; it is *not* a billing cap or quote.
Cloud Billing budgets notify but generally do **not automatically halt
charges**. Set an operator-controlled end time and teardown procedure.

No lab can be provisioned until finance approves exact resources,
a maximum authorized runtime, budget-alert coverage and cost scope;
security signs the threat matrix; platform signs routing; and a change
ticket names the operator and reviewer.

Teardown order (for a separately approved future lab): disable synthetic
probes; retain sanitized evidence; remove disposable routes and policies;
remove gateway and verify delete completion; inspect/remove owned
auto-generated NAT/router; remove disposable compute, identities,
subnet and VPC **only after verifying ownership and dependencies**;
check zero remaining billable resources and billing reports. Never use
wildcards against the existing Epic staging network. Do not automatically
delete resources if ownership or dependency checks fail.

## Exit criteria for 07G-B

- [ ] Read-only operator inventory captured with immutable hash manifest
- [ ] Inherited/effective route and firewall behavior reviewed
- [ ] Cloud Run compatibility matrix reviewed against official limitations
- [ ] Disposable lab topology audited and security-approved
- [ ] Budget and cost/teardown approval recorded
- [ ] Separate resource-creation change ticket approved

**Until those are complete, CI-EXT-07G-B remains DESIGN / READ-ONLY.**
The next live lab and all GCP mutations are a distinct milestone, not a
side effect of green GitHub tests.

## References

- https://docs.cloud.google.com/secure-web-proxy/docs/deploy-next-hop
- https://docs.cloud.google.com/secure-web-proxy/docs/configure-rules
- https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc
- https://docs.cloud.google.com/secure-web-proxy/docs/use-cloud-nat-for-swp
- https://docs.cloud.google.com/secure-web-proxy/docs/troubleshoot-next-hop-deployment-errors
- https://cloud.google.com/secure-web-proxy/pricing
