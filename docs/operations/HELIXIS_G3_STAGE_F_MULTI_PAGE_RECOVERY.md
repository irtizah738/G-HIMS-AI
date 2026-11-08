# Helixis CI G3 — Stage F, synthetic multi-page recovery rehearsal

**Decision:** `LOCAL_EMULATOR_ONLY`, `PRODUCTION_RELEASE=NO_GO`.

Stage E qualified a single-item recovery chain. Stage F extends evidence verification to **2–3 ordered encrypted manifests, 2–12 distinct resource items, and (within the bound) recovered earlier-epoch reservations**, without introducing hosted infrastructure or live FHIR requests.

## Architectural invariant

A complete recovery rehearsal may be recorded **only** if an independently retained *emulator-test-only* HMAC anchor and its signed page/step ledger agree with a consistent Firestore transaction snapshot that includes:

- Active approved synthetic FENCED source, exact source Firestore `updateTime` revision, and tenant/facility scope.
- Every encrypted manifest, its exact `updateTime` revision, approved resource type, unique resource head, and uninterrupted checkpoint sequence.
- Every prior operation reservation (`RESERVED`), including abandoned reservations from an earlier epoch. Abandoned reservations must be superseded by a new epoch. Gaps and duplicates fail closed.
- Every committed checkpoint event, checkpoint audit record, and HELD checkpoint outbox, bound to manifest revision, receipt, global operation sequence, epoch, and digest.
- Every immutable current source import receipt and its current head, import event, import audit, HELD import outbox, verified patient link/consent, and active nonmerged patient.
- No active or expired in-flight lease; final lease must be `RELEASED` with its global issued-operation watermark and last checkpoint matching the signed anchor.
- Two **different synthetic** reviewers (security and clinical) with the exact signed anchor fingerprint, neither of whom is the operator.

**No completion on HTTP 200 alone.** No missing item is silently omitted. No report can claim clinical publication. The only mutation is an **atomic create-only** `fhirPollMultiRecoveryRehearsals`, `fhirPollMultiRecoveryEvents`, `auditLogs`, and `fhirPollMultiRecoveryOutbox` (status `HELD`). Existing evidence is revalidated on idempotent retry.

## Bounded design and limitations

The verifier intentionally accepts a maximum of 3 pages / 12 items / 12 abandoned reservations / 24 issued operations. It expects an **initial synthetic source sequence of zero**, with ordered pages and globally nonduplicated `(resourceType, resourceId)` heads. For updated versions of the same resource in separate pages, historical evidence needs a different domain model; Stage F rejects that ambiguity instead of claiming present-day head equality.

The signed anchor does not contain resource IDs, patient IDs, clinical JSON or decrypted vendor cursors. Its cryptographic key must be retained outside Firestore during tests. **This proves no production KMS, external escrow, immutability/WORM, true independent storage, or full backup/restore.** A key and anchor stored alongside a restored database would not independently detect rollback. The operator constructs the anchor before any corruption/restore simulation; it is never regenerated from corrupted data to obtain a PASS.

Page ordering proves a **sequence of locally approved manifests**, not vendor-authenticated `_history` pagination, opaque cursor continuity, `next`-link trust, server certificate, or ETag semantics. Those remain `NOT_QUALIFIED` for production.

The standard `runPersistedSyntheticFhirPoll` still performs all import/checkpoint writes via Stage D's bounded transactions. Stage F is a **read-only reconciliation/rehearsal**, not a substitute worker or a migration API. A crash after import but before checkpoint may leave an unused reserved operation; a new lease epoch may replay the immutable receipt and complete that sequence without dropping the intervening checkpoint. The signed anchor must explicitly list the abandoned operation and its immutable reservation event.

## Firestore collections

All below are nested under `tenants/{tenantId}`. Browser reads/writes of Stage F collections are explicitly denied by `firestore.rules`.

- `fhirPollMultiRecoveryRehearsals/{rehearsalId}` — immutable dry-run receipt containing tenant/source/facility, signed anchor fingerprint, sequence bounds, page/item counts, reviewers, `productionAuthorization: NO_GO`.
- `fhirPollMultiRecoveryEvents/{eventId}` — immutable dry-run domain event (deterministic ID from tenant/source/rehearsal ID).
- `auditLogs/fau_{eventId}` — immutable server-only actor audit.
- `fhirPollMultiRecoveryOutbox/fmro_{eventId}` — `HELD`, never dispatched to clinical projection.

The transaction uses direct document reads for each anchored checkpoint/receipt and avoids unbounded collection scans or non-transactional authority checks. It fails on absent documents or changed mutable evidence. Firestore will retry/reject on conflicts; no HTTP operation occurs inside the transaction.

## Qualification matrix

1. Signed multi-page happy path with four items; exact retry, conflicting retry, and concurrent duplicate proposals.
2. Synthetic pre-commit failure leaves **zero** partial rehearsal records; retry creates one chain.
3. Crash after imported receipt but before checkpoint; emulate lease expiry, then validate takeover in a new epoch with the abandoned reservation retained.
4. Missing intermediate checkpoint, import receipt, audit, HELD outbox, current head, changed patient consent, source revision, encrypted manifest or lease watermarks => **no rehearsal evidence**.
5. Cross-tenant/underprivileged actor, forged signature/review, duplicate/overlapping pages, unaccounted reservation or partial final checkpoint => **no qualification**.
6. Preserve Stages A–E, TS/lint, FHIR and security regressions, then compile and run all **ten** Firestore emulator suites from the isolated synthetic project.

### Production blockers deliberately retained

`G1_EGRESS=NO_GO`, `G2_HOSTED_POLL=NO_GO`, `PRODUCTION_KMS=NOT_QUALIFIED`, `HOSTED_INDEPENDENT_ANCHOR=NOT_QUALIFIED`, `LIVE_FENCED_MIGRATION=NOT_PERFORMED`, `VENDOR_CURSOR_CHAIN=NOT_QUALIFIED`, `G6_CLINICAL_SIGNOFF=PENDING`, `G7_DR_HARDWARE_RESTORE=PENDING`, `G8_RELEASE=NO_GO`.

Also retain `H0_RESOURCE_ALIAS_DURABLE_MAPPING=REVIEW_REQUIRED` and `SECURITY_SUITE_PERSISTENCE=TEST_EPHEMERAL_ONLY`; neither is closed by the Stage F test runner.
