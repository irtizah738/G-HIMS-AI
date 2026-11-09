# CI-EXT-19 — Current, event-backed hospital authority at clinical consumption

**Status:** server-side fail-closed qualification, synthetic emulator only. Stacked on the CI-EXT-17 branch containing merged CI-EXT-18, not yet integrated with `main`. All `clinicalUseAuthorized` and `aiDraftingEligible` outcomes remain `false`. **Do not deploy.**

## Threat: mutable heads that look authoritative

CI-EXT-16 originally accepted `VERIFIED` clinician and `APPROVED` source-site derived heads, then checked per-fact approval heads against immutable CI-EXT-17 events. CI-EXT-18 introduced a dual-person immutable proposal/issuance/revocation chain, but did not force CI-EXT-16 or CI-EXT-17 to consume it. That allowed a synthetic credential/site head without any matching issuance event to satisfy a structural credential test. CI-EXT-19 closes that trust gap.

## New transaction boundary

`verifyCurrentExternalGovernanceAuthority` runs in **the very same Firestore transaction** as source/consent/receipt/projection validation and the CI-EXT-17 fact approval or CI-EXT-16 diagnostic preflight. No split read or client-supplied credential attestation. The consumer checks for **every** reviewer, approver, and registered HIS source:

1. Exact tenant, subject/source, facility, revision-1 current head, expected `VERIFIED` / `APPROVED` status, valid current time and non-revoked flag. The head must remain non-promoting.
2. Existing immutable `externalClinicalAuthorityEvents/{governanceEventId}` issuance event; recomputed domain-separated SHA-256 event hash; all derived head and event fields identical.
3. Actual `ACTIVATED` issuance, not a historical `PROPOSED` or `REVOKED` event, with independent proposer, activation approver and evidence verifier. None of these may be the clinician subject.
4. Previous immutable `PROPOSED` event plus its hash and corresponding immutable proposal document. Exact tenant/subject/facility/evidence/siteApprovalId/proposer/verifier lineage, within proposal expiry and issuance chronology.
5. Current `externalClinicalAuthorityEvidence/{evidenceId}`: matching immutable evidence hash, subject, facility, source-site approval ID, independent verifier, validity window, verified identity and (for clinician) professional license flag.
6. Current proposer and activator `externalClinicalGovernanceGrants/{actorId}`: hospital-verified identity, verified MFA attestation, facility scope, appropriate hospital-officer role and explicit proposal/activation permission, unexpired and unrevoked.
7. Existing CI-EXT-03/16/17 authorization still controls source status, patient identity/consent, exact FHIR receipt, import provenance, version and projection fence, independent review, fact approval event, and current professional/site revisions.

A missing, malformed, stale, revoked, cross-tenant or unlinked dependency returns a denial code, never clinical authority. No browser Firestore access is introduced. Existing deny-all Firestore rules protect governance collections.

## Replay and offline safety

CI-EXT-17 approval-command replays now redo reviewer, approver and site governance validation after exact source and consent checks, rather than returning an old success immediately. A withdrawn hospital officer grant prevents even a same-key replay. Idempotency still avoids duplicate event creation when all authority remains valid. Emergency revocation remains independent from the HIS connection and original clinician/source credential availability; that path is not changed here.

Offline clients cannot activate clinical authority by replaying a cached approval. Historical approval events remain audit evidence, never current authorization. Any clinical operation must revalidate current authority server-side.

## Qualification

- Tests: `tests/ci-ext16-current-authorization-contract.test.ts`, `tests/ci-ext19-governance-consumer-contract.test.ts`, CI-EXT-17 emulator clinician-review tests updated with actual event/proposal/evidence/grant-backed synthetic fixtures, plus existing CI-EXT-18 governance tests and native clinical-context regression.
- CI covers TypeScript, lint, contracts, Node Firestore emulator and security supply-chain checks on the exact PR head.
- No compound Firestore indexes are needed; reads use tenant-scoped direct document references.
- No GCP, billing, network, IAM, source-provider or patient-data mutations.

**Remaining security and clinical blockers:** Current evidence/grants are *synthetic fixture records*, not institutionally authenticated claims. SHA-256 detects mismatch, but is not an external hospital signature or HSM-backed event chain. Professional licensing, institutional issuer trust and grant issuance/revocation services, hospital contracts, real MFA proof, clinical assignment, source authorization, independent review by @AB2412 and separate institutional Dr Ufaq Waqas signoff are not yet qualified. The external ClinicalContextReader and patient chart promotion remain disabled.

```text
CI_EXT19_CURRENT_AUTHORITY_CONSUMER=SOURCE_QUALIFICATION_ONLY
EXTERNAL_HIS_CLINICAL_GO=NO_GO
CI_AI_DRAFTING=NO_GO
G1_HOSTED=NO_GO
G2_HOSTED=NO_GO
PRODUCTION_RELEASE=NO_GO
```
