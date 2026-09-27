# G-HIMS OS — Engineering Readiness Status

## Purpose

This document describes repository-level engineering evidence. It is **not** a regulatory approval, hospital go-live authorization, security certification, clinical validation, or independent audit report.

## Current architecture evidence

The repository implements and tests the following engineering boundaries:

- server-authoritative Firebase identity, tenant membership, session and authorization resolution;
- tenant-scoped Firestore read models with server-only authoritative writes for sensitive stores;
- command/idempotency/event/audit/outbox transaction boundaries;
- governed offline command replay instead of browser-authoritative reconciliation;
- human-reviewed AI drafts with provider/model provenance and explicit integration activation;
- explicit LIVE / INTEGRATION_READY / SIMULATION / DISABLED integration states;
- fail-closed FHIR and DICOM integration adapters;
- HL7 authentication and message-type restrictions;
- structural-only X12 validation with external payer/clearinghouse conformance still required;
- environment/project separation contracts;
- PHI-conscious structured operational telemetry;
- backup/restore commands and a disaster-recovery runbook with target RPO/RTO.

## Evidence levels

| Level | Meaning |
| --- | --- |
| IMPLEMENTED | Code exists in the repository. |
| REPOSITORY_TESTED | Automated repository tests exercise the stated boundary. |
| INTEGRATION_READY | Adapter/contract exists, but a real external system is not certified or activated. |
| SIMULATION_ONLY | Synthetic/demo operation only; not authoritative clinical production input. |
| EXTERNAL_VALIDATION_REQUIRED | Requires hospital, vendor, regulator, security assessor, or production infrastructure evidence outside this repository. |

## Production blockers that code alone cannot retire

A hospital production deployment still requires institution-specific work, including:

- approved cloud/security/legal agreements for the deployment jurisdiction;
- production identity, network, key-management, logging/SIEM, alerting and incident-response configuration;
- independent penetration testing and remediation;
- real backup scheduling, retention policy and timed restore exercises;
- clinical workflow validation and hospital governance approval;
- real LIS/PACS/device/clearinghouse conformance testing where those integrations are enabled;
- operational training, downtime procedures and deployment-specific rollback criteria.

## Integration status

| Area | Repository status | Production boundary |
| --- | --- | --- |
| Core auth / tenant command boundary | IMPLEMENTED + REPOSITORY_TESTED | Production IAM and institutional access policy still required |
| Offline replay | IMPLEMENTED + REPOSITORY_TESTED | Field testing under real outages/power loss required |
| Clinical AI | IMPLEMENTED as review-only draft workflow | Clinical governance, provider/data-processing approval and monitored deployment required |
| HL7 | INTEGRATION_READY | Real interface-engine connectivity, sender allowlist and conformance testing required |
| FHIR R4 | INTEGRATION_READY | Real server authentication/profile testing required |
| DICOMweb | INTEGRATION_READY / explicit simulation available | PACS/VNA connectivity and DICOM conformance required |
| Device telemetry | SIMULATION_ONLY for authoritative clinical use | Physical device identity, transport, calibration, durable dedupe and clinical validation required |
| X12 EDI | STRUCTURAL_ONLY | Payer companion-guide and clearinghouse certification required |
| Backup / DR | PROCEDURE + TOOLING IMPLEMENTED | Scheduled backups, retention and timed restore evidence required |
| Observability | STRUCTURED EVENTS + CONTRACT IMPLEMENTED | External dashboards, SIEM/pager and deployment thresholds must be provisioned |

## Release decision

No repository document may independently declare G-HIMS “approved,” “certified,” “HIPAA compliant,” “production verified,” or “pilot safe.” Those decisions require deployment-specific evidence and accountable institutional approval.
