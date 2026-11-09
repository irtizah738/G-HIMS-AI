# CI-EXT-21 — Signed hospital authority consumption and unsigned-legacy cutover

**Status:** exact-head synthetic emulator source qualification. **NO_GO** for any real clinical operation, patient-chart promotion, AI drafting, or hosted environment. Stacked on the CI-EXT-20 draft branch; upstream CI-EXT-15/16 parent review remains incomplete.

## Architectural correction

An append-only domain event only proves an internal audit sequence. A mutable hospital credential/site head marked `HOSPITAL_VERIFIED` is *not* institutional evidence, even when it has a matching event hash. CI-EXT-20 added Ed25519 signed enrollment but did not force the existing CI-EXT-18/19 consumers to use it. CI-EXT-21 now **removes the unsigned legacy consumption path**.

The same Firestore transaction that reads current patient consent, source version, approval and site authority also reads independently signed issuer provenance. For each credential-evidence record and every proposer/approver governance grant, the server verifies:

1. Exact `issuerAttestationId`, `issuerId`, `issuerKeyId`, `issuerKeyRevision`, `issuerClaimDigest`, `issuerSpkiFingerprint`, `immutableSourceEvent=true`, and non-promoting flags.
2. A currently valid and independently pinned hospital Ed25519 public key. The pin is **never** read from the attested claim or any mutable Firestore tenant collection. The source code currently has **no production trust provider**. A test-only in-memory resolver is enabled under explicitly guarded `TEST` + `ghims-p4-ci` + localhost Firestore emulator configuration.
3. Signed `externalClinicalIssuerAttestations/{attestationId}` and matching immutable `externalClinicalIssuerEnrollmentCommands/{attestationId}` plus `externalClinicalIssuerOutbox/{attestationId}` still in `HELD` state. Missing/journal-swapped/forged/mismatched records deny.
4. Actual Ed25519 signature over domain-separated canonical issuer claim, matching pinned SPKI SHA-256 fingerprint and key revision, tenant/facility/issuer IDs, purpose, valid time, non-revoked trust pin, and claim-bound professional license/site contract/hospital grant scope.
5. Exact derived evidence or grant fields: clinician/registered site subject, evidence hash, source `siteApprovalId`, verifier, verification time, valid window; or one matching hospital officer role, permission and MFA attestation.
6. Existing CI-EXT-18/19 independent proposer/approver and immutable governance event/proposal chain, exact source and consent fences, and CI-EXT-17 fact approval lineage.

The write/approval entry points are also checked. CI-EXT-18 proposals, dual-actor activation and clinical-safety revocation require current signed grants; proposal and activation require signed external evidence. CI-EXT-19 preflight and CI-EXT-17 fact approval issuance/replay reject unsigned evidence and expired/revoked issuer anchors. **Do not add a backward-compatibility `allowUnsigned` flag.**

## Firestore data model and indexes

Tenant-scoped direct document reads, with no additional composite indexes:

- `tenants/{tenantId}/externalClinicalIssuerAttestations/{attestationId}`: signed source claim, issuer key/revision/fingerprint, canonical claim digest, signature and exact derived-record ID.
- `tenants/{tenantId}/externalClinicalIssuerEnrollmentCommands/{attestationId}`: immutable event-type/idempotency journal.
- `tenants/{tenantId}/externalClinicalIssuerOutbox/{attestationId}`: append-only `HELD` outbox. No externally published issuer authority.
- `tenants/{tenantId}/externalClinicalAuthorityEvidence/{evidenceId}`: derived credential/site proof with precise immutable issuer attestation pointer and fingerprint.
- `tenants/{tenantId}/externalClinicalGovernanceGrants/{actorId}`: purpose-limited officer grant with attestation pointer.
- `tenants/{tenantId}/externalClinicalCredentialHeads/{actorId}`, `externalClinicalSiteAuthorityHeads/{sourceId}`: current derived heads, never sufficient without all evidence above.

Every collection remains server-only: browser/mobile/IndexedDB writes are denied in Firestore rules. Offline intents cannot issue, revoke or revalidate hospital credentials. A stale command key cannot resurrect a revoked grant or bypass a changed trust root. Real revocation must be enforced at every online decision, not only when a hospital logs in.

## Qualification environment

Only tests can install synthetic pins, and only when all these gates are explicitly set:

```text
GHIMS_RUNTIME_MODE=TEST
FIREBASE_PROJECT_ID=ghims-p4-ci
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
GHIMS_CI_EXTERNAL_SIGNED_CONSUMER_ENABLED=true
```

The contract test suite uses a simulated Firestore transaction with that same explicit emulator host string. In integration tests, the localhost Firestore emulator is running. The signing key is generated ephemerally **inside the test helper**, not committed or deployed. Nothing is connected to actual hospital identity records or a real HSM.

## Adversarial qualification

Missing unsigned issuer linkage, forged signature, switched claim subject, tampered signature digest, swapped journal record ID, missing HELD outbox, revoked/rotated signing key, expired claim, cross-tenant substitution, withdrawn site agreement, revoked original approver grant, stale approval replay and conflict outcomes must all deny. Existing immutable clinical approvals remain audit records and never become clinical authority.

## Production blockers

1. A genuinely independent institutional trust-root onboarding and custody system, signed contracting evidence, root rotation/revocation and disaster recovery; do not treat self-supplied public keys as hospital identity.
2. Real medical license and active staff privileges, credential revocation feeds, verified clinical role/site authorization, hospital-signed source contract, patient assignment, and phishing-resistant authentication.
3. No production verifier/trust-root connector has been commissioned. In all non-test runtimes **verification fails closed with `CI_EXT21_TRUST_STORE_NOT_COMMISSIONED`**.
4. These signatures cover synthetic authorization claims, **not** legal attestation of human professional identity.
5. Independent @AB2412 security review, clinical signoff by Dr Ufaq Waqas outside GitHub, upstream merge/rebase governance, main-base full CI, hosted G1/G2 qualification and formal deployment change control.

```text
CI_EXT21_UNSIGNED_LEGACY_ACCEPTANCE=DENY
CI_EXT21_HOSPITAL_TRUST_STORE=TEST_ONLY
EXTERNAL_HIS_CLINICAL_GO=NO_GO
AI_DRAFTING=NO_GO
G1_G2_HOSTED=NO_GO
PRODUCTION_RELEASE=NO_GO
```
