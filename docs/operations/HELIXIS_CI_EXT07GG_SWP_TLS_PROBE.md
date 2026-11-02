# CI-EXT-07G-G — Epic Secure Web Proxy next-hop TLS-only probe

**Status: designed and code tested in CI only; NOT deployed, NOT executed against the live gateway.** All data is synthetic lab metadata; no authentication, FHIR payload, patient ID or HTTP request.

## Current evidence

As of 2026-11-02 the operator has verified:
- disposable isolated VPC `helixis-epic-lab-net`, PRIVATE subnet `10.250.240.0/24` and `REGIONAL_MANAGED_PROXY` subnet `10.250.242.0/23`.
- protected deny-all `0.0.0.0/0` priority 1000, original Epic worker sealed, no SWP gateway.
- regional policy `helixis-epic-lab-policy` and sole rule `allow-epic-sandbox-https` verified with `gcloud ... policies list` and `rules list`. Rule: exact `host() == "fhir.epic.com" && destination.port == 443`, no TLS inspection.
- Cloud Run negative baseline `helixis-epic-lab-deny-probe-m9tmk` reached neither `1.1.1.1:443` nor `1.0.0.1:443`. This does **not** prove firewall causality (no NAT) or proxy path.
- fixed verifier PR #259 must be merged/reviewed independently; the old policy import script's post-import `describe` was unsupported, but cloud policy/rule were created successfully and independently reverified.

## Why a different test is required

The first probe only tries public TCP. A next-hop gateway can permit a TCP connection before applying SNI checks, so an unapproved `connect` success/failure alone does not establish hostname policy enforcement.

This probe performs **TLS handshake only**, with zero application bytes or HTTP/FHIR data:
1. Positive: `fhir.epic.com:443`, SNI exact, strict trusted certificate. Expected `tlsConnected=true`.
2. Negative: `www.google.com:443` with matching SNI. Expected `false`.
3. Negative: `fhir.epic.com:443` with intentionally wrong SNI `www.google.com`. Expected `false`.

The two negative scenarios set `rejectUnauthorized=false` **only for this zero-payload test**, so a certificate mismatch does not falsely count as a network policy denial. No tokens, credentials or HTTP bodies are sent. Positive Epic still strictly validates its certificate.

**Limits:** Network failure or upstream SNI rejection can look like an SWP deny. Even a green result does not establish route causality, absence of a direct fallback, or gateway-only NAT behavior. Need independent SWP connection/decision logs, tagged-route inventory, and intentional route loss. Do not promote this alone to a security qualification.

## Local tests, build only

Source is fixed to `services/epic-egress-probe/swp-tls-probe.mjs` and immutable Node base in `Dockerfile.swp-tls`. No cloud credentials in the image.

```bash
cd "$HOME/helixis-epic-swp-probe-20261102" || exit 1
node --test tests/ci-ext07gg-swp-tls-probe.test.mjs
PROJECT=studio-1130431360-48a05
gcloud builds submit services/epic-egress-probe \
  --project="$PROJECT" --region=us-central1 \
  --config=services/epic-egress-probe/cloudbuild.swp-tls.yaml
```

Building is **not** gateway provisioning. Record actual immutable Artifact Registry SHA-256 digest from Cloud Build; never deploy using mutable `:ci-ext07gg-v1` tag.

## Future execution — intentionally NOT included in this PR

- Deploy a *distinct* job `helixis-epic-lab-swp-tls-probe` using `--network=helixis-epic-lab-net --subnet=helixis-epic-lab-subnet --network-tags=helixis-epic-lab-probe --vpc-egress=all-traffic`, pinned image digest, isolated keyless lab identity, max retries 0, task timeout 60s. Explicit `SWP_TLS` mode only. **Do not update the earlier denied-TCP baseline job.**
- No gateway should be provisioned until a **tested, executable SWP/next-hop route/auto-generated Cloud NAT+Router teardown** exists. Cloud Shell disconnections and billing alerts do not enforce two hours. Each test must be in a bounded operator-owned window.
- Google documents tagged static route with next-hop ILB, numeric priority <1000, `0.0.0.0/0` destination and same-region source. Preserve original priority-1000 DENY. **Do not add broad ALLOW `0.0.0.0/0`** to force traffic. If positive Epic TLS cannot coexist with fail-closed egress, STOP, reject this design.
- When gateway is installed, verify the network tag applied **on the Cloud Run job execution**, exact route and policy, and SWP logs; intentionally remove the tagged route while checking unapproved hosts remain blocked. The default internet route persists, but must not become an allowed bypass.
- When testing is done, order teardown: tagged static route -> gateway -> auto-generated Cloud NAT on its associated router -> router -> security policy/rule -> proxy-only subnet -> Cloud Run probe and account -> lab VPC foundation. Inventory each resource and fail closed on unexpected ownership. Allow Cloud Run IP release lag and avoid removing DENY prematurely.
- Never contact Epic's FHIR endpoints or change the original worker in this network-only experiment.

References:
- https://docs.cloud.google.com/secure-web-proxy/docs/deploy-next-hop
- https://docs.cloud.google.com/secure-web-proxy/docs/configure-rules
- https://docs.cloud.google.com/secure-web-proxy/docs/quickstart
- https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc
