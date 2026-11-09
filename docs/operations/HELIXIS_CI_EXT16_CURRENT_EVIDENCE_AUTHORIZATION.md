# CI-EXT-16 — Current-time authorization assessment for external HIS evidence

**Engineering classification:** source-only, current-snapshot assessment. **Clinical use and AI drafting are NOT authorized.** `EXTERNAL_HIS_CLINICAL_GO=NO_GO` and `PRODUCTION_RELEASE=NO_GO`.

## Architecture and trust boundary

CI-EXT-15 records append-only clinician review of an exact external FHIR evidence snapshot. A historical review is not durable permission. CI-EXT-16 evaluates whether that review still refers to **current** facts, source and consent revisions, and whether the reviewing clinician **currently** has verified clinical employment, credentials and facility-scoped privilege. It separately inspects any independently governed clinical approval artifact. Crucially, *no independently verifiable approval writer, issuer trust root or clinical release policy exists yet*. Thus a plausible `status=APPROVED` row **cannot** grant clinical use or AI drafting.

The evaluator is a server-only option on the existing `readExternalClinicalEvidence` Firestore transaction (`evaluateReviewId`). It reuses all the verified source-head/receipt/event, FHIR resource hash/version, live approved source, patient match, consent, facility, availability, history, reconciliation and 5-minute projection freshness checks. **It reads the historical review, reviewer membership, HCM employee/credentials/privileges and approval candidate inside the same transaction**, after re-reading all present patient and source facts. Any intervening Firestore mutation causes transaction conflict/retry, or a fresh mismatch; it cannot produce a previously verified authorization result.

For each requested review, the evaluator:
1. Requires independent evaluation permission `FHIR_CLINICAL_EVIDENCE_EVALUATE` **plus** `FHIR_EVIDENCE_REVIEW`, authenticated tenant, facility and active session.
2. Checks exact review schema, tenant/patient/review ID, `EVIDENCE_ONLY` marker, disposition, fact receipt IDs/version IDs/resource hashes, ordered source refs, source checkpoint, content hash and projection revision.
3. Recomputes the original **source and consent authority fence** (FireStore updateTime seconds + nanoseconds, source site/credential binding, verified patient link and consent) from the current transaction.
4. Re-reads `tenants/{tenantId}/users/{reviewerUid}`, exactly one `employees` record whose `userId` equals the reviewer Firebase UID, bounded `clinicalCredentials` (max 32), and bounded `clinicalPrivileges` (max 32). No match by email or display name.
5. Reuses `credentialsValid` and `activePrivileges`: active employee/member, explicit clinician role and review permissions, verified mandatory professional credentials with independent verification actor/time and unexpired issuance, and a current `CONSULT_OPD` or `SIGN_CLINICAL_NOTE` privilege for each source facility and current department. HCM facilities and source facilities must intersect exactly; revoked/suspended/expired/wrong-facility records fail closed.
6. Reads an optional `externalClinicalUseApprovals/{reviewId}` record, requiring exact patient/review/tenant, fact digest, authority fence, source checkpoint, content hash, independent approver and future expiry. **Even if these fields match**, the evaluator returns `CLINICAL_APPROVAL_PROOF_UNAVAILABLE` because no trusted approval signer or verifier has been deployed. The approval collection has no application writer in this milestone.

No historical review or raw FHIR resource ever becomes native Patient360 clinical authority. The evaluator returns `reviewCurrent` and `clinicianCurrentlyQualified` as **diagnostic eligibility fields**, not authorizations. It always returns `clinicalApprovalVerified=false`, `clinicalUseAuthorized=false`, `aiDraftingEligible=false`, `disposition='EVIDENCE_ONLY'` and a fail-closed reason. No writes to patient, projection, medical records or any clinical outbox. Existing `externalContextAccessAudits` still records every successful scoped read, including failed eligibility.

## API and deploy flags

`POST /api/integrations/fhir/current-authorization` accepts only `{tenantId,patientId,reviewId}` (strict IDs, 4 KiB maximum). Requires an authenticated active session and server-derived identity, explicit `FHIR_CLINICAL_EVIDENCE_EVALUATE` permission, FHIR R4 integration gate, runtime **TEST or STAGING**, and `GHIMS_CI_EXTERNAL_CURRENT_AUTH_EVALUATOR_ENABLED=true`. **Default OFF, PRODUCTION refused.** Response contains only the current eligibility result and a fixed `externalClinicalRelease='NO_GO'`; never a patient narrative, resource JSON, token, raw metadata or verified clinical fact.

The API is for synthetic qualification and privileged status diagnostics. There is **no** automatically authorized context adapter or AI drafting/medication/clinical-signing consumer. Do not wire an external draft API directly to `reviewCurrent=true` or `clinicianCurrentlyQualified=true`: those are insufficient for clinical use. Do not bypass PR #283's native-mode guard; it is a separate still-unmerged dependency.

## Firestore schema and indexes

Existing immutable `externalClinicianEvidenceReviews` created by CI-EXT-15 is unchanged. New reserved per-tenant collection:

```
tenants/{tenantId}/externalClinicalUseApprovals/{reviewId}
  schemaVersion: 1
  tenantId, patientId, reviewId: string
  status: 'APPROVED'       # candidate only, NOT a trusted grant
  approvedByActorId: string
  projectionContentHash, sourceCheckpoint, authorityFenceHash,
  factualDigest: hex SHA-256
  expiresAt: integer epoch milliseconds
```

This is **a future design contract, not an issuance API**. No client write/read permission, no admin mutation path, and no valid cryptographic issuer exist. Additional signature, medical credential, per-fact adjudication, site authorization and formal approval revocation must be designed and independently qualified before granting clinical use.

Existing `employees.userId`, `clinicalCredentials.employeeId`, and `clinicalPrivileges.employeeId` single-field equality queries are bounded with Firestore default single-field indexes. No composite indexes, additional read models, Cloud Functions, GCP resources or billing needed. **Security rule:** `match /externalClinicalUseApprovals/{reviewId} { allow read, write: if false; }`. All prior FHIR evidence/review records remain browser denied; Admin SDK must be guarded by authenticated, least-privilege server routes and audited access.

## Offline, rotation, invalidation and failure modes

- Offline cannot authorize a changed/replayed clinical context. Local cache and historical reviews are never proof of current consent, clinician privilege, facility assignment or source availability. On reconnect fetch and evaluate through a new server transaction; if offline, return **UNAVAILABLE**, not a cached allow.
- If patient consent changes to `WITHDRAWN`, source is `REVOKED`, patient matching changes or import updates without projection rebuild, the underlying FHIR reader rejects the transaction. If those settings are later restored, **Firestore updateTime authority fences** still make the earlier review stale.
- Reviewers whose membership is suspended, professional license expired/unverified, HCM employee terminated, or facility privileges revoked no longer qualify; HCM changes are checked each evaluation, not only at original review time.
- A new FHIR version changes the source head and facts hash; even after projection rebuild, the prior review cannot match.
- Mismatched approvals, missing trusted signatures and unverified signers are denied. A valid-looking Admin SDK row cannot confer release.
- A read transaction is not a long-lived token: its result can be stale immediately afterward. Any future actual clinical consumer must execute a fresh authorization check **at the same authoritative transaction boundary as use**; do not use a previously cached status or a boolean supplied by the browser. No such consumer is implemented here.
- Firestore transaction retries, bounded reads and fail-closed errors protect from partial assessment. No in-band clinical/financial/notification outbox is published by evaluation.

## Acceptance and open gates

The dedicated CI-EXT-03/16 workflow runs unit contract cases and Firestore emulator attacks: absent review, valid HCM with no clinical approval, fabricated approval, revoked/expired credentials, revoked privileges, suspended membership, source withdrawal/reinstatement, consent withdrawal/reinstatement, new version and projection refresh, cross-tenant/facility request and insufficient evaluator permission. Existing G3–G8 pinned offline suites remain intact.

**Remaining:** independent security code owner review, clinician safety signoff, CODEOWNERS/branch approval enforcement, hospital contracting and clinical governance, independent signer/HCM trust, real worker/IAM/SWP hosted qualification, and externally qualified ClinicalContextReader before AI use. These have not been implemented or authorized by this PR.

**G1_HOSTED=NO_GO | G2_HOSTED=NO_GO | EXTERNAL_HIS_CLINICAL_GO=NO_GO | PRODUCTION_RELEASE=NO_GO.**
