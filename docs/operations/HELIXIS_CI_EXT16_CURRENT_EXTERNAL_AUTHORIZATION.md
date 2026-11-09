# CI-EXT-16 — Current clinical-source authorization preflight

**Engineering status:** draft, source-only, non-promoting, not a deployment grant. Depends on CI-EXT-15 draft PR #285. No cloud, IAM, billing, network, production, external vendor or hospital patient-data actions.

**Decision:** A historical clinician review cannot be treated as a perpetual clinical approval. The server must re-evaluate **current** authority against the **same Firestore transaction snapshot** used to verify and disclose external FHIR evidence. No client, browser, IndexedDB outbox or prior API response can authorize a later clinical use.

## Execution boundary

The existing `readExternalClinicalEvidence` accepts the new **trusted-server-only** parameter `currentAuthorizationReviewId`. It remains inaccessible from any public route. If provided, the reader first verifies the entire clinical evidence transaction: patient identity/merge, current FHIR heads, immutable import receipts and events, hashes, source ACTIVE/APPROVED state, facility scope, verified patient link and current consent, availability/history, reconciliations and projection checkpoint.

Before the reader writes its atomic access audit, it calls `assessCurrentExternalClinicalApproval` **using that exact transaction**. The evaluator uses exact `externalClinicianEvidenceReviews/{reviewId}` lineage and the source/link Firestore `updateTime` **seconds + nanoseconds** fence from CI-EXT-15. A revoked-then-restored source/consent document changes its revision and invalidates old attestations. No second-transaction snapshot, stale cache or standalone `get()` is accepted.

The evaluator always returns `clinicalUseAuthorized=false`, `aiDraftingEligible=false`, `evidenceOnly=true` even for `state=PREQUALIFIED_NON_PROMOTING`. This status means that a *candidate set of derived heads* has matched; it is **not** an authorization for diagnosis, clinical summarization, a clinical alert, prescription, chart migration, Patient 360 promotion or an external `ClinicalContextReader`.

## Schema — tenant-scoped, server-only read models

All collections are `tenants/{tenantId}/...` and all have `allow read, write: if false` for Firestore client SDK access. The server uses its Admin SDK and separately governed IAM. Current-head documents are **derived views**; they are not a substitute for immutable issuance, credential, hospital policy and revocation events. This change adds no write endpoints or issuance mechanism.

| Collection / document key | Required contract | Failure behavior |
|---|---|---|
| `externalClinicianEvidenceReviews/{reviewId}` | Immutable CI-EXT-15 review, exact actor/patient, `SOURCE_EVIDENCE_REVIEWED`, content and projection revision, checkpoint, all fact source-version/hash references, current source/consent fence | Missing, contested, stale or mismatched denies |
| `externalClinicalCredentialHeads/{actorId}` | `tenantId`, `actorId`, facility list, `status=VERIFIED`, `identityAssurance=HOSPITAL_VERIFIED`, `licenseVerified=true`, integer `revision`, `validFrom`, `validUntil`, optional `revokedAt` | Missing, unverified, expired, revoked, wrong facility or revised credential denies |
| `externalClinicalSiteAuthorityHeads/{sourceId}` | Tenant/source/facility, `siteApprovalId` matching current FHIR source registration, `status=APPROVED`, `clinicalUseReviewStatus=APPROVED`, current revision and validity interval | Missing, expired, mismatched source, revised site authority or revoked policy denies |
| `externalClinicalFactApprovalHeads/{approvalId}` | Deterministic `externalFactApprovalHeadId(reviewId,receiptId)`, tenant/patient/review, exact fact receipt/version/hash/source ID, full fact digest, authority fence, `status=APPROVED`, immutable source `approvalEventId`, `revision`, site-authority revision, reviewer and approver credential revisions, independent `approvedByActorId`, validity interval | **Every** fact must match; no partial approval, self-approval or stale approver credential |

Timestamps are milliseconds since Unix epoch; `validFrom <= now < validUntil` and `revokedAt` must be absent/null. Revision values must be positive safe integers. One review covers **at most 64 facts and 64 sources**. No compound index is required: the reader uses its existing bounded per-patient indexes, while authorization uses direct document IDs only.

Example — *synthetic policy head* (not an issuance command or grant):

```json
{
  "tenantId": "synthetic-tenant",
  "sourceId": "synthetic-fhir-source",
  "facilityId": "synthetic-facility",
  "siteApprovalId": "site-approval-v1",
  "status": "APPROVED",
  "clinicalUseReviewStatus": "APPROVED",
  "revision": 4,
  "validFrom": 1794100000000,
  "validUntil": 1794300000000,
  "revokedAt": null
}
```

## Transaction / replay / offline semantics

- Identity, source, facility and patient matching are derived server-side in the existing reader; a client can never provide an approval status, credential, site policy or signature.
- Current source and consent `updateTime` binds every historical review. A new resource version, withdrawn/regranted consent, a recreated site policy, a patient relink, changed credential revision, revoked approver, expired license or expired approval fails closed. A prior `200` is not a durable authorization.
- The preflight only reads heads; it never mutates any approval, source, import, native chart or projection. The existing reader creates an immutable access audit that includes the preflight state/reason code, not clinical payload.
- In an offline PWA, an old review may be displayed only as explicitly *historical* local information. No offline actuation, approval promotion, final clinical drafting or automatic retry is accepted. Reconnection requires a new authorized live read/assessment; expired or conflicting intents require human review.
- Transaction retries can re-evaluate all heads. A policy change during the transaction must cause Firestore transaction conflict/retry or safe failure. An assessment is point-in-time, not a lease for subsequent downstream steps. Any later consuming workflow needs an atomic authority gate at **its own** point of use.
- No production or external HIS endpoint invokes this feature, so availability/billing problems do not relax policy.

## Required qualifications before any clinical activation

1. Institutionally governed **immutable clinical credential issuance/revocation event chain**, professional registration and clinician-patient assignment verification; signed and replay-safe.
2. Independently verified hospital site authority, contract, consent basis, source trust and source-license policies, plus security-owned credential rotation and review.
3. Separate immutable per-fact clinician approval issuance/events and a derived-head projector with integrity checks, revision fencing, independent clinician co-signature and tamper evidence.
4. Full preflight emulator races and rule-denial qualification; source/consent revocation and restore, credential expiration, policy revision, partially approved fact sets, patient merges, refresh, offline replay and malicious tenant tests.
5. Security review by `@AB2412`; independently authenticated clinical review by Dr Ufaq Waqas; hospital-specific contracting authority; G1/G2 hosted isolation/IAM; and a qualified external clinical context adapter before clinical drafting.

**Release gates:**

```text
CI_EXT16_PREFLIGHT_IMPLEMENTED=SOURCE_ONLY
CI_EXT16_APPROVAL_ISSUANCE=NOT_IMPLEMENTED
CI_EXT16_CLINICAL_USE=DENIED
EXTERNAL_HIS_CLINICAL_GO=NO_GO
G1_HOSTED=NO_GO
G2_HOSTED=NO_GO
PRODUCTION_RELEASE=NO_GO
```

Do not merge the stacked draft until upstream PR #285 is reviewed/merged, exact-head CI is green, and independent governance approvals are recorded. Cloud billing is currently inactive; do not attempt paid G1/G2 runtime deployments or bypass fail-closed checks to accommodate billing.
