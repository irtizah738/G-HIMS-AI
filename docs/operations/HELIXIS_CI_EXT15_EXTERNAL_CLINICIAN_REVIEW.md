# CI-EXT-15 — Clinician review of externally sourced FHIR evidence

**Status:** source-only, externally sourced facts remain `EVIDENCE_ONLY`. `EXTERNAL_HIS_CLINICAL_GO=NO_GO`, `PRODUCTION_RELEASE=NO_GO`.

## Safety decision and architecture

A hospital clinician may record having reviewed or contested an exact bounded external FHIR Patient 360 evidence snapshot. This is *not* permission to present these facts as a native chart, issue medication orders, draft notes or publish clinical conclusions. The existing external reader remains the authority for deciding whether facts are currently viewable. This milestone adds a durable append-only evidence-of-review layer inside the reader's **same Firestore transaction**.

The review endpoint `POST /api/integrations/fhir/clinical-review` is **default disabled** (`GHIMS_CI_EXTERNAL_CLINICAL_REVIEW_ENABLED=true` must be explicitly set), rejects `GHIMS_RUNTIME_MODE=PRODUCTION` even when enabled, requires the existing enabled FHIR R4 integration state, and uses the server-derived authenticated tenant, facility, actor and permission context. The browser may supply only a tenant ID, patient ID, and an explicit version-pinned review command—never a token, source URL, patient mapping, actor role, clinical output or authorization override.

Review authority requires both `FHIR_EVIDENCE_REVIEW` and `FHIR_CLINICAL_EVIDENCE_REVIEW`, plus one of `DOCTOR`, `CONSULTANT`, or `ATTENDING_PHYSICIAN`. `SYSTEM_ADMIN` alone is insufficient. The clinician must not be the actor that imported any reviewed source receipt. The clinician role and permission must be provisioned through real hospital-issued server-authoritative identity; no permission is created by this PR.

Before writing, the existing reader transaction verifies the source-head/checkpoint consistency, imported immutable receipt and event hashes, version order, active source approval, facility membership, verified canonical patient link, current consent, availability, history and absence of unresolved reconciliation. The clinician must attest the exact `projectionRevision`, `projectionContentHash`, `sourceCheckpoint`, and **all** source receipt IDs, versions and SHA-256 resource hashes displayed through the separately authorized `/api/integrations/fhir/evidence` API. The server compares these to the verified transaction snapshot; stale or incomplete claims are rejected.

## Firestore model (per tenant; no compound index)

All writes use deterministic, tenant- and actor-scoped idempotent IDs derived from a caller-supplied UUID (but not trusted for authorization):

- `tenants/{tenantId}/externalClinicianEvidenceReviews/{reviewId}`: append-only `schemaVersion=1`, tenant/patient/reviewer, `disposition`, source refs, exact evidence receipt/version/hash references, content hash, projection revision, source checkpoint, a SHA-256 `factualDigest`, and a SHA-256 `authorityFenceHash` over fully qualified Firestore source/consent revisions (seconds **and** nanoseconds), source facility, credential revision, approved site binding, verified patient link, match/consent statuses. Also includes `submissionHash`, `recordedAt`, `immutable=true`, `clinicalUseAuthorized=false`, `aiDraftingEligible=false`, `evidenceOnly=true`.
- `tenants/{tenantId}/externalClinicianEvidenceReviewEvents/{eventId}`: immutable `EXTERNAL_CLINICIAN_EVIDENCE_REVIEW_RECORDED` event with same scope/evidence references, no resource JSON.
- `tenants/{tenantId}/externalClinicianEvidenceReviewOutbox/{outboxId}`: same event held at `status=HELD` and `destination=CI_EXTERNAL_REVIEW_GOVERNANCE`. There is **no** publishing worker or clinical authority transition.
- `tenants/{tenantId}/auditLogs/{auditId}`: immutable reviewer-attributed review audit; `externalContextAccessAudits` continues to log the read. No clinical payload or OAuth material is written to a review record.

All four review/event/audit/outbox writes (plus the read audit) commit atomically after all transaction reads. Duplicate idempotency key for the exact same transaction context is a replay, with no duplicate review/event/outbox. A replay with changed disposition, source, consent, patient matching, site binding, or source content is rejected. No overwriting, updating or deleting reviews.

No composite indexes are introduced: reads/writes use deterministic IDs and the pre-existing patient-scoped source-head and case queries. Browser Firestore rules explicitly deny **all reads and writes** for the three new review/event/outbox collections, and the pre-existing `auditLogs` collection retains its server-only boundary. An Admin SDK server identity bypasses client rules; workload IAM/least-privilege controls require separate hosted qualification.

## Request contract (synthetic staging only)

```json
{
  "tenantId": "synthetic-tenant",
  "patientId": "synthetic-patient",
  "review": {
    "idempotencyKey": "<fresh UUID v4 from the review client>",
    "expectedProjectionRevision": 2,
    "expectedProjectionContentHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "expectedSourceCheckpoint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "expectedFacts": [
      {
        "evidenceReceiptId": "fir_synthetic",
        "sourceVersionId": "v3",
        "resourceHash": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
      }
    ],
    "disposition": "SOURCE_EVIDENCE_REVIEWED"
  }
}
```

Allowed dispositions: `SOURCE_EVIDENCE_REVIEWED` or `CLINICAL_CONCERN_RECORDED`. This acknowledgment is **not** a clinical fact approval or clinical source of truth. Even a successful response contains `clinicalUseAuthorized=false`, `aiDraftingEligible=false`, and `evidenceOnly=true`. External Patient 360 still reports `dataQuality.externalEvidenceVerifiedByClinician=false` until a separately defined clinical approval and revocation model is evaluated; that model is not provided in this milestone.

## Offline, corrections and failures

- No direct offline signature or queued browser write is accepted. An offline client may save a **local draft intent** for convenience, but on reconnection it must retrieve fresh evidence via the permissioned server API, compare revision/consent/source authority, and submit a *new* server-validated intent. Never replay a stale approval.
- 404/410 suspected absence, history uncertainty, unresolved reconciliation, source revocation, patient merge/relink, withdrawn consent or inaccessible facility all fail closed at review time.
- An old immutable review is a historical record, **not a current approval**. The runtime never reads it to authorize AI drafting. Do not introduce a client-side check of `review.disposition` as a clinical approval shortcut. A future `isCurrentClinicalApproval` evaluator must revalidate current source/consent generation and explicitly signed clinical policies in a fresh transaction.
- Source/consent Firestore revisions (seconds+nanoseconds), evidence content hashes and site binding are recorded as review fences. They are not KMS signatures, vendor-authentic source proofs, secure time attestation, or independent external clinical credentials.
- The current basic clinician permission is a server-verified identity/role check. Institutional license verification, clinician assignment to the patient, professional credential status, two-party clinical signoff, versioned source policies, HIPAA/local privacy review and hospital-site agreement remain separately required for real data.

## Acceptance and release

Emulator qualifications must prove: independently authorized clinician success and exact replay; same-key conflicting disposition denial; rejection of admin-only and importer self-review; cross-tenant/facility denial; stale content hash/version; source, patient match and consent revisions; no unauthorized writes after failures; no patient360 or AI projection change; HELD outbox and immutable events.

**Do not merge/deploy solely on green CI.** Require independent security review by `@AB2412`, separately authenticated clinical review by Dr Ufaq Waqas, functional hospital authorization, reviewer privilege provisioning, and hosted G1/G2 acceptance. The CODEOWNERS PR and GitHub required approval count are separate governance gaps.

**G1_HOSTED=NO_GO | G2_HOSTED=NO_GO | EXTERNAL_HIS_CLINICAL_GO=NO_GO | PRODUCTION_RELEASE=NO_GO.**
