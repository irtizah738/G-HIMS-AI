# G2 fresh-manifest recovery — zero-billing synthetic qualification

**Status:** stacked draft PR, emulator-only. **Production release: NO_GO.**

## Objective and strict boundary

Recover a previously **governed superseded** G2 work attempt into a **new immutable, sealed manifest**. The old attempt and all receipt/review/audit evidence remain untouched. The recovery routine cannot send HTTP, load OAuth secrets, checkpoint, requeue the original work, publish clinical output, or modify any Google Cloud resource.

Execution requires `NODE_ENV=test`, `GHIMS_RUNTIME_MODE=TEST`, `FIREBASE_PROJECT_ID=ghims-p4-ci`, Firestore emulator `127.0.0.1:8080`, external FHIR import disabled and HIS FHIR integration disabled. No real patient data or credentials.

The parent PR #274 must be reviewed independently before this stacked PR can be considered for merging. Both remain separated from live network testing.

## Authority and transaction model

`recoverSyntheticG2FreshManifest()` has a strict additional `FHIR_POLL_RECOVERY` permission beyond `FHIR_IMPORT` and `FHIR_POLL_COORDINATE`. The operator actor is a synthetic TEST fixture only; a hosted implementation must derive grants from authenticated server claims.

A single Firestore transaction:
1. Authenticates the old Stage C encrypted manifest, its immutable revision and the original work ID; reads the terminal `REVIEWED_SUPERSEDED` derived state.
2. Rechecks both immutable held-work SECURITY and CLINICAL reviews from different independent reviewer IDs, the matching supersession transition event, its audit and HELD outbox, and the fixed `REQUIRES_NEW_MANIFEST` resolution. No reviewer may be the recovery operator.
3. Rechecks the **current** source (tenant, facility, source ID, ACTIVE, APPROVED, FENCED, `syntheticOnly`, resource type) and pins its Firestore updateTime. The source must have a changed generation since the old manifest.
4. Requires SMART_BACKEND configuration with a positive, matching `credentialRevision`, a valid secret **version reference** (not material), and an independent **site approval** valid at Firestore server read time. The site approval must bind the source/facility/resource type/revision, remain unexpired, and have distinct clinical/security approvers.
5. Revalidates the verified patient link, currently GRANTED consent, same tenant/source/facility, and an active, unmerged canonical patient.
6. Verifies there is no active source poll lease and that the new manifest's `startCheckpointSequence` equals the last committed checkpoint (or zero when no lease exists).
7. Permits only one fresh work item, matching the old FHIR resource identity. New manifest ID and work ID must be distinct UUIDs; the version ID may be updated to the corrected source version. The cursor must be NULL to forbid replaying a stale vendor cursor.
8. Atomically **creates** the new AES-GCM sealed manifest, immutable manifest event/audit/HELD outbox, immutable recovery record/event/audit/HELD outbox, each bound to the supersession review and current credential revision.

A deterministic recovery record keyed by old work and review prevents a conflicting second new manifest. Exact same recovery replay returns without writes after revalidating live consent/site/source authority.

**No derived G2 work is enqueued in the recovery transaction.** A separate, reviewed, authenticated enqueue call for the new manifest is required. The old work stays terminal. Recovery does not establish vendor authenticity or new evidence.

## Firestore schema and browser isolation

Under `tenants/{tenantId}`:

| Collection | Key | Meaning |
| --- | --- | --- |
| `fhirPollWorkManifests` | New UUID | New authenticated encrypted manifest; immutable |
| `fhirPollManifestEvents` | `fpme_{manifestId}` | New sealed manifest event |
| `fhirPollManifestOutbox` | `fpmo_fpme_{manifestId}` | HELD qualification outbox |
| `fhirG2SyntheticFreshRecoveries` | `fg2fr_{sha256([oldStateId,reviewId])}` | Immutable one-to-one recovery proof |
| `fhirG2SyntheticRecoveryEvents` | `fg2re_{recoveryId}` | Immutable recovery event |
| `fhirG2SyntheticWorkOutbox` | `fg2o_{recoveryId}` | HELD recovery outbox |
| `auditLogs` | New manifest + recovery IDs | Immutable attributed audit records |

Existing `fhirG2SyntheticWorkReviews`, `fhirG2SyntheticWorkEvents`, `fhirSiteApprovals` and `fhirPatientLinks` are read, never altered. New recovery collections explicitly deny browser read/write in `firestore.rules`. All operations use exact document IDs, so no new composite index is required in this slice.

Only **non-PHI metadata** is emitted into recovery audit/outbox. Patient link ID is a deterministic pseudonymous identifier, not raw patient identity; nevertheless access must remain server-only because joins could expose protected information.

## Adversarial emulator tests

- Concurrent duplicate recovery creates exactly one new manifest, one recovery record and correct immutable audit/HELD outbox.
- Authorized new manifest can be enqueued as `QUEUED`; old `REVIEWED_SUPERSEDED` stays terminal.
- Stale credential revision, stale source updateTime, source revocation, missing/stale site approval, withdrawn consent and merged patient reject recovery.
- Wrong tenant/facility, absent recovery permission, non-independent/forged reviews and tampered supersession proof reject.
- Conflicting second manifest ID or work ID rejects as a replay conflict.
- Reusing prior manifest/work ID, sending vendor cursor, unrelated FHIR resource and trying to execute in PRODUCTION are denied.
- No FHIR source checkpoint or Patient 360 projection is created by the recovery command.

## Limitations and release status

The site review and OAuth configuration are **synthetic fixtures**, not a vendor token exchange or proof of legal hospital authorization. A signed state transition alone is not sufficient vendor-origin assurance. This does not authorize Cloud Run, Secret Manager, real Epic access, source migration, clinical publication or patient-facing use.

Remain blocked pending independent GitHub CODEOWNER/security reviews, actual G1 network identity/fail-closed egress, G2 hosted worker IAM + scheduler, KMS/rotation, vendor certificate and OAuth attestation, independent witness/trusted time, backup/DR and hospital clinical governance.

`G2_FRESH_MANIFEST_SYNTHETIC=QUALIFICATION_CANDIDATE`; `G1_HOSTED=NO_GO`; `G2_HOSTED=NO_GO`; `PRODUCTION_RELEASE=NO_GO`.
