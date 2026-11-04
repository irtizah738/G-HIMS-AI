# ADR CI-EXT-08 — Independently authenticated egress for external FHIR

**Date:** 2026-11-05  
**Status:** PROPOSED — design only; no cloud resources deployed or production authorization  
**Owner:** Helixis Clinical Intelligence engineering  
**Related investigation:** R24 Secure Web Proxy next-hop qualification, production NO-GO

## Context and decision boundary

R24 V5/V6/V8 confirmed that TCP/TLS connections from the isolated canary reached the Google Cloud Secure Web Proxy and were denied by hostname or default rules, but neither `source.matchServiceAccount()` nor `source.matchTag()` selected its configured diagnostic source rule. Correct service-account attachment, Resource Manager `GCE_FIREWALL` purpose, VPC scope and effective tag binding were verified. Google's internal reason remains unknown; source-identity enforcement has **not** passed.

**Decision:** Freeze the existing next-hop SWP lab. Implement and qualify a *separate* independently authenticated egress boundary before permitting live external FHIR imports. No new broad firewall ALLOW, no hostname-only authorization, no production toggle changes. The existing application transport and event/provenance contracts must remain unchanged.

## Alternatives

| Candidate | Independent workload authentication | Principal risk | Current recommendation |
| --- | --- | --- | --- |
| Existing next-hop SWP | Cloud-attributed service account or secure tag | R24 identity matching not observed | **NO-GO**, preserve for support |
| Explicit SWP with frontend mTLS | Validated client certificate (SAN-based authorization policy) | Frontend mTLS is Preview, plus proxy deployment/route qualification | Research-only proof of concept |
| Private, dedicated egress broker (Envoy or equivalent) | mTLS from import worker to broker, separate upstream TLS to HIS | Operating CA, cert rotation, broker HA, allowlisting and enforcement correctly | Preferred independent design candidate; **not deployed or qualified** |
| Hospital-local integration gateway | Mutual authentication of hospital-owned local connector and Helixis service | Hospital operational security, unreliable uplink, credential lifecycle | Candidate for hospital HIS without public FHIR API |

Google documents Direct VPC egress with `all-traffic` and VPC firewall policy for Cloud Run. Its public SWP frontend mTLS documentation is marked Preview, applies only in explicit proxy routing, and requires authorization policies rather than ordinary gateway security rules.

References:
- https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc
- https://docs.cloud.google.com/run/docs/securing/security
- https://docs.cloud.google.com/secure-web-proxy/docs/use-frontend-mtls-with-swp

## Proposed trust topology — private egress broker

```text
FHIR import command (tenant, hospital source, resource)
  -> authenticated server session and source/site approval
  -> source-specific work item (no arbitrary URL from client)
  -> isolated import worker (Cloud Run, Direct VPC egress = all-traffic)
       | deny all internet; allow ONLY broker private address/port
       | short-lived, workload-specific client certificate
       v
  private egress broker (mTLS listener; client SAN -> source policy)
       | reject unrecognized certificates and tenant/source mismatch
       | exact FHIR upstream hostname, scheme, port, approved paths
       | DNS/address verification; no redirects; no arbitrary CONNECT
       | independent TLS validation to registered upstream FHIR host
       v
  dedicated gateway egress VPC / controlled Public NAT
       -> approved hospital HIS / Epic FHIR endpoint
       -> immutable FHIR receipt, provenance, held outbox
```

The worker-to-broker certificate authenticates the calling workload; the independently verified source registration authorizes the destination. **Do not treat a certificate, a network tag or a user-supplied sourceId as tenant authorization by itself.** Map the authenticated workload identity to an operator-managed source allowlist, then revalidate tenant, consent, facility and credential revision at the FHIR import transaction.

### Required boundary controls

1. **Network:** Worker has no public interface. Enforce `all-traffic` VPC egress under organizational policy, with deny-by-default egress and a single private broker destination allow. Check fail-closed behavior for bad route, NAT loss, broker failure, VPC fallback, and workloads lacking the permitted network identity. Cloud Run network tags are not cryptographic identities; limit who may edit revisions, networks, tags, firewall rules and IAM.
2. **Certificate identity:** Dedicated private CA, short-lived client certificates, unique SPIFFE-style URI SAN per source workload and environment, strict trust-anchor validation, revoked/expired certificate rejection, reliable rotation and audit. Never store private keys in Firestore, IndexedDB, logs or client applications.
3. **Broker authorization:** Authenticate before establishing upstream connections. Bind identity to an operator-approved `tenantId/sourceId/facilityId` mapping; exact host and port; block IP literals, private/link-local/metadata endpoints, redirects and unapproved DNS answers. DNS alone is insufficient: verify resolved addresses, re-resolve under controlled policy and verify the upstream TLS certificate hostname.
4. **Outbound TLS:** Validate upstream PKI, host and SNI; prohibit insecure certificate bypass, request-body logging, unapproved headers, token forwarding across hostnames, and source EHR writes. Source-specific scopes remain read-only.
5. **Availability and durability:** Work items are idempotent and persisted before execution. A broker outage must retry through the existing bounded outbox, never bypass it. Ensure per-source rate limits, jitter, circuit breakers and explicit human-review status for ambiguous revisions.
6. **Audit and monitoring:** Record broker decision ID, tenant/source and pseudonymous correlation, certificate fingerprint, destination policy ID, response outcome and event receipt hash; do not log tokens, raw FHIR payload, patient identity or PHI.
7. **Isolation:** Use an independent synthetic staging environment; no changes to `studio-1130431360-48a05` next-hop SWP lab until Google escalation is resolved. Data never promoted to native Patient 360 or AI drafting without an independent clinical qualification.

## Qualification gates before any production use

- **Positive:** Valid workload certificate, authorized source and correct upstream DNS/TLS result produce a versioned, immutable external receipt and held outbox; never raw clinical authority.
- **Negative identity:** Missing, expired, revoked, wrong-tenant or wrong-environment certificate fails before upstream connection.
- **Negative destination:** Unauthorized domain, literal IP, metadata/private address, wrong port, unexpected redirect, TLS/SNI mismatch, DNS rebinding and cross-source credential use all fail.
- **Failure-injection:** Broker down, network route removed, NAT unavailable and Cloud Run revision reconfigured must not create direct egress. Include independent firewall and Cloud Logging/VPC Flow Log evidence.
- **Data integrity:** 401/403/429, duplicate/version conflicts, corrections, deletions, consent withdrawal and offline replay preserve immutable imported evidence and held outbox with no silent overwrite.
- **Operational:** Automated certificate rotation and emergency revocation, sealed credentials, least-privilege IAM, budget alerts, regional failover and reproducible rollback passed with independently witnessed evidence.

**Release gate:** No production enablement until all negative controls, fail-closed tests, and clinical consent/site-authority checks are passed and signed.

## Parallel application workstream

Continue using already present modules:
- `lib/interop/fhir-r4-adapter.ts`
- `lib/clinical/intelligence/external-fhir-import.ts`
- `lib/clinical/intelligence/external-patient360-projection.ts`
- `lib/clinical/intelligence/external-clinical-evidence-reader.ts`

First incremental correction-safety change: an `entered-in-error` Observation/Encounter head remains in immutable import history, but its corresponding clinical evidence fact is omitted from the external Patient 360 projection and flagged `RECONCILIATION_REQUIRED`. A later newly imported valid version may restore the fact via a fresh monotonic revision. No native clinical event is automatically authored.

All browser writes to external FHIR source/event/projection collections remain denied by existing `firestore.rules`. No new collection or composite index is necessary for this first slice. Follow-up milestones must address 404/410 tombstones, source deletions, patient merges, pagination and broader normalization without treating missing data as clinical negative findings.

## Decisions explicitly deferred

- No switch to explicit SWP mTLS Preview as a production dependency.
- No deployment of Envoy, gateway, Private CA or NAT in this change.
- No activation of `GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED`, `GHIMS_INTEGRATION_FHIR_R4_STATE=LIVE` or external clinical context/drafting feature flags.
- No claim that a denied transaction proves independent non-bypass under all failure scenarios.

**Disposition:** Architecture selected for independent qualification planning; production stays NO-GO.
