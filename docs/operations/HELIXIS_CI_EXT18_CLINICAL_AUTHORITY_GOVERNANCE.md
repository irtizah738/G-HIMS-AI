# CI-EXT-18 — Clinician credential and hospital-site authority governance

**Status:** synthetic Firestore-emulator qualification only; not clinical, commercial, production or hosted authorization. Stacked on CI-EXT-17 PR #288, which is stacked on CI-EXT-15/16 PR #285. **NO_GO** for external HIS clinical use.

## Design decision

CI-EXT-17 can record a fact-specific clinician approval, but its synthetic `externalClinicalCredentialHeads` and `externalClinicalSiteAuthorityHeads` must not be treated as credible just because a document asserts `VERIFIED` or `APPROVED`. CI-EXT-18 introduces a traceable two-person hospital governance protocol for constructing *synthetic* derived heads. Credentials/authorities cannot be issued from unverified user-supplied claims. Their source evidence, institutional grant and independent approval are required **in one Firestore transaction** at activation.

The resulting heads remain **engineering fixtures** until hospital-issued source documents, verifiable authority chains, professional registration checks, patient assignment and independent cryptographic signatures exist. No browser route, hospital network connection, OAuth flow or production configuration is created.

## Actors and evidence chain

1. A trusted evidence-ingestion subsystem would verify identity/professional qualification or the hospital-site agreement, recording an immutable `externalClinicalAuthorityEvidence/{evidenceId}` with tenant, target, facility, evidence hash, independent verifier identity, validity window, and—for a site—the exact registered `siteApprovalId`. **That ingestion and verification subsystem is deliberately NOT implemented here.** Tests seed synthetic evidence.
2. A separately authenticated, hospital-scoped proposer with active `externalClinicalGovernanceGrants/{actorId}`, an explicit privilege and matched institutional officer role proposes the exact evidence. The proposal and event are immutable and expire after 5 minutes.
3. A different authority holder **who is neither proposer, evidence verifier, nor credential subject** activates. The transaction rechecks source evidence, proposer and approver grants, MFA, facility, valid windows and, for sites, `fhirSources` status and siteApprovalId. A fresh, separate activation event builds revision-1 derived head.
4. A clinical safety officer with a current, explicit `FHIR_AUTHORITY_REVOKE` grant may revoke at any time. The revocation is append-only, increments the derived-head revision and is never blocked by inactive source, expired original issuer credential, or withdrawn patient consent.

Grant requirements: `status=ACTIVE`, `identityAssurance=HOSPITAL_VERIFIED`, `mfaStatus=VERIFIED`, valid time window, exact tenant/facility, role and privilege. The actor context and stored grant **must both** pass. Browser-supplied grants or identity claims are never authoritative.

### Role/permission boundary

| Operation | Stored grant role | Explicit privilege |
|---|---|---|
| Credential proposal | `HOSPITAL_CREDENTIAL_OFFICER` | `FHIR_CREDENTIAL_PROPOSE` |
| Credential activation | `HOSPITAL_CREDENTIAL_OFFICER` | `FHIR_CREDENTIAL_ACTIVATE` |
| Site proposal | `HOSPITAL_INTEGRATION_OFFICER` | `FHIR_SITE_AUTHORITY_PROPOSE` |
| Site activation | `HOSPITAL_INTEGRATION_OFFICER` | `FHIR_SITE_AUTHORITY_ACTIVATE` |
| Either authority revocation | `CLINICAL_SAFETY_OFFICER` | `FHIR_AUTHORITY_REVOKE` |

These are **synthetic server-attested roles**, not deployment authorization. Institutional authorization policy and real MFA enforcement need separate qualification.

## Firestore records

All collections live at `tenants/{tenantId}` and are explicitly denied to browser/mobile/IndexedDB clients. No compound indexes are introduced: every new access uses direct document references.

| Collection | Description |
|---|---|
| `externalClinicalGovernanceGrants/{actorId}` | Server-only currently active institutional officer authority seed (fixture only; real issuance is not implemented) |
| `externalClinicalAuthorityEvidence/{evidenceId}` | Externally verified evidence seed with hash, verifier, scope and expiry (fixture only) |
| `externalClinicalAuthorityProposals/{proposalId}` | Immutable proposal with kind, subject/source, evidence reference/hash, proposer and short expiry |
| `externalClinicalAuthorityEvents/{eventId}` | Immutable `PROPOSED`, `ACTIVATED` and `REVOKED` event payload, deterministic domain-separated SHA-256, previous-event linkage |
| `externalClinicalAuthorityOutbox/{eventId}` | Append-only `HELD` governance event, no publisher |
| `externalClinicalAuthorityCommands/{commandId}` | Immutable idempotency command outcome with request hash and event pointer |
| `externalClinicalCredentialHeads/{actorId}` | Mutable derived current clinician `VERIFIED` or `REVOKED` state, revision, event pointer, license evidence, facility and expiry |
| `externalClinicalSiteAuthorityHeads/{sourceId}` | Mutable derived current hospital-site `APPROVED` or `REVOKED` state, revision, exact approved HIS source and expiry |
| `auditLogs/{id}` | Immutable actor-attributed event metadata, no raw patient data |

Both issuance and revocation retain original records; current heads change, events never overwrite. Deterministic idempotency identity uses tenant, authenticated actor and normalized UUID; exact matching replay returns the same event, but does not resurrect superseded or revoked state. Concurrent opposing decisions conflict and re-evaluate in Firestore transactions.

Example synthetic clinician-derived head:

```json
{
  "schemaVersion": 1,
  "tenantId": "synthetic-tenant",
  "kind": "CLINICIAN",
  "targetId": "synthetic-clinician",
  "facilityId": "synthetic-facility",
  "actorId": "synthetic-clinician",
  "facilityIds": ["synthetic-facility"],
  "status": "VERIFIED",
  "identityAssurance": "HOSPITAL_VERIFIED",
  "licenseVerified": true,
  "revision": 1,
  "validFrom": 1794200000000,
  "validUntil": 1794200600000,
  "revokedAt": null,
  "evidenceOnly": true,
  "clinicalUseAuthorized": false,
  "aiDraftingEligible": false
}
```

The actual event-linked head also contains immutable evidence reference/hash, independent verifier, proposer and approver IDs, `governanceEventId`, `governanceEventHash`, `previousEventId`, `previousEventHash`, and `immutableSourceEvent=true`. A `verifyGovernanceHead` helper checks the current head against its immutable event, but **SHA-256 is not hospital signature attestation** and cannot stop an administrator who rewrites both records.

## Emulation and safety limits

The issuance functions are unavailable unless *all* environment gates hold:

```text
GHIMS_RUNTIME_MODE=TEST
FIREBASE_PROJECT_ID=ghims-p4-ci
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
GHIMS_CI_EXTERNAL_AUTHORITY_GOVERNANCE_ENABLED=true
```

No public API or clinical `ClinicalContextReader` calls these functions. No cloud-resource, billing, IAM, certificate or Secret Manager changes are made. No data from a real hospital is necessary.

Offline clients must **not** queue or replay authority changes. They may retain an unsent intent as a local draft without privilege; an online hospital-authorized transaction is required to act. A late offline intent does not bypass revoked grants, evidence updates, source withdrawal, or expired proposals.

## Release blockers and acceptance

CI-EXT-18 requires exact-head TypeScript, lint, unit/contract tests, Firestore emulator transaction tests, full repository requalification after the stacked PRs land, and security-supply-chain checks. Adversarial cases: self-activation, evidence-revision mismatch, grant revocation, expired proposal, overlapping commands, source-disabled emergency revocation, forged browser writes, credential impersonation, stale replay, and no native Patient 360 promotion.

**Not implemented / NO-GO until separate milestones:** real credential source verification, regulatory license checks, professional registry refresh, issuer trust chain, site contracting authority, institutional role/credential grant issuance/revocation, signed event-chain/HSM policy, clinician–patient clinical assignment, proof of identity with phishing-resistant MFA, operational clinical policy, migration and rollout, and a qualified external clinical context adapter.

Independent review remains required from **@AB2412**; clinical signoff remains separate and institutionally authenticated with **Dr Ufaq Waqas**. Do not merge or deploy merely on passing CI.

```text
CI_EXT18=EMULATOR_ONLY
EXTERNAL_HIS_CLINICAL_GO=NO_GO
G1_HOSTED=NO_GO
G2_HOSTED=NO_GO
PRODUCTION_RELEASE=NO_GO
```
