# CI-EXT-20 — Hospital issuer attestation and signed credential evidence enrollment

**Engineering status:** emulator-only, no external HIS clinical authority. The prior CI-EXT-18/19 governance workflow relies on synthetic source evidence and pre-seeded hospital grants. This milestone adds a **separate signed-enrollment gate** for hospital-provided evidence and grants. It does not yet rewire all downstream consumers to reject unsigned legacy synthetic fixtures; that remains a mandatory pre-release integration gate.

## Trust model and intent

A clinician credential, hospital-source authority, or governance-officer grant is not trustworthy merely because a Firestore document says `HOSPITAL_VERIFIED`, even if it has an immutable hash chain. CI-EXT-20 specifies:

1. An **independently provisioned, pinned Ed25519 hospital public key**; pin is supplied only by trusted server configuration—not in a client request, from the issuer's signed claim itself, or from a mutable tenant Firestore registry.
2. A signed, canonically serialized, purpose-bound claim with exact tenant, hospital facility, issuer/key IDs, subject, independent verifier, claim ID, issuance and validity window, evidence digest, professional-licence decision, site contract ID, or exact governance-officer permission.
3. Verification of **actual signature bytes** using Node's Ed25519 implementation, plus SHA-256 SPKI DER fingerprint, key revision and valid trust window, current non-revoked key state, 30-minute maximum claim validity, 2-minute clock-skew bound, tenant/facility and purpose match.
4. An emulator-only atomic enrollment transaction creating the immutable signed attestation, immutable command journal, HELD outbox and immutable audit; plus a derived `externalClinicalAuthorityEvidence` record or a narrowly scoped `externalClinicalGovernanceGrants` record.
5. Deterministic identity `eia_<sha256(tenant,issuer,claimId)>` and exact replay checks; altered claims, revoked derived grant/evidence, different issuer key/fingerprint, or duplicate subject conflict cannot resurrect the old authorization.

**This does not generate keys, inspect a real medical license, make an institutional contracting decision, perform interactive MFA, issue a verified hospital grant, or enable clinical drafting.** The hospital signer is only authenticated relative to an independently pinned key; the business meaning of the signer must be established separately.

## Data contracts

`HospitalIssuerClaim` has these exactly typed fields:

| Field(s) | Required effect |
|---|---|
| `schemaVersion=1`, `issuerId`, `keyId` | Match pinned hospital authority and current signing key |
| `tenantId`, `facilityId`, `subjectId` | Tenant and exact hospital scope |
| `claimId`, `verifiedByActorId` | Uniqueness and independent verification identity |
| `issuedAt`, `validFrom`, `validUntil` | Server-checked bounded expiry and signing chronology |
| `kind` | `CLINICIAN`, `SITE`, or `GOVERNANCE_GRANT` |
| `evidenceDigest` | Exact domain evidence hash |
| `licenseVerified`, `siteApprovalId` | Purpose-bound professional-licence/site-approval assertions |
| `roles`, `permissions`, `mfaVerified` | Strictly allowlisted governance roles and single matching privilege; no arbitrary administration |

The signature is Ed25519 over UTF-8 of:

```text
HELIXIS_CI_EXT20_ISSUER_CLAIM_V1\n<deterministic-canonical-JSON-claim>
```

A `SignedHospitalIssuerClaim` contains exactly `claim` and `signatureBase64Url`. A `PinnedHospitalIssuerKey` contains an independently provisioned PEM SPKI public key, its SHA-256 DER fingerprint, allowed purposes, tenant and facility scope, key revision, validity and revocation status. Tests create **ephemeral keys in memory only**; no private signing key or PEM fixture is committed to the repository.

## Firestore collection contract

All paths are under `tenants/{tenantId}`, with explicit client read/write denial:

| Collection | Role |
|---|---|
| `externalClinicalIssuerAttestations/{attestationId}` | Immutable signed claim, issuer ID/key ID/revision/fingerprint, signed claim hash, exact signature bytes and record pointer |
| `externalClinicalIssuerEnrollmentCommands/{attestationId}` | Append-only idempotency journal |
| `externalClinicalIssuerOutbox/{attestationId}` | Immutable `HELD` delivery record; no publisher |
| `externalClinicalAuthorityEvidence/{evidenceId}` | Derived credential or site evidence, plus attestation pointer and signer fingerprint |
| `externalClinicalGovernanceGrants/{actorId}` | Derived, single-scope hospital-officer grant, plus attestation pointer and signer fingerprint |
| `auditLogs/{id}` | Immutable issuer-attributed operation without raw patient data |

No compound Firestore indexes are required. The enrollment operation uses direct document reads/writes and Firestore transactions. Any exception aborts the whole set; write retries use the same deterministic ID and signature. Replaying after revocation never re-enables the earlier record.

## Qualification-only runtime guards

All conditions are mandatory:

```text
GHIMS_RUNTIME_MODE=TEST
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_PROJECT_ID=ghims-p4-ci
GHIMS_CI_EXTERNAL_ISSUER_ENROLLMENT_ENABLED=true
```

No HTTP endpoint or browser function exposes the signing key, the pinned trust anchor, or the enrollment method. Never set this flag in staging/production. No user data, hospital PHI, external HIS network traffic, GCP billing, IAM, Cloud Run, KMS or networking changes are necessary.

## Failures to test

Test a forged or altered signature, rogue public key, changed fingerprint, wrong tenant or facility, unauthorized signing purpose, revoked/expired issuer key, expired claim, excessive claim lifetime, arbitrary role/privilege escalation, duplicate claim ID with modified payload, revoked evidence replay, and concurrent enrollment attempts. Verify grant and evidence cannot be constructed through Firestore client security rules and no native Patient360 or external AI drafting data is written.

## Outstanding deployment gates

- **Trust-anchor enrollment and approval:** Independent, signed hospital contracting evidence, multiple signers/quorum, human governance, audited root rotation, revocation feed, key custody/HSM, key origin and validity proof.
- **Evidence verification:** Medical-council licensure and current professional status, hospital HR/medical-staff appointment, verified person/device identity, patient assignment, source-site contracts, independent evidence validation.
- **Interactive MFA:** Signed `mfaVerified` is a declaration, not real proof of fresh operator authentication.
- **Consumer integration:** CI-EXT-18 and CI-EXT-19 must reject **all** legacy unsigned evidence and governance grants and verify the current signed attestation and live trust-anchor revision before releasing even non-promoting approval. Until that is delivered, this milestone qualifies enrollment only.
- **Security/governance:** @AB2412 independent security review and Dr Ufaq Waqas institutionally authenticated clinical review; upstream draft PR #285, repository-wide main-base CI qualification and hospital safety approvals.

```text
CI_EXT20_SIGNED_ENROLLMENT=EMULATOR_ONLY
CI_EXT20_PRODUCTION_TRUST_BOOTSTRAP=NOT_IMPLEMENTED
EXTERNAL_HIS_CLINICAL_GO=NO_GO
AI_DRAFTING=NO_GO
G1_HOSTED=NO_GO
G2_HOSTED=NO_GO
PRODUCTION_RELEASE=NO_GO
```
