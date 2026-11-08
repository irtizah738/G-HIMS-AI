# Helixis G2 — durable, source-fenced offline work lifecycle

**Status:** source-only emulator qualification candidate. **Production release: NO_GO.**

## Execution boundary

This module is not a hosted broker, scheduler, or Cloud Run job. All exported mutations require `NODE_ENV=test`, `GHIMS_RUNTIME_MODE=TEST`, project `ghims-p4-ci`, Firestore emulator at `127.0.0.1:8080`, and disabled FHIR integration/import flags. A production/hosted invocation throws before accessing Firestore. No Google Cloud API, token, hospital FHIR endpoint or network transport is used.

The input to every action must be a valid, decrypted and authenticated Stage C `PollWorkManifest`. **Inside the same Firestore transaction** each operation rereads the authoritative source, checks tenant/facility/source, `ACTIVE`, security approval, `FENCED`, `syntheticOnly`, resource type, and the original source document `updateTime`; then rereads and authenticates the encrypted manifest, ensuring its exact plaintext and source revision still match. It never accepts a caller-supplied source authorization flag or "already checkpointed" claim.

## Firestore data model

Under `tenants/{tenantId}/`:

| Collection | Key | Contents | Write authority |
| --- | --- | --- | --- |
| `fhirG2SyntheticWorkStates` | `fg2w_<SHA256([tenantId,sourceId,manifestId,workId])>` | Derived status and epoch/attempt counters, revision pins and safe retry eligibility | Emulator-qualified server transaction only |
| `fhirG2SyntheticWorkEvents` | `fg2e_<SHA256([workDocId,transitionSequence])>` | Immutable ENQUEUED, CLAIMED or OUTCOME event, revision scope and recorded server timestamp | Transaction `create` only |
| `fhirG2SyntheticWorkOutbox` | `fg2o_<eventId>` | Immutable event metadata, `HELD`, `CI_EXTERNAL_CONTEXT_QUALIFICATION` | Transaction `create` only |
| `auditLogs` | `fau_<eventId>` | Immutable event metadata and server-authorized actor ID | Transaction `create` only |

The new collections are explicitly denied browser read/write in `firestore.rules`. No compound index is needed for exact-ID writes. A future hosted dispatcher would need a strictly tenant/source-sharded query strategy and separately reviewed composite indexes; no unbounded cross-tenant scans are implemented here.

The derived state stores **no raw FHIR payload**, OAuth token, patient ID, vendor cursor or private key. The immutable event/outbox contain no PHI. A future hosted implementation must validate actor/tenant authority using server-issued claims, not trust a worker-supplied actor object.

## Transition table

| Current | Operation | Next | Safety behavior |
| --- | --- | --- | --- |
| absent | enqueue sealed manifest item | QUEUED | Replay returns same state; event created once |
| QUEUED | acquire eligible claim | LEASED | Server read-time expiry; epoch increments; attempt count increments |
| LEASED (not expired) | identical claim | LEASED | Exact idempotent replay; no second event |
| LEASED (not expired) | another claim | Reject | Prevents simultaneous owners |
| LEASED (expired) | new claim ID | LEASED | New epoch; old owner fenced permanently |
| LEASED | HTTP 200 | EVIDENCE_PENDING | No checkpoint, import, clinical fact or completion |
| LEASED | HTTP 401/403 | PAUSED_AUTH | Requires source credential and site authorization review |
| LEASED | HTTP 404/410 | HELD_ABSENCE | Never auto-deletes imported clinical evidence |
| LEASED | HTTP redirect/unsafe/unknown | QUARANTINED | No arbitrary request forwarding |
| LEASED | transient HTTP with bounded Retry-After | RETRY_WAIT | Bounded jitter; maximum five attempts |
| LEASED | exhausted attempts or unbounded Retry-After | QUARANTINED | Manual reconciliation |
| RETRY_WAIT after due time | fresh claim | LEASED | Epoch+attempt increments; old claim cannot settle |
| EVIDENCE_PENDING / HELD / QUARANTINED | claim | Reject | Requires reviewed Stage D evidence and/or explicit new manifest |

**No automatic COMPLETED state exists here.** Completion must be integrated with Stage D's atomic evidence writer. HTTP status, caller-supplied receipt ID, a success boolean, or a local event alone are not sufficient. External Firestore-to-witness transactions cannot be treated as atomic distributed commits. Do not promote held outboxes.

## Failure tests

The Firestore emulator suite tests concurrent identical enqueue, concurrent claims, replay without duplicate event/audit/outbox, attempt and epoch monotonicity, takeover after simulated expiry, stale owner unable to settle, resume only after retry eligibility, conflicting response replay, HTTP 200 evidence pending, revoked source failure, auth pause, absence hold, redirect/304 quarantine, production/environment guards and absence of clinical projections.

The integration runner now compiles and runs **11 emulator suites**, compared with the preceding 10. The existing dedicated workflow retains Node/Bun typecheck, source lint, Stage A–H/G2 contracts, security and FHIR transport regressions.

## Known limitations and future work

1. **Manual review is not implemented.** No actor can release a held/quarantined item through this module. A separate, audited governance command with fresh source/consent checks must be designed.
2. **G2 is not connected to the actual synthetic reader.** No network action occurs in this work lifecycle; a future orchestrator integration must reconcile `EVIDENCE_PENDING` with Stage D and prevent duplicate external HTTP reads after crashes.
3. **No scheduler/backpressure/TTL service exists.** Durable `RETRY_WAIT` makes retry state explicit but does not launch work. Timers must use server-owned due times, tenant/source budgets, fair scheduling, jitter, and poison-work alerting.
4. **No local bypass claims.** G1 SWP actual identity enforcement, route removal anti-bypass, NAT/IPv6, private broker mTLS and DNS pinning require deployed, independently reviewed measurements.
5. **Production trust is absent.** Real provider KMS/Secret Manager IAM, vendor credential revision, witness root and trusted clock, real hospital site authority, DR and clinical signoff are unqualified.
6. **Source revision pins are deliberately strict.** Any source document rewrite, including an innocuous administrative update, holds work until a new manifest is reviewed; never silently widen authorization.

**Release status:** `G2_OFFLINE_DURABLE_WORK=QUALIFICATION_CANDIDATE`; `G1_HOSTED=NO_GO`; `G2_HOSTED=NO_GO`; `CLOUD_MUTATIONS=NONE`; `PRODUCTION_RELEASE=NO_GO`.
