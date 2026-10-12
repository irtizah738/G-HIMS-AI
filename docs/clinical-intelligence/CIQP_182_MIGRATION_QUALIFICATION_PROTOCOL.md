# CIQP-05 — Patient 360 policy epoch migration qualification (issue #182)

**Scope:** G-HIMS-AI only; **synthetic Firestore emulator** until independently approved staging change control. This document is a qualification protocol, not an authorization to mutate hosted patient data.

## Implementation and reproducibility
- Migration engine: `lib/clinical/patient360/ciqp-policy-migration.ts`
- Execution entry: `scripts/ops/ciqp-migrate-patient360-legacy.ts`
- Inspection: `scripts/ops/ciqp-inspect-patient360-legacy.ts`
- Tests: `emulator-security/ciqp-patient360-policy-migration.test.ts`, `tests/ciqp-patient360-policy-migration-guards.test.ts`, and revision-fenced timeline tests.
- Candidate implementation reviewed at SHA `0b84670e28182530faa5d0a806908dc97bf384c8` (2026-10-12). Later commits and test runs must be recorded separately.
- Audit records are tenant-scoped and client-denied. Preserve all immutable canonical events, outbox records, previous hashes, old checkpoints, and migration ledger records.

## Emulated rehearsal (no hosted data)
1. Use a **new, disposable** Firestore emulator instance on loopback; choose a unique tenant containing **synthetic** clinical documents, encounters, signed events, unsigned drafts, out-of-order metadata and historical timeline rows. Never copy real patient or production data into the emulator.
2. Export only aggregate counts and exact Git SHA. Set `GHIMS_RUNTIME_MODE=TEST`, `NODE_ENV=test`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `GHIMS_CIQP_MIGRATION_ACK=SYNTHETIC_EMULATOR_POLICY_MIGRATION_ONLY`, `GHIMS_CIQP_MIGRATION_TENANT_ID=<synthetic-tenant>`. Ensure production Firebase credentials and hosted endpoints are not present.
3. Run `GHIMS_CIQP_MIGRATION_MODE=DRY_RUN bun scripts/ops/ciqp-migrate-patient360-legacy.ts`. Record classification totals, all blocks, cohort truncation and zero-write assertion. Refuse promotion for ambiguous source cursors, incomplete generations, absent immutable evidence, or wrong tenant.
4. Back up the **disposable emulator fixture** to a separate location, verify restore to a distinct emulator instance and compare patient-scoped source hashes/counts.
5. Run `GHIMS_CIQP_MIGRATION_MODE=APPLY_SYNTHETIC bun scripts/ops/ciqp-migrate-patient360-legacy.ts`. Compare before/after revision, event checkpoint, canonical source fingerprint, content hash and every timeline row. Confirm no immutable clinical events or outbox messages changed.
6. Repeat the same command and require idempotent `ALREADY_CURRENT` or valid interrupted `RESUMED` results. Inject a crash between policy CAS and timeline completion, simultaneous workers, an intervening signed clinical event and a wrong-tenant attempt; require fail-closed read behavior, no stale publication, and no duplicate ledgers.
7. Validate restoration to the pre-migration synthetic state and rehearse the procedure for an interrupted deployment. Capture immutable output checksums, exact Actions/emulator job links, run SHA, operator identity and date. Never log MRNs, names, patient IDs or event payloads.

## Hosted staging prerequisites — NOT SATISFIED by this emulator harness
- Separate G-HIMS-AI staging Firebase project, explicit approval of test-data provenance, read-only discovery that redacts patient IDs/PHI and confirmed network/project isolation.
- Reviewed **separate** hosted-staging migration implementation and source/event atomicity controls. The current executor deliberately rejects any non-emulator host; do **not** weaken its guard to make hosted execution work.
- Backups, independent restore, rollback, recovery-time measurements and incident stop criteria approved in writing.
- Clinician review of signed-document provenance and Patient 360 timeline completeness; institutional authorization and named operator approval.
- Evidence manifest containing commit SHA, staging deployment SHA, tests, before/after aggregate counts and source hashes, scope, observed conflicts, audit/outbox preservation and dual sign-offs.

## Gate
**Status: SOURCE IMPLEMENTED / EMULATOR CI IN PROGRESS — HOSTED STAGING AND CLINICAL APPROVAL BLOCKED.** Do not close issue #182 or mark G-HIMS-AI clinically production-ready until exact-head tests have all passed and every hosted-staging/restore/institutional sign-off requirement above has verifiable records. Do not merge #189 solely because source CI is green.


## Implemented hosted-staging read-only diagnostic (source only; no hosted access yet)

This tool is separate from the emulator-only mutation harness. It makes
read-only queries to a dedicated G-HIMS-AI Firebase STAGING project and cannot
perform migration, rebuild projections or execute Firestore writes.

- Operator command: bun scripts/ops/ciqp-inspect-staging-readonly.ts
- Guard: lib/clinical/patient360/ciqp-hosted-staging-readonly.ts
- Unit tests: tests/ciqp-hosted-staging-readonly.test.ts
- Offline evidence completeness checker: bun scripts/ops/ciqp-verify-qualification-evidence.ts <qualification-manifest.json>
- Evidence tests: tests/ciqp-qualification-evidence.test.ts
- Dedicated source CI: .github/workflows/ciqp-182-readiness.yml

**This does not replace the outstanding hosted-staging migration executor/change
approval. Do not weaken the emulator-only migration guard or repoint the
emulator tool at a hosted database.**

### Isolated staging operator setup — independently authorized

The operator must first provision and verify:
1. A **separate G-HIMS-AI** Firebase STAGING project, not production
   g-hims-ai and not the unrelated G-HIMS-OS staging project.
2. A dedicated Firestore read-only identity scoped to staging, not a
   production service account. A project-scoped IAM restriction is essential;
   source-level read-only code is not a substitute.
3. A synthetic-only Firestore tenant named ciqp-synthetic-<cohort>; confirm
   test-data provenance through a separately retained signed attestation.
   The tool cannot independently prove that records are synthetic.
4. The exact approved G-HIMS-AI source SHA checked out clean, with no edits.

Set the following environment variables in the isolated operator terminal only:

- GHIMS_RUNTIME_MODE=STAGING
- FIREBASE_PROJECT_ID=<dedicated-ghims-ai-staging-project>
- GHIMS_FIREBASE_PROJECT_ID_STAGING=<same-dedicated-staging-project>
- GHIMS_FIREBASE_PROJECT_ID_PRODUCTION=<separate-real-production-project-id>
- GHIMS_CIQP_STAGING_TENANT_ID=ciqp-synthetic-<cohort>
- GHIMS_CIQP_STAGING_CONFIRM_PROJECT=<same-dedicated-staging-project>
- GHIMS_CIQP_STAGING_CONFIRM_TENANT=ciqp-synthetic-<cohort>
- GHIMS_CIQP_STAGING_EXPECTED_SHA=<40-character-clean-checkout-head>
- GHIMS_CIQP_STAGING_DATA_ACK=OPERATOR_ATTESTS_SYNTHETIC_ONLY
- GHIMS_CIQP_STAGING_READONLY_ACK=STAGING_READ_ONLY_NO_WRITES
- GHIMS_CIQP_STAGING_AUDIT_HMAC_KEY=<fresh-private-random-secret-at-least-32-bytes>

Do not set either emulator host variable. Supply credentials exclusively for
the dedicated staging project through approved local Google identity/ADC or
a project-scoped service account. Never commit tokens, private keys or HMAC
keys. GOOGLE_APPLICATION_CREDENTIALS, if used, must point only at a staging
read-only identity.

Run: bun scripts/ops/ciqp-inspect-staging-readonly.ts

The output contains only aggregate classification counts, a keyed HMAC,
a bounded coverage marker and permanent releaseAuthorization: NOT_GRANTED.
It never prints patient IDs, MRNs, event payloads, individual patient
fingerprints or keys. A zero-patient or over-limit cohort fails closed.
COHORT_MATCHED_ONLY is not a production patient inventory, migration or
clinical approval.

### Backup/restore and hosted apply design review (not yet executed)

1. Provision an independent restore target, separate from the source staging
   and production projects. Record export/import operation IDs, observed RPO
   and measured restore duration.
2. Compare keyed immutable-event and outbox HMACs, event counts and canonical
   source/timeline parity. Projection revision alone is not sufficient:
   migration intentionally changes legacy revision semantics without rewriting
   immutable clinical events.
3. A separately reviewed hosted staging executor must enforce an explicitly
   authorized synthetic cohort, policy epoch compare-and-swap, concurrent
   source rechecks, generation-fenced timeline writes, idempotent recovery,
   incident stop criteria, and project denylisting. Production writes remain
   forbidden.
4. Run the offline evidence-manifest checker. Even a syntactically complete
   manifest returns clinicalReleaseAuthority: NOT_ESTABLISHED and
   productionDeploymentAuthority: NOT_ESTABLISHED until the linked artifacts
   and signatures are independently reviewed.

### Still outstanding: actual externally authorized evidence

- Signed synthetic-data provenance, isolated staging Firebase project/IAM.
- Approved staging inventory and a separately reviewed synthetic hosted
  migration apply path; immutable events and outbox must remain untouched.
- Real export/import to an isolated restore target, operation logs, RPO/RTO,
  timeline parity and immutable integrity receipts.
- Named operator, independent credentialed clinician and institutional/site
  approval, plus a signed production change/rollback plan.
- Exact-head completed CI, staging deployment SHA and independent verification
  before declaring any external gate closed.

**Until this is evidenced, issue #182 stays OPEN and PR #189 stays DRAFT.**
