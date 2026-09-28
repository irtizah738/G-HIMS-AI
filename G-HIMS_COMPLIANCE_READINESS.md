# G-HIMS — Regulatory & Compliance Readiness Boundary

This document records **architectural support and missing evidence**. It does not certify legal or regulatory compliance.

| Framework / topic | Repository capability | Formal status |
| --- | --- | --- |
| HIPAA Security / Privacy | Tenant isolation, server authorization, audit records, access controls | NOT CERTIFIED; institutional legal/security review required |
| HITECH audit controls | Server-owned durable audit events and access records | NOT CERTIFIED; retention/SIEM/institutional policy evidence required |
| ISO 27001 | Security architecture and operational controls exist | NOT CERTIFIED; ISMS and accredited audit required |
| 21 CFR Part 11 | Some signed/audited workflow primitives exist | NOT VALIDATED; formal CSV/IQ/OQ/PQ required if applicable |
| GDPR / local privacy law | Data-isolation/security primitives exist | NOT CERTIFIED; controller/processor, lawful-basis, residency and DSR processes require institutional validation |
| Medical-device regulation | Device telemetry production path is intentionally blocked | NOT CERTIFIED / NOT VALIDATED |

## Claims this repository does not make

The repository does not independently prove:
- negotiated TLS protocol versions or cloud-provider encryption-at-rest implementation;
- execution of a Business Associate Agreement or equivalent contract;
- successful penetration testing by an independent assessor;
- achieved uptime, RPO or RTO;
- production clinical safety validation;
- IRB or hospital pilot approval;
- medical-device, PACS, payer or clearinghouse certification.

Those facts must come from the actual deployment provider, contracts, test reports, institutional approvals, and measured operational evidence.

## Minimum external evidence before production declaration

1. Target institution security/privacy review.
2. Required cloud/vendor agreements.
3. Independent penetration/security test and remediation evidence.
4. Successful isolated restore drill with measured recovery point and elapsed restore duration.
5. Alerting/incident-response ownership and contact paths.
6. Integration-specific validation for every integration placed in `LIVE` state.
7. Clinical governance/validation appropriate to the deployed scope.

See `G-HIMS_PRODUCTION_EVIDENCE_BOUNDARY.md`, `G-HIMS_PRODUCTION_DEPLOYMENT_RUNBOOK.md`, and `G-HIMS_DISASTER_RECOVERY_RUNBOOK.md`.
