# Helixis G3 Stage C — Sealed Synthetic Poll Manifest Qualification

**Status:** SOURCE-ONLY / EMULATOR-ONLY. **Production release: NO_GO.**
**Date:** 2026-11-08.
**Base:** G3–G8 offline patch on `feat/helixis-g3-g8-offline`, from `7eff2903bf8004a446a49038f4fe76681307b8fc`.

## Architectural decision

Extends the current CI-EXT-11 transaction-fenced source coordinator and CI-EXT-12 synthetic poll runner; does not replace or modify their lease, receipt, history, availability, or checkpoint implementation. Immutable source receipts remain authority-external; held outboxes do not dispatch to native Patient 360 or clinical AI drafting.

The Stage C improvement is a *source-only reference implementation* for a durable, encrypted per-source work manifest and opaque vendor cursor. It is an isolated synthetic emulator qualification, not a deployable hospital polling service. No OAuth tokens, live HTTP, gcloud commands, NAT, Secure Web Proxy or Google Cloud deployment are used.

## Data model (single tenant root)

`/tenants/{tenantId}/fhirPollWorkManifests/{manifestId}`

- Created once (`Transaction.create`) and never overwritten by this implementation.
- Safe searchable metadata only: `schemaVersion=1`, `tenantId`, `sourceId`, `facilityId`, opaque UUID `manifestId`, exact `sourceRevision` (server Firestore Timestamp seconds.nanoseconds), `status=SEALED`, `immutable=true`, `clinicalAuthority=false`, `createdAtMs`, `createdBy`.
- `payload`: authenticated ciphertext `{suite,keyId,nonceHex,tagHex,ciphertextBase64}`.
- The ciphertext contains `startCheckpointSequence`, at most 12 bounded work items `{workId,resourceType,resourceId,expectedVersionId}` and nullable `vendorCursor`. Resource IDs, version IDs and cursors are never persisted as plaintext manifest fields.
- Authenticated associated data (AAD) binds tenant, facility, source, manifest UUID and **exact** source revision. A change in source document revision requires a *new approved manifest*, not a silent resume.
- The intentionally emulator-only cipher uses random 96-bit AES-GCM nonces and a 256-bit test key. No test key is committed; no production KMS provider is implemented.

`/tenants/{tenantId}/fhirPollManifestEvents/{eventId}`

- Transaction-created immutable event `FHIR_POLL_MANIFEST_SEALED` with only scoped metadata and no raw patient/resource IDs or cursor.

`/tenants/{tenantId}/fhirPollManifestOutbox/{outboxId}`

- Transaction-created `status=HELD`, `destination=CI_EXTERNAL_CONTEXT_QUALIFICATION`; never dispatch clinical authority.

`/tenants/{tenantId}/auditLogs/{auditId}`

- Transaction-created immutable source approval trace. Same transaction as manifest/event/outbox; no plaintext cursor, token or resource body.

**Indexes:** No new composite Firestore indexes are necessary. Lookups are deterministic document IDs; no collection-group queries. Preserve existing index definitions.

**Security rules:** Add explicit `allow read, write: if false` entries for these three new collections under `match /tenants/{tenantId}`. The current default-deny already covers them, but explicit denials document the new sensitive collection boundary. Admin SDK bypasses rules: this is why source-specific IAM and server-side permission/consent verification are still mandatory for hosted use.

## Transaction/state boundaries

1. Reject any runtime except `TEST`, exact project `ghims-p4-ci`, exact emulator host `127.0.0.1:8080`, FHIR integration disabled, external import disabled.
2. Validate tenant/source/facility IDs and opaque UUID work IDs **before** constructing document paths.
3. Verify server actor has explicit `FHIR_IMPORT` and `FHIR_POLL_COORDINATE`, tenant and facility grants.
4. Inside Firestore transaction read the registered source and manifest document; require `ACTIVE`, `securityReviewStatus=APPROVED`, `syncMode=FENCED`, `syntheticOnly=true` and all manifest resource types approved.
5. Bind manifest to exact Firestore source snapshot revision (seconds and nanoseconds), encrypt with tenant/source-specific AAD and `tx.create()` the manifest, immutable event, audit and HELD outbox together.
6. If manifest UUID already exists, decrypt, authenticate and compare the exact payload. Exact replay returns `{replay:true}` without duplicate evidence. Different content fails closed.
7. Read through the server-only adapter, revalidating source revision and approval; decrypt manifest and use the injected fixture-only reader for bounded synthetic items. No arbitrary user-provided URL is called.
8. Existing CI-EXT-11/12 coordinates source lease, reservation before fixture read, immutable receipt/import audit/HELD outbox and availability; checkpoint after evidence commit. It tolerates crash after receipt before checkpoint by replaying under a new epoch.

### Explicit limitations — do not waive

- **G1:** Existing next-hop SWP R24 fails source identity matching; direct VPC bypass under route failures is not qualified. NO_GO.
- **G2:** This adapter is *not* a production Cloud Run worker, scheduler or real FHIR HTTP polling runtime. No persistent per-source work queue lifecycle, poison quarantine, managed retries, token refresh, source rate limiting or production cursor pagination yet.
- **Manifest-binding race:** Exact source revision is checked when loading the manifest, but the existing imported-receipt/checkpoint transaction does **not yet** verify the persisted sealed manifest revision atomically. A source change between load and commit can invalidate the previously checked manifest. The import transaction enforces its existing source/consent rules, but this does not complete the stronger Stage C manifest-commit binding gate. Before hosted deployment, extend CI-EXT-11 transactional fence/checkpoint to assert a stable manifest revision and work digest **in the same Firestore transaction**; test concurrent source mutation and stale in-flight worker responses. Do not claim this adapter closes that race.
- **Key management:** AES-GCM reference key is ephemeral and test-only. Source-specific KMS envelope key, rotation, re-encryption, access control, recovery and independent IAM review are not implemented. This blocks production.
- **Storage durability:** Local Firestore emulator test proves atomicity in the emulator, not hosted backup/restore, multi-region DR or restoration of KMS key generations.
- **G3 migration:** The module does not write `fhirSources/{sourceId}.syncMode`. The G3 offline planner remains dry-run-only. No LIVE or STAGING source toggle is authorized.
- **G4/G6/G7/G8:** Hospital contract, MFA, consent review, blinded clinical evaluation, production audit/logging/budget, supply-chain and independently signed GO are still outstanding. Production flags remain disabled.

## One-go local verification

Run after applying the Stage C source-only patch to the existing feature branch:

```powershell
Set-Location "$HOME\Helixis-G3-G8-Worktree"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\ops\helixis-g3-g8-one-go.ps1"
```

This invokes, as one guarded workflow:

- TypeScript (`bun run typecheck`), repository source quality (`bun run lint`).
- Existing FHIR import/transport unit contracts.
- Existing G3–G8 offline gates (17 tests).
- New Stage C AES-GCM, scope binding, tampering, revision/cursor tests (50 tests when last validated in the preparation runtime).
- Existing Wave 4 external interoperability and security regressions.
- Eight Firestore emulator suites (seven existing and one new, covering atomicity, competing workers, revocation, and tampering), compiled using repository's Node compatibility adapter and run under exact `ghims-p4-ci` emulator isolation.

The unrestricted repository-wide test command is deliberately excluded: unrelated tests have not been audited for hosted service calls. Expand the suite only after verifying it is synthetic-only and cost-safe.

No production deploy, gcloud IAM change, feature flag activation or GCP billing action is authorized. Confirm the final `STAGE_C_ONE_GO=PASS` **only after the user's own local emulator run**; do not infer this from the cryptographic unit tests alone.

## Acceptance and release

Success of local tests is necessary but insufficient. Every skipped billable/hosted/hospital approval remains `SKIPPED_COST` or `BLOCKED`, never `PASS`. Keep `G1_EGRESS_QUALIFICATION=NO_GO`, `G2_HOSTED_POLL_QUALIFICATION=NO_GO`, `SOURCE_FENCED_MIGRATION=NOT_PERFORMED`, `PRODUCTION_RELEASE=NO_GO`.

Future gate owners must review source KMS/ IAM, late source revision changes in the same transaction, source-scoped sealed manifest checkpointing, verified consent after recovery, SHA/digest attestations, and independently witnessed hosted/clinical negative tests.
