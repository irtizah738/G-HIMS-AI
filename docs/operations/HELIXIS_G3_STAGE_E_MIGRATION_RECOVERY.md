# Helixis G3 Stage E — Synthetic Migration, Stale Restore and Evidence Reconciliation

**Status:** Source-only, `PASS_LOCAL_ONLY` maximum. `PRODUCTION_RELEASE=NO_GO` always.

**Scope:** Offline migration rehearsal of one already-completed **synthetic-only** FENCED source work manifest. **Never** changes a source's `syncMode`, user privilege, clinical record, poll lease, source snapshot, checkpoint, or vendor cursor. It creates only a non-authoritative evidence record, immutable event, audit and `HELD` outbox inside a single Firestore transaction. No live API traffic, credentials, hosted Firestore, SWP, Cloud Run, Cloud KMS or real PHI is accessed.

## Why this is not a real migration or DR qualification

The local HMAC signer simulates an **independent recovery anchor** preserved outside a restored snapshot. A real deployment must use a distinct security/storage domain and independently authenticated hardware-backed signing/verification. A signer constructed using state **after** rollback merely signs the rollback; Stage E does not solve that. There is no qualified production KMS, durable external WORM escrow, key rotation/revocation, verified restore, authentic dual-party approvals or live source authorization. All such gates remain `NO_GO`.

Stage E deliberately rejects multi-item manifests, even though Stage C supports up to 12. To qualify multiple items, every item's immutable receipt, current source head, consent, availability state and checkpoint linkage must be verified in a bounded transaction. Checking only the final item would be unsafe. Current Stage E deliberately tests the **single-item** case and records multi-item qualification as blocked.

## Data model (synthetic emulator only)

| Collection | ID | Persistence and authority |
|---|---|---|
| `tenants/{tenantId}/fhirPollMigrationRehearsals` | UUID `rehearsalId` | Immutable report with `dryRunOnly=true`, `productionAuthorization=NO_GO`, `anchorFingerprint`, `evidenceFingerprint`, reviewer identifiers. No PHI/cursors. |
| `tenants/{tenantId}/fhirPollMigrationEvents` | `fme_` + SHA256(tenant/source/rehearsal UUID) | Append-only `FHIR_SYNTHETIC_MIGRATION_REHEARSED` event. |
| `tenants/{tenantId}/auditLogs` | `fau_` + event ID | Immutable audit of the synthetic worker, with evidence fingerprints. |
| `tenants/{tenantId}/fhirPollMigrationOutbox` | `fmo_` + event ID | `HELD`, never publishable to clinical authority. |

Browser Firestore rules explicitly deny direct access to the three new domain collections. All four writes share one Firestore transaction; identical replay returns `replay=true`, a conflicting replay fails closed.

### Input contract

```
StageERecoveryAnchor {
  schemaVersion: 1,
  kind: 'SYNTHETIC_OFFLINE_EXPORTED_RECOVERY_ANCHOR',
  tenantId, sourceId, facilityId, manifestId,
  sourceRevision, manifestRevision,
  epoch, issuedSequence, checkpointSequence,
  checkpointDigest, checkpointWorkId,
  checkpointEventId, receiptId, macHex
}
```

`macHex` is a *test-only* HMAC-SHA256 binding each field in canonical sequence. No external or live credentials are accepted. Real anchor issuance must occur **before** backup/restore, and be retained outside the restored failure domain.

### Transactional read set

- `fhirSources/{sourceId}` and its `updateTime`; only `syntheticOnly=true`, ACTIVE, APPROVED and FENCED.
- `fhirPollWorkManifests/{manifestId}` and `updateTime`; AES-GCM authenticated, single-item payload.
- `fhirSourcePollLeases/{sourceId}`; exact anchored epoch, issued and checkpoint high-water, no active or expired in-flight lease, no sequence gaps.
- Exact checkpoint event, audit and HELD outbox by derived IDs.
- Exact import receipt, import event/audit/HELD outbox and current head.
- Availability state: absent only if verified initial import, otherwise `AVAILABLE_CONFIRMED` and not newer than the anchored operation.
- Verified patient link and active canonical patient with consent `GRANTED`.
- Proposed rehearsal ID and its three matching immutable evidence docs to enforce atomic replay.

The checkpoint digest, import receipt ID and checkpoint event ID must be **recomputed** from the source, work item, manifest, epoch and sequence; merely copying a signed anchor and plausible evidence cannot override these derivations.

### Deterministic failure modes

- **Interrupted rehearsal before commit:** no rehearsal/event/audit/outbox is created; retry produces one complete chain.
- **Concurrent same-ID attempts:** at most one chain; other participant must replay or fail with an explicit conflict.
- **Lost checkpoint or issued-sequence high-water:** held against pre-restoration anchor; never fabricate a successful checkpoint.
- **Old/forged source revision or rewritten ciphertext:** reject, including same-value Firestore document rewrite.
- **Unreleased lease, expired lease, operational gap or uncompleted manifest:** reject.
- **Missing import or checkpoint evidence, or unavailable source:** reject; never treat HTTP 200 as durable proof.
- **Consent withdrawal, patient merge, source disabling or changed tenant/facility:** reject.
- **Duplicate, self-attested or stale reviewers:** reject in local shape checks; these tests do not establish genuine signatures/MFA.
- **Entire database rollback + lost independent anchor:** **not detectable by this package**. Hosted DR must require independently preserved signed high-water evidence.

## Local qualification

Use the Stage E incremental patch on `feat/helixis-g3-g8-offline` **after Stage D**. Run `scripts/ops/helixis-g3-g8-one-go.ps1`; it invokes the existing TypeScript, source, contracts, G3–G8, Stage C, Stage D, Wave 4, test-ephemeral security suite, plus Stage E's pure adversarial assertions and **nine** Firestore emulator suites.

The PS script requires Java, Node 22+, Bun and Firebase CLI already present on the user's computer, a clean test emulator at `127.0.0.1:8080` and the synthetic project `ghims-p4-ci`. The output is a local qualification record, **not** a deployment authorization.

Remaining material blockers: G1 egress, G2 hosted poll runtime, production KMS/independent WORM recovery anchor, multi-item reconciliation, hosted DR, genuine reviewer identity/MFA, H0 `RESOURCE` durable mapping, hospital-specific clinical signoff, and real authorized G8 GO decision.
