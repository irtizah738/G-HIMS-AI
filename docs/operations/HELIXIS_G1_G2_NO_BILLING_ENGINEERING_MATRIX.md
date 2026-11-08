# Helixis G1/G2 — No-Billing Source Qualification Matrix

**Classification:** source-only architecture, synthetic tests, Firestore emulator and repository review.  
**Production release:** **NO_GO**. A successful GitHub workflow or local emulator is not evidence of Google Cloud network enforcement, vendor authenticity, clinical authorization, or hospital operation.

## Frozen project and financial context

- Dedicated G1 project: `helixis-g1-qual-20261105`, region `us-central1`.
- The operator's read-only CLI reported attached billing account `010843-8EB8AA-7DCAC2` with `open: false` and the Network Security API returning `BILLING_DISABLED`. Project-level `billingEnabled: true` is not proof that the underlying account is open.
- Three projects shared that billing account: `helixis-g1-qual-20261105`, `studio-1130431360-48a05`, `helixis-oidc-recovery-20261102`.
- The regional Network Services read listed an existing next-hop SWP named `helixis-g2-rq-swp`. **Do not create a second gateway or infer this gateway is enforcing policy.**
- The historical `studio-1130431360-48a05` CI-EXT-14 preflight targets a different project and VPC. It must not be run as a substitute for the dedicated project's inventory.
- No billable provisioning, billing status update, route deletion, workload execution, IAM policy mutation, secrets exposure, or production feature activation is approved under this workstream. GitHub Actions may consume CI minutes but do not need GCP billing for the isolated synthetic tests.

## Qualification boundary

| Gate | Work possible without activating Google Cloud billing | What remains impossible to certify offline |
| --- | --- | --- |
| G1 egress source identity | Design reviews; rule/identity allowlist syntax checks on sanitized exported configurations; identity matrix; evidence manifest schemas; test case definitions | Actual SWP identity match from an allowed and denied workload with identical subnet/route; correlated SWP policy logs |
| G1 fail-closed network | Analyze saved VPC topology; audit intended firewall/route constraints; model DNS, IP-literal and QUIC/UDP negative scenarios | Observe real packet outcomes; NAT/direct fallback during route removal or gateway failure; negative-flow/packet evidence |
| G2 orchestration | Pure state-machine and HTTP decision policies; authenticated source-scope contracts; idempotency, retry, bounded backoff, quarantine; Firestore emulator crash/replay/revocation/concurrency tests | Cloud Run job isolation, production service account IAM, live scheduler semantics, real network access, scaled retries and monitoring |
| G3–G8 data integrity | Transactional synthetic receipt/hash/manifest/checkpoint, clinical consent, HELD outbox, restoration rehearsals, Stage H local signed attestations | Real patient/source mapping, real hospital HIS provenance, independent hosted witness, production disaster recovery |
| Cryptography | Ed25519/AES-GCM/HMAC synthetic key-rotation and tamper contracts | Production KMS key residency, IAM separation, key version operations, independent immutable witness storage |
| Security and governance | Static Firestore rules review, negative authorization tests, source-bound schema audit, CI hardening, documentation | Independent pen test, actual vendor/HIS security signoff and authority, protected production release |
| FinOps | Read-only inventories where APIs permit; cost model and deletion plan; check drift in exported inventories | Actual current resource charges, effective enforcement, new budget creation or binding, billed network tests |

## Changes under this PR

### A. Stronger Stage H configured-origin syntax

`external-fhir-poll-hosted-boundary.ts` now refuses IP literal URLs, localhost/metadata/local suffixes, trailing-dot aliases, malformed DNS labels, query strings, nonstandard ports, non-HTTPS schemes and embedded credentials. These checks happen before a trusted witness/clock can validate the synthetic endpoint scope.

**Limit:** syntax validation cannot detect DNS rebinding or public DNS names resolving to private/metadata addresses. A hosted broker must resolve, pin and enforce the actual socket destination, upstream TLS certificate and registered HIS authority. Do not falsely label this as SSRF prevention or G1 egress PASS.

### B. Synthetic G2 HTTP outcome policy

`external-fhir-g2-offline-outcome.ts` provides a pure decision contract with strict `TEST` + loopback emulator + disabled FHIR flags. It cannot open connections, write Firestore, acquire a lease or checkpoint data.

- HTTP 200: request separate immutable receipt + manifest + consent + audit + HELD outbox verification. HTTP status alone never advances a source checkpoint.
- HTTP 401/403: pause source for authorization review, not unbounded credential cycling.
- HTTP 404/410: hold for reconciliation; never treat absence as a patient clinical deletion.
- HTTP 3xx: reject redirects; no cross-host token forwarding.
- HTTP 408/425/429/500/502/503/504: deterministic bounded retry under a five-attempt cap; honor a safe Retry-After and **hold** if the requested delay exceeds the bounded window, instead of shortening the vendor's delay.
- Other or ambiguous responses, exhausted attempts: quarantine with manual review.
- Every returned decision explicitly sets checkpoint/deletion/clinical/migration authorization to `false` and release to `NO_GO`.

These are **planning contracts**, not an operational scheduler. A future hosted implementation must use durable server-time work claims, transactional leases, idempotent commands, safe concurrency limits, poison queues, exact source/tenant credential isolation, audit and human escalation; it must not simply enable this TEST module.

### C. CI

The existing G3–G8 synthetic source workflow runs the new G2 decision tests together with Stage A–H contracts, typecheck, security, transport, Wave 4, and the ten Firestore emulator suites. No GCP credential, service-account token, network request or project resource mutation is permitted. Keep the production release gate returning `NO_GO`.

## Next no-billing engineering queue

1. **Source-only G2 FSM:** durability of work claims, retry intents and poison quarantine; enforce monotonic lease epoch, source revision, facility and tenant identity. Store only immutable, non-PHI evidence in audit logs.
2. **Emulator negative coverage:** duplicate job delivery, lease takeover, commit/ack crash windows, withdrawn patient consent, wrong-source OAuth credential revision, unknown FHIR version, malformed/revised cursor and multi-page failure.
3. **G1 design qualification:** security-reviewed dedicated broker versus current next-hop SWP; never rely on hostname-only SNI or unsupported identity behavior. Maintain an evidence checklist for the actual G1 transport tests after billing recovery.
4. **Production boundary designs:** independently governed KMS, witness, clock, secure credential rotation, WORM retention, DR and rollback. Use mock signatures only for tests and explicitly refuse production claims.
5. **Repository governance:** main ruleset requires zero reviews and lacks the dedicated synthetic workflow jobs as mandatory checks; create real CODEOWNERS only after independent reviewers are identified, configure rule enforcement, and verify via a fresh PR.

## Deferred hosted acceptance matrix

G1 actual workload allow-vs-deny identity, wrong host/SNI, IP literal/private DNS, 443/UDP/QUIC, route removed, SWP unavailable, NAT fallback and indirect forwarding **must** be proven with independent packet/SWP/log correlations.

G2 actual job identity, network isolation, source-approved OAuth scopes, bounded retry, reset/revocation, crash+replay, disconnected source, rate limiting, backpressure, KMS/witness, DR and clinical/hospital approval **must** be proven outside these mocks.

**Decision:** `G1_OFFLINE_DESIGN=IN_PROGRESS`, `G2_SYNTHETIC_CONTRACT=IN_PROGRESS`, `G1_HOSTED=NO_GO`, `G2_HOSTED=NO_GO`, `PRODUCTION_RELEASE=NO_GO`.

## Reference documentation

- Google SWP source identity support: https://docs.cloud.google.com/secure-web-proxy/docs/create-a-policy
- SWP next-hop routing and one-instance-per-VPC-region constraint: https://docs.cloud.google.com/secure-web-proxy/docs/deploy-next-hop
- SWP next-hop HTTPS/SNI host matching: https://docs.cloud.google.com/secure-web-proxy/docs/configure-rules
- Helixis ADR CI-EXT-08: `docs/architecture/ADR-CI-EXT-08-INDEPENDENT-EGRESS-BOUNDARY.md`
