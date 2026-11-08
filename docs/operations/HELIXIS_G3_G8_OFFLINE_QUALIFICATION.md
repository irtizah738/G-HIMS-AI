# Helixis Clinical Intelligence — G3–G8 Offline Qualification

**Baseline:** `main@7eff2903bf8004a446a49038f4fe76681307b8fc` at preparation.
**Prepared:** 2026-11-08.
**Change classification:** Source-only; local test and documentation; no billing, IAM, deployment, Firestore, feature-flag or cloud resource mutation.
**Decision:** `NO_GO_COST_CONTROL` / `PRODUCTION_NO_GO`.
**Trust assumption:** G1 next-hop SWP R24 independent source identity and fail-closed route proof is still **NO-GO**. G2 does not yet have qualified deployed broker/production orchestrator. No evidence in this document overrides those dependencies.

## 1. Architectural scope

The existing system already has:

- `external-fhir-sync-coordinator.ts`: transaction-fenced source lease (epoch), pre-I/O operation sequence, immutable poll events/audit and HELD outbox, transactional checkpoint.
- `external-fhir-synthetic-poll-runner.ts`: emulator-only, bounded synthetic import and availability poll with receipt/replay and delayed checkpoint.
- `external-fhir-import.ts`: tenant+facility+source scoped import receipt, resource head/version provenance, verified link and consent at commit, immutable audit/HELD outbox.
- `firestore.rules`: browser denies `fhirSources`, leases, poll events/outbox, import receipts, clinical import and external Patient 360 collections.
- `ADR-CI-EXT-08-INDEPENDENT-EGRESS-BOUNDARY.md`: proposed independently authenticated broker; *not deployed or qualified*.

The added `external-fhir-g3-g8-qualification.ts` is intentionally **pure**: it constructs a migration plan, assesses whether a checkpoint could be eligible, and evaluates metadata-only release evidence. It does not have Cloud SDK/Firebase credentials, a Firestore writer, a network client or a production GO path. Its results are advisory for independent reviewers, **not authoritative approvals**.

## 2. G3 — explicit fenced-source migration

### Rules

1. Only a named `STAGING_SYNTHETIC` tenant/facility/source is eligible for a reviewed plan. Never apply the plan to LIVE sources as a convenience.
2. Baseline source must be `ACTIVE`, security review `APPROVED`, use a synthetic-only fixture, not already `syncMode:'FENCED'`, and have an exact revision read-back.
3. An independently verified orchestrator end-to-end PASS, successful one-off-writer disarm, and two distinct review identities are prerequisites. A self-attested boolean in the plan's input **does not constitute actual qualification evidence**.
4. `planSyntheticFencedMigration` returns `{syncMode:'FENCED'}` as a *proposed patch only*. It never writes. As of this package, the G3 **write/rollback deployment remains blocked** by G2.
5. The existing one-off import route cannot obtain the source lease. Once `FENCED` is actually enabled, that route must fail closed. If the orchestrator does not work, the source stays `FENCED`/suspended until a new approved compensating migration; do **not** silently downgrade it to legacy mode.

### Future migration transaction (not executed here)

```
root = /tenants/{tenantId}
read /fhirSources/{sourceId} at exact updateTime/revision
read /fhirSyntheticPollQualifications/{qualificationId} (signed, source-bound, immutable)
read /fhirSourceMigrationApprovals/{approvalId} (two independently verified reviewers)
read /fhirSourcePollLeases/{sourceId} (absent/released and checkpoint reconciled)
assert verified source, no legacy writer, scope & consent policy, STAGING only
transaction:
  update fhirSources/{sourceId} syncMode='FENCED', migrationGeneration=N
  create fhirSourceMigrationEvents/{deterministicId} immutable actor, sourceRevision, evidence SHA
  create auditLogs/{deterministicId} immutable security + clinical approval references
  create fhirSourceMigrationOutbox/{deterministicId} status='HELD'
re-read source+events+outbox; prove legacy one-off route refuses write
```

**Do not implement the mutation by handing a client an Admin SDK credential or relying on browser Firestore rules.** A future trusted server entrypoint must verify environment and approval authority again, including duplicate request ID handling and a compare-and-swap source precondition.

### Indexes and browser rules

No composite index is needed for the current source-scoped deterministic document IDs. If the future migration event/approval/outbox collections are created, add explicit browser-deny patterns under `/tenants/{tenantId}`. Do not deploy a new collection/index until the actual server query is implemented and reviewed. Firestore Admin SDK bypasses security rules: its IAM/workload identity is a separate mandatory gate.

## 3. G4 — identity, IAM, site approvals

- Dedicated worker identity per environment; no service account keys on disk, browser, or in a repository. Enforce per-source Secret Manager *resource-level* `roles/secretmanager.secretAccessor`, with explicit scope to the tenant/source and credential revision. Never grant project-wide access as a shortcut.
- Server checks must bind actor, tenant, facility, site contract/authority, approved endpoint, read-only FHIR scopes, patient link and **current** consent inside the clinical evidence commit transaction. A prior GET 200 cannot substitute for authorization at commit.
- Least privilege is independently reviewed at runtime. Browser must not read/write lease, events, outbox, manifest, cursor, source credentials or raw imported evidence. Persist manifests/cursors encrypted, not plaintext in Firestore or IndexedDB.
- MFA and change approval are separate institutional controls. Clinical data use requires independent security + clinician review and authorized hospital site scope. Break-glass emergency disclosure requires an approved, time-limited, narrowly scoped workflow and immutable post-event review; no standing bypass.
- Evidence requirement: redacted IAM snapshot, principal-to-secret mapping, Secret Manager policy revisions, security-rules emulator denial, approvals referencing the exact source and allowed scopes. **None of these can be asserted PASS merely by executing this pure module.**

## 4. G5 — deterministic concurrency, offline faults and disaster recovery

Critical test matrix (emulator or deterministic synthetic harness, no paid endpoint):

| Failure class | Required invariant |
| --- | --- |
| Two workers / lease contention | One active epoch; competing worker rejected; no duplicate immutable receipts |
| Lease expiration/takeover | New epoch; old epoch cannot commit clinical evidence or checkpoint |
| Pre-HTTP sequence / clock skew | Global monotonic operation sequence; no client clock in ordering |
| Crash after receipt, before checkpoint | Durable receipt/event/audit/HELD outbox preserved; replay idempotent; checkpoint later exactly once |
| 401/403 | Authorization blocked; no inferred deletion, no checkpoint |
| 429, 5xx | Bounded retries with per-source backoff; no checkpoint; suspend on exhaustion |
| 404/410 | Suspected absence case + `HELD` outbox, never irreversible patient-history deletion |
| Stale resource head / out-of-order version | Immutable historical version; reconciliation fence; no stale head advancement |
| Consent withdrawal/source suspension | Revalidate at commit; reject in-flight worker; preserve audit |
| Regional outage, offline backlog | Persistent encrypted manifest/cursor; resumption with new epoch; no token/PHI leak |
| Delete/tombstone, duplicate messages | Versioned evidence only; stable IDs and replay deduplication |
| Restore / rollback | Immutable event+receipt+audit+outbox parity, checkpoint never ahead of reconciled receipt |

`assessFhirCheckpoint` is a deterministic **necessary-condition predicate** for tests and release evaluation, not a substitute for `checkpointSourcePollLease` and its Firestore transaction. It deliberately denies checkpoint if any prerequisite fails, including HTTP 200 without a committed receipt, audit or HELD outbox.

### Limitations

The code tests fault *decisions*, not actual two-worker Firestore concurrency, encrypted persistence, regional failover or real network failure. Existing emulator integration tests cover some of these; extended emulator tests and independently measured restore/RPO/RTO are still required before marking G5 complete.

## 5. G6 — external clinical correctness

- External data retain source/vendor, original FHIR resourceType/id/version, source lastUpdated, local receipt ID, content hash, patient-link revision, provenance, source status and independent clinical review state.
- No direct promotion to native `patient360Projections`; external Patient 360 uses a separate derived projection and `UNVERIFIED_EXTERNAL` status.
- Source error, stale history, absent resource, ambiguous timestamps or conflicting versions create `RECONCILIATION_REQUIRED`/`HELD`, not an invented clinical fact or automatic AI drafting authority.
- Emergency access is a clinical governance decision with time-limited, named actor/source/patient scope, patient-safety justification, immutable event/audit and later independent review. Local tests cannot sign this on behalf of a hospital.
- Blinded/synthetic evaluation must record cohort provenance, sample size, reviewer identities, severity categories, measured harms/omissions, approved thresholds, inter-rater disagreement, re-review, and immutable versioned result snapshots. Until approved, G6 clinical authorization is incomplete.

## 6. G7 — operational release package

Before production, retain independent, dated proof of:

- Architecture, security and clinical sign-off for **exact tenant+facility+source** and allowed FHIR scopes.
- Source Git SHA, immutable artifact/image digest, CI/supply-chain attestations and vulnerability/license reviews. A file hash is not a verified build provenance or an image attestation.
- Runtime service account+Secret Manager grants, external authenticated egress control, route/firewall/IAM snapshots from the **actual workload**, and negative no-bypass tests from that workload. Never mark R24 as closed by source-only tests.
- PHI-free sanitized broker/egress logs, alerting and paging, rate limits, quotas, capacity, budget hard bounds, operator playbook, backup restore measured RPO/RTO, and observed rollback rehearsal.
- Emergency disable/stop criteria: unexpected public egress, identity mismatch, expired consent, mutable receipt, unresolved source error, outbox dispatch, unapproved clinical drafting, checkpoint without receipt, or billing cap exceeded.

## 7. G8 — release decision

The offline evaluator `evaluateG3G8Offline` checks evidence *metadata* for the required controls, duplicate evidence, scope mismatch, malformed hashes, missing independent signoff, disabled flags and explicit G1/G2 status.

The evaluator **ALWAYS returns `productionDecision:'NO_GO'`**, even if every metadata row is `PASS`; this is by design. Only an independently authenticated deployment/change-authorization system with verified artifacts and site clinical authority can eventually issue a production GO. The local repository must not contain a hidden bypass flag.

Current status: `G1=NO_GO`, `G2=PARTIAL`, `G3=PLAN_ONLY`, `G4–G7=PARTIAL`, `G8=NO_GO_COST_CONTROL`. The `SKIPPED_COST` status is a documented missing proof, **never a PASS**.

## 8. Firestore schema and security boundary

Existing paths (do not migrate or overwrite):

```
/tenants/{tenantId}/fhirSources/{sourceId}
/tenants/{tenantId}/fhirSourcePollLeases/{sourceId}
/tenants/{tenantId}/fhirSourcePollEvents/{eventId}
/tenants/{tenantId}/fhirSourcePollOutbox/{outboxId}   # HELD
/tenants/{tenantId}/fhirImportedVersions/{receiptId}
/tenants/{tenantId}/fhirImportEvents/{eventId}
/tenants/{tenantId}/fhirImportOutbox/{outboxId}       # HELD
/tenants/{tenantId}/fhirAvailabilityStates/{headId}
/tenants/{tenantId}/fhirHistoryStates/{headId}
/tenants/{tenantId}/fhirReconciliationCases/{caseId}
/tenants/{tenantId}/externalPatient360Projections/{patientId}
```

Proposed *future* migration records (not created/deployed in this change):

```
/tenants/{tenantId}/fhirSourceMigrationApprovals/{approvalId}
/tenants/{tenantId}/fhirSourceMigrationEvents/{eventId}     # immutable
/tenants/{tenantId}/fhirSourceMigrationOutbox/{outboxId}    # HELD
```

No new composite indexes are necessary for this source-only qualification module; it performs **no Firestore queries**. Future production queries require query-plan-specific indexes and corresponding security rule tests. Browser security posture remains `allow read,write: if false` for protected source/evidence paths, including all future migration paths.

## 9. Local commands and evidence handoff

Run without Firebase, `gcloud`, paid API, or network connection:

```sh
node --experimental-strip-types --test tests/external-fhir-g3-g8-qualification.test.mjs
```

In this isolated implementation session, 17 pure unit tests passed locally. This does not attest to repository-wide Bun CI or Firestore emulator results.

Evidence must be stored as signed metadata-only JSON referenced by immutable SHA-256 and exact Git SHA (no tokens/PHI). Each required control starts `NOT_RUN` or `SKIPPED_COST`; only an independent qualified verifier may mark PASS. A reviewer must confirm source bound, timestamp, artifact signature, test execution environment and actual result before treating it as evidence.

**Final release disposition:** `NO_GO_COST_CONTROL`; imports, native Patient 360 promotion and clinical AI drafting remain disabled. No cloud billing workaround, deployment, production toggle, Live FHIR API call, IAM mutation, or new cloud resource is authorized.
