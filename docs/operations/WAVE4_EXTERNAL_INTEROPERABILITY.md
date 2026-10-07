# Wave 4 — External Interoperability Closure

## Status model

Wave 4 has two independent gates:

- **ENGINEERING_QUALIFIED** — protocol parsing, trust boundaries, fail-closed activation, replay/idempotency, resource allowlists, security rules, and production build are green in CI.
- **STAGING_QUALIFIED / PRODUCTION_QUALIFIED** — real partner endpoints have been exercised with deployment credentials and evidence has been captured.

A green engineering build does not prove a hospital LIS, FHIR server, PACS, biomedical device, or clearinghouse is interoperable in a specific deployment.

## Wave 4A — HL7 v2 over MLLP

Authoritative path:

MLLP source → TLS/mTLS listener → MSH-3/MSH-4 source routing → tenant binding → governed HTTP ORU ingestion → MPI/order resolution → RecordDiagnosticResultCommand → immutable event/audit/outbox.

Safety rules:

- MLLP is available only when HL7 integration state is LIVE.
- Production MLLP requires TLS and peer verification.
- Source application/facility must map to exactly one tenant.
- The tenant in the internal request must equal the source route.
- Frames are size bounded and socket timeouts are enforced.
- Transient internal HTTP failures may be retried only because MSH-10 drives the existing idempotency key.
- Unresolved patient/order identity goes to integration reconciliation; no guessed matching.

## Wave 4B — FHIR R4

FHIR traffic is blocked unless FHIR_R4 is LIVE.

The adapter has:

- an approved-resource allowlist;
- a separate writable-resource allowlist;
- CapabilityStatement R4 qualification;
- read/search retry only for transient responses;
- no blind write retries;
- conditional create support;
- optimistic update binding through If-Match;
- production HTTPS enforcement.

Default approved resources:

Patient, Encounter, Observation, DiagnosticReport, Condition, AllergyIntolerance,
MedicationRequest, MedicationAdministration, Procedure, CarePlan, DocumentReference.

Default writes are intentionally narrower:

Observation, DiagnosticReport, DocumentReference.

Deployment teams may narrow these sets further.

## Wave 4C — DICOMweb / PACS

LIVE PACS access requires an absolute endpoint. Production requires HTTPS and may use a host allowlist.

Wave 4 permits bounded read access:

- QIDO-RS study search;
- QIDO-RS series search;
- WADO-RS instance metadata;
- rendered-frame URL construction;
- live QIDO environment probe.

LIVE study searches require PatientID or AccessionNumber. Unbounded PACS browsing is rejected.

STOW-RS write is intentionally not enabled by Wave 4. PACS write-back must be a separate governed program.

## Wave 4D — Device / Biomedical

Network credentials do not establish biomedical safety.

Every external telemetry device profile must bind to a canonical ResourceMaster. Before device evidence is accepted, G-HIMS validates:

- biomedical resource type;
- lifecycle state IN_SERVICE;
- resource not MAINTENANCE / OUT_OF_SERVICE / LOST / RETIRED;
- calibration status VALID when calibration is required;
- calibration expiry;
- configured device model identity.

The existing Emergency pre-arrival telemetry path now invokes this canonical biomedical authority before ingestion.

## Wave 4E — EDI 837 / 835

EDI remains disabled unless all of the following are explicit:

- EDI_X12 integration state LIVE;
- GHIMS_EDI_PROGRAM_ENABLED=true;
- deployment-specific external conformance evidence recorded;
- clearinghouse endpoint and credential configured.

The structural 837 generator remains labelled STRUCTURAL_ONLY and does not claim external certification.

Inbound 835 remittance files:

- are authenticated;
- are content-hash deduplicated;
- enter ediRemittanceInbox;
- are marked REQUIRES_RECONCILIATION;
- never auto-post cash, contractual adjustments, denials, or patient responsibility into the ledger.

## Engineering qualification

Run:

`bun run validate:wave4`

This covers:

- Wave 4 protocol/authority tests;
- X12 structural tests;
- P2 interoperability safety;
- Wave 3 preservation;
- P8 baseline;
- offline resilience;
- security regression;
- Firestore rules;
- production build.

## Live qualification

Run only in an environment with real deployment credentials:

`bun run ops:wave4:live-qualification`

The harness validates enabled integrations only. It does not fabricate a PASS for disabled integrations.

Additional deployment evidence is still required for:

- real MLLP message/ACK exchange with each LIS/RIS source;
- FHIR CapabilityStatement and approved-resource interactions;
- PACS QIDO/WADO access;
- biomedical resource/calibration binding;
- payer/clearinghouse certification and companion-guide validation before EDI transmission.
