# CI-EXT-12 — Synthetic FHIR Poll Orchestrator Qualification

**Date:** 2026-11-05  
**Status:** Development qualification candidate only — not deployable as a hospital polling service.  
**R24:** Independently authenticated egress remains **NO-GO** for production FHIR.

## Purpose

CI-EXT-11 introduced a tenant/source-scoped Firestore lease, monotonically
increasing fencing epoch, server-issued operation sequence, and durable
checkpoint metadata. CI-EXT-12 exercises those contracts in a real
end-to-end **Firestore emulator** workflow, using a synthetic fixture reader
rather than a hospital network.

The implemented `runSyntheticFhirPoll()` performs the following sequence:

1. Refuse execution unless `GHIMS_RUNTIME_MODE=TEST`,
   `FIREBASE_PROJECT_ID=ghims-p4-ci`,
   `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`,
   `GHIMS_INTEGRATION_FHIR_R4_STATE=DISABLED`, and
   `GHIMS_CI_EXTERNAL_FHIR_IMPORT_ENABLED=false`.
2. Validate a bounded server-provided synthetic manifest (1–12 immutable
   work items, opaque UUID manifest/work identifiers, allowed resource types,
   exact expected FHIR resource ID + version).
3. Acquire the existing source lease under authenticated
   `FHIR_IMPORT` + `FHIR_POLL_COORDINATE` grants, an ACTIVE/APPROVED
   `FENCED` source, tenant, and facility.
4. Determine progress from `checkpointSequence`, verify the previous
   checkpoint's manifest-bound SHA-256 digest and work UUID.
5. For each uncheckpointed work item, reserve a **source-global** operation
   sequence *before* the synthetic read.
6. Execute the injected fixture callback outside Firestore transactions.
   No HTTP endpoint, OAuth token, browser command, arbitrary URL, or FHIR
   credential is accepted by this runner.
7. Validate FHIR resourceType, logical ID, and opaque version against the
   approved synthetic work manifest; import using the existing
   `ingestExternalFhirResource()` transaction, exact live lease fence,
   patient link/consent/source authorization and immutable source receipts.
8. Verify the receipt remains the authoritative imported resource head;
   run the existing FHIR 200 availability reconciliation transaction with
   the *same* operation fence. A 404/410 only creates an immutable
   suspected-absence case for a previously imported head.
9. Write a monotonic checkpoint **only after** successful import and
   availability reconciliation. Any error, refused identity, corrupted
   payload, 404/410 case, or `entered-in-error` clinical resource withholds
   the checkpoint. Erroneous resources still produce immutable import evidence
   before being held.
10. Release the lease after completing the approved manifest. On a simulated
    process crash, leave the lease active until server-time expiry/takeover;
    rerun the same manifest and replay the immutable receipt idempotently.

## State and data lineage

All changes use existing tenant-scoped Firestore paths:

| Collection | Record | Invariant |
| --- | --- | --- |
| `fhirSources` | Source registration | `syncMode: FENCED`, `ACTIVE/APPROVED`; no browser-configured source |
| `fhirSourcePollLeases` | Derived state | `epoch,workerId,claimId,issuedSequence,checkpointSequence,checkpointDigest,checkpointWorkId` |
| `fhirSourcePollEvents` | Immutable | ACQUIRED, RESERVED, CHECKPOINTED, RELEASED, etc. |
| `fhirSourcePollOutbox` | HELD | Never dispatched to native clinical authority |
| `fhirImportedVersions`, `fhirImportEvents`, `auditLogs` | Immutable | Exact source/version/hash and provenance, subject to established consent/authority |
| `fhirImportOutbox` | HELD | Source import does not create native clinical events |
| `fhirAvailabilityStates` and `fhirReconciliationCases` | Derived | 404/410 is unresolved availability, not patient-history deletion |

**Index requirements:** This change introduces no new Firestore collections or
composite indexes. All coordination and evidence lookups use deterministic
document IDs. Existing browser Security Rules deny raw coordination/event
and external clinical evidence collections; the Admin SDK is privileged and
requires a separately reviewed workload IAM boundary.

## Tests

`emulator-security/helixis-fhir-synthetic-poll-runner.test.ts`
is added to `.github/workflows/helixis-external-fhir-r4.yml`.

- Two-item successful poll; immutable receipt/event/outbox; released lease.
- Repeating an already completed manifest does **not** refetch a resource.
- Crash **after** imported receipt, **before** checkpoint: lease expires,
  a new worker takes over and reads the same synthetic FHIR version;
  immutable import replay occurs without duplicate receipts, then advances
  checkpoint exactly once.
- Previously imported head reports 404: immutable availability case and
  HELD outbox persist, no checkpoint. A subsequent versioned 200 resolves
  the availability case and permits checkpoint.
- 403 does not create a deletion/absence case or advance checkpoint.
- `entered-in-error` remains in immutable external FHIR evidence, but is
  not checkpointed as a qualified clinical reading.
- No native `patient360Projections` written or clinical AI authority granted.

## Critical limitations before real hospital use

This class is explicitly **emulator-only** and not called by a deployed
route, scheduler or Cloud Run worker. Its work plan and test fixtures are
in-process only. It is **not** a persistent, encrypted workload queue.

Production requires a *separate* implementation and qualifications for:

1. An encrypted, persistent per-source work manifest and bounded vendor
   cursor, with exact manifest revision bound to every checkpoint. Ensure
   it is recoverable from Firestore backup/KMS and that the key cannot be
   accessed by a client.
2. A separately authenticated Cloud Run worker and service authorization
   with source-scoped Secret Manager access, least privilege and
   reviewed hospital-specific FHIR site approval.
3. An independently authenticated, fail-closed egress boundary
   (ADR CI-EXT-08) from the **actual workload**. Do not repeat the frozen
   next-hop SWP source-matcher experiment; escalate that existing evidence
   to Google and qualify an alternative.
4. A real FHIR adapter bound to registered host/port, explicit credential
   revision, source/site consent and supported pagination; no redirects,
   unsafe DNS rebinding, writes or unapproved resources.
5. Fenced distributed work-item and checkpoint authority, poisoned-message
   quarantine, multi-worker rate limits, 401/403/429/backoff, abort and
   renewal semantics, retention, rollback and disaster recovery.
6. Hospital-specific legal/clinical acceptance and measured safety
   thresholds. Every external Patient 360 fact remains
   `UNVERIFIED_EXTERNAL`, not automatic native Patient 360/AI drafting.
7. Production release manifest: exact deploy SHA and immutable image
   digest, operational alerts, budget, source-specific canary,
   independently witnessed negative tests and GO/NO-GO signoff.

The developer workflow may pass 87+ CI jobs yet **production clinical
egress remains NO-GO** until release gates
[`#266`](https://github.com/irtizah738/G-HIMS-AI/issues/266)
and [`#254`](https://github.com/irtizah738/G-HIMS-AI/issues/254)
are independently closed on evidence.

## References

- `docs/operations/HELIXIS_CI_EXT11_FHIR_SOURCE_POLL_COORDINATION.md`
- `docs/architecture/ADR-CI-EXT-08-INDEPENDENT-EGRESS-BOUNDARY.md`
- `docs/operations/HELIXIS_CI_EXT09_FHIR_AVAILABILITY.md`
