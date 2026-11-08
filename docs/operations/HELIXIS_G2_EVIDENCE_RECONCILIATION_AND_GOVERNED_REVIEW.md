# G2 source-only Stage D evidence reconciliation and governed held-work review

**Scope:** TEST-only, `ghims-p4-ci` Firestore emulator, no external HIS HTTP.
**Security classification:** emulator qualification candidate, **NOT** production release or hosted G2 qualification.
**No billing, cloud, IAM, network, source migration, or clinical output changes.**

## Architecture

G2 work is a **derived** queue; each operation appends immutable event/audit/HELD-outbox evidence. An HTTP 200 results only in `EVIDENCE_PENDING` and cannot directly checkpoint a source.

The existing Stage D writer is the only component permitted to commit a checkpoint. G2 may subsequently transition to `EVIDENCE_RECONCILED` when the committed evidence passes a **fresh** single-transaction proof:

- Reauthenticate the sealed, AES-GCM-protected Stage C manifest against the original source and manifest document revisions and exact expected work item.
- Read immutable Stage D `fhirSourcePollEvents/{eventId}`, `auditLogs/fau_{eventId}`, and HELD `fhirSourcePollOutbox/fso_{eventId}`. Verify deterministic event ID, manifest version, item sequence, work ID, receipt ID, checkpoint digest and source lease's committed sequence.
- Read the expected immutable imported FHIR receipt, its current resource head, import event, import audit, HELD import outbox. Hash the stored `resourceJson`, validate `resourceType`, `id`, `meta.versionId`, and its provenance content digest.
- In the **same** Firestore transaction, read the receipt's verified patient link and canonical patient, and demand `GRANTED` consent, `VERIFIED` match, active unmerged patient, and matching tenant/source/facility.
- Only after every read succeeds: atomically update G2's **derived** state and create a unique immutable G2 transition event, audit and HELD outbox. Concurrent identical reconciliations are idempotent.

No HTTP response, caller-supplied checkpoint boolean, or G2 result can create a Stage D checkpoint, clinical fact, patient projection, clinical note, or FHIR source migration. `EVIDENCE_RECONCILED` means *local evidence chain validated at that transaction snapshot*, not clinically released or hosted qualified.

A patient link's consent can be withdrawn **after** a valid Stage D checkpoint. In that case reconciliation fails closed and leaves the prior immutable checkpoint and import trail intact. Review and correction are a new workflow rather than deletion or rewriting history.

## Governed held-work supersession

Held states `PAUSED_AUTH`, `HELD_ABSENCE` and `QUARANTINED` cannot be requeued automatically. To supersede the attempt:

1. A synthetic reviewer with `FHIR_POLL_SECURITY_REVIEW` permission submits an immutable `SECURITY` review to `fhirG2SyntheticWorkReviews`. A second independent synthetic reviewer with `FHIR_POLL_CLINICAL_REVIEW` submits a `CLINICAL` review.
2. Reviews are bound to one UUID `reviewId`, exact work key, source/manifest revision, transition sequence, lease epoch and held status. The reviewer may not be the work operator. Two roles must be held by **different** reviewer IDs.
3. Review intent is the fixed code `REQUIRES_NEW_MANIFEST`; no free-text PHI or arbitrary reopening instruction is accepted.
4. A second transaction rechecks the original sealed manifest/source authority and both reviews, then atomically changes the derived work status to `REVIEWED_SUPERSEDED` and emits immutable G2 event/audit/HELD outbox.
5. Superseded work cannot be claimed or resumed. A fresh source-authorized sealed manifest must be created and independently qualified to represent any new work.

This is a **synthetic authorization contract**, not proof of real identity-provider enforcement: `FhirImportActor` inputs are test fixtures. A hosted implementation must resolve actor identity, permissions, facility access and separation of duties from authenticated server-side identities, not accept reviewer objects from the client.

## Firestore data and indexes

All under `tenants/{tenantId}`:

- `fhirG2SyntheticWorkStates/fg2w_{hash}`: mutable **derived** state, with `reconciledCheckpointEventId` or `lastReviewId` after a verified transition.
- `fhirG2SyntheticWorkEvents/fg2e_{hash}`: immutable transition event, with provenance of the checkpoint or governance review ID.
- `fhirG2SyntheticWorkReviews/fg2r_{hash}`: immutable reviewer decision, bound to exact hold transition sequence and reason.
- `fhirG2SyntheticWorkOutbox/fg2o_{eventOrReviewId}`: immutable HELD qualification outbox.
- `auditLogs/fau_{eventOrReviewId}`: immutable source- and reviewer-attributed audit evidence.

Exact document-ID access is used. **No new composite index is required** for this offline slice. All G2 state, review, event and outbox collections explicitly deny **browser read and write** in `firestore.rules`. Firebase Admin SDK bypasses these rules, so hosted principal IAM would need separate minimum privileges and transaction authorization checks.

## Adversarial emulator acceptance

- No Stage D checkpoint event: HTTP 200 remains `EVIDENCE_PENDING`.
- Genuine synthetic imported receipt plus Stage D checkpoint: one idempotent `EVIDENCE_RECONCILED` transition, never clinical authority.
- Consent withdrawal before reconciliation, tampered receipt JSON, absent/mismatched event/audit/outbox or rewritten source revision: fail closed without G2 completion.
- Duplicate concurrent reconciliations: at most one immutable G2 reconciliation event.
- One reviewer missing, same person approving two roles, unauthorized reviewer, wrong facility/tenant or source revoked: supersession rejected.
- Two independently authorized reviewers: terminal `REVIEWED_SUPERSEDED`; old work cannot requeue.
- All previous G3–G8 contracts, source security, typecheck and **11** emulator suites retained.

## Non-billing work still outstanding

Further source-only actions: verified credential-revision pinning, a separate human-reviewed command to create a *new* sealed recovery manifest, realistic multi-page and mixed-status reconciliation, restoration with externally retained synthetic witness, and explicit telemetry/poison-queue alert contracts.

**Not claimable without a separately approved billed/hosted trial:** G1 SWP workload identity and fail-closed route evidence; G2 Cloud Run IAM, scheduler, network and KMS; vendor-origin FHIR authenticity, independently hosted witness/time, cross-region DR, clinical/hospital approval, production security review and actual production GO.

`G1_HOSTED=NO_GO`; `G2_HOSTED=NO_GO`; `PRODUCTION_RELEASE=NO_GO`.
