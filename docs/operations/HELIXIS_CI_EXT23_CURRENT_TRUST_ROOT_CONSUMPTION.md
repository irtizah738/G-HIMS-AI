# CI-EXT-23 — Current steward-signed trust-root authorization fence

**Scope:** Synthetic TEST/localhost Firestore emulator only. The source is not suitable for production clinical use, patient chart promotion, or AI drafting.

## Architectural security correction

CI-EXT-21 previously accepted a hospital issuer key from a test-only in-memory map. CI-EXT-22 introduced a two-/three-steward signed trust-root lifecycle, but it was not consumed by CI-EXT-21. Therefore, a legitimate CI-EXT-22 key revocation or rotation did not necessarily invalidate previously accepted issuer credentials.

**CI-EXT-23 removes the legacy hospital issuer key map altogether.** The issuer key is now resolved only from the **current CI-EXT-22 Firestore trust head and its immutable event in the same Firestore transaction** as source, consent, credential and fact-approval decisions.

A separate test-only map holds **independently pinned steward public keys**, not hospital issuer keys. The steward pins are out-of-band test fixtures; they are never populated from a Firestore head or an incoming hospital claim. No production trust-store provider or root-onboarding API has been commissioned. When the test guard is absent, the consumer denies with `CI_EXT21_TRUST_STORE_NOT_COMMISSIONED`.

## Authorization algorithm

Each `verifyCurrentSignedAuthorityRecord(...)` call:

1. Ensures TEST mode, exact `ghims-p4-ci` project and `127.0.0.1:8080` Firestore emulator, enabled synthetic verifier, and valid tenant/facility/record IDs.
2. Refuses an unsigned or non-promoting derived credential, site or hospital-officer grant.
3. Requires an independently pinned, current and correctly scoped hospital/security/recovery steward set for the exact tenant, facility and issuer.
4. **Within the caller's existing transaction**, reads `externalClinicalHospitalTrustHeads/{issuerId}` then its current `externalClinicalHospitalTrustEvents/{currentEventId}`.
5. Demands current `ACTIVE` state, matching issuer tenant/facility, matching immutable event and head SHA-256 lineage, valid pin, and the current required steward quorum with correctly verified Ed25519 command signatures. A revoked/expired signer denies.
6. Compares that **current root key ID, key revision and SPKI fingerprint** against the derived evidence/grant record, before checking the CI-EXT-20 signed issuer attestation, exact enrollment command journal, HELD outbox and Ed25519 issuer signature.
7. Returns a *non-promoting* success only when all immutable and current facts match. `clinicalUseAuthorized=false`, `aiDraftingEligible=false`, without exception.

**There is no migration flag, native fallback or old test issuer pin override**. Historical approvals and signatures remain immutable audit evidence; they can never override a currently revoked or rotated issuer.

### Transaction and failure semantics

CI-EXT-16 current clinical preflight, CI-EXT-17 fact issuance/idempotent replay, CI-EXT-18 proposal/activation and existing CI-EXT-19 current governance consumption all reach the CI-EXT-23 check through the CI-EXT-21 consumer. A mismatch fails the transaction. Firestore SDK clients cannot write trust heads, issuer attestations or clinical governance events under the explicit-deny rules already present.

Emulator qualification includes:

- First request without a trust root: **denied** despite a valid hospital-signed attestation.
- Actual independent-steward **ENROLL** transaction: current signed attestation becomes **non-promoting eligible**.
- Actual independent-steward **REVOKE** transaction: the same credential becomes **denied** with no patient, approval or credential mutation.
- Previous ENROLL command replay cannot revive the revoked root.
- Actual independent-steward **RECOVER** transaction with a fresh key: the *old* credential stays **denied** because its signing key is superseded.
- Missing or tampered head/event, withdrawn signer, swapped key revision, deleted signed attestation, grant revocation, stale clinical review and consent withdrawal all fail closed.
- The previously green CI-EXT-03 through CI-EXT-22 contracts, Node Firestore emulator suites and native clinical-context regressions continue to run.

No composite indexes are needed: direct document IDs, tenant-scoped transactions, and only server Admin SDK writes are used. No external network, real hospital data, paid cloud API, KMS, IAM, VPC or production mutation occurs.

## Remaining real-world blockers

A passing synthetic test does not validate legal hospital identity or attestations, credentialing by a medical council, the validity of an HIS integration agreement, operator physical identity/MFA, production steward trust distribution, HSM/KMS private-key custody, or long-term independent oversight.

**Operational requirements before deployment:**
- Independently authenticated real hospital officers and contracting authority, hardware-isolated stewardship keys, officer removal/replacement, and documented security/clinical decision rights.
- Production-safe trust-anchor distribution with immutable external audit, key rotation, key revocation notifications and disaster recovery; no Firestore-derived trust bootstrap.
- Formal evidence/authorization reconciliation and tenant-isolation tests against trusted real-hospital onboarding metadata, with no real patient production testing before clinical governance approval.
- Security sign-off @AB2412; separate institutionally authenticated Dr Ufaq Waqas clinical approval; parent PR reconciliation to `main` and repository-wide release qualification.

```text
CI_EXT23_ISSUER_KEY_SOURCE=CURRENT_CI_EXT22_SIGNED_ROOT_ONLY
CI_EXT23_LEGACY_ISSUER_PIN=DENY
CI_EXT23_HOSTED_TRUST_STORE=NOT_COMMISSIONED
EXTERNAL_HIS_CLINICAL_GO=NO_GO
AI_DRAFTING=NO_GO
G1_G2_HOSTED=NO_GO
PRODUCTION_RELEASE=NO_GO
```
