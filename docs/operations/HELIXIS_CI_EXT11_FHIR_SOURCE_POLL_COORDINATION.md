# CI-EXT-11 — Transaction-Fenced FHIR Source Poll Coordination

**Status:** Synthetic qualification candidate. Not deployed or production authorized.  
**Date:** 2026-11-05  
**Existing security gate:** R24 Secure Web Proxy next-hop = PRODUCTION NO-GO.

## Decision

Use one transactionally updated poll lease per **tenant + FHIR source**, with
a monotonically increasing **epoch** for each acquisition/takeover, plus an
independently increasing **operation sequence** reserved before each HTTP GET.

A credentialed source explicitly opts in through `fhirSources/{sourceId}.syncMode
= "FENCED"`. For such sources, the immutable import transaction must validate
the active fence; availability and history transactions must also validate a
pre-reserved operation sequence and rank observations by that sequence rather
than worker wall-clock timestamps. Legacy sources without `syncMode` remain
on their current path until separately migrated. The current single-resource
HTTP route does **not** acquire leases: enabling FENCED on an active live
source without deploying the coordinated orchestrator makes that route fail
closed. Never flip the source setting to FENCED until a qualified orchestrator
is in place.

## Trust and workflow

```text
Authenticated server-only poll coordinator
   -> verify tenant + FHIR_IMPORT + FHIR_POLL_COORDINATE + facility + ACTIVE source
   -> acquire lease (Firestore transaction, authoritative snapshot readTime)
   -> receive {tenant, source, worker UUID, claim UUID, monotonic epoch}
   -> reserve operation sequence (new transaction and immutable event)
   -> perform ONE bounded FHIR HTTP read outside transaction (no token in browser)
   -> commit immutable import / history assessment / availability observation
        | exact active epoch + owner + claim + expiry checked IN SAME transaction
        | source-global operation sequence determines observation order
        v
      immutable source event + audit + held outbox + derived read state
   -> checkpoint success (transaction; monotonic checkpoint sequence)
   -> renew (if needed) or release lease
```

If the process crashes after evidence commit but before checkpoint, a new
worker acquires a higher epoch and resumes from the durable last checkpoint.
It must replay already completed source work through the existing immutable,
idempotent import contracts. The new epoch prevents the old process from
committing even if its in-flight remote HTTP finishes. A completed checkpoint
is **not** a clinical authorization or a claim of end-to-end source completeness.

## Firestore schema

All document paths are strictly tenant-scoped:

| Path | Mutability | Key fields |
| --- | --- | --- |
| `/tenants/{tenantId}/fhirSourcePollLeases/{sourceId}` | Derived state | `epoch` (monotonic integer), `status`, `workerId`, `claimId`, `expiresAtMs` (server-read-time based), `issuedSequence`, `renewalSequence`, `checkpointSequence`, `checkpointWorkId`, `checkpointDigest` |
| `/tenants/{tenantId}/fhirSourcePollEvents/{eventId}` | Immutable | `FHIR_SOURCE_POLL_ACQUIRED / RESERVED / RENEWED / CHECKPOINTED / RELEASED`, `epoch`, `sequence`, pseudonymous work pointer, digest |
| `/tenants/{tenantId}/fhirSourcePollOutbox/{outboxId}` | HELD | Event reference and non-clinical metadata |
| `/tenants/{tenantId}/auditLogs/{auditId}` | Immutable | Server actor, operation, epoch, sequence, digest |
| `/tenants/{tenantId}/fhirHistoryStates/{headId}` | Derived state | Optional `lastOperationSequence` for managed sources |
| `/tenants/{tenantId}/fhirAvailabilityStates/{headId}` | Derived state | Optional `lastOperationSequence` for managed sources |
| `/tenants/{tenantId}/fhirSources/{sourceId}` | Existing config | Optional `syncMode: 'FENCED'` |

Event IDs are SHA-256 derived from source identity + epoch + operation and
sequence. Source receipt/content and patient data are *not* written to source
poll coordination events. The checkpoint's `digest` must be a cryptographic
hash of an operator-defined internal work manifest, not a raw external FHIR URL
or PHI. The actual work manifest/cursor persistence and encryption scheme
remain a separate orchestrator responsibility.

**Indexes:** only deterministic tenant-scoped document IDs are used; no new
composite indexes are needed. The new lease/event/outbox paths are explicitly
`allow read, write: if false` in `firestore.rules`. This browser policy does
not constrain Admin SDK: server IAM and explicit coordinator grants are required.

## Lease constraints and failure handling

- Lease TTL is bounded to **5–300 seconds**. Firestore snapshot `readTime`
  determines expiry; no caller-provided clock is trusted to decide takeover.
- One active claim per source. Duplicate acquisition with the same worker and
  claim is replayed; takeover or voluntary release produces a strictly higher
  epoch. An expired claim cannot be resurrected with its old claim ID.
- Heartbeats and checkpoints require an unexpired, currently attached
  `epoch + workerId + claimId` and create immutable event/audit/outbox records
  in the same Firestore transaction.
- `RESERVED` operations increment a source-global `issuedSequence`.
  For `FENCED` sources history/availability observations compare that
  sequence against `lastOperationSequence`; a lower reservation is stale
  even when its wall-clock timestamp is greater.
- A checkpoint requires exactly `checkpointSequence + 1`. Replaying the
  same epoch/sequence/workId/digest is idempotent; conflicting replay fails.
  Missing checkpoints leave work replayable; a checkpoint is never advanced
  merely because the source returned an HTTP 200.
- Transactions are rerun by Firestore on contention. No external HTTP calls,
  email sends or other non-idempotent work is allowed in a transaction.
- Lease expiration cannot cancel a remote HTTP already in flight; it can and
  must prevent its eventual Firestore mutation. A broker outage/network
  disconnection must not fall back to an uncoordinated production route.
- `FHIR_POLL_COORDINATE` is a distinct server permission and does not replace
  `FHIR_IMPORT`, source approval, facility checks, clinician consent or the
  hospital's two-party site authorization.

## Qualification and still-open work

CI emulator:
`emulator-security/helixis-fhir-source-sync-coordinator.test.ts`.

Includes: concurrent lease contender blocked, same-claim replay, ordered
operation reservations, older response with later wall-clock refused,
checkpoint replay/sequence rejection, renewal, release, takeover, stale
worker rejection, expiry injection, resumed checkpoint and immutable held
outbox, no native Patient 360 mutation.

**Not included:** live poll scheduler, external HIS paging/cursor storage,
encrypted work manifest, credential rotation during long-running jobs,
multi-region orchestrator deployment, verified NTP/server clock behavior
under failover, production retries and operational alerting, server IAM
attestation, independent outbound egress qualification, or re-adjudication
of clinical deletion cases.

**Release gates:** All CI checks green, security review, synthetic
fault injection and operational qualification before source config migration.
Even if CI passes, R24 maintains **PRODUCTION NO-GO**.

Google Cloud references:
- https://firebase.google.com/docs/firestore/transaction-data-contention
- https://firebase.google.com/docs/firestore/manage-data/transactions
