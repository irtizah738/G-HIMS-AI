# CI-EXT-17 — Immutable external fact approval issuance and revocation

**Status:** synthetic-emulator engineering qualification only; stacked on draft PR #285 (which now includes CI-EXT-16). No production, staging, vendor or hospital-PHI write route. Not a clinical authorization or qualified hospital integration.

## Decision

An imported FHIR fact must not acquire clinical authority because a review exists or because a writable approval-head document says `APPROVED`. Clinical source qualification requires a separate, independently credentialed approver for **each exact source fact version**, with an immutable issuance event and monotonic derived head. Safety revocation must remain possible when the FHIR source, patient link, consent, or issuer credential has already been revoked.

CI-EXT-17 implements the **synthetic-only** event writer and chain verification. The issuer is called only from within the already authorized and source/consent-verified CI-EXT-03 Firestore transaction. Revocation is a separate privileged transaction and **does not access source data or require active patient consent**. Nothing creates native Patient 360 clinical facts or authorizes AI drafting.

## Technical contract

The issuance command specifies only `reviewId`, `evidenceReceiptId`, `sourceVersionId`, `resourceHash` and `idempotencyKey`. Tenant, patient, source, facility, current projection revision, source checkpoint, consent/site-authority revision fence and approver identity are derived by the server from the verified reader transaction.

Qualification environment is hard-locked to **all** of:

- `GHIMS_RUNTIME_MODE=TEST`
- `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`
- `FIREBASE_PROJECT_ID=ghims-p4-ci`
- `GHIMS_CI_EXTERNAL_FACT_APPROVAL_ENABLED=true`

No HTTP route is exposed. This feature is **not enabled for STAGING or PRODUCTION**. Credentials and site authority used in tests are synthetic fixture documents; this milestone does not issue hospital credentials or policy approvals.

### Issuance fences

Before committing, server transaction verifies:
1. Live, approved source, facility ABAC, verified canonical patient identity and current consent; immutable FHIR receipts/events, latest resource heads, history and availability, projection hashes, current checkpoint, non-expired projection and no unresolved reconciliation.
2. Historical `SOURCE_EVIDENCE_REVIEWED` review matching **every** current fact receipt/version/hash and the exact projection plus source/consent updateTime nanoseconds fence. `CLINICAL_CONCERN_RECORDED` cannot be approved.
3. Issuer is a server-derived clinician, with explicit `FHIR_CLINICAL_FACT_APPROVE` and `FHIR_EVIDENCE_REVIEW`, relevant facility and no conflict with original reviewer or any source importer.
4. Both reviewer and approver have present/current `externalClinicalCredentialHeads/{actorId}` with hospital-verified identity, verified professional license and matching facility; issuer cannot forge or extend credential expiry.
5. The current `externalClinicalSiteAuthorityHeads/{sourceId}` matches the source's `siteApprovalId`, facility, valid policy and revision. The approval expiry is server-capped at the earliest of reviewer, approver or site expiry and **10 minutes**.
6. No prior approval head for this *review+fact*; a revoked review may not be silently reissued. A new review is required.

## Firestore schema and event chain

All paths are under `tenants/{tenantId}`. Each `eventId` is deterministically derived from tenant, patient, review, receipt, actor and idempotency UUID. All browser Firestore reads/writes to these collections are denied.

| Path | Role |
|---|---|
| `externalClinicalFactApprovalEvents/{eventId}` | Immutable `EXTERNAL_FACT_APPROVAL_ISSUED` or `EXTERNAL_FACT_APPROVAL_REVOKED` event, `payload`, domain-separated SHA-256 `eventHash`, immutable and non-promoting flags |
| `externalClinicalFactApprovalHeads/{headId}` | Mutable derived state keyed by `externalFactApprovalHeadId(reviewId,receiptId)`; `revision` starts at 1, becomes 2 on revocation. Includes exact event and clinical snapshot reference, `approvalEventId` and `eventHash` |
| `externalClinicalFactApprovalOutbox/{eventId}` | Append-only `HELD` governance outbox; no publisher or clinical downstream action |
| `externalClinicalFactApprovalCommands/{commandId}` | Append-only idempotency outcome, request hash and event pointer |
| `auditLogs/{auditId}` | Immutable, actor-attributed issuance/revocation metadata (no clinical payload) |

Issuance is a single Firestore transaction: read current facts/review/policies/credential/command/head; then create event, command record, HELD outbox, immutable audit, head and evidence read-access audit. Transaction retries and deterministic IDs avoid duplicate outcomes.

Revocation is another single Firestore transaction: read command, existing head and immutable latest event; verify event/head hash and scope, require server-authoritative `FHIR_CLINICAL_FACT_REVOKE`, appropriate clinical/safety officer role and facility authorization; then append revocation event with `previousEventId`/`previousEventHash` and increment head revision. It does not need active HIS endpoint, valid consent, source status or a currently licensed original approver. Repeated identical idempotency commands replay; conflicting or stale revisions fail closed. Once revoked, this review+fact cannot be reapproved through this flow.

**Important:** SHA-256 event hashes and chain references detect ordinary mismatches, **not** malicious Admin SDK rewriting of both the event and its head. Production requires hardware/KMS-backed attestation, immutable audit retention, permission separation and independent hospital-issued credentials.

## Clinical and offline non-promotion

A fully matched approval head may produce `PREQUALIFIED_NON_PROMOTING` in CI-EXT-16, **never `clinicalUseAuthorized=true` or `aiDraftingEligible=true`**. The external clinical context adapter remains intentionally unavailable; no automatic drafting, diagnosis, orders, dispensing, clinical alerts, or native Patient 360 projection changes.

Offline clients may keep an unsent *intent*, never an offline approval or signature. On reconnection, the hospital must issue a fresh, server-validated transaction with current authority; conflicts and expired credentials require human action. Revocation takes precedence over historical approvals.

## Qualification and remaining NO-GO gates

- CI-EXT-03/15/16/17 contract suite, Node Firestore emulator integration and security supply-chain checks are required at exact head.
- CI-EXT-16 now requires a matching immutable `externalClinicalFactApprovalEvents` event for **every** approval head before any non-promoting prequalification; a forged head alone no longer qualifies.
- Must obtain independent security review by **@AB2412**, separate institutionally authenticated clinical signoff by **Dr Ufaq Waqas**, hospital site contract/consent authority and repository-wide qualification after upstream merge.
- **Not implemented:** production clinician identity/credential issuance and revocation, clinician-patient assignment, hospital policy approval event chains and signatures, KMS/HSM event attestation, trusted external HIS context reader, operation-time authorization, governed downstream alerting or AI drafting.
- No GCP, billing, IAM, network, vendor, patient or production mutations are authorized.

```text
CI_EXT17_EVENT_WRITER=EMULATOR_ONLY
CI_EXT17_CLINICAL_USE=DENIED
EXTERNAL_HIS_CLINICAL_GO=NO_GO
G1_HOSTED=NO_GO
G2_HOSTED=NO_GO
PRODUCTION_RELEASE=NO_GO
```
