# CI-EXT-24 — Institutional identity evidence and trust-distribution contracts

**Status:** synthetic non-promoting qualification, with zero real-hospital verification. No production trust onboarding, real contracting authority, medical licensing, external HIS connection, hosted G1/G2, AI drafting, or clinical release.

## Why this milestone is necessary

CI-EXT-20–23 confirm cryptographic signatures and a current, steward-signed issuer key; they do **not** establish that a signing key belongs to a legally registered hospital, that an officer can execute a contract, or that a clinician's licence is current. A signed claim is only as trustworthy as the party who signed it and the provenance of the facts.

The CI-EXT-24 contracts explicitly separate:

1. **Identity and legal standing assertions** made by independent, externally pinned verification authorities.
2. **Current cryptographic trust-root governance** from CI-EXT-22/23, which still uses emulator-only steward keys.
3. **Secure distribution handoff** authenticated independently from the issuer and institution, with a monotonic anti-rollback sequence.
4. **Actual primary-source confirmation and commissioning**, which are **not implemented** and cannot be silently inferred from a successful signature check.

## Institution evidence dossier

`InstitutionalEvidenceDossier` contains `schemaVersion=1`, exact tenant/facility/issuer/institution identifiers, ISO two-letter jurisdiction, unique case ID, five SHA-256 digests of vetted registry/licence/contract/appointment-related source material, site approval identifier, and three uniquely scoped steward appointment digests with roles `HOSPITAL_TRUSTEE`, `SECURITY_TRUSTEE` and `RECOVERY_TRUSTEE`. Raw names, identity documents, patient information and credential secrets are **not stored** in the control-plane events.

The dossier requires **five distinct verifier roles**, each signing the full domain-separated, canonical dossier with an independent Ed25519 key that must be pinned **outside Firestore**:

| Independent verifier | Documentary fact asserted |
|---|---|
| `LEGAL_REGISTRY_VERIFIER` | Hospital legal entity and registration |
| `HOSPITAL_LICENCE_VERIFIER` | Hospital licence or provider authorization |
| `CONTRACT_AUTHORITY_VERIFIER` | Institution's delegated contracting power |
| `STEWARD_IDENTITY_VERIFIER` | Identities and appointments of the three governance stewards |
| `SOURCE_AGREEMENT_VERIFIER` | Existing HIS/site agreement and approved integration scope |

Signatures cover the same case, scope and evidence digests. No signer can reuse another verifier's role, share another verifier's public-key fingerprint, act as an institutional issuer or the named steward, or be outside its own validity window. A dossier has a maximum 24-hour validity. Changes to evidence, hospital, facility, issuer, steward, or source approval require new independent signatures.

**Important:** The current five verifiers are generated *only in synthetic test fixtures*. The code never queries a real government registry, medical council, hospital board, accreditation body or contract archive. **`institutionalIdentityCommissioned=false` even when all signatures verify.**

## Firestore model, constraints and indexes

Under `tenants/{tenantId}` and explicitly denied to browser/mobile/IndexedDB clients:

| Collection | Write contract |
|---|---|
| `externalClinicalInstitutionalVerificationEvents/{caseHash}` | Append-only complete signed dossier, digest, evidence-verification provenance |
| `externalClinicalInstitutionalVerificationCommands/{caseHash}` | Immutable idempotency journal binding case ID + content hash |
| `externalClinicalInstitutionalVerificationOutbox/{caseHash}` | Immutable **HELD** quarantine record; no publisher |
| `externalClinicalInstitutionalVerificationHeads/{issuerId}` | Derived current `QUALIFIED_NON_PROMOTING` state only, never authority |
| `externalClinicalTrustDistributionHandoffs/{distributionId}` | Immutable dual-signed destination-bound quarantine manifest |
| `externalClinicalTrustDistributionCommands/{distributionId}` | Immutable idempotency journal |
| `externalClinicalTrustDistributionOutbox/{distributionId}` | Immutable **HELD**, no actual distribution |
| `externalClinicalTrustDistributionHeads/{destinationHash}` | Current accepted sequence and distribution ID to prevent rollback |
| `auditLogs/{auditId}` | Append-only case and evidence digests without PHI |

All operations use direct-document reads and a Firestore transaction, so no new composite indexes are required. A previously enrolled case ID with changed content fails idempotency; an altered/revoked independent verifier invalidates live inspection. Revocation of an institution requires further, independently authorized event-driven lifecycle work; do not promote the synthetic head to operational proof.

## Trust distribution contract

A `TrustDistributionManifest` contains the exact tenant/facility/issuer/destination, immutable current root event ID + hash, issuer revision/key ID/SPKI fingerprint, current institution dossier ID + digest, unique distribution ID, strictly increasing per-destination sequence, bounded issue/expiry, and the literal state `HELD_NOT_DELIVERED`.

The manifest requires **two distinct independent Ed25519 signers**: `TRUST_DISTRIBUTION_OPERATOR` and `INDEPENDENT_SECURITY_AUDITOR`. Their active keys must be pinned independently of the hospital issuer and the HIS client.

A distribution *stage* is allowed only when the same Firestore transaction verifies:

- Existing **ACTIVE** CI-EXT-22 root and currently valid steward quorum, with exact issuer key fingerprint and revision;
- Existing, unexpired CI-EXT-24 independent institution evidence with its current five-signature quorum;
- Exactly matching dossier ID/digest and root event ID/hash in the signed manifest;
- Valid distribution quorum and `sequence > current destination sequence`; repeated older manifests or attempted rollback fail closed;
- No clinical promotion, no browser write permission, no network publisher and no report of actual delivery.

The outcome is intentionally **`delivered=false`**. It does not provision a device, transport a key, update an HIS, publish a trust cache, or allow a device to authorize a patient. Future consumers must verify authenticated delivery receipts, channel/device binding, trust revocation, anti-rollback on the device, expiry and absence of stale caches.

## Emulator-only runtime

```text
GHIMS_RUNTIME_MODE=TEST
FIREBASE_PROJECT_ID=ghims-p4-ci
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
GHIMS_CI_EXTERNAL_INSTITUTIONAL_VERIFICATION_ENABLED=true
GHIMS_CI_EXTERNAL_TRUST_DISTRIBUTION_ENABLED=true
```

Both modules check the synthetic runtime before a Firestore write, and the trust/issuer modules retain their own TEST runtime fences. Signing keys are created ephemerally in test code only and never persisted.

## Required gates before a real-hospital pilot

**Identity and governance:** Establish each real legal entity and clinical operating licence by a primary-source registry check with source timestamp and evidence hash; independently validate actual contract signatories and delegations; audit human identities, appointment status, clinician professional licences and facility/site agreements.

**Signing and trust custody:** Commission verified institutional verifiers and stewards through a formally approved offline trust-bootstrap ceremony; hardware-protected private keys, rotation, revocation feed, independent audit and multiple human approvals. Never accept a self-provided public key as hospital identity.

**Distribution and resilience:** Build a separate authenticated distribution plane with secure device/server binding, signed monotonic epochs, cached-key invalidation under interrupted connectivity, durable delivery receipts, rollback recovery, and offline denial when trust revocation freshness is unknown.

**Release and review:** Independent @AB2412 security review, institutionally authenticated clinical signoff by Dr Ufaq Waqas, parent PR reconciliation into main, and full repository and hospital-integrated qualification.

### Explicit no-go flags

```text
CI_EXT24_INSTITUTIONAL_IDENTITY=SIGNED_SYNTHETIC_ASSERTIONS_ONLY
CI_EXT24_TRUST_HANDOFF=QUARANTINED_HELD_NOT_DELIVERED
REAL_HOSPITAL_VERIFICATION=NOT_CONNECTED
EXTERNAL_HIS_CLINICAL_GO=NO_GO
AI_DRAFTING=NO_GO
G1_G2_HOSTED=NO_GO
PRODUCTION_RELEASE=NO_GO
```
