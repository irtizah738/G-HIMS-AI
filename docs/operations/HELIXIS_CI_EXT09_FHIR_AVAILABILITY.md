# CI-EXT-09 — FHIR R4 Source Availability and Tombstone-Reconciliation Boundary

**State:** Synthetic engineering qualification candidate; **not** a production deletion or clinical-publishing feature.  
**Security:** R24 remains production NO-GO; existing network lab frozen.

## Clinical reasoning

A successful FHIR REST `GET` obtains a versioned clinical source record. A later
`404 Not Found` can mean an unknown resource, unavailable history, or source access
behavior. A `410 Gone` may indicate deletion in version-supporting servers, but
it is **not sufficient proof** that the clinical fact was historically false or
should be erased. Helixis must not overwrite immutable imported observations or
silently infer a patient lacks a problem/diagnosis/measurement.

Standards: [FHIR R4 RESTful API](https://hl7.org/fhir/R4/http.html),
specifically `read`, `vread` and `history` semantics.

## Bounded flow

```text
Authorized import request + ACTIVE source + hospital site approval
 -> server-pinned SMART backend token + FHIR GET, no redirects
 -> no previous imported resource head?
      -> 404/410 propagated as sanitized failure; no patient mapping invented
 -> existing head and HTTP 404/410?
      -> verified source/head/receipt/patient link/consent/site-approval in Firestore transaction
      -> immutable availability event + audit + HELD outbox
      -> OPEN REMOTE_RESOURCE_UNAVAILABLE case (or reused existing episode)
      -> derived availability state SUSPECTED_ABSENCE
      -> evidence reader immediately denies access on open case/availability state
      -> external Patient 360 rebuild excludes unavailable head's fact
 -> later valid HTTP 200?
      -> existing FHIR import transaction persists exact immutable version
      -> second fail-closed availability transaction verifies current receipt
      -> resolves matching availability case only on a strictly newer probe
      -> availability state AVAILABLE_CONFIRMED and immutable recovery event
      -> explicit external Patient 360 rebuild before evidence review
```

**Important:** The HTTP fetch is *outside* Firestore transactions. The two-transaction
success/recovery handoff is intentionally fail-closed: if recovery recording fails,
the imported FHIR version remains immutable while the previously OPEN case still
blocks clinical evidence. No automatic native Patient 360 event or AI draft is created.

## Source authorization contract

The server exclusively supplies `probeId` (UUID), `probeStartedAt` and the
observed transport HTTP status. The user request cannot provide an absence reason,
patient ID, remote endpoint, credential, source resource JSON or deletion instruction.

Each availability transaction revalidates:

- Firebase-authorized `FHIR_IMPORT` actor, tenant and facility;
- ACTIVE, APPROVED, operator-pinned FHIR source and allowed resource type;
- exact source/head/immutable receipt linkage;
- verified FHIR patient link, current consent and active canonical patient;
- credential revision and institutional site approval when SMART credentials exist;
- current receipt ID corresponding to the resource head.

A 404/410 can be recorded only for a resource that **was already imported before
the HTTP read**. The HTTP route captures that head receipt before making the
request. If the head advances before the transaction, reconciliation fails closed.
401/403 and transport errors are never interpreted as deletion evidence.

## Firestore data — tenant scoped

All three new collections are **Admin SDK only**; browser rules explicitly deny reads/writes.

- `/tenants/{tenantId}/fhirAvailabilityStates/{headId}` (mutable derived)
  - `{tenantId,patientId,sourceId,resourceType,resourceId,headId,sourceReceiptId,status,revision,episode,caseId,lastProbeStartedAt,lastObservedAt,lastEventId}`.
  - `status`: `SUSPECTED_ABSENCE | AVAILABLE_CONFIRMED`.
  - Only a validated 200 can resolve suspected absence. A newer version must
    be reverified before evidence publication, not merely imported.
- `/tenants/{tenantId}/fhirAvailabilityEvents/{eventId}` (immutable)
  - `{eventType,tenantId,patientId,sourceId,resourceType,resourceId,headId,sourceReceiptId,probeId,probeStartedAt,httpStatus,disposition,caseId,recordedAt,immutable:true,clinicalAuthority:false}`.
  - Event identity is SHA-256 of source identity + server probe UUID + kind.
- `/tenants/{tenantId}/fhirAvailabilityOutbox/{outboxId}` (held, not dispatched)
  - `{eventId,status:'HELD',destination:'CI_EXTERNAL_CONTEXT_QUALIFICATION',...provenance}`.

Existing collections used:
- `/tenants/{tenantId}/fhirReconciliationCases/{caseId}` — `reason:'REMOTE_RESOURCE_UNAVAILABLE'`.
  - Only the source-verified recovery workflow resolves this case; the
    existing dual-operator `SOURCE_VERSION_TIE` decision path refuses it.
- `/tenants/{tenantId}/auditLogs/{auditId}` — immutable action receipt.
- `/tenants/{tenantId}/fhirResourceHeads/{headId}` — untouched by 404/410.
- `/tenants/{tenantId}/fhirImportedVersions/{receiptId}` — immutable.

**Indexes:** No new composite indexes. All availability lookups use deterministic
document paths; pre-existing bounded patient-scoped case and head reads use
single-field `patientId` indexing. Never index raw FHIR payloads.

## Replay and races

- Repeated commit of one `probeId`, HTTP status and head receipt is idempotent.
  Conflicting reuse of the same probe ID is rejected.
- A second independent 404/410 in one unresolved episode creates audit/event
  evidence without creating multiple open cases.
- A request with `probeStartedAt` not newer than the latest committed
  observation is stale. Stale 404/410 is retained as immutable evidence but
  cannot reopen a resolved case; stale 200 cannot clear an open case.
- `probeStartedAt` uses trusted server wall-clock timestamps, not Firestore
  commit sequencing. Cross-worker clock skew and same-millisecond ties are
  **not independently qualified**; the conservative tie rule refuses to clear
  a suspected absence. A distributed source-poll lease/monotonic sequence
  is required before unattended multi-worker production ingestion.
- Case resolution does **not** mean a clinical reviewer has verified every
  imported fact. All facts stay `UNVERIFIED_EXTERNAL`.

## Patient 360 and disclosure gates

External projection rebuilds:
- Exclude any head whose derived availability is `SUSPECTED_ABSENCE`.
- Mark `RECONCILIATION_REQUIRED`, including `SOURCE_RETRIEVAL_UNVERIFIED:<headId>`.
- Refuse a new head after an older `AVAILABLE_CONFIRMED` state until
  its current receipt is reverified, yielding `SOURCE_NEW_HEAD_NOT_REVERIFIED:<headId>`.
- Include availability revision, status and receipt in `sourceFingerprint`
  so a recovery requires a fresh immutable projection revision.

The external evidence reader also rechecks availability within its disclosure
transaction, independent of projection freshness; a previously published
`EVIDENCE_ONLY` revision is *not* allowed to bypass an intervening absence case.

Native clinical events, native Patient 360 and AI drafting remain separate and
unqualified; no new clinical authority is introduced.

## Tests and release boundary

The isolated Firestore emulator suite `helixis-fhir-availability-reconciliation.test.ts`
exercises initial import; 404 quarantine; immediate reader refusal; immutable
replay; 410 escalation; source-head race; stale 200; versioned restoration;
stale 404 after recovery; re-verification of a subsequent new head; consent
withdrawal; cross-tenant rejection; held outbox; and no native projection write.

CI pipeline: `.github/workflows/helixis-external-fhir-r4.yml`.
Required: typecheck, source quality, FHIR contract tests, Firestore emulator,
existing regression tests. **CI pass is not hospital-site qualification.**

**Still blocked:** Vendor-specific history proof and true deletion tombstones,
source-specific 404/410 authorization semantics, persistent poll leases,
multi-worker temporal fencing, source removal, merge/split reconciliation,
complete provenance and clinical coding evaluation, comprehensive auditing
and independent security sign-off.

**Rollback:** Keep existing integration feature flags disabled. Revert this
feature PR if emulator gates regress. Preserve historical immutable evidence;
never delete source receipts or export unavailable evidence into native clinical
authority.
