# G2 no-billing credential rotation, crash and restore qualification

**Trust boundary:** strictly `ghims-p4-ci` Firestore emulator and `TEST` runtime. No hosted polling, GCP billing action, key material, OAuth exchange, real FHIR network, clinical publication, or production release is authorized.

## Why this hardening exists

A source's `credentialRevision` number alone is insufficient approval provenance. Changing its token URL, OAuth client ID, JWKS key ID, Secret Manager **version reference**, requested OAuth scopes, or FHIR base URL while retaining that number could silently change the trust boundary. The fresh-manifest recovery command now requires a separate `recoveryBindingSha256` on its site approval record, matching the **entire non-secret approved source configuration**.

The binding uses a versioned SHA-256 digest over exact tenant, facility, source, FHIR base URL, SMART_BACKEND mode, client ID, token URL, key ID, secret version number, credential revision and sorted scopes. It rejects malformed, local, IP-based, query-bearing and non-HTTPS endpoints. A rotated source requires an independently reissued site approval, even if an operator incorrectly retains the same numeric credential revision. No token or private key is read or included.

**This is a synthetic source-config integrity check, not vendor authenticity or evidence that the authorizer is independent.** A SHA-256 field in Firestore can be forged by an actor with unauthorized Admin SDK access; production controls still require IAM, signatures, immutable independent attestation, Secret Manager authorization, and live network proof.

## Recovery behavior and failure semantics

`recoverSyntheticG2FreshManifest` retains these gates in one Firestore transaction:

- terminal governed supersession of original G2 work and two independent immutable reviews with audit/HELD outbox records;
- original sealed manifest/source generation, current security/site approval, credential and source configuration fingerprint;
- current verified patient link and consent, same tenant/facility and active unmerged patient;
- no live lease, exact last committed checkpoint sequence, distinct manifest and work IDs, no vendor cursor reuse;
- immutable new sealed manifest, recovery event, audit and HELD outbox emitted atomically, with idempotent replay.

An optional TEST-only `afterValidationBeforeCommit` callback allows a simulated crash immediately before the transaction starts writing. Its exception must result in **zero new documents**; retry must commit once. A simulated lost HTTP response after Firestore commit is represented by resubmitting the identical request and observing replay without new events or a second manifest. Neither mock claims to simulate physical GCP power loss.

## Firestore schema

`tenants/{tenantId}/fhirSiteApprovals/{approvalId}` has one additional recovery-only field, `recoveryBindingSha256`, a lowercase 64-character digest. This is a *synthetic extension*, not yet a release-grade schema migration. The existing approval ID, expiration, review separation, resource types and credential revision remain mandatory.

All recoveries continue to create the exact-ID immutable records and HELD outboxes documented in `HELIXIS_G2_FRESH_MANIFEST_RECOVERY_OFFLINE.md`. No new composite indexes or browser grants are introduced. Admin SDK bypasses Firestore security rules; hosted production authorization remains unqualified.

## Adversarial acceptance

- Same `credentialRevision` but different OAuth client, token URL, key ID, secret-version reference, scopes or FHIR endpoint must deny fresh-manifest recovery, even when source `updateTime` is correctly repinned by the caller.
- Changing the credential revision without new site approval fails. Updating its revision field without updating the exact configuration fingerprint still fails. Independently reissuing the binding enables only synthetic sealed-manifest recovery.
- Precommit crash leaves zero partial manifests, recovery events, audits and outboxes. Retried command creates exactly one record and future identical command returns replay.
- A live lease or inconsistent source checkpoint cursor rejects fresh-manifest recovery.
- Stage F's detached synthetic multi-page anchor must not validate a restored/rolled-back checkpoint or a missing middle FHIR receipt, even after a previously successful rehearsal. The original immutable rehearsal records remain intact, not overwritten.
- No patient projection, clinical authority, source migration or external dispatch is performed.

## Remaining non-billing work

Further local-only qualification: provenance-based rotation certificates rather than caller-provided source revision alone, recovery after simultaneous consent/credential rotations, restore of partial multi-page event logs from independent synthetic backup, deterministic escalation/poison-work alerts, and stricter release governance.

## Hosted acceptance still required

G1 workload-authenticated proxy vs SWP source matching, fail-closed IPv4/IPv6/NAT/UDP routing, actual vendor endpoints and token origins, G2 Cloud Run/Secret Manager/KMS IAM, live hospital approval, independent WORM witness/time, DR backup restore and production security approval all remain unverified.

`G2_SYNTHETIC_ROTATION_RESTORE=QUALIFICATION_CANDIDATE`; `G1_HOSTED=NO_GO`; `G2_HOSTED=NO_GO`; `PRODUCTION_RELEASE=NO_GO`.
