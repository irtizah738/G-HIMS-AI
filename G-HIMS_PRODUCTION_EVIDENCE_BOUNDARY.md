# G-HIMS Production Evidence Boundary

This repository distinguishes **implemented controls**, **automated verification**, **integration readiness**, and **external validation**.

## Repository-verifiable evidence

The codebase can verify:
- default-deny Firestore rules and server-authoritative mutation boundaries;
- tenant/session/role/privilege enforcement covered by automated tests;
- command idempotency, durable event/audit/outbox behavior covered by tests;
- governed offline replay;
- AI fail-closed behavior, provenance and human acceptance boundaries;
- explicit integration states and fail-closed FHIR/DICOM/telemetry/HL7/EDI behavior;
- environment-separation policy;
- liveness/readiness endpoints;
- structured operational-log redaction;
- production CI gates.

## External evidence required

The repository cannot self-certify:
- HIPAA, GDPR, ISO 27001, SOC 2, 21 CFR Part 11, medical-device or other regulatory compliance;
- hospital/IRB/pilot approval;
- cloud-provider BAA execution;
- achieved RPO/RTO;
- backup success or restore success without drill records;
- penetration-test results from an independent assessor;
- PACS/device/clearinghouse/payer certification;
- real-world clinical validation, uptime, latency or safety performance.

## Status vocabulary

Use only:
- `IMPLEMENTED` — code exists.
- `AUTOMATED-VERIFIED` — a named automated test/gate passes.
- `INTEGRATION_READY` — adapter exists but external connection/certification is pending.
- `SIMULATION_ONLY` — synthetic/demo behavior only.
- `EXTERNALLY_BLOCKED` — evidence or dependency outside the repository is missing.
- `NOT_IMPLEMENTED` — required control is absent.

Do not use `APPROVED`, `CERTIFIED`, `COMPLIANT`, `PRODUCTION-VALIDATED`, or quantified reliability/recovery claims without attached external evidence.
