# CI-EXT-14 — Full G1 Cloud Run / Secure Web Proxy Qualification

**Status:** EXECUTION PACKAGE ONLY; cloud tests NOT executed; production G1 remains NO-GO.  
**Source milestone:** CI-EXT-12 merged PR #267; CI-EXT-13 draft PR #268 is a separate read-only audit/persistent-manifest track.  
**Owner:** Helixis Security/Networking + SRE + independent reviewer.  
**Date:** 2026-11-05  
**Never use real patients, Epic OAuth secrets, production client IDs, or production FHIR write scopes.**

## Decision boundary

The existing sealed Epic worker on `helixis-epic-egress` has Direct VPC
`all-traffic`, a dedicated SA, manual instances 0, IPv4-only source subnet,
no NAT, and effective deny-all IPv4 egress. The historical
`helixis-ci-gateway-net` R24 GCE-VM SWP lab did **not** show expected
`source.matchServiceAccount()` or secure-tag matching and is frozen.
**Neither network may be altered for this experiment.**

Google's currently documented SWP source support matrix lists
**Direct VPC Cloud Run service-account identity as supported** and secure
tags as unsupported. This warrants a *new*, isolated Cloud Run-specific
experiment, not re-running VM tags.

Full G1 requires **both** (a) workload identity-positive/negative enforcement
by the real next-hop SWP, and (b) proof that direct public internet fallback,
wrong destination, route failure and application-level forwarding attacks
fail closed. Cloud Run TLS success alone and SWP hostname-only denials
**do not satisfy G1**.

## Operational preconditions (block deployment until every one exists)

- [ ] Approved isolated disposable lab VPC name beginning `helixis-g1-`,
  in `studio-1130431360-48a05`, region `us-central1`; *not* either
  existing protected network. New subnets must not overlap existing CIDRs.
- [ ] Security/network change approval and explicit budget+deletion/teardown
  approval recorded outside this public repo.
- [ ] Cloud billing enabled and budget alert set. Google currently lists
  SWP Standard Gateway at **US$1.25/hour**, plus data processing and other
  GCP resources. A budget alert is not an automatic shutoff; delete the
  gateway after qualification.
- [ ] Cloud IAM principal authorized only to deploy disposable network,
  job, gateway, security policy, inspect logs and tear down named resources.
- [ ] Two new, distinct Cloud Run identities: `g1-allow-probe` and
  `g1-deny-probe`; neither has any FHIR/Secret Manager/Firestore permissions.
  Match the same test VPC, subnet, region and routing network tag.
- [ ] Signed image digest of `services/g1-swp-probe` pinned to both jobs.
  One task, max one retry **zero**, short timeout, no secrets, no inbound URL.
- [ ] SWP is NEXT_HOP_ROUTING_MODE on the disposable VPC. Create a
  region-local gateway and dedicated policy; **do not** attach an
  authorization policy that shadows the gateway-security policy.
- [ ] Test route to SWP next-hop ILB on disposable VPC, priority numerically
  less than default route (normally 1000), with network tag restricted to the
  two synthetic jobs. Use Google documented subnet/route constraints.
- [ ] No Cloud NAT, VM public IP or unrelated VPC transit in the test path.
  Audit all effective egress rules: if a TCP 443 allow is needed for SWP,
  scope source identity/tag and route, verify that removed-route fallback
  still fails without NAT. **Do not add a general wildcard source allow**.
- [ ] FHIR activation remains OFF, R24 and sealed worker unchanged.
  No self-approval for final G1 evidence.

Official docs:
- https://docs.cloud.google.com/secure-web-proxy/docs/create-a-policy
- https://docs.cloud.google.com/secure-web-proxy/docs/use-service-accounts
- https://docs.cloud.google.com/secure-web-proxy/docs/deploy-next-hop
- https://docs.cloud.google.com/secure-web-proxy/docs/configure-rules
- https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc
- https://cloud.google.com/secure-web-proxy/pricing

## Proposed policy and workload design

```text
CLOUD RUN JOB allow-SA (synthetic only)        CLOUD RUN JOB deny-SA
  same network / subnet / route tag             same network / subnet / route tag
             \                                  /
                 disposable VPC, Direct VPC all-traffic
                     next-hop ILB route -> SWP
                                |
                     gateway security policy
                         default DENY
             ALLOW source.matchServiceAccount(allow-SA)
               AND host() == 'fhir.epic.com' AND tcp port 443
                                |
                    HTTPS/TLS to public endpoint
```

The exact rule must be verified using Google CEL syntax on the real gateway.
Recommended first version: `source.matchServiceAccount('SERVICE_ACCOUNT') &&
host() == 'fhir.epic.com'` with an explicitly **443-only gateway listener**,
default deny, and no permissive TCP proxy rules. Avoid an unconstrained
`destination.port == 443` TCP ALLOW: that would bypass hostname policy.
The allowed and denied jobs **must share the same network tags and routes**
so only service-account identity distinguishes them.

The probe `services/g1-swp-probe/probe.mjs` opens a TLS handshake without
reading a FHIR resource and never sends OAuth tokens. It is intentionally
bounded to `fhir.epic.com` and `example.com`, with case names only. It
cannot independently decide whether an upstream response was permitted by
the proxy or an unexpected direct path; its output explicitly reports
`swpPolicyEnforcementVerified:false`.

### Build and execute in disposable lab (operator-owned commands)

Only **after** the above approvals and disposable VPC/SWP/route are created
and inspected, build the image using pinned Cloud Build and Artifact Registry
configuration in the disposable staging project. Example deployment
commands below deliberately use **explicit placeholders**, not guessed
network, image or service-account IDs:

```powershell
$PROJECT = "studio-1130431360-48a05"
$REGION = "us-central1"
$JOB_ALLOW = "<approved-disposable-allow-job>"
$JOB_DENY = "<approved-disposable-deny-job>"

# These commands execute only existing disposable test jobs, NOT Cloud Run services.
gcloud run jobs execute $JOB_ALLOW --project=$PROJECT --region=$REGION --args=approved-origin --wait
gcloud run jobs execute $JOB_DENY  --project=$PROJECT --region=$REGION --args=approved-origin --wait

# Authorized identity still must be blocked at unapproved destination.
gcloud run jobs execute $JOB_ALLOW --project=$PROJECT --region=$REGION --args=unapproved-origin --wait
gcloud run jobs execute $JOB_ALLOW --project=$PROJECT --region=$REGION --args=wrong-sni --wait
gcloud run jobs execute $JOB_ALLOW --project=$PROJECT --region=$REGION --args=missing-sni --wait
gcloud run jobs execute $JOB_ALLOW --project=$PROJECT --region=$REGION --args=wrong-port --wait
gcloud run jobs execute $JOB_ALLOW --project=$PROJECT --region=$REGION --args=direct-ip --wait
```

**Beware:** Cloud Run `--args` overrides may be issued only against the
disposable jobs. Do not put a new job on the sealed worker's source VPC.
Also do not infer that a `TLS_BLOCKED_OR_FAILED` probe output proves an
SWP deny: a DNS issue, firewall, route mistake or upstream timeout could
produce the same output. Every positive/negative test needs SWP transaction
logs and Cloud Run execution reference.

## Full G1 acceptance matrix

| ID | Expected | Independent mandatory evidence |
| --- | --- | --- |
| `allowed-service-account` | ALLOW | Approved Cloud Run SA, exact SWP matched-rule, TLS certificate chain verified |
| `denied-service-account` | DENY | Different SA, identical subnet/tag/route; SWP default denied or identity policy denied |
| `wrong-host` | DENY | Allowed SA, `example.com:443` SWP policy DENY |
| `wrong-sni` | DENY | SWP log shows SNI != approved hostname and DENY |
| `missing-sni` | DENY | SWP log shows SNI absent and DENY |
| `wrong-port` | DENY | Non-443 TLS blocked, no direct fallback |
| `direct-ip` | DENY | Application authority/IP literal blocked; SWP SNI alone may not enforce it |
| `redirect-cross-host` | DENY | Synthetic external redirect fixture; FHIR adapter `redirect:'error'`; no token forwarding |
| `dns-rebinding` | DENY | Controlled DNS test fixture; approved-host DNS must not resolve/bypass into private, metadata, unrelated IP |
| `quic-udp443` | DENY | Independent UDP probe plus egress/flow evidence; **no response is not sufficient** |
| `route-removed` | DENY | Snapshot/delete **disposable** next-hop route only; direct fallback fails; restore/teardown verified |
| `gateway-unavailable` | DENY | Synthetic gateway failure, no direct public fallback, post-failure recovery |
| `nat-bypass-attempt` | DENY | No NAT/default public path in disposable VPC; actual blocked attempt and independent route/flow evidence |
| `cross-source-credentials` | DENY | No credentials issued to either probe; independently prove real worker credential/source binding in a later *separate* synthetic integration qualification |

**Important coverage note:** The bounded TLS probe implements the first six
transport cases and direct-IP diagnostics only. Redirect, DNS rebinding,
QUIC, route/gateway outage, NAT bypass and credential confusion require
additional controlled fixtures and witnessed network fault injection.
Do **not** mark full G1 PASS based only on the bundled probe.

The existing G-HIMS-AI FHIR adapter already forces
`redirect:'error'` and bounded responses; this still needs egress worker
endpoint allowlisting, resolver address policy and DNS-rebinding tests.
SWP next-hop without TLS inspection sees HTTPS SNI, not full URL, so SWP
alone cannot enforce all application-level G1 controls.

## Collect and adjudicate evidence

For each job execution:
- Record exact Cloud Run job name, service account, immutable image SHA256,
  execution name, timestamp window and probe `testCase`.
- Correlate exact SWP transaction log with source, expected hostname,
  matched identity rule or default DENY, destination and policy revision.
- Capture sanitized GCP configuration before/after each destructive fault
  scenario; verify no NAT introduction or untagged broad egress grant.
- Keep Cloud Logging correlation refs and file SHA256; never put a raw
  access token, credential, OAuth payload, synthetic patient identifier,
  resource URL query or private certificate in GitHub.
- Cloud Run Direct VPC **does not support VPC Firewall Rules Logging**, and
  flow logs **do not include revision identity**. Use SWP transaction logs,
  Cloud Run execution logs, subnet flow logs and route snapshots together.
- A TLS success without a correlated SWP ALLOW from the authorized SA
  must be considered potential bypass and **STOP**.

The offline completeness checker
`node scripts/ops/ci-ext14-assess-g1-evidence.mjs EVIDENCE.json`
validates the presence and consistency of the 14 mandatory test cases,
change IDs and artifact hashes. It **always** emits
`productionAuthorization:NO_GO` and
`externalGcpEvidenceIndependentlyValidated:false`, even if the candidate
manifest is complete. External security/SRE review must verify log refs,
actual GCP configuration and approvals.

## Stop / cleanup

Stop immediately on any uncorrelated successful external TLS handshake,
unexpected permitted destination, source identity ambiguity, route fallback,
gateway policy override or unexpected NAT/IPv6 egress.

Cleanup is mandatory, even after partial failure:
1. Disable/stop any disposable test jobs; never touch the source worker.
2. Record immutable gateway logs, policy revisions, route/filter snapshots.
3. Delete only exact named disposable jobs, route, SWP gateway, policy/rules,
   subnet and VPC after their dependency-safe order is reviewed.
4. Verify resources no longer exist; retain non-PHI evidence and teardown hash.
5. Confirm source worker remains sealed at manual 0; R24 lab unchanged.
6. Set gate G1 to PASS only after independent signed review; otherwise NO-GO.

**Billing note:** SWP's published Standard Gateway list price is
US$1.25 per hour plus data-processing charges. There may also be Cloud
Run, logging, network and image-build costs; do not present a fabricated
all-in cost. Source: https://cloud.google.com/secure-web-proxy/pricing

**Production status: NO-GO until independent acceptance of the full matrix.**
