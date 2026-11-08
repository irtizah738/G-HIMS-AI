# Helixis Clinical Intelligence — Stage H: Integration boundary (offline contract)

**Classification:** test-only engineering qualification. No hosted KMS, external witness, real HIS pagination origin, or trusted-time service has been verified. **Production release: NO_GO.**

## Why Stage H exists

Stages C–G qualify encrypted synthetic manifests, atomic checkpoint/replay, multi-item recovery, and signed cursor/witness *local simulations*. A signed local fixture is not evidence that a real HIS issued the cursor, nor that a public key was pinned independently, nor that a witness survived regional disaster. Stage H specifies and adversarially tests what a hosted boundary must prove **before** any credentialed connector or production authority is allowed.

## Contract components

- `lib/clinical/intelligence/external-fhir-poll-hosted-boundary.ts`: no network, Firestore, IAM, KMS, or deployment calls. Exposes asynchronous `StageHClockPort`, `StageHWitnessPort`, and `StageHVendorOriginPort`. Every port's result is treated as **untrusted** until checked against signatures and an independently pinned key root.
- **Key registry:** exact-version canonical JSON; root-signed Ed25519; unique ID/purpose and bounded validity; monotonic `registryRevision` floor; supports overlapping signing key versions during rotation; rejects revoked or retired keys even when proofs are backdated.
- **Trusted clock contract:** verifier-origin 256-bit unpredictable challenge; root-registry-pinned Ed25519 clock signer; strictly increasing clock sequence and separately retained time floor; binds all proof validity windows. This **does not** constitute independent time infrastructure.
- **Witness contract:** nonce- and scope-bound signed current head containing the exact Stage G certificate fingerprint, sequence, predecessor, and witness ID. The witness identity must be rooted in independently approved deployment IAM and immutable independent storage before production.
- **Vendor-origin contract:** signed synthetic adapter evidence binds exact FHIR source URL, tenant/facility/source revision, Stage G certificate fingerprint and all ordered page digests. Only `TEST_SIGNED_FIXTURE_ONLY` is accepted in this implementation. A real FHIR server is **not** required to sign pagination cursors by the FHIR standard. Production provenance must be established independently (approved gateway TLS/mTLS, credential-bound request/response hashes, chain of custody, vendor-specific signed responses where available).
- **Release return:** `LOCAL_INTEGRATION_CONTRACT_VALIDATED`, `productionRelease: NO_GO`. No checkpoint, source-mode or patient document writes are possible through this module.

## Data protection and trust boundaries

There are no new Firestore collections, rules or indexes. Stage H contracts operate on opaque signed hashes and scopes; do not serialize raw cursor tokens, access tokens, clinical payloads, patient identifiers, private keys or signing credentials in Firestore, logs or CI artifacts.

The root public key and the clock/registry/witness monotonic floors are **inputs that must come from an independently governed trust domain**. They are not fetched from the same Firestore backup, user request, or adapter whose response is being authenticated. If the attacker can substitute the root, replace the clock floor, or sign all three adapter proofs, this contract cannot detect the compromise. Same-machine synthetic test keys do not satisfy this separation.

Stage H is deliberately **not** wired to auto-authorize Stage F/G imports or migration. To ship a hosted service, implement an independently deployed verifier with authenticated workload identity, independent durable witness storage, KMS-managed asymmetric keys, registered key versions and a verified clock; re-read a fresh signed witness head after any non-atomic external transition. Firestore-to-witness operations do not form a distributed atomic transaction. Use an explicit prepare/confirm protocol with a crash-safe reconciliation journal and finalization idempotency rather than assuming two-phase commit.

## Failure and negative scenarios tested

62 Stage H local tests cover: changed root/registry, forged signatures, signature purpose substitution, retired and revoked signing keys, key rotation, replayed challenges, clock rollback, stale proof timestamps, certificate expiry, cross-source/tenant/facility substitution, HTTPS endpoint downgrade, missing and stale independent witness, tampered page digest, fake vendor origin, and fail-closed production/emulator guards. Prior A–G tests remain required and must be rerun.

The existing ten Firestore emulator suites are retained as a separate qualification gate. Stage H adds **no new Firestore integration case**, because it is a pure untrusted-provider verification boundary and performs no data writes.

## GitHub CI and consolidation

A **new pull-request-only workflow** `.github/workflows/helixis-g3-g8-offline-qualification.yml` runs the contract tests, repository typecheck/quality, legacy ephemeral-only security suite, and all ten Firestore emulator suites. It uses only the synthetic project `ghims-p4-ci`, no OIDC grants, no cloud credentials, no live FHIR endpoint or deployment steps. GitHub-hosted Actions can consume plan minutes; the user initiates a PR and is responsible for any resulting CI usage. Do not confuse GitHub CI with G1/G2 hosted-runner qualification.

Review all C–H changes as one local development commit using `scripts/ops/helixis-g3-g8-stage-for-review.ps1` after the Windows one-go suite reports PASS. The helper defaults to staging and displaying diffs; `-CreateCommit` is an explicit local action. It never pushes or merges. Review source changes, security rules and workflow before PR.

## Remaining NO_GO gates

1. G1: qualified source-identity enforcement of allowlisted secure egress and explicit denial outside that source; prior next-hop SWP service-account matching was not supported in the observed lab topology.
2. G2: hosted poll runner, isolated workload identity, egress qualification, zero real-data exposures, safe retries and DR.
3. Production KMS: real key provisioning, least-privilege IAM, rotation, revocation, audit, regional availability and key backup/escrow policy.
4. Independent trusted time: deployed cryptographically authenticated monotonic time authority and cross-region rollback safety.
5. Independent witness: off-project append-only/WORM retention, tamper/restore drill, producer/verifier separation and independent RPO/RTO validation.
6. Authentic HIS provenance: vendor-specific FHIR API behavior and source-specific HTTP/TLS, pagination, patient matching and consent evaluation.
7. Hospital-0 `RESOURCE`/`RESOURCE_MASTER` mapping, ephemeral-only security suites, real clinical evaluation and formal release approvals.

**Release classification is invariant:** `GOOGLE_CLOUD_MUTATIONS=NONE`, `SOURCE_FENCED_MIGRATION=NOT_PERFORMED`, `PRODUCTION_RELEASE=NO_GO`, `STAGE_H_ONE_GO=PASS_LOCAL_ONLY` only after the Windows runner passes.
