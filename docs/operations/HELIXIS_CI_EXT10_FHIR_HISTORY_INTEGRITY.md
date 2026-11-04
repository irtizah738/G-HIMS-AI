# CI-EXT-10 — Source History Integrity and Deterministic Reconciliation

**Date:** 2026-11-05  
**Engineering status:** Synthetic-only qualification candidate; not a production integration approval  
**Scope:** G-HIMS-AI / Helixis Clinical Intelligence, tenant-scoped external FHIR R4 evidence  
**External network release:** R24 SWP source-identity enforcement **NO-GO** (unchanged)

## 1. Architectural decision

A FHIR R4 `history` Bundle is evidence of a source's reported versions, **not** proof
that every historic version was retrieved. `meta.versionId` is an opaque
identifier and SHALL NOT be incremented or numerically compared. A current
FHIR 404/410 or history DELETE entry MUST NOT erase previously imported clinical
facts, nor make the patient appear to have no such medical history.

This feature implements **bounded, server-fetched history-window assessments**.
The new adapter can request `GET /{type}/{id}/_history?_count=N` only for
approved FHIR resource types, using the existing token, timeout, byte limit,
no-redirect and retry safety controls. The adapter returns a single page; it
**never** follows an untrusted `next` URL. The history assessor validates
the scope and records a hash of normalized version metadata—not raw PHI.

**Integration status:** The adapter read and transactional assessor are implemented
but are not yet wired into any production scheduler, browser API, enabled import
feature flag, or external hospital gateway. A trusted server orchestrator must
capture source ID and head receipt before the remote read and run both operations
inside the existing hospital approval boundary.

## 2. Qualification state machine

```
   Imported immutable FHIR current head
                 |
                 v
      Authorized bounded history GET
                 |
          normalize + validate
                 |
        Source/head/consent/credential
        rechecked in Firestore tx
                 |
         +-------+--------+
         |                |
   WINDOW_ANCHORED    REVIEW_REQUIRED
   top version and    missing/mismatched
   timestamp match    head, timestamps tied,
   current head       DELETE entry, empty page
         |                |
   metadata-only       OPEN SOURCE_HISTORY_REVIEW
   evidence event      reconciliation case
         |                |
         +-------+--------+
                 |
     immutable event + audit + HELD outbox
       and revisioned history read state
                 |
       Patient 360 and evidence reader
       revalidate state and head receipt
```

`WINDOW_ANCHORED` means **only** the observed window's newest version matches
the imported head and the returned timestamps are newest-first. It does not
mean complete history, no deleted versions, clinically verified results, or
permission to promote facts into native Patient 360.

If `link[relation=next]` is present, record `paginated:true` but do not
follow an arbitrary URL. A later pagination implementation requires host and
scope binding, cursor validation, page limit, total byte budget, and independent
qualification of each continuation page.

## 3. Firestore schema and invariants

All documents are rooted under `/tenants/{tenantId}/`:

| Collection | ID | Immutable / derived | Content |
| --- | --- | --- | --- |
| `fhirHistoryStates` | `{headId}` | Derived mutable | `tenantId,patientId,sourceId,resourceType,resourceId,headId,headReceiptId,status,reasons,historyHash,revision,probeStartedAt,observedAt,eventId,caseId` |
| `fhirHistoryEvents` | `fhe_{sha256(tenant,source,type,id,probeId)}` | Immutable | Bound source/head identifiers, receipt ID, hash, page count, pagination flag, reason codes, probe and audit times; **no raw FHIR** |
| `fhirHistoryOutbox` | `fho_{assessmentId}` | HELD | Source-qualified, non-clinical event metadata, no automatic dispatch |
| `auditLogs` | `fau_{assessmentId}` | Immutable | Action, authorized server actor, source and outcome |
| `fhirReconciliationCases` | `frc_{issueHash}` | Existing review model | `SOURCE_HISTORY_REVIEW` is deliberately excluded from the existing SOURCE_VERSION_TIE approval path |

The existing `fhirResourceHeads` and `fhirImportedVersions` are **never**
modified by a history assessment. The selected head/receipt must match
`expectedHeadReceiptId` captured before fetching from the HIS. The
Firestore transaction rechecks that same receipt, source, canonical patient,
facility, verified patient link, current consent and (for SMART) credential
revision plus two-party hospital site approval.

**Indexes:** only deterministic document ID lookups are added. No composite
indexes or collection-group queries required. Existing `patientId` single
field indexes support the bounded patient-case query.

**Firestore Rules:** explicit `allow read, write: if false` for the three new
history collections. Admin access is restricted separately through cloud IAM
and server authorization. Firestore Rules do not restrict Firebase Admin SDK.

## 4. Concurrency, offline and failure handling

- Each remote observation has a **server-generated UUID** and a server-captured
  `probeStartedAt` timestamp. Transactional event IDs are deterministic,
  duplicate probes replay only when the normalized hash/head match, and reused
  probes with conflicting content are rejected.
- A probe older than the last committed history assessment is an immutable
  `STALE_IGNORED` event and cannot overwrite derived state or create a case.
- The imported current head is checked inside the assessment transaction.
  Concurrent or offline import advances the head → stale history assessment
  fails closed. Import itself already uses a Firestore transaction on the
  resource head, preserving timestamp ordering even for opaque version IDs.
- If an established history state points to a superseded head, Patient 360
  suppresses that fact and the evidence reader refuses disclosure until
  the newer head's window is assessed.
- An observed history DELETE, missing latest head, same-time ambiguous entries
  or empty window is a **review** case. It is *not* a clinical deletion or an
  instruction to delete evidence.
- Reassessment that becomes `WINDOW_ANCHORED` does **not** automatically
  close an earlier OPEN review case. Clinician/source repair and independent
  adjudication workflows must be designed before production use.
- Raw external evidence and historical records never become offline-write
  authoritative. Offline clients do not write source-history observations;
  stale cached projections are fenced at authenticated server read time.
- Cross-worker clock skew and leap/precision boundaries are NOT yet
  production-qualified. Before an unattended multi-worker importer, replace
  wall-clock ordering with a durable source-scoped poll lease and monotonic
  transactional epoch.
- This feature is not a vendor proof of complete source history; vendors may
  not support `history` or may omit deletion entries / truncate retention.

## 5. Test and release gates

Synthetic qualification file:
`emulator-security/helixis-fhir-history-integrity.test.ts`

Contract and transport tests:
`tests/helixis-fhir-r4-transport-safety.test.ts`.

Workflow: `.github/workflows/helixis-external-fhir-r4.yml`.

Cases include: opaque versions, instance-history scope and HTTP safety, paginated
first page, replay conflict, newest-first validation, deleted-resource evidence
holding, stale response, imported-head advancement, consent withdrawal, tenant
isolation, immutable events, HELD outbox, no native Patient 360 write and
concurrent import head ordering.

The independent security review must additionally qualify: bounded multiple
pages, vendor-specific deletion responses, vread proof, source version
corrections, source-poll fencing, malformed/hostile entry payloads, 401/403
suppression, multi-worker clock correctness, incident repair, IAM, alerting,
audit retention, rollback and disaster recovery.

**Release:** CI green is necessary but insufficient. Production egress remains
NO-GO under R24 until an independent authenticated gateway is qualified.
External data remains `UNVERIFIED_EXTERNAL`; clinical drafting and native
Patient 360 authority are not granted.

## 6. References

- HL7 FHIR R4: https://hl7.org/fhir/R4/http.html (history, vread, delete, pagination)
- CI-EXT-09: `docs/operations/HELIXIS_CI_EXT09_FHIR_AVAILABILITY.md`
- ADR CI-EXT-08: `docs/architecture/ADR-CI-EXT-08-INDEPENDENT-EGRESS-BOUNDARY.md`
