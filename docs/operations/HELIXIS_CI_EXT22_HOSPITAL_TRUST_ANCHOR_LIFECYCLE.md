# CI-EXT-22 — Governed hospital issuer trust-anchor lifecycle

**Status:** synthetic-only test and Firestore emulator qualification. **NO_GO for real hospital identity, licensing, attestation, clinical authorization, AI drafting, G1/G2 hosted environments and production.**

## Design decision

A cryptographic signature proves that a claim was signed by a matching key; it does not prove the key legally belongs to a hospital. Equally, a Firestore document declaring a hospital issuer public key to be trusted cannot establish institutional authority. CI-EXT-22 models a controlled lifecycle for issuer trust anchors using **out-of-band pinned independent steward identities** and append-only governance events.

The stewardship authority is an injected **emulator-only** set of Ed25519 public keys with independent roles. None is created from the hospital issuer key, uploaded by the hospital issuer through an HTTP endpoint, or read from a mutable Firestore tenant registry. Only synthetic test fixtures create transient steward private keys.

### Trust stages

| Transition | Current state required | Required current independent steward quorum | New key |
|---|---|---|---|
| **ENROLL** | Absent | HOSPITAL_TRUSTEE + SECURITY_TRUSTEE | Fresh unique Ed25519 key |
| **ROTATE** | ACTIVE | HOSPITAL_TRUSTEE + SECURITY_TRUSTEE | New key ID and fingerprint; cannot reuse |
| **REVOKE** | ACTIVE | SECURITY_TRUSTEE + RECOVERY_TRUSTEE | **None** (emergency deny) |
| **RECOVER** | REVOKED | HOSPITAL_TRUSTEE + SECURITY_TRUSTEE + RECOVERY_TRUSTEE | Fresh, unused Ed25519 key |

All signers attest to the exact same versioned command bytes using Ed25519, rather than accepting role strings, unverified signatures, or a mutable Firestore approval document. Each signer must have an independently pinned, currently valid public key scoped to the exact tenant/facility/issuer, and at most one signer occupies each required role. The issuer being enrolled cannot be its own steward.

**The signers' factual identity and real hospital authority are not established by this milestone.** Any use with real hospitals requires validated institutional contracts, independently managed trust distribution, and security operations procedures.

### Command and event data model

A canonical `HospitalTrustCommand` contains: `schemaVersion=1`, `operation`, `tenantId`, `facilityId`, `issuerId`, `commandId` (UUID), `expectedRevision`, `issuedAt`, `evidenceDigest` (SHA-256 of separately vetted evidence), matching `reasonCode`, and `newPin` (null for revocation, otherwise a fully validated `PinnedHospitalIssuerKey`).

Each signer signs these bytes (signature base64url):

```text
HELIXIS_CI_EXT22_TRUST_COMMAND_V1\n<sorted-key deterministic JSON command>
```

All Firestore collections are under `tenants/{tenantId}`, with **explicit client read/write denial**:

| Collection | Contract |
|---|---|
| `externalClinicalHospitalTrustHeads/{issuerId}` | Mutable derived state with exact revision, ACTIVE/REVOKED, key ID/public key, immutable event pointer/hash. **Never an independent trust root** |
| `externalClinicalHospitalTrustEvents/{eventId}` | Append-only signed-steward governance transition, domain-separated hash and predecessor link |
| `externalClinicalHospitalTrustCommands/{commandId}` | Immutable idempotency journal with exact request hash and event pointer |
| `externalClinicalHospitalTrustOutbox/{eventId}` | Append-only `HELD` outbox; no publisher |
| `externalClinicalHospitalTrustKeyUsage/{keyId}` | Immutable issuer-key-use tombstone: key IDs cannot be reused after rotation, revocation or recovery |
| `auditLogs/{auditId}` | Immutable steward and event attribution; no patient PHI |

All reads are by direct document ID in a Firestore transaction, so no new composite indexes are required. The active head is updated **only in the same transaction** as creation of event, command, outbox, key-use record and audit. A conflicting revision or repeated key ID aborts atomically. The signing-key private material is never stored or transmitted.

### Revocation, replay and offline

- **Revocation is a new immutable governance event** replacing the current head's ACTIVE status with REVOKED and null currentPin. Historical issuer claims and approvals remain for audit, but must not be treated as current authorization.
- A command replay is accepted only while its event remains the current head and its signed stewardship quorum remains current. Replay of an earlier enrollment after rotation/revocation/recovery returns `IDEMPOTENCY_CONFLICT_OR_SUPERSEDED`.
- A revoked root cannot be reactivated by rotation. **RECOVER** demands a separately attested three-person quorum and fresh, previously unused key, creating a new revision.
- A signer losing independent steward authority invalidates current-root inspection. Root event/hash consistency is insufficient without re-verification of current steward signatures.
- An offline client can hold a *draft intention only*; it cannot generate steward authority, submit or approve trust-root changes offline, or revive stale issuer keys. Reconnect must complete a new online server transaction.

### Runtime qualification fence

```text
GHIMS_RUNTIME_MODE=TEST
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_PROJECT_ID=ghims-p4-ci
GHIMS_CI_EXTERNAL_TRUST_LIFECYCLE_ENABLED=true
```

CI-EXT-22 does not create new Cloud Run, KMS, IAM, VPC, SWP, Secret Manager, real hospital keys, database indexes or paid billing dependencies. The trust-anchor custody is *only simulated* in test fixtures.

## Hard release blockers

1. **Institutional identities:** The current out-of-band synthetic stewards are not real hospital officers. Bind verified legal hospital contracting authority, two-person or three-person quorum, approved delegation, key custody and hospital sign-off before any trust root is commissioned.
2. **Production trust distribution:** There is no production signer registry, HSM/KMS-backed signing, immutable external audit or source of independently trusted public keys. An in-memory test registry must never be promoted to production.
3. **Consumer reconciliation not yet wired:** CI-EXT-21 validates against its existing synthetic, TEST-only pinned issuer keys. This new Firestore lifecycle **is not yet an authority source for that consumer**, nor does it update/revoke the earlier in-memory test pins. A separate security milestone must make every CI-EXT-21 consumption check reconcile the current CI-EXT-22 head and steward approvals **in the same Firestore transaction**. Until then, do **not** claim that CI-EXT-22 lifecycle revocation blocks CI-EXT-21 access.
4. **Administrative safety:** Operator grant expiry, compromised steward recovery, independent evidence digest validation and real-time hospital identity attestations need operational controls and external testing; the command's `evidenceDigest` is a signed reference, not a direct validation of its legal facts.
5. **Governance:** Independent @AB2412 security review, non-GitHub institutional Dr Ufaq Waqas clinical signoff, upstream branch integration/requalification, and full main-base CI before any release.

```text
CI_EXT22_TRUST_LIFECYCLE=EMULATOR_ONLY
CI_EXT22_TRUST_ROOT_CONSUMER_INTEGRATION=PENDING
EXTERNAL_HIS_CLINICAL_GO=NO_GO
AI_DRAFTING=NO_GO
G1_G2_HOSTED=NO_GO
PRODUCTION_RELEASE=NO_GO
```
