# G3 Stage D — Atomic Fenced Checkpoint Qualification

**Scope:** Local source-only engineering; exact base branch `feat/helixis-g3-g8-offline`, Git base `7eff2903bf8004a446a49038f4fe76681307b8fc`, **after** the Stage C source patch and Stage C security-runner fix.

**Release status:** `PASS_LOCAL_ONLY` is the maximum allowed result. **Production remains NO-GO**, including all R24/G1 egress, G2 hosted orchestrator, and G3 FENCED source migration gates. No live FHIR credentials, real patient data, hosted Firestore, Cloud Run, SWP, KMS or other billable qualification tasks.

## Why Stage D exists

Stage C encrypted and persisted source-bound work manifests, but its synthetic runner still used the CI-EXT-11 source-only checkpoint operation. After a remote read and immutable receipt commit, the source or encrypted manifest could change before that checkpoint transaction. The source-only lease fence does not independently prove that the currently approved *sealed manifest revision* is the one that authorized a specific checkpoint and versioned receipt.

Stage D changes only the **emulator-only** persisted runner to select `checkpointPersistedSyntheticPoll()` instead of the original coordinator checkpoint callback. The existing in-memory synthetic runner retains the legacy checkpoint path for its current CI-EXT-12 tests.

## Atomic transaction read set and checks

Transaction reads all of the following within one Firestore snapshot, before any writes:

```
/tenants/{tenantId}/fhirSources/{sourceId}
/tenants/{tenantId}/fhirPollWorkManifests/{manifestId}
/tenants/{tenantId}/fhirSourcePollLeases/{sourceId}
/tenants/{tenantId}/fhirSourcePollEvents/{reservedEventId}
/tenants/{tenantId}/fhirSourcePollEvents/{checkpointEventId}
/tenants/{tenantId}/fhirImportedVersions/{receiptId}
/tenants/{tenantId}/fhirResourceHeads/{headId}
/tenants/{tenantId}/fhirImportEvents/{eventId}
/tenants/{tenantId}/auditLogs/{auditId}
/tenants/{tenantId}/fhirImportOutbox/{outboxId}
/tenants/{tenantId}/fhirAvailabilityStates/{headId}
/tenants/{tenantId}/fhirPatientLinks/{linkId}
/tenants/{tenantId}/patients/{patientId}
```

- Validate actor tenant, `FHIR_IMPORT` and `FHIR_POLL_COORDINATE`, and facility scope on the trusted server.
- Revalidate source ACTIVE/APPROVED/FENCED and `syntheticOnly`; assert source `updateTime` exactly matches the sealed manifest's bound source revision.
- Authenticate the AES-GCM manifest payload and require both its original plaintext and exact Firestore document `updateTime` to match the initially loaded generation.
- Confirm active lease owner, claim UUID, epoch, expiration against **Firestore server readTime**, and expected checkpoint `sequence - 1`.
- Verify a previously written `FHIR_SOURCE_POLL_RESERVED` immutable event for the **same work ID**, epoch, and pre-request operation sequence.
- Verify a deterministic receipt ID derived from source, resource type, resource ID, and opaque source version. Require immutable CURRENT receipt, matching current head, import event, audit, and HELD outbox.
- Recheck the verified patient link, canonical patient state and `GRANTED` consent **in the checkpoint transaction**, so consent withdrawal after import blocks checkpoint.
- Any existing availability record must be `AVAILABLE_CONFIRMED` for the same current receipt, with no newer source operation. The initial successful verified import may have no availability-state document because CI-EXT-09 intentionally returns `UNCHANGED` without writing one; immutable import evidence + a matching current head remain mandatory in that case.
- Recompute the exact CI-EXT-12 manifest-bound SHA-256 checkpoint digest server-side; never accept a caller's digest or HTTP 200 without corroborating stored evidence.

If *any* guard fails, Firestore commits **nothing** in the checkpoint transaction; immutable pre-existing import evidence remains intact.

## Atomic write set

One Firestore transaction performs these writes:

```
UPDATE /fhirSourcePollLeases/{sourceId}           checkpointSequence, checkpointDigest, checkpointWorkId
CREATE /fhirSourcePollEvents/{checkpointEventId}  immutable, manifestId, manifestRevision, sourceRevision, operationSequence, receiptId, digest
CREATE /auditLogs/{auditId}                      immutable, same manifest and receipt evidence
CREATE /fhirSourcePollOutbox/{outboxId}           HELD, clinicalAuthority=false
```

A repeated whole-manifest execution sees the existing checkpoint and **does not refetch**. A direct duplicate checkpoint callback is rejected; it cannot create a duplicate event or claim a second commit. A process crash after receipt commit but before checkpoint is recoverable by a new lease epoch and replay of the immutable receipt.

**Indexes:** None added: transaction reads use deterministic document references. Firestore security rules: Stage C already explicitly denies client reads/writes to `fhirPollWorkManifests`, `fhirPollManifestEvents`, and `fhirPollManifestOutbox`; existing raw source/lease/import collections remain denied. Admin SDK bypass requires IAM, which this local qualification does *not* prove.

## Test scope and evidence

- 44 new Node-native pure checkpoint-guard tests: positive and 42 negative variants, including source and manifest revision changes, wrong identity and reservations, clock/lease expiry, patient merge/consent revocation, import evidence loss, and availability reversal.
- Seven new emulator tests added to Stage C's persistent-manifest suite: exact checkpoint event, consent withdrawal/recovery, manifest modification during the run, source revocation during the run, lease epoch takeover, reservation work ID tampering, and deleted audit.
- Re-run existing Stage C AES-GCM tests, prior G3-G8 controls, FHIR import/transport contracts, Wave 4 interoperability, ephemeral legacy security tests, and all eight FHIR Firestore emulator suites using `scripts/ops/helixis-g3-g8-one-go.ps1`.
- Runner must print `STAGE_D_ONE_GO=PASS_LOCAL_ONLY` only when all groups pass. On any failure, exit nonzero and preserve the transcript under `.tmp/g3g8-stage-c/one-go-transcript.txt`.

## Remaining deliberate blockers

1. Stage C cipher is an ephemeral TEST-only AES-256-GCM reference. Hosted key custody and rotation are not implemented or qualified.
2. No hospital FHIR HTTP scheduler, hardened source gateway, or permanent hosted work queue has been deployed; the synthetic callback is not a live adapter.
3. FHIR history and vendor cursor progression are not yet an end-to-end qualified hosted orchestration contract.
4. Hospital clinical authorization, emergency disclosure, external Patient 360 evaluation, IAM and hosted DR RPO/RTO remain independently unverified.
5. Legacy Hospital-0 `RESOURCE` aggregate mapping in durable Firestore is separately `REVIEW_REQUIRED`; security suite is deliberately run in TEST ephemeral mode. Do not silently alias `RESOURCE` to another aggregate.
6. G1 independently authenticated fail-closed egress and G2 hosted poll services remain NO-GO. Do not toggle any source `syncMode` or release flag.

## Recovery / rollback

Only the new emulator-only manifest path uses the Stage D callback. A source-only rollback can revert this incremental patch. Do not alter existing immutable events, delete recorded clinical receipts, clear the lease, or mark any production migration complete as a rollback shortcut. A staged operational rollback requires a separately approved compensating plan and evidence.
