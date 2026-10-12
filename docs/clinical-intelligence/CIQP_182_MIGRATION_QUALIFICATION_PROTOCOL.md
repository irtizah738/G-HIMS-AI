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
