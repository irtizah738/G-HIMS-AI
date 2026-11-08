# G3–G8 security hardening — checkpoint boundary follow-up

**Scope:** synthetic-only source changes and Firestore emulator/Node regression tests.
**Baseline:** `main@f2fe6465bd8152129c7d1ba7a1b38c1c887beff6`.
**Release:** `NO_GO`. These changes authorize no hosted polling, live FHIR reads, source migration, clinical AI promotion, IAM mutation, network change, or production deployment.

## Review findings and mitigation

### SH-01: legacy source-only checkpoint contract

`checkpointSourcePollLease()` historically accepted a work ID and hash from its caller and checked only the source lease and checkpoint sequence, without verifying the committed resource version, sealed manifest, import event/audit, and HELD outbox in the same transaction.

The function now requires ALL of the following before it can execute:
- `NODE_ENV=test`, `GHIMS_RUNTIME_MODE=TEST`, `FIREBASE_PROJECT_ID=ghims-p4-ci`, and the loopback Firestore emulator address;
- disabled FHIR import and FHIR integration feature states;
- `syntheticOnly: true` in the source snapshot read by the checkpoint transaction.

This legacy function remains only to qualify CI-EXT-11/12 synthetic fixtures. A future hosted runner MUST NOT weaken or remove these guards. It must use an independently reviewed, source+manifest+receipt-bound atomic writer instead. The existing Stage D writer is itself emulator-only and cannot simply be enabled in production.

### SH-02: persisted payload verification at Stage D

`assertStageDCheckpointEvidence()` now verifies the exact `resourceJson` bytes read inside the checkpoint transaction against their SHA-256 `resourceHash`, requires `provenance.contentSha256` to match, enforces the 120,000-byte import limit, parses the bounded resource, and checks `resourceType`, `id`, and `meta.versionId` against the sealed manifest item.

Any mismatch prevents the lease checkpoint, checkpoint event, audit, and outbox writes. Previously committed immutable import evidence is retained for reconciliation. The check detects corrupted receipt bytes; it cannot independently prove vendor-origin authenticity if a privileged writer can replace all related data and signatures.

## Adversarial checks

- Node-native Stage D tests: receipt body tampering, resource hash tampering, provenance hash tampering, oversize payload, and forged resource identity with internally consistent updated hashes.
- Firestore emulator: mutation of imported receipt bytes after import but before checkpoint; verifies checkpoint sequence remains unchanged and no checkpoint event is emitted.
- Firestore emulator: legacy checkpoint refuses a source without `syntheticOnly: true`; refuses `GHIMS_RUNTIME_MODE=PRODUCTION`.
- Existing Stage A–H, CI-EXT-11/12, and ten FHIR emulator suites remain required.

## Independent repository governance (manual settings required)

The active `G-HIMS AI Production Release Protection` ruleset currently requires zero approving reviews, does not require CODEOWNER approval, and does not mandate the dedicated G3–G8 synthetic qualification workflow.

A repository administrator must:
1. Set at least **two independent approving reviews** for security-sensitive changes; enable stale-review dismissal and last-push approval where available.
2. Assign legitimate, independently accountable CODEOWNERS for `lib/clinical/intelligence/external-fhir-*`, `firestore.rules`, `emulator-security/helixis-fhir-*`, `tests/external-fhir-*`, and corresponding workflows. Do not use a placeholder owner or claim author self-review is independent.
3. Require both exact G3–G8 job contexts in the main ruleset, **in addition to** existing mandatory checks:
   - `G3-G8 offline contracts, security and typecheck`
   - `G3-G8 atomicity and synthetic recovery emulator`
4. Verify the ruleset with a fresh test PR and reject merge without passing checks and independently recorded approvals.

These administration changes cannot be established by merging source code or executing tests.

## Remaining production blockers

G1 independent fail-closed source egress identity; G2 hosted orchestration and workload IAM; KMS and key rotation; independently governed witness/trusted time floors; vendor-authenticated FHIR provenance; patient-link clinical governance; evidence-preserving disaster recovery; measured rollback and formal site release approvals.

**Current disposition:** `G3_G8_SECURITY_HARDENING=REVIEW_REQUIRED`, `PRODUCTION_RELEASE=NO_GO`.
